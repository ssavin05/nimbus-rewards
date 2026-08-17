-- ======================================================================
-- seguridad.sql — Endurecimiento del servidor.
--
-- Este archivo es la respuesta a la auditoría documentada en
-- docs/SEGURIDAD.md. Se aplica DESPUÉS de schema.sql y policies.sql, y
-- se puede volver a correr las veces que haga falta (es idempotente).
--
--     psql "$DATABASE_URL" -f supabase/schema.sql
--     psql "$DATABASE_URL" -f supabase/policies.sql
--     psql "$DATABASE_URL" -f supabase/seguridad.sql
--
-- La idea de fondo: las políticas RLS deciden QUÉ FILAS puede tocar
-- cada quien, pero no QUÉ COLUMNAS. Sin esa segunda mitad, cualquiera
-- con la llave pública (que va en el JavaScript, a la vista de todos)
-- podía mandar un PATCH y confirmarse la reserva, ponerse el total en
-- cero o firmar una reseña como si fuera la administración. Aquí se
-- cierra columna por columna, con triggers que no dependen de que el
-- cliente se porte bien.
-- ======================================================================

-- ----------------------------------------------------------------------
-- 0. Sello de "vengo de una función de confianza"
--
-- Las RPC (crear_reserva, cancelar_reserva…) son SECURITY DEFINER pero
-- auth.uid() sigue siendo el de la persona, así que los triggers de
-- abajo también las frenarían. Cada RPC deja una marca local a la
-- transacción; ningún cliente puede ponerla porque PostgREST abre una
-- transacción por petición y no expone set_config(). Además cada RPC
-- la APAGA antes de devolver: aunque algo más corriera en la misma
-- transacción, ya no encontraría la puerta abierta.
-- ----------------------------------------------------------------------
create or replace function public.desde_rpc() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.rpc_confiable', true), '') = '1';
$$;

comment on function public.desde_rpc() is
  'true si la escritura viene de una RPC del propio servidor, no de un PATCH del cliente.';

-- ¿Quién hace la petición? PostgREST deja el rol en una variable de
-- sesión que SECURITY DEFINER no altera (current_user sí cambiaría).
-- Si no hay variable, venimos de psql/migración: rol de servidor.
create or replace function public.rol_peticion() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'postgres'
  );
$$;

-- Las Edge Functions (webhooks de pago, borrado de cuenta, facturación)
-- usan la llave de servicio. Esa llave NO la tiene el navegador: vive en
-- los secretos de Supabase. Sin esta puerta, los triggers de abajo
-- bloquearían los cobros y la anonimización de cuentas borradas.
create or replace function public.es_servicio() returns boolean
language sql stable as $$
  select public.rol_peticion() in ('service_role', 'postgres', 'supabase_admin');
$$;

-- Atajo: escritura de confianza (servidor o RPC propia).
create or replace function public.escritura_confiable() returns boolean
language sql stable as $$
  select public.es_servicio() or public.desde_rpc();
$$;

-- Convierte a uuid sin reventar la consulta si el texto no lo es.
create or replace function public.a_uuid(t text) returns uuid
language plpgsql immutable as $$
begin return t::uuid; exception when others then return null; end $$;


-- ======================================================================
-- 1. AISLAMIENTO ENTRE EMPRESAS (multiempresa)
--
-- Antes: es_staff('org-A') devolvía true para el staff de la org B,
-- porque la primera mitad de la consulta miraba `usuarios.rol` sin
-- filtrar por organización. Con eso, el administrador de una empresa
-- leía y editaba las reservas, los pagos y los usuarios de todas las
-- demás. Ahora el rol global necesita una organización a la que
-- pertenecer.
-- ======================================================================
alter table public.usuarios
  add column if not exists organizacion_id uuid references public.organizaciones(id) on delete set null;
create index if not exists idx_usuarios_org on public.usuarios(organizacion_id);

-- Relleno para instalaciones que ya existen.
update public.usuarios u
   set organizacion_id = ou.organizacion_id
  from public.organizacion_usuarios ou
 where ou.usuario_id = u.id
   and u.organizacion_id is null;

-- Instalación de una sola empresa: todo el mundo pertenece a ella.
update public.usuarios u
   set organizacion_id = (select o.id from public.organizaciones o limit 1)
 where u.organizacion_id is null
   and (select count(*) from public.organizaciones) = 1;

create or replace function public.es_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'superadmin'
  );
$$;

-- ¿Es staff (o más) de ESA organización? Sin argumento: de alguna.
create or replace function public.es_staff(p_org uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    -- El superadmin de la plataforma sí atraviesa todas las empresas.
    exists (select 1 from public.usuarios u
             where u.id = auth.uid() and u.rol = 'superadmin')
    -- Rol global, pero acotado a la organización de la persona.
    or exists (select 1 from public.usuarios u
                where u.id = auth.uid()
                  and u.rol in ('staff','admin')
                  and (p_org is null or u.organizacion_id = p_org))
    -- Membresía explícita en esa organización.
    or exists (select 1 from public.organizacion_usuarios ou
                where ou.usuario_id = auth.uid()
                  and (p_org is null or ou.organizacion_id = p_org)
                  and ou.rol in ('staff','admin','superadmin'))
  );
$$;

