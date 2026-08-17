-- ======================================================================
-- migracion-12-franjas-y-zona-horaria.sql
--
-- Cierra dos huecos de negocio que la interfaz ocultaba pero la API no:
--   1) disponibilidad_dia/mapa construían la hora local como hora de la sesión
--      de PostgreSQL, no como hora de la organización;
--   2) crear_reserva aceptaba cualquier rango de 30 min a 24 h, incluso
--      fuera de horario, aunque V1 vende franjas de 1 h entre 08:00 y 19:00.
--
-- Resultado: navegador, RPC y calendario usan la MISMA regla en la zona
-- horaria de la organización. Falta de horario = cerrado (fail closed).
-- Idempotente.
-- ======================================================================

begin;

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

  -- V1 no vende bloques que crucen medianoche.
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

create or replace function public.validar_ventana_reserva(
  p_espacio public.espacios, p_inicio timestamptz, p_fin timestamptz, p_asistentes int
) returns void language plpgsql stable set search_path = public as $$
declare v_horas numeric; v_pendientes int;
begin
  if p_inicio is null or p_fin is null then
    raise exception 'Faltan la fecha de inicio o la de fin';
  end if;
  if p_fin <= p_inicio then
    raise exception 'La hora de fin tiene que ser posterior a la de inicio';
  end if;
  if p_inicio < now() - interval '15 minutes' then
    raise exception 'No se puede reservar en el pasado';
  end if;
  if p_inicio > now() + interval '90 days' then
    raise exception 'Sólo se puede reservar con 90 días de anticipación';
  end if;

  v_horas := extract(epoch from (p_fin - p_inicio)) / 3600.0;
  if v_horas > 24 then
    raise exception 'Una reserva no puede durar más de 24 horas seguidas';
  end if;
  if v_horas < 0.5 then
    raise exception 'La reserva mínima es de media hora';
  end if;

  if not public.franja_reservable_v1(p_espacio.id, p_inicio, p_fin) then
    raise exception 'Ese horario no pertenece a una franja reservable o el espacio está cerrado ese día';
  end if;

  if p_asistentes is not null
     and (p_asistentes < 1 or p_asistentes > coalesce(p_espacio.capacidad, 1)) then
    raise exception 'El espacio admite hasta % personas', coalesce(p_espacio.capacidad, 1);
  end if;

  select count(*) into v_pendientes
    from public.reservas r
   where r.usuario_id = auth.uid()
     and r.estado = 'pendiente'
     and r.fin > now();
  if v_pendientes >= 10 then
    raise exception 'Tienes demasiadas reservas pendientes de pago. Págalas o cancélalas antes de crear otra.';
  end if;
end $$;

revoke execute on function public.validar_ventana_reserva(public.espacios, timestamptz, timestamptz, int)
  from public, anon, authenticated;

-- La consulta pública también falla cerrada fuera de horario y conserva
-- la excepción de apartados pendientes ya vencidos.
create or replace function public.esta_disponible(
  p_espacio uuid, p_inicio timestamptz, p_fin timestamptz, p_excluir_reserva uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select public.franja_reservable_v1(p_espacio, p_inicio, p_fin)
     and not exists (
       select 1 from public.reservas r
        where r.espacio_id = p_espacio
          and r.estado in ('pendiente','confirmada','en_curso')
          and (p_excluir_reserva is null or r.id <> p_excluir_reserva)
          and not (r.estado = 'pendiente' and r.expira_en is not null and r.expira_en < now())
          and r.periodo && tstzrange(p_inicio, p_fin, '[)')
     )
     and not exists (
       select 1 from public.bloqueos b
        where (b.espacio_id = p_espacio
               or b.edificio_id = (select edificio_id from public.espacios where id = p_espacio))
          and tstzrange(b.inicio, b.fin) && tstzrange(p_inicio, p_fin, '[)')
     );
$$;

-- Construye cada hora en la zona del negocio, no en la zona de la
-- conexión SQL (que normalmente es UTC en la nube).
create or replace function public.disponibilidad_dia(
  p_espacio uuid, p_fecha date,
  p_bloques text[] default array['08:00-09:00','09:00-10:00','10:00-11:00','11:00-12:00','12:00-13:00','13:00-14:00','14:00-15:00','15:00-16:00','16:00-17:00','17:00-18:00','18:00-19:00']
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
      libre := fin > now() and public.esta_disponible(p_espacio, ini, fin);
    exception when others then
      libre := false;
    end;
    return next;
  end loop;
end $$;

create or replace function public.disponibilidad_mapa(
  p_organizacion uuid, p_fecha date
) returns table (espacio_id uuid, libres int, total int)
language sql stable set search_path = public as $$
  with cfg as (
    select zona_horaria from public.organizaciones where id = p_organizacion
  ),
  bloques as (
    select unnest(array['08:00-09:00','09:00-10:00','10:00-11:00','11:00-12:00','12:00-13:00','13:00-14:00','14:00-15:00','15:00-16:00','16:00-17:00','17:00-18:00','18:00-19:00']) as b
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
