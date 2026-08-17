-- ======================================================================
--  CADUCIDAD DE RESERVAS PENDIENTES DE PAGO
--
--  El problema: `reservas_sin_solape` considera ocupado el horario de
--  una reserva en estado `pendiente`. Eso está bien mientras la persona
--  paga... pero si cierra el navegador y no vuelve, ese hueco se queda
--  bloqueado para siempre.
--
--      13:00  crea la reserva  →  pendiente
--      13:01  cierra el navegador
--      nunca  paga
--      ————————————————————————————————
--      el horario sigue ocupado en marzo del año que viene
--
--  La solución es un apartado con fecha de caducidad: si no se paga en
--  15 minutos, la reserva se cancela sola y el horario vuelve al
--  catálogo.
--
--  Aplicar DESPUÉS de restricciones.sql.
-- ======================================================================

-- ----------------------------------------------------------------------
-- 1. Hasta cuándo aguanta el apartado
-- ----------------------------------------------------------------------
alter table public.reservas
  add column if not exists expira_en timestamptz;

comment on column public.reservas.expira_en is
  'Sólo para reservas pendientes de pago: cuándo se libera el horario si nadie paga.';

create index if not exists idx_reservas_por_expirar
  on public.reservas (expira_en)
  where estado = 'pendiente' and expira_en is not null;

-- Minutos de apartado. Se guarda en la organización para poder ajustarlo
-- sin tocar código: un coworking de paso querrá 10 minutos y una sala de
-- juntas corporativa quizá 30.
alter table public.organizaciones
  add column if not exists minutos_apartado int not null default 15;

do $$ begin
  perform 1 from pg_constraint where conname = 'org_apartado_razonable';
  if not found then
    alter table public.organizaciones add constraint org_apartado_razonable
      check (minutos_apartado between 5 and 120);
  end if;
end $$;

-- ----------------------------------------------------------------------
-- 2. Ponerle caducidad a toda reserva pendiente nueva
-- ----------------------------------------------------------------------
create or replace function public.marcar_caducidad_reserva()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_minutos int;
begin
  if new.estado = 'pendiente' then
    -- Sólo si aún no la trae puesta (crear_reserva puede fijarla).
    if new.expira_en is null then
      select coalesce(minutos_apartado, 15) into v_minutos
        from public.organizaciones where id = new.organizacion_id;
      new.expira_en := now() + make_interval(mins => coalesce(v_minutos, 15));
    end if;
  else
    -- En cuanto deja de estar pendiente, la caducidad sobra: una reserva
    -- confirmada no se cae sola.
    new.expira_en := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_caducidad_reserva on public.reservas;
create trigger trg_caducidad_reserva
  before insert or update of estado on public.reservas
  for each row execute function public.marcar_caducidad_reserva();

-- ----------------------------------------------------------------------
-- 3. Cancelar las que se pasaron de tiempo
--
--    No borra: cancela. Así queda el rastro de que se intentó y de por
--    qué se soltó el hueco.
-- ----------------------------------------------------------------------
create or replace function public.expirar_reservas_pendientes()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform set_config('app.rpc_confiable', '1', true);

  with vencidas as (
    select r.id from public.reservas r
     where r.estado = 'pendiente'
       and r.expira_en is not null
       and r.expira_en < now()
       -- Si tiene un pago aprobado, algo va mal: no se toca y que lo
       -- mire una persona. Antes muerta que cancelar algo ya cobrado.
       and not exists (
         select 1 from public.pagos p
          where p.reserva_id = r.id and p.estado in ('aprobado','procesando')
       )
     for update skip locked
  )
  update public.reservas r
     set estado = 'cancelada',
         cancelada_en = now(),
         motivo_cancelacion = 'Apartado vencido: no se completó el pago a tiempo',
         monto_reembolso = 0,
         expira_en = null
    from vencidas v
   where r.id = v.id;

  get diagnostics v_n = row_count;
  perform set_config('app.rpc_confiable', '0', true);
  return v_n;
end $$;

revoke all on function public.expirar_reservas_pendientes() from public, anon, authenticated;
grant execute on function public.expirar_reservas_pendientes() to service_role;

-- ----------------------------------------------------------------------
-- 4. Que se ejecute sola
--
--    Con pg_cron, cada minuto. Si la extensión no está disponible en el
--    plan, queda el aviso y hay que llamarla desde una función
--    programada (Supabase Scheduled Functions) o desde el propio
--    servidor antes de comprobar disponibilidad.
-- ----------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule('expirar-reservas')
      where exists (select 1 from cron.job where jobname = 'expirar-reservas');
    perform cron.schedule('expirar-reservas', '* * * * *',
                          'select public.expirar_reservas_pendientes()');
    raise notice 'pg_cron programado: expirar-reservas cada minuto.';
  else
    raise warning 'pg_cron no disponible: hay que llamar a expirar_reservas_pendientes() '
                  'desde una función programada, o el horario apartado no se liberará solo.';
  end if;
exception when others then
  raise warning 'no se pudo programar pg_cron (%). Queda pendiente de programar a mano.', sqlerrm;
end $$;