create or replace function public.es_admin(p_org uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.usuarios u
             where u.id = auth.uid() and u.rol = 'superadmin')
    or exists (select 1 from public.usuarios u
                where u.id = auth.uid()
                  and u.rol = 'admin'
                  and (p_org is null or u.organizacion_id = p_org))
    or exists (select 1 from public.organizacion_usuarios ou
                where ou.usuario_id = auth.uid()
                  and (p_org is null or ou.organizacion_id = p_org)
                  and ou.rol in ('admin','superadmin'))
  );
$$;

-- Organizaciones que administra la sesión actual. Útil en las políticas
-- que no tienen una columna `organizacion_id` a mano.
create or replace function public.orgs_de_mi_staff()
returns setof uuid language sql stable security definer set search_path = public as $$
  select o.id from public.organizaciones o where public.es_superadmin()
  union
  select u.organizacion_id from public.usuarios u
   where u.id = auth.uid() and u.rol in ('staff','admin') and u.organizacion_id is not null
  union
  select ou.organizacion_id from public.organizacion_usuarios ou
   where ou.usuario_id = auth.uid() and ou.rol in ('staff','admin','superadmin');
$$;


-- ======================================================================
-- 2. RESERVAS — el cliente ya no se autoconfirma ni se pone el total en 0
--
-- Fallo original: la política `reservas_update` permitía a la persona
-- dueña actualizar SU reserva… sin decir qué columnas. Un PATCH a
-- /rest/v1/reservas?id=eq.… con {"estado":"confirmada","total":0}
-- bastaba para tener una oficina gratis y confirmada (y de paso
-- desbloqueaba dejar reseñas, que exigen una reserva confirmada).
-- ======================================================================
create or replace function public.guardia_reserva()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Reactivar una reserva cancelada (sólo lo hace la administración)
  -- tiene que borrar el rastro de la cancelación: si no, quedaba una
  -- fila «confirmada» que además decía cancelada el 12/08 por «ya no
  -- viajo», con un reembolso apuntado que nunca se pagó.
  -- Nota: si mientras tanto alguien ocupó ese hueco, la reserva vuelve
  -- al alcance de `reservas_sin_solape` y PostgreSQL rechaza el cambio,
  -- así que reactivar no puede provocar una doble reserva.
  if tg_op = 'UPDATE'
     and old.estado = 'cancelada' and new.estado is distinct from 'cancelada' then
    new.cancelada_en       := null;
    new.cancelada_por      := null;
    new.motivo_cancelacion := null;
    new.monto_reembolso    := 0;
  end if;

  if public.escritura_confiable() or public.es_staff(old.organizacion_id) then
    return new;
  end if;

  -- Columnas que el cliente NUNCA puede tocar: se restauran en silencio.
  new.id                  := old.id;
  new.folio               := old.folio;
  new.organizacion_id     := old.organizacion_id;
  new.espacio_id          := old.espacio_id;
  new.usuario_id          := old.usuario_id;
  new.cliente_nombre      := old.cliente_nombre;
  new.cliente_email       := old.cliente_email;
  new.inicio              := old.inicio;
  new.fin                 := old.fin;
  new.subtotal            := old.subtotal;
  new.descuento           := old.descuento;
  new.impuestos           := old.impuestos;
  new.total               := old.total;
  new.moneda              := old.moneda;
  new.promocion_id        := old.promocion_id;
  new.monto_reembolso     := old.monto_reembolso;
  new.recordatorio_enviado := old.recordatorio_enviado;
  new.origen              := old.origen;
  new.creado_en           := old.creado_en;

  -- Del estado sólo se permite un movimiento: cancelar la propia.
  if new.estado is distinct from old.estado then
    if new.estado <> 'cancelada' then
      raise exception 'Sólo la administración puede cambiar el estado de una reserva'
        using errcode = '42501';
    end if;
    if old.estado in ('cancelada','completada','no_asistio') then
      raise exception 'Esta reserva ya no se puede cancelar' using errcode = '42501';
    end if;
    new.cancelada_en  := now();
    new.cancelada_por := auth.uid();
  else
    new.cancelada_en       := old.cancelada_en;
    new.cancelada_por      := old.cancelada_por;
    new.motivo_cancelacion := old.motivo_cancelacion;
  end if;

  -- Cambiar asistentes sí, pero dentro de la capacidad real.
  if new.asistentes is distinct from old.asistentes then
    if new.asistentes < 1
       or new.asistentes > coalesce((select capacidad from public.espacios where id = old.espacio_id), 1) then
      raise exception 'Número de asistentes fuera de la capacidad del espacio';
    end if;
  end if;

  -- Y las notas no pueden ser una novela.
  if length(coalesce(new.notas, '')) > 1000 then
    raise exception 'Las notas no pueden pasar de 1000 caracteres';
  end if;

  return new;
end $$;

drop trigger if exists trg_guardia_reserva on public.reservas;
create trigger trg_guardia_reserva before update on public.reservas
  for each row execute function public.guardia_reserva();

-- Insertar reservas a mano (sin pasar por crear_reserva) permitía
-- inventarse el precio. Se recalcula siempre desde el catálogo.
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

drop trigger if exists trg_guardia_reserva_insert on public.reservas;
create trigger trg_guardia_reserva_insert before insert on public.reservas
  for each row execute function public.guardia_reserva_insert();


