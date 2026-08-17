-- ======================================================================
-- migracion-04-turno-por-franja.sql
--
-- Aplícala en cualquier base ya desplegada. Si instalas de cero,
-- seguridad.sql ya trae el cambio y no hace falta ejecutarla.
--
-- INCLUYE la migración 03 (comprobación de espacio cerrado en el INSERT
-- directo): las dos tocan las mismas funciones, así que si aún no has
-- aplicado la 03, con ésta te vale.
--
-- Qué arregla
-- -----------
-- Cuando dos personas reservaban el mismo hueco en el mismo instante, la
-- base hacía lo correcto —sólo entraba una reserva— pero por el camino
-- feo: cada transacción insertaba su entrada en el índice de la
-- restricción de exclusión `reservas_sin_solape`, veía la de la otra y
-- se quedaba esperándola. Las dos esperándose es un ciclo, y PostgreSQL
-- lo rompe matando una con «deadlock detected».
--
-- Consecuencias de dejarlo así:
--   · la persona que pierde ve un error de motor, no «ese horario ya
--     está ocupado»;
--   · 40P01 es un error oficialmente reintentable, y el cliente no lo
--     sabe: o reintenta a ciegas o da por perdida una reserva que sí
--     podría hacer en otra franja;
--   · cuál de las dos muere lo decide el motor, no la regla de negocio.
--
-- Arreglo: un lock de aviso por (espacio, hora de inicio) tomado ANTES
-- de comprobar disponibilidad. Con eso los contendientes pasan de uno en
-- uno; la segunda encuentra el hueco ya tomado y sale con el error de
-- negocio de siempre. Es `pg_advisory_xact_lock`, de transacción: se
-- suelta solo al confirmar o deshacer, no hay nada que liberar a mano ni
-- riesgo de dejar un lock colgado.
--
-- La restricción de exclusión SE QUEDA: es la garantía de verdad. El
-- lock sólo ordena la cola para que el error sea el correcto. Si algún
-- día una escritura entra por otra vía, la restricción sigue ahí.
--
-- Se puede ejecutar varias veces sin problema.
-- ======================================================================

begin;

create or replace function public.guardia_reserva_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_espacio public.espacios; v_horas numeric; v_tasa numeric;
begin
  if public.escritura_confiable() or public.es_staff(new.organizacion_id) then
    return new;
  end if;

  new.usuario_id := auth.uid();
  -- copiar_datos_cliente() ya corrió con el usuario_id que mandó el
  -- navegador: se rehace la copia desde la sesión real.
  select u.nombre, u.email into new.cliente_nombre, new.cliente_email
    from public.usuarios u where u.id = auth.uid();
  new.estado     := 'pendiente';
  new.origen     := coalesce(nullif(new.origen, ''), 'web');
  new.promocion_id := null;              -- las promos sólo por crear_reserva
  new.descuento    := 0;
  new.monto_reembolso := 0;
  new.cancelada_en := null;
  new.cancelada_por := null;

  select * into v_espacio from public.espacios where id = new.espacio_id;
  if not found then raise exception 'El espacio no existe'; end if;
  -- Esta comprobación sólo estaba en crear_reserva(). El INSERT directo
  -- por PostgREST se la saltaba entera: cualquiera con sesión podía
  -- mandar un POST a /rest/v1/reservas con el id de un espacio que no se
  -- renta —la Oficina Principal, la Sala de Juntas, un espacio en
  -- mantenimiento o uno marcado «próximamente»— y quedaba reservado. Que
  -- la interfaz no ofrezca el botón no es una defensa: la API es pública.
  if not v_espacio.activo or not v_espacio.reservable or v_espacio.estado <> 'disponible' then
    raise exception 'Este espacio no está disponible para reservar';
  end if;
  new.organizacion_id := v_espacio.organizacion_id;

  perform public.validar_ventana_reserva(v_espacio, new.inicio, new.fin, new.asistentes);
  -- Mismo turno que en crear_reserva(): el INSERT directo por PostgREST
  -- compite por el mismo hueco y se merecía el mismo trato.
  perform pg_advisory_xact_lock(hashtext(new.espacio_id::text), hashtext(new.inicio::text));

  v_horas := extract(epoch from (new.fin - new.inicio)) / 3600.0;
  select tasa_impuesto into v_tasa from public.organizaciones where id = v_espacio.organizacion_id;
  new.subtotal  := round(v_espacio.precio_hora * v_horas, 2);
  new.impuestos := round(new.subtotal * coalesce(v_tasa, 0.16), 2);
  new.total     := new.subtotal + new.impuestos;
  return new;
end $$;

create or replace function public.crear_reserva(
  p_espacio uuid, p_inicio timestamptz, p_fin timestamptz,
  p_asistentes int default 1, p_notas text default null,
  p_promocion text default null, p_origen text default 'web'
) returns public.reservas
language plpgsql security definer set search_path = public as $$
declare
  v_espacio public.espacios;
  v_promo   public.promociones;
  v_horas   numeric;
  v_sub     numeric;
  v_desc    numeric := 0;
  v_imp     numeric;
  v_tasa    numeric;
  v_usos    int;
  v_reserva public.reservas;
