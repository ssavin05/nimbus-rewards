-- ======================================================================
-- migracion-14-horario-8-a-19-y-mapa-semaforo.sql
--
-- Regla comercial Smart Hub:
--   • abierto TODOS los días;
--   • 08:00 a 19:00, America/Tijuana;
--   • 11 bloques reservables de 1 hora;
--   • el mapa resume verde / ámbar / rojo con esos mismos bloques.
--
-- Idempotente. Diseñada para una base que ya tenga migraciones 01–13.
-- ======================================================================

begin;

-- 1) Horario autoritativo de la organización Smart Hub.
-- Actualiza tanto reglas generales de edificio como excepciones por
-- espacio para que ninguna excepción vieja (por ejemplo domingo cerrado)
-- gane prioridad sobre el nuevo horario.
update public.horarios_operacion h
   set abre = '08:00'::time,
       cierra = '19:00'::time,
       cerrado = false
 where h.organizacion_id = (
   select id from public.organizaciones where slug = 'smart-hub' limit 1
 );

-- Si falta algún día general de algún edificio, créalo.
insert into public.horarios_operacion
  (organizacion_id, edificio_id, espacio_id, dia_semana, abre, cierra, cerrado)
select e.organizacion_id, e.id, null, d, '08:00'::time, '19:00'::time, false
  from public.edificios e
  join public.organizaciones o on o.id = e.organizacion_id and o.slug = 'smart-hub'
 cross join generate_series(0, 6) as d
 where not exists (
   select 1 from public.horarios_operacion h
    where h.organizacion_id = e.organizacion_id
      and h.edificio_id = e.id
      and h.espacio_id is null
      and h.dia_semana = d
 );

-- 2) Única definición de franja permitida.
create or replace function public.franja_reservable_v1(
  p_espacio uuid, p_inicio timestamptz, p_fin timestamptz
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_zona text;
  v_edificio uuid;
  v_ini_local timestamp;
  v_fin_local timestamp;
  v_dia int;
  v_bloque text;
  v_hor public.horarios_operacion;
begin
  if p_espacio is null or p_inicio is null or p_fin is null or p_fin <= p_inicio then
    return false;
  end if;

  select o.zona_horaria, e.edificio_id
    into v_zona, v_edificio
    from public.espacios e
    join public.organizaciones o on o.id = e.organizacion_id
   where e.id = p_espacio;
  if not found then return false; end if;

  v_ini_local := p_inicio at time zone v_zona;
  v_fin_local := p_fin at time zone v_zona;
  if v_ini_local::date <> v_fin_local::date then return false; end if;

  v_bloque := to_char(v_ini_local, 'HH24:MI') || '-' || to_char(v_fin_local, 'HH24:MI');
  if not (v_bloque = any(array[
    '08:00-09:00','09:00-10:00','10:00-11:00','11:00-12:00',
    '12:00-13:00','13:00-14:00','14:00-15:00','15:00-16:00',
    '16:00-17:00','17:00-18:00','18:00-19:00'
  ]::text[])) then
    return false;
  end if;

  v_dia := extract(dow from v_ini_local)::int;
  select h.* into v_hor
    from public.horarios_operacion h
   where h.dia_semana = v_dia
     and (h.espacio_id = p_espacio
          or (h.espacio_id is null and h.edificio_id = v_edificio))
   order by (h.espacio_id is not null) desc, h.creado_en desc
   limit 1;

  if not found or v_hor.cerrado then return false; end if;
  return v_ini_local::time >= v_hor.abre
     and v_fin_local::time <= v_hor.cierra;
end $$;

revoke all on function public.franja_reservable_v1(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.franja_reservable_v1(uuid, timestamptz, timestamptz)
  to service_role;

-- 3) Disponibilidad diaria con la misma rejilla que el navegador.
create or replace function public.disponibilidad_dia(
  p_espacio uuid, p_fecha date,
  p_bloques text[] default array[
    '08:00-09:00','09:00-10:00','10:00-11:00','11:00-12:00',
    '12:00-13:00','13:00-14:00','14:00-15:00','15:00-16:00',
    '16:00-17:00','17:00-18:00','18:00-19:00'
  ]
) returns table (bloque text, libre boolean)
language plpgsql stable set search_path = public as $$
declare
  b text;
  ini timestamptz;
  fin timestamptz;
  v_zona text;
begin
  select o.zona_horaria into v_zona
    from public.espacios e
    join public.organizaciones o on o.id = e.organizacion_id
   where e.id = p_espacio;
  if not found then return; end if;

  foreach b in array p_bloques loop
    bloque := b;
    begin
      ini := (p_fecha + split_part(b, '-', 1)::time) at time zone v_zona;
      fin := (p_fecha + split_part(b, '-', 2)::time) at time zone v_zona;
      -- Un bloque que ya terminó no se anuncia como libre.
      libre := fin > now() and public.esta_disponible(p_espacio, ini, fin);
    exception when others then
      libre := false;
    end;
    return next;
  end loop;
end $$;

-- 4) Semáforo de mapa. `total` cuenta sólo bloques que aún no terminaron:
-- verde significa que TODO lo que todavía puede reservarse hoy está libre.
create or replace function public.disponibilidad_mapa(
  p_organizacion uuid, p_fecha date
) returns table (espacio_id uuid, libres int, total int)
language sql stable set search_path = public as $$
  with cfg as (
    select zona_horaria from public.organizaciones where id = p_organizacion
  ),
  bloques as (
    select unnest(array[
      '08:00-09:00','09:00-10:00','10:00-11:00','11:00-12:00',
      '12:00-13:00','13:00-14:00','14:00-15:00','15:00-16:00',
      '16:00-17:00','17:00-18:00','18:00-19:00'
    ]) as b
  ),
  reservables as (
    select id from public.espacios
     where organizacion_id = p_organizacion and reservable and activo and estado = 'disponible'
  )
  select e.id,
         count(*) filter (
           where ((p_fecha + split_part(bl.b,'-',2)::time) at time zone cfg.zona_horaria) > now()
             and public.esta_disponible(
               e.id,
               (p_fecha + split_part(bl.b,'-',1)::time) at time zone cfg.zona_horaria,
               (p_fecha + split_part(bl.b,'-',2)::time) at time zone cfg.zona_horaria
             )
         )::int as libres,
         count(*) filter (
           where ((p_fecha + split_part(bl.b,'-',2)::time) at time zone cfg.zona_horaria) > now()
         )::int as total
    from reservables e cross join bloques bl cross join cfg
   group by e.id;
$$;

commit;