-- ======================================================================
-- 3. VALIDACIÓN DE HORARIOS — el navegador y PostgreSQL venden lo mismo
--
-- La interfaz V1 ofrece once franjas de una hora, de 08:00 a 19:00,
-- TODOS los días. La API no puede aceptar horas fuera de esa ventana ni
-- una hora interpretada en UTC: un cliente puede llamar las RPC sin pasar
-- por nuestros botones.
-- ======================================================================
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
  -- 15 min de gracia por el reloj del teléfono y la latencia.
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

  -- Freno al acaparamiento: máximo 10 reservas sin pagar a la vez.
  select count(*) into v_pendientes
    from public.reservas r
   where r.usuario_id = auth.uid()
     and r.estado = 'pendiente'
     and r.fin > now();
  if v_pendientes >= 10 then
    raise exception 'Tienes demasiadas reservas pendientes de pago. Págalas o cancélalas antes de crear otra.';
  end if;
end $$;


-- ======================================================================
-- 4. PAGOS — un PATCH no puede volver "aprobado" lo que nadie pagó
--
-- Fallo original: `pagos_insert` sólo comprobaba usuario_id = auth.uid().
-- Con eso, un POST a /rest/v1/pagos con {"estado":"aprobado","monto":0}
-- dejaba la reserva marcada como pagada en la interfaz y en los informes
-- del panel de administración.
-- ======================================================================

-- El webhook hace upsert con onConflict:"proveedor_id": sin esto,
-- Postgres devuelve error y NINGÚN cobro llega a registrarse.
--
-- OJO CON EL «WHERE». Esto era un índice PARCIAL
-- (`... where proveedor_id is not null`) y por eso no servía para nada:
-- PostgreSQL no infiere un índice parcial en `ON CONFLICT (columna)` a
-- menos que la sentencia repita el mismo predicado, y PostgREST no lo
-- repite. El índice existía, se veía bien en el esquema, y aun así cada
-- upsert moría con 42P10.
--
-- No hace falta el predicado: en una restricción UNIQUE los NULL son
-- distintos entre sí, así que siguen cabiendo tantos pagos sin
-- proveedor_id como haga falta (efectivo, cortesía, transferencia).
alter table public.pagos drop constraint if exists uq_pagos_proveedor;
drop index if exists public.uq_pagos_proveedor;
alter table public.pagos add constraint uq_pagos_proveedor unique (proveedor_id);

create or replace function public.guardia_pago()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- V1 cobra únicamente desde funciones de servidor. El navegador ya no
  -- tiene métodos fuera de línea (transferencia/efectivo), así que aceptar
  -- INSERT directos sólo conservaría una puerta que la interfaz no usa.
  if public.escritura_confiable() or public.es_staff(new.organizacion_id) then
    return new;
  end if;

  raise exception 'Los pagos se registran únicamente desde el servidor'
    using errcode = '42501';
end $$;

drop trigger if exists trg_guardia_pago on public.pagos;
create trigger trg_guardia_pago before insert or update on public.pagos
  for each row execute function public.guardia_pago();


-- ======================================================================
-- 5. FACTURAS — importes tomados del pago, no del navegador
--
-- Fallo original: `facturas_insert` sólo pedía usuario_id = auth.uid().
-- Se podía pedir una factura de cualquier importe, contra cualquier
-- organización, y con el estado ya en "timbrada".
-- ======================================================================
create or replace function public.guardia_factura()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pago public.pagos;
begin
  -- Ojo: en un INSERT el registro OLD no existe, así que no se toca.
  if public.escritura_confiable() or public.es_staff(new.organizacion_id) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Una factura emitida ya no se edita desde la app' using errcode = '42501';
  end if;

  if new.pago_id is null then
    raise exception 'Hay que indicar el pago que se va a facturar';
  end if;
  select * into v_pago from public.pagos where id = new.pago_id;
  if not found or v_pago.usuario_id is distinct from auth.uid() then
    raise exception 'Ese pago no es tuyo' using errcode = '42501';
  end if;
  if v_pago.estado <> 'aprobado' then
    raise exception 'Sólo se factura un pago aprobado';
  end if;
  if new.rfc is null or new.rfc !~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' then
    raise exception 'El RFC no tiene un formato válido';
  end if;
  if exists (select 1 from public.facturas f
              where f.pago_id = v_pago.id and f.estado <> 'cancelada') then
    raise exception 'Ese pago ya tiene factura';
  end if;

  new.usuario_id      := auth.uid();
  new.organizacion_id := v_pago.organizacion_id;
  new.total           := v_pago.monto;
  new.subtotal        := round(v_pago.monto / 1.16, 2);
  new.impuestos       := v_pago.monto - round(v_pago.monto / 1.16, 2);
  new.estado          := 'solicitada';
  new.uuid_fiscal     := null;
  new.xml_url         := null;
  new.pdf_url         := null;
  return new;
end $$;

drop trigger if exists trg_guardia_factura on public.facturas;
create trigger trg_guardia_factura before insert or update on public.facturas
  for each row execute function public.guardia_factura();


-- ======================================================================
-- 6. RESEÑAS — nadie firma como la administración
--
-- Tres fallos en uno:
--   • `resenas_update` dejaba escribir la columna `respuesta`, que la
--     interfaz pinta como "Respuesta del centro de oficinas".
--   • También dejaba mover `espacio_id`: una reseña legítima de un
--     espacio se convertía en cinco estrellas para otro.
--   • `reserva_id` podía ir en NULL y, como en SQL dos NULL no son
--     iguales, el UNIQUE(usuario_id, reserva_id) no impedía repetir:
--     una sola reserva confirmada daba reseñas infinitas.
-- ======================================================================

