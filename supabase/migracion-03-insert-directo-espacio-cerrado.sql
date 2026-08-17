-- ======================================================================
-- migracion-03-insert-directo-espacio-cerrado.sql
--
-- SEGURIDAD. Aplícala en cualquier base ya desplegada. Si instalas de
-- cero, seguridad.sql ya trae el arreglo y no hace falta ejecutarla.
--
-- Qué agujero cierra
-- ------------------
-- `crear_reserva()` comprobaba que el espacio estuviera activo, fuera
-- reservable y estuviera 'disponible'. El trigger que vigila los INSERT
-- directos, `guardia_reserva_insert()`, NO lo comprobaba.
--
-- Como PostgREST expone la tabla `reservas`, cualquier persona con
-- sesión iniciada podía saltarse la RPC y mandar:
--
--     POST /rest/v1/reservas
--     { "espacio_id": "<id de la Oficina Principal>", ... }
--
-- y quedaba reservado un espacio que no se renta. Lo mismo servía para
-- un espacio en mantenimiento, uno marcado 'proximamente' o uno
-- desactivado. Que la interfaz no pinte el botón «Reservar» no defiende
-- nada: la API es pública y responde igual.
--
-- Amenaza real: reservas —y cobros— sobre espacios que no están a la
-- venta, huecos bloqueados en el calendario de espacios que la
-- administración creía cerrados, y una Oficina Principal ocupada por
-- alguien que sólo tuvo que cambiar un id en la petición.
--
-- Dependencias: ninguna policy depende de esta función; sólo el trigger
-- trg_guardia_reserva_insert, que se mantiene igual. Las escrituras de
-- servicio (Edge Functions con service_role) y las de la propia RPC
-- siguen entrando por la puerta de `escritura_confiable()`, intactas.
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
  -- ⬇️ Lo que faltaba: la misma puerta que ya tenía crear_reserva().
  if not v_espacio.activo or not v_espacio.reservable or v_espacio.estado <> 'disponible' then
    raise exception 'Este espacio no está disponible para reservar';
  end if;
  new.organizacion_id := v_espacio.organizacion_id;

  perform public.validar_ventana_reserva(v_espacio, new.inicio, new.fin, new.asistentes);

  v_horas := extract(epoch from (new.fin - new.inicio)) / 3600.0;
  select tasa_impuesto into v_tasa from public.organizaciones where id = v_espacio.organizacion_id;
  new.subtotal  := round(v_espacio.precio_hora * v_horas, 2);
  new.impuestos := round(new.subtotal * coalesce(v_tasa, 0.16), 2);
  new.total     := new.subtotal + new.impuestos;
  return new;
end $$;

-- El trigger ya existe; se recrea por si la base viene de una versión
-- que no lo tenía.
drop trigger if exists trg_guardia_reserva_insert on public.reservas;
create trigger trg_guardia_reserva_insert before insert on public.reservas
  for each row execute function public.guardia_reserva_insert();

commit;

-- ----------------------------------------------------------------------
-- Comprobación después de aplicar: esto tiene que dar 0 filas. Si sale
-- alguna, son reservas que entraron por el agujero y hay que revisarlas
-- a mano (avisar a esas personas, reembolsar y cancelar).
--
--   select r.id, r.folio, r.inicio, e.codigo, e.nombre, e.reservable, e.estado
--     from public.reservas r
--     join public.espacios e on e.id = r.espacio_id
--    where (not e.reservable or not e.activo or e.estado <> 'disponible')
--      and r.estado in ('pendiente','confirmada','en_curso');
-- ----------------------------------------------------------------------