-- ----------------------------------------------------------------------
-- 5. Red de seguridad: limpiar antes de comprobar disponibilidad
--
--    Aunque el cron fallara, nadie debería ver ocupado un hueco cuyo
--    apartado ya venció. `esta_disponible` pasa a ignorar las reservas
--    pendientes caducadas.
-- ----------------------------------------------------------------------
create or replace function public.esta_disponible(
  p_espacio uuid, p_inicio timestamptz, p_fin timestamptz, p_excluir_reserva uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select public.franja_reservable_v1(p_espacio, p_inicio, p_fin)
     and not exists (
    select 1 from public.reservas r
     where r.espacio_id = p_espacio
       and r.estado in ('pendiente','confirmada','en_curso')
       and (p_excluir_reserva is null or r.id <> p_excluir_reserva)
       -- Un apartado vencido ya no ocupa, aunque el cron no haya pasado.
       and not (r.estado = 'pendiente' and r.expira_en is not null and r.expira_en < now())
       and r.periodo && tstzrange(p_inicio, p_fin, '[)')
  ) and not exists (
    select 1 from public.bloqueos b
     where (b.espacio_id = p_espacio
            or b.edificio_id = (select edificio_id from public.espacios where id = p_espacio))
       and tstzrange(b.inicio, b.fin) && tstzrange(p_inicio, p_fin, '[)')
  );
$$;

-- ----------------------------------------------------------------------
-- 6. Reanudar el pago de una reserva propia
--
--    Para que recargar la página durante el pago no obligue a crear otra
--    reserva (y chocar con la primera). Devuelve la reserva si es tuya,
--    sigue pendiente y no ha vencido — y de paso le renueva el apartado.
-- ----------------------------------------------------------------------
create or replace function public.reanudar_reserva(p_reserva uuid)
returns public.reservas
language plpgsql security definer set search_path = public as $$
declare v public.reservas; v_minutos int;
begin
  if auth.uid() is null then raise exception 'Se requiere sesión'; end if;
  perform set_config('app.rpc_confiable', '1', true);

  select * into v from public.reservas where id = p_reserva for update;
  if not found then raise exception 'La reserva no existe'; end if;
  if v.usuario_id is distinct from auth.uid() then
    raise exception 'Esa reserva no es tuya' using errcode = '42501';
  end if;
  if v.estado <> 'pendiente' then
    -- Ya está confirmada o cancelada: se devuelve tal cual para que la
    -- pantalla sepa qué enseñar, sin tocar nada.
    perform set_config('app.rpc_confiable', '0', true);
    return v;
  end if;
  if v.expira_en is not null and v.expira_en < now() then
    raise exception 'El apartado venció. Vuelve a elegir el horario.';
  end if;

  select coalesce(minutos_apartado, 15) into v_minutos
    from public.organizaciones where id = v.organizacion_id;

  update public.reservas
     set expira_en = now() + make_interval(mins => coalesce(v_minutos, 15))
   where id = p_reserva
  returning * into v;

  perform set_config('app.rpc_confiable', '0', true);
  return v;
end $$;

revoke all on function public.reanudar_reserva(uuid) from public, anon;
grant execute on function public.reanudar_reserva(uuid) to authenticated, service_role;

do $$
declare v_pendientes int;
begin
  select count(*) into v_pendientes from public.reservas
   where estado = 'pendiente' and expira_en is null;
  if v_pendientes > 0 then
    raise notice 'Hay % reservas pendientes sin caducidad (de antes de este cambio).', v_pendientes;
    raise notice 'Se les pone una hora de margen desde ahora.';
  end if;
end $$;

update public.reservas
   set expira_en = now() + interval '1 hour'
 where estado = 'pendiente' and expira_en is null;

-- ----------------------------------------------------------------------
-- 7. La restricción de exclusión no sabe de caducidades
--
--    `esta_disponible()` ignora los apartados vencidos, pero
--    `reservas_sin_solape` no: para PostgreSQL la fila `pendiente`
--    sigue ahí hasta que alguien la cancele. Eso deja un hueco feo:
--
--        esta_disponible()  →  libre        (el apartado venció)
--        INSERT             →  23P01        (la fila sigue existiendo)
--
--    La pantalla ofrece el horario y al reservar rebota. Si el cron no
--    corre, pasa siempre.
--
--    Se arregla soltando los apartados vencidos DE ESE ESPACIO justo
--    antes de insertar. Va en un trigger y no dentro de crear_reserva()
--    para que valga también en los INSERT directos.
-- ----------------------------------------------------------------------
create or replace function public.liberar_apartados_vencidos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Sólo mira el espacio que se está reservando: es un índice parcial,
  -- así que sale barato aunque la tabla sea enorme.
  update public.reservas r
     set estado = 'cancelada',
         cancelada_en = now(),
         motivo_cancelacion = 'Apartado vencido: no se completó el pago a tiempo',
         monto_reembolso = 0,
         expira_en = null
   where r.espacio_id = new.espacio_id
     and r.estado = 'pendiente'
     and r.expira_en is not null
     and r.expira_en < now()
     and not exists (
       select 1 from public.pagos p
        where p.reserva_id = r.id and p.estado in ('aprobado','procesando')
     );
  return new;
end $$;

-- `aaa_` para que corra antes que los demás disparadores BEFORE de la
-- tabla: se ejecutan por orden alfabético.
drop trigger if exists trg_aaa_liberar_vencidos on public.reservas;
create trigger trg_aaa_liberar_vencidos
  before insert on public.reservas
  for each row execute function public.liberar_apartados_vencidos();