-- El nombre y la foto se copian al publicar. Así la lista de reseñas no
-- necesita leer la tabla `usuarios` (que es privada) y de paso no se
-- filtra el correo de nadie al hacer el JOIN.
alter table public.resenas add column if not exists autor_nombre text;
alter table public.resenas add column if not exists autor_avatar text;

create or replace function public.guardia_resena()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_reserva public.reservas; v_org uuid;
begin
  select organizacion_id into v_org from public.espacios where id = new.espacio_id;
  if public.escritura_confiable() or public.es_staff(v_org) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.usuario_id := auth.uid();
    if new.reserva_id is null then
      raise exception 'Sólo se puede opinar sobre una reserva concreta';
    end if;
    select * into v_reserva from public.reservas where id = new.reserva_id;
    if not found
       or v_reserva.usuario_id is distinct from auth.uid()
       or v_reserva.espacio_id <> new.espacio_id then
      raise exception 'Esa reserva no es tuya' using errcode = '42501';
    end if;
    if v_reserva.estado = 'cancelada' or v_reserva.inicio > now() then
      raise exception 'Puedes opinar a partir del momento en que empieza tu reserva';
    end if;
  else
    -- En una edición no se cambia ni de espacio ni de reserva ni de autor.
    new.espacio_id := old.espacio_id;
    new.reserva_id := old.reserva_id;
    new.usuario_id := old.usuario_id;
    new.creado_en  := old.creado_en;
  end if;

  -- Columnas que son voz de la administración.
  new.respuesta     := case when tg_op = 'INSERT' then null else old.respuesta end;
  new.respondido_en := case when tg_op = 'INSERT' then null else old.respondido_en end;
  new.visible       := case when tg_op = 'INSERT' then true else old.visible end;

  if length(coalesce(new.comentario, '')) > 2000 then
    raise exception 'El comentario no puede pasar de 2000 caracteres';
  end if;

  select nombre, avatar_url into new.autor_nombre, new.autor_avatar
    from public.usuarios where id = auth.uid();
  return new;
end $$;

drop trigger if exists trg_guardia_resena on public.resenas;
create trigger trg_guardia_resena before insert or update on public.resenas
  for each row execute function public.guardia_resena();

-- Rellena el autor de las reseñas que ya existían.
update public.resenas r
   set autor_nombre = u.nombre, autor_avatar = u.avatar_url
  from public.usuarios u
 where u.id = r.usuario_id and r.autor_nombre is null;


-- ======================================================================
-- 7. CHAT — no te puedes hacer pasar por el equipo de soporte
--
-- `mensajes.es_staff` y `autor_id` llegaban tal cual desde el navegador:
-- bastaba mandar {"es_staff":true} para que el mensaje se pintara con la
-- insignia de la administración dentro de tu propia conversación.
-- ======================================================================
create or replace function public.guardia_mensaje()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organizacion_id into v_org from public.conversaciones where id = new.conversacion_id;
  new.autor_id := auth.uid();
  new.es_staff := public.es_staff(v_org);
  new.es_ia    := new.es_ia and public.es_staff(v_org);
  if length(coalesce(new.cuerpo, '')) = 0 then
    raise exception 'El mensaje viene vacío';
  end if;
  if length(new.cuerpo) > 4000 then
    raise exception 'El mensaje es demasiado largo';
  end if;
  return new;
end $$;

drop trigger if exists trg_guardia_mensaje on public.mensajes;
create trigger trg_guardia_mensaje before insert on public.mensajes
  for each row execute function public.guardia_mensaje();


-- ======================================================================
-- 8. PERFIL — ni el rol, ni el correo, ni la empresa a la que perteneces
-- ======================================================================
create or replace function public.proteger_rol()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.escritura_confiable() then return new; end if;

  -- Sólo un admin de TU organización cambia tu rol, y sólo el
  -- superadmin puede crear otro superadmin.
  if new.rol is distinct from old.rol then
    if not public.es_admin(old.organizacion_id) then
      new.rol := old.rol;
    elsif new.rol = 'superadmin' and not public.es_superadmin() then
      new.rol := old.rol;
    end if;
  end if;

  -- Nadie se cambia de empresa por su cuenta.
  if new.organizacion_id is distinct from old.organizacion_id
     and not public.es_admin(old.organizacion_id) then
    new.organizacion_id := old.organizacion_id;
  end if;

  -- El correo lo manda Auth (verificado), no un PATCH a la tabla.
  if new.email is distinct from old.email and not public.es_admin(old.organizacion_id) then
    new.email := old.email;
  end if;

  new.id        := old.id;
  new.creado_en := old.creado_en;
  return new;
end $$;

drop trigger if exists trg_proteger_rol on public.usuarios;
create trigger trg_proteger_rol before update on public.usuarios
  for each row execute function public.proteger_rol();

-- El correo sí se sincroniza desde auth.users cuando la persona lo
-- cambia y lo verifica.
create or replace function public.sincronizar_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.usuarios set email = new.email where id = new.id;
  return new;
end $$;