begin
  if auth.uid() is null then raise exception 'Se requiere sesión'; end if;
  perform set_config('app.rpc_confiable', '1', true);

  select * into v_espacio from public.espacios where id = p_espacio;
  if not found then raise exception 'El espacio no existe'; end if;
  if not v_espacio.activo or not v_espacio.reservable or v_espacio.estado <> 'disponible' then
    raise exception 'Este espacio no está disponible para reservar';
  end if;

  perform public.validar_ventana_reserva(v_espacio, p_inicio, p_fin, p_asistentes);

  -- Turno para este espacio y esta franja.
  --
  -- La restricción de exclusión `reservas_sin_solape` ya garantiza que
  -- no haya dos reservas encima; el problema es CÓMO falla la segunda.
  -- Si dos personas reservan el mismo hueco a la vez, cada transacción
  -- inserta su entrada en el índice, ve la de la otra y se queda
  -- esperándola: se esperan mutuamente y PostgreSQL rompe el ciclo con
  -- «deadlock detected». Sale una reserva —eso siempre estuvo bien—
  -- pero la persona que pierde recibe un error de motor incomprensible
  -- en vez de «ese horario ya está ocupado».
  --
  -- Con este lock sólo entra una cada vez, así que la segunda llega
  -- cuando la primera ya terminó, `esta_disponible` le dice que no y se
  -- va con el mensaje correcto. Es de transacción: se suelta solo al
  -- confirmar o al deshacer, no hay nada que liberar a mano.
  perform pg_advisory_xact_lock(hashtext(p_espacio::text), hashtext(p_inicio::text));

  if not public.esta_disponible(p_espacio, p_inicio, p_fin) then
    raise exception 'conflicto_horario: ese horario ya está ocupado';
  end if;

  v_horas := extract(epoch from (p_fin - p_inicio)) / 3600.0;
  v_sub   := round(v_espacio.precio_hora * v_horas, 2);

  if p_promocion is not null then
    select * into v_promo from public.promociones
     where organizacion_id = v_espacio.organizacion_id
       and upper(codigo) = upper(p_promocion)
       and activa and inicia <= now()
       and (termina is null or termina >= now())
       and (usos_maximos is null or usos_actuales < usos_maximos)
       and (cardinality(espacios) = 0 or p_espacio = any(espacios))
     for update;                      -- cierra la carrera sobre usos_actuales

    if found then
      -- Antes no se miraba `usos_por_usuario`: el mismo código de
      -- descuento se podía canjear una y otra vez sin límite.
      select count(*) into v_usos from public.promocion_usos
       where promocion_id = v_promo.id and usuario_id = auth.uid();
      if v_usos >= greatest(v_promo.usos_por_usuario, 1) then
        raise exception 'Ya usaste ese código de descuento';
      end if;
      if v_sub >= v_promo.minimo_compra then
        v_desc := case v_promo.tipo
                    when 'porcentaje'   then round(v_sub * v_promo.valor / 100.0, 2)
                    when 'monto'        then least(v_promo.valor, v_sub)
                    when 'horas_gratis' then round(least(v_promo.valor, v_horas) * v_espacio.precio_hora, 2)
                  end;
        v_desc := least(greatest(v_desc, 0), v_sub);
      end if;
    else
      raise exception 'Ese código de descuento no es válido';
    end if;
  end if;

  select tasa_impuesto into v_tasa from public.organizaciones where id = v_espacio.organizacion_id;
  v_imp := round((v_sub - v_desc) * coalesce(v_tasa, 0.16), 2);

  insert into public.reservas (
    organizacion_id, espacio_id, usuario_id, inicio, fin, estado,
    asistentes, notas, subtotal, descuento, impuestos, total,
    moneda, promocion_id, origen
  ) values (
    v_espacio.organizacion_id, p_espacio, auth.uid(), p_inicio, p_fin, 'pendiente',
    greatest(coalesce(p_asistentes, 1), 1), nullif(left(coalesce(p_notas, ''), 1000), ''),
    v_sub, v_desc, v_imp, v_sub - v_desc + v_imp,
    (select moneda from public.organizaciones where id = v_espacio.organizacion_id),
    v_promo.id,
    case when p_origen in ('web','ios','android','admin','ia') then p_origen else 'web' end
  ) returning * into v_reserva;

  if v_promo.id is not null and v_desc > 0 then
    insert into public.promocion_usos (promocion_id, usuario_id, reserva_id, descuento)
    values (v_promo.id, auth.uid(), v_reserva.id, v_desc);
    update public.promociones set usos_actuales = usos_actuales + 1 where id = v_promo.id;
  end if;

  perform set_config('app.rpc_confiable', '0', true);
  return v_reserva;
end $$;
drop trigger if exists trg_guardia_reserva_insert on public.reservas;
create trigger trg_guardia_reserva_insert before insert on public.reservas
  for each row execute function public.guardia_reserva_insert();

commit;