drop trigger if exists trg_sincronizar_email on auth.users;
create trigger trg_sincronizar_email after update of email on auth.users
  for each row execute function public.sincronizar_email();


-- ======================================================================
-- 9. POLÍTICAS RLS CORREGIDAS
-- ======================================================================

-- 9.1 Catálogo: la escritura se acota a la organización dueña.
do $$
declare t text;
begin
  foreach t in array array['sedes','edificios','espacios','horarios_operacion','promociones'] loop
    execute format('drop policy if exists "escritura_admin" on public.%I', t);
    execute format($f$create policy "escritura_admin" on public.%I for all to authenticated
      using (public.es_admin(organizacion_id)) with check (public.es_admin(organizacion_id))$f$, t);
  end loop;
end $$;

drop policy if exists "escritura_admin" on public.organizaciones;
create policy "escritura_admin" on public.organizaciones for all to authenticated
  using (public.es_admin(id)) with check (public.es_admin(id));

-- Los pisos cuelgan del edificio; las fotos, del espacio.
drop policy if exists "escritura_admin" on public.pisos;
create policy "escritura_admin" on public.pisos for all to authenticated
  using (exists (select 1 from public.edificios e
                  where e.id = pisos.edificio_id and public.es_admin(e.organizacion_id)))
  with check (exists (select 1 from public.edificios e
                       where e.id = pisos.edificio_id and public.es_admin(e.organizacion_id)));

drop policy if exists "escritura_admin" on public.espacio_fotos;
create policy "escritura_admin" on public.espacio_fotos for all to authenticated
  using (exists (select 1 from public.espacios e
                  where e.id = espacio_fotos.espacio_id and public.es_staff(e.organizacion_id)))
  with check (exists (select 1 from public.espacios e
                       where e.id = espacio_fotos.espacio_id and public.es_staff(e.organizacion_id)));

-- El catálogo de amenidades es global: sólo la plataforma lo toca.
drop policy if exists "escritura_admin" on public.amenidades;
create policy "escritura_admin" on public.amenidades for all to authenticated
  using (public.es_superadmin()) with check (public.es_superadmin());

-- 9.2 Usuarios: el staff ve a la gente de SU organización, no a todo el mundo.
drop policy if exists "perfil_propio_select" on public.usuarios;
create policy "perfil_propio_select" on public.usuarios for select to authenticated
  using (
    id = auth.uid()
    or public.es_superadmin()
    or (organizacion_id is not null and public.es_staff(organizacion_id))
    or exists (select 1 from public.organizacion_usuarios ou
                where ou.usuario_id = usuarios.id and public.es_staff(ou.organizacion_id))
    or exists (select 1 from public.reservas r
                where r.usuario_id = usuarios.id and public.es_staff(r.organizacion_id))
  );

drop policy if exists "perfil_admin_update" on public.usuarios;
create policy "perfil_admin_update" on public.usuarios for update to authenticated
  using (public.es_admin(organizacion_id)) with check (public.es_admin(organizacion_id));

-- 9.3 Reseñas: el staff sólo responde las de sus espacios.
drop policy if exists "resenas_update" on public.resenas;
create policy "resenas_update" on public.resenas for update to authenticated
  using (
    usuario_id = auth.uid()
    or exists (select 1 from public.espacios e
                where e.id = resenas.espacio_id and public.es_staff(e.organizacion_id))
  )
  with check (
    usuario_id = auth.uid()
    or exists (select 1 from public.espacios e
                where e.id = resenas.espacio_id and public.es_staff(e.organizacion_id))
  );

drop policy if exists "resenas_delete" on public.resenas;
create policy "resenas_delete" on public.resenas for delete to authenticated
  using (
    usuario_id = auth.uid()
    or exists (select 1 from public.espacios e
                where e.id = resenas.espacio_id and public.es_admin(e.organizacion_id))
  );

drop policy if exists "resenas_lectura" on public.resenas;
create policy "resenas_lectura" on public.resenas for select using (
  visible
  or usuario_id = auth.uid()
  or exists (select 1 from public.espacios e
              where e.id = resenas.espacio_id and public.es_staff(e.organizacion_id))
);

-- 9.4 Notificaciones: el staff sólo escribe a gente de su organización.
drop policy if exists "notif_staff_insert" on public.notificaciones;
create policy "notif_staff_insert" on public.notificaciones for insert to authenticated
  with check (exists (
    select 1 from public.usuarios u
     where u.id = notificaciones.usuario_id
       and (public.es_superadmin() or public.es_staff(u.organizacion_id))
  ));

-- 9.5 Lista de espera y usos de promoción.
drop policy if exists "espera_propia" on public.lista_espera;
create policy "espera_propia" on public.lista_espera for all to authenticated
  using (usuario_id = auth.uid()
         or exists (select 1 from public.espacios e
                     where e.id = lista_espera.espacio_id and public.es_staff(e.organizacion_id)))
  with check (usuario_id = auth.uid());

-- Los usos de promoción los escribe crear_reserva() (SECURITY DEFINER),
-- nunca el navegador: si no, cualquiera se regala descuentos.
drop policy if exists "usos_insert" on public.promocion_usos;

drop policy if exists "usos_propios" on public.promocion_usos;
create policy "usos_propios" on public.promocion_usos for select to authenticated
  using (usuario_id = auth.uid()
         or exists (select 1 from public.promociones p
                     where p.id = promocion_usos.promocion_id and public.es_staff(p.organizacion_id)));

-- 9.6 Facturas: quitar el UPDATE del staff de otras empresas.
drop policy if exists "facturas_admin" on public.facturas;
create policy "facturas_admin" on public.facturas for update to authenticated
  using (public.es_staff(organizacion_id)) with check (public.es_staff(organizacion_id));

-- 9.7 Auditoría: cada quien la suya.
drop policy if exists "auditoria_admin" on public.auditoria;
create policy "auditoria_admin" on public.auditoria for select to authenticated
  using (public.es_superadmin() or exists (
    select 1 from public.usuarios u
     where u.id = auditoria.usuario_id and public.es_admin(u.organizacion_id)
  ));

-- 9.8 Storage: las fotos y las facturas también se acotan por empresa.
drop policy if exists "espacios_escritura" on storage.objects;
create policy "espacios_escritura" on storage.objects for all to authenticated
  using (bucket_id in ('espacios','modelos-3d') and public.es_staff())
  with check (
    bucket_id in ('espacios','modelos-3d')
    -- La carpeta raíz es el id del espacio: <espacio>/1699…-ab12.jpg
    and exists (
      select 1 from public.espacios e
       where e.id = public.a_uuid((storage.foldername(name))[1])
         and public.es_staff(e.organizacion_id)
    )
  );

drop policy if exists "facturas_archivos" on storage.objects;
create policy "facturas_archivos" on storage.objects for select to authenticated
  using (
    bucket_id = 'facturas'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.a_uuid((storage.foldername(name))[1]) in (select public.orgs_de_mi_staff())
    )
  );

-- SVG fuera de los buckets públicos: un SVG es HTML ejecutable.
update storage.buckets
   set allowed_mime_types = array['image/png','image/jpeg','image/webp','image/avif']
 where id = 'avatares';


-- ======================================================================
-- 10. RPC ENDURECIDAS
-- ======================================================================

-- esta_disponible() leía `reservas` con los permisos de quien llama:
-- para una visita sin sesión RLS ocultaba todas las reservas y la
-- función respondía "libre" siempre. Ahora consulta con permisos del
-- servidor (sólo devuelve un booleano, no filtra datos de nadie).
create or replace function public.esta_disponible(
  p_espacio uuid, p_inicio timestamptz, p_fin timestamptz, p_excluir_reserva uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select public.franja_reservable_v1(p_espacio, p_inicio, p_fin)
     and not exists (
    select 1 from public.reservas r
     where r.espacio_id = p_espacio
       and r.estado in ('pendiente','confirmada','en_curso')
       and (p_excluir_reserva is null or r.id <> p_excluir_reserva)
       and r.periodo && tstzrange(p_inicio, p_fin, '[)')
  )
     and not exists (
    select 1 from public.bloqueos b
     where (b.espacio_id = p_espacio
            or b.edificio_id = (select edificio_id from public.espacios where id = p_espacio))
       and tstzrange(b.inicio, b.fin) && tstzrange(p_inicio, p_fin, '[)')
  );
$$;

-- crear_reserva: valida la ventana y respeta `usos_por_usuario`.
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

-- cancelar_reserva: el reembolso se calcula sobre la fecha ORIGINAL.
create or replace function public.cancelar_reserva(
  p_reserva uuid, p_motivo text default null
) returns public.reservas
language plpgsql security definer set search_path = public as $$
declare v public.reservas; v_horas numeric; v_reembolso numeric; v_pagado numeric;
begin
  perform set_config('app.rpc_confiable', '1', true);

  select * into v from public.reservas where id = p_reserva for update;
  if not found then raise exception 'La reserva no existe'; end if;
  -- `is distinct from` y no `<>`: con usuario_id en NULL (cuenta
  -- borrada) la comparación daba NULL y la condición no saltaba, así que
  -- cualquiera con sesión podía cancelar una reserva huérfana.
  if v.usuario_id is distinct from auth.uid() and not public.es_staff(v.organizacion_id) then
    raise exception 'No puedes cancelar esta reserva' using errcode = '42501';
  end if;
  if v.estado in ('cancelada','completada','no_asistio') then
    raise exception 'La reserva ya no se puede cancelar';
  end if;

  v_horas := extract(epoch from (v.inicio - now())) / 3600.0;
  select coalesce(sum(monto - reembolsado), 0) into v_pagado
    from public.pagos where reserva_id = v.id and estado = 'aprobado';

  v_reembolso := case
                   when v_horas >= 24 then v_pagado
                   when v_horas >= 0  then round(v_pagado * 0.5, 2)
                   else 0                          -- ya empezó: sin reembolso
                 end;

  update public.reservas
     set estado = 'cancelada', cancelada_en = now(), cancelada_por = auth.uid(),
         motivo_cancelacion = left(coalesce(p_motivo, ''), 500),
         monto_reembolso = v_reembolso
   where id = p_reserva
  returning * into v;

  if v.usuario_id is not null then
    insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, enlace)
    values (v.usuario_id, 'reserva', 'Reserva cancelada',
            'Tu reserva ' || v.folio || ' fue cancelada. Reembolso estimado: $' || v_reembolso,
            '/reservas/' || v.id);
  end if;
  perform set_config('app.rpc_confiable', '0', true);
  return v;
end $$;

-- modificar_reserva: no se mueve una reserva al futuro para después
-- cancelarla y cobrar el 100 % de reembolso, ni se mueve al pasado.
create or replace function public.modificar_reserva(
  p_reserva uuid, p_inicio timestamptz, p_fin timestamptz
) returns public.reservas
language plpgsql security definer set search_path = public as $$
declare v public.reservas; v_espacio public.espacios; v_horas numeric; v_sub numeric; v_tasa numeric;
begin
  perform set_config('app.rpc_confiable', '1', true);

  select * into v from public.reservas where id = p_reserva for update;
  if not found then raise exception 'La reserva no existe'; end if;
  if v.usuario_id is distinct from auth.uid() and not public.es_staff(v.organizacion_id) then
    raise exception 'No puedes modificar esta reserva' using errcode = '42501';
  end if;
  if v.estado in ('cancelada','completada','no_asistio') then
    raise exception 'La reserva ya no se puede modificar';
  end if;

  -- Dentro de las 24 h previas ya no se mueve: es la misma ventana que
  -- la política de cancelación, para que no se pueda dar la vuelta.
  if not public.es_staff(v.organizacion_id)
     and v.inicio < now() + interval '24 hours' then
    raise exception 'Faltan menos de 24 horas: escríbenos para moverla';
  end if;

  select * into v_espacio from public.espacios where id = v.espacio_id;
  perform public.validar_ventana_reserva(v_espacio, p_inicio, p_fin, v.asistentes);

  if not public.esta_disponible(v.espacio_id, p_inicio, p_fin, p_reserva) then
    raise exception 'conflicto_horario: ese horario ya está ocupado';
  end if;

  select tasa_impuesto into v_tasa from public.organizaciones where id = v.organizacion_id;
  v_horas := extract(epoch from (p_fin - p_inicio)) / 3600.0;
  v_sub := round(v_espacio.precio_hora * v_horas, 2);

  update public.reservas
     set inicio = p_inicio, fin = p_fin,
         subtotal = v_sub,
         descuento = least(descuento, v_sub),
         impuestos = round((v_sub - least(descuento, v_sub)) * coalesce(v_tasa, 0.16), 2),
         total = v_sub - least(descuento, v_sub)
                 + round((v_sub - least(descuento, v_sub)) * coalesce(v_tasa, 0.16), 2),
         recordatorio_enviado = false
   where id = p_reserva
  returning * into v;
  perform set_config('app.rpc_confiable', '0', true);
  return v;
end $$;

-- Estas dos sólo tienen sentido para quien tiene sesión.
revoke execute on function public.crear_reserva(uuid, timestamptz, timestamptz, int, text, text, text) from public;
revoke execute on function public.cancelar_reserva(uuid, text) from public;
revoke execute on function public.modificar_reserva(uuid, timestamptz, timestamptz) from public;
grant  execute on function public.crear_reserva(uuid, timestamptz, timestamptz, int, text, text, text) to authenticated, service_role;
grant  execute on function public.cancelar_reserva(uuid, text) to authenticated, service_role;
grant  execute on function public.modificar_reserva(uuid, timestamptz, timestamptz) to authenticated, service_role;


-- ======================================================================
-- 11. LÍMITE DE RITMO (anti-abuso barato)
--
-- Sin esto, un script con la llave pública puede crear miles de filas
-- por minuto: reseñas, mensajes, listas de espera, notificaciones…
-- ======================================================================
create table if not exists public.ritmo (
  usuario_id uuid not null,
  accion     text not null,
  ventana    timestamptz not null,
  conteo     int not null default 0,
  primary key (usuario_id, accion, ventana)
);
alter table public.ritmo enable row level security;   -- nadie la lee desde el cliente

create or replace function public.limitar_ritmo(p_accion text, p_maximo int, p_minutos int default 1)
returns void language plpgsql security definer set search_path = public as $$
declare v_ventana timestamptz; v_conteo int;
begin
  if auth.uid() is null then return; end if;
  v_ventana := date_trunc('minute', now())
               - make_interval(mins => extract(minute from now())::int % greatest(p_minutos, 1));

  insert into public.ritmo (usuario_id, accion, ventana, conteo)
  values (auth.uid(), p_accion, v_ventana, 1)
  on conflict (usuario_id, accion, ventana)
  do update set conteo = public.ritmo.conteo + 1
  returning conteo into v_conteo;

  if v_conteo > p_maximo then
    raise exception 'Demasiadas peticiones seguidas. Espera un momento.' using errcode = '53400';
  end if;

  delete from public.ritmo where ventana < now() - interval '1 day';
end $$;

create or replace function public.ritmo_mensajes() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.limitar_ritmo('mensaje', 20, 1); return new; end $$;
drop trigger if exists trg_ritmo_mensajes on public.mensajes;
create trigger trg_ritmo_mensajes before insert on public.mensajes
  for each row execute function public.ritmo_mensajes();

create or replace function public.ritmo_resenas() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.limitar_ritmo('resena', 5, 10); return new; end $$;
drop trigger if exists trg_ritmo_resenas on public.resenas;
create trigger trg_ritmo_resenas before insert on public.resenas
  for each row execute function public.ritmo_resenas();

create or replace function public.ritmo_espera() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.limitar_ritmo('espera', 30, 10); return new; end $$;
drop trigger if exists trg_ritmo_espera on public.lista_espera;
create trigger trg_ritmo_espera before insert on public.lista_espera
  for each row execute function public.ritmo_espera();


-- ======================================================================
-- 12. HIGIENE FINAL
-- ======================================================================

-- Que nadie pueda llamar a las funciones internas desde la API.
revoke execute on function public.limitar_ritmo(text, int, int) from public;
revoke execute on function public.validar_ventana_reserva(public.espacios, timestamptz, timestamptz, int) from public;

-- La ocupación pública conserva el acceso anónimo sin dejar la vista
-- como SECURITY DEFINER. Sólo la función interna, de superficie mínima,
-- puede saltar RLS y únicamente devuelve espacio_id, inicio y fin.
-- Disponibilidad pública segura: la vista ya NO ejecuta con los permisos
-- de su dueño. La función encapsula únicamente los tres campos que son
-- públicos y mantiene el bypass de RLS limitado a esos datos.
create or replace function public.ocupacion_publica_segura()
returns table (
  espacio_id uuid,
  inicio timestamptz,
  fin timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.espacio_id, r.inicio, r.fin
    from public.reservas as r
   where r.estado in (
     'pendiente'::public.estado_reserva,
     'confirmada'::public.estado_reserva,
     'en_curso'::public.estado_reserva
   );
$$;

revoke all on function public.ocupacion_publica_segura() from public;
grant execute on function public.ocupacion_publica_segura() to anon, authenticated;

create or replace view public.v_ocupacion_publica
with (security_invoker = true, security_barrier = true) as
  select espacio_id, inicio, fin
    from public.ocupacion_publica_segura();

revoke all on public.v_ocupacion_publica from anon, authenticated;
grant select on public.v_ocupacion_publica to anon, authenticated;

-- Comprobación rápida: ninguna tabla de public sin RLS.
do $$
declare faltan text;
begin
  select string_agg(c.relname, ', ') into faltan
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if faltan is not null then
    raise warning 'Tablas SIN row level security: %', faltan;
  else
    raise notice 'RLS activo en todas las tablas de public.';
  end if;
end $$;


-- ======================================================================
-- 13. BORRAR LA CUENTA SIN DEPENDER DE UNA EDGE FUNCTION
--
-- Antes, borrar la cuenta llamaba a la función `eliminar-cuenta`. Si no
-- estaba desplegada —que es lo normal en una instalación nueva— el botón
-- devolvía un error y no había forma de darse de baja. Esto es un
-- derecho, no una función opcional: ahora vive en la base de datos, que
-- siempre está.
--
-- SECURITY DEFINER: corre con permisos del dueño, así que puede tocar
-- auth.users. Sólo borra la cuenta de QUIEN LLAMA (auth.uid()), nunca
-- otra: no recibe ningún id como parámetro, a propósito.
-- ======================================================================
create or replace function public.eliminar_mi_cuenta()
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_detalle jsonb := '{}'::jsonb;
  v_n int;
begin
  if v_uid is null then raise exception 'Se requiere sesión'; end if;
  perform set_config('app.rpc_confiable', '1', true);

  -- 1. Cancelar lo que esté por venir, para liberar las salas.
  update public.reservas
     set estado = 'cancelada', cancelada_en = now(), cancelada_por = v_uid,
         motivo_cancelacion = 'Cuenta eliminada por la persona usuaria'
   where usuario_id = v_uid and estado in ('pendiente','confirmada') and inicio > now();
  get diagnostics v_n = row_count;
  v_detalle := v_detalle || jsonb_build_object('reservas_canceladas', v_n);

  -- 2. Borrar lo que es puramente personal y no tiene valor contable.
  delete from public.favoritos           where usuario_id = v_uid;
  delete from public.lista_espera        where usuario_id = v_uid;
  delete from public.notificaciones      where usuario_id = v_uid;
  delete from public.push_suscripciones  where usuario_id = v_uid;
  delete from public.promocion_usos      where usuario_id = v_uid;
  delete from public.organizacion_usuarios where usuario_id = v_uid;
  delete from public.resenas             where usuario_id = v_uid;
  delete from public.ritmo               where usuario_id = v_uid;

  update public.mensajes set autor_id = null, cuerpo = '[mensaje de una cuenta eliminada]'
   where autor_id = v_uid;
  delete from public.conversaciones where usuario_id = v_uid;

  -- 3. Anonimizar lo que la ley obliga a conservar (comprobantes).
  --    El histórico sobrevive sin nombre: el derecho al olvido no puede
  --    borrar la contabilidad de la empresa, pero tampoco dejar tu
  --    nombre pegado a ella.
  update public.reservas
     set usuario_id = null, cliente_nombre = 'Cuenta eliminada', cliente_email = null,
         notas = null
   where usuario_id = v_uid;
  update public.pagos
     set usuario_id = null, cliente_nombre = 'Cuenta eliminada', cliente_email = null
   where usuario_id = v_uid;
  update public.facturas
     set usuario_id = null, email = null
   where usuario_id = v_uid;

  -- 4. El perfil y la credencial de acceso.
  delete from public.usuarios  where id = v_uid;
  delete from auth.users       where id = v_uid;

  return v_detalle || jsonb_build_object('ok', true, 'borrado_en', now());
end $$;

revoke execute on function public.eliminar_mi_cuenta() from public;
grant  execute on function public.eliminar_mi_cuenta() to authenticated;
