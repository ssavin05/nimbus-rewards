-- ======================================================================
-- pruebas-seguridad.sql — Los ataques, convertidos en pruebas.
--
-- Cada bloque reproduce un abuso REAL que funcionaba antes de aplicar
-- seguridad.sql. La prueba pasa cuando el ataque FALLA.
--
--     psql "$DATABASE_URL" -f supabase/pruebas-seguridad.sql
--
-- Se ejecuta dentro de una transacción y hace ROLLBACK al final: no
-- deja nada en la base. Aun así, córrelo en una copia, no en producción.
-- ======================================================================
\set ON_ERROR_STOP on
begin;

-- ----------------------------------------------------------------------
-- Utilería: ponerse en la piel de alguien (como hace PostgREST).
-- ----------------------------------------------------------------------
create or replace function pg_temp.actuar_como(p_uid uuid, p_rol text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_rol, true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid, 'role', p_rol)::text, true);
end $$;

create or replace function pg_temp.como_servidor() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;

-- Ejecuta una sentencia CON EL ROL REAL del navegador (`authenticated`),
-- para que las políticas RLS entren en juego igual que en producción.
-- Si se corriera como superusuario, RLS se saltaría y la prueba mentiría.
create or replace function pg_temp.como_cliente(p_sql text)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
end $$;

-- Espera que el ataque reviente. Si NO revienta, el ataque funcionó.
create or replace function pg_temp.debe_fallar(p_nombre text, p_sql text)
returns void language plpgsql as $$
begin
  begin
    perform pg_temp.como_cliente(p_sql);
  exception when others then
    execute 'reset role';
    raise notice '  OK   %  (bloqueado: %)', rpad(p_nombre, 46), left(sqlerrm, 58);
    return;
  end;
  execute 'reset role';
  raise exception 'FALLO DE SEGURIDAD -> % : el ataque funcionó', p_nombre;
end $$;

-- El ataque no revienta, pero tampoco debe surtir efecto.
create or replace function pg_temp.sin_efecto(p_nombre text, p_sql text, p_condicion_sql text)
returns void language plpgsql as $$
declare v_ok boolean;
begin
  begin
    perform pg_temp.como_cliente(p_sql);
  exception when others then
    execute 'reset role';
    raise notice '  OK   %  (bloqueado: %)', rpad(p_nombre, 46), left(sqlerrm, 58);
    return;
  end;
  execute 'reset role';
  execute 'select ' || p_condicion_sql into v_ok;
  if coalesce(v_ok, false) then raise notice '  OK   %  (sin efecto)', rpad(p_nombre, 46);
  else raise exception 'FALLO DE SEGURIDAD -> % : el cambio SÍ se guardó', p_nombre;
  end if;
end $$;

create or replace function pg_temp.debe_valer(p_nombre text, p_condicion boolean)
returns void language plpgsql as $$
begin
  if p_condicion then raise notice '  OK   %', p_nombre;
  else raise exception 'FALLO DE SEGURIDAD -> %', p_nombre;
  end if;
end $$;


-- ----------------------------------------------------------------------
-- Escenario: dos empresas, un espacio, una víctima y un atacante.
-- ----------------------------------------------------------------------
do $$
declare
  v_org_a uuid; v_org_b uuid; v_sede uuid; v_edif uuid;
  v_espacio uuid; v_victima uuid; v_atacante uuid; v_staff_b uuid;
begin
  perform pg_temp.como_servidor();

  insert into public.organizaciones (nombre, slug) values ('Empresa A', 'a') returning id into v_org_a;
  insert into public.organizaciones (nombre, slug) values ('Empresa B', 'b') returning id into v_org_b;

  insert into public.sedes (organizacion_id, nombre, slug) values (v_org_a, 'Centro', 'centro') returning id into v_sede;
  insert into public.edificios (organizacion_id, sede_id, nombre) values (v_org_a, v_sede, 'Torre 1') returning id into v_edif;
  insert into public.espacios (organizacion_id, sede_id, edificio_id, codigo, nombre, tipo, capacidad, precio_hora)
    values (v_org_a, v_sede, v_edif, 'A-101', 'Sala Roble', 'sala_juntas', 8, 500)
    returning id into v_espacio;

  insert into auth.users (email) values ('victima@ejemplo.mx')  returning id into v_victima;
  insert into auth.users (email) values ('atacante@ejemplo.mx') returning id into v_atacante;
  insert into auth.users (email) values ('staff.b@ejemplo.mx')  returning id into v_staff_b;

  update public.usuarios set organizacion_id = v_org_a where id in (v_victima, v_atacante);
  update public.usuarios set organizacion_id = v_org_b, rol = 'admin' where id = v_staff_b;

  create temp table ctx as
    select v_org_a org_a, v_org_b org_b, v_espacio espacio,
           v_victima victima, v_atacante atacante, v_staff_b staff_b;
end $$;


-- ======================================================================
-- 1. RESERVAS
-- ======================================================================
do $$
declare c record; r_atacante uuid; r_victima uuid;
begin
  select * into c from ctx;
  raise notice '';
  raise notice '── Reservas ─────────────────────────────────────────────────';

  -- El atacante crea su reserva por la vía legítima.
  perform pg_temp.actuar_como(c.atacante);
  r_atacante := (public.crear_reserva(c.espacio, now() + interval '2 days',
                                      now() + interval '2 days 2 hours', 4)).id;
  perform pg_temp.debe_valer('la reserva legítima se crea',
    (select total from public.reservas where id = r_atacante) = 1160.00);

  -- ATAQUE 1: confirmármela yo mismo y ponerme el total en cero.
  perform pg_temp.debe_fallar('PATCH estado=confirmada',
    format('update public.reservas set estado = ''confirmada'' where id = %L', r_atacante));

  perform pg_temp.sin_efecto('PATCH total=0',
    format('update public.reservas set total = 0, subtotal = 0, descuento = 999 where id = %L', r_atacante),
    format('(select total from public.reservas where id = %L) = 1160.00', r_atacante));

  -- ATAQUE 2: moverla de horario sin pasar por modificar_reserva().
  perform pg_temp.sin_efecto('PATCH de horario',
    format('update public.reservas set inicio = now() + interval ''9 days'',
                   fin = now() + interval ''9 days 8 hours'' where id = %L', r_atacante),
    format('(select fin - inicio from public.reservas where id = %L) = interval ''2 hours''', r_atacante));

  -- ATAQUE 3: pasarle la reserva a otra persona / a otra empresa.
  perform pg_temp.sin_efecto('PATCH de dueño y empresa',
    format('update public.reservas set usuario_id = %L, organizacion_id = %L where id = %L',
           c.victima, c.org_b, r_atacante),
    format('(select usuario_id = %L and organizacion_id = %L from public.reservas where id = %L)',
           c.atacante, c.org_a, r_atacante));

  -- ATAQUE 4: reservar el pasado, y reservar hasta el año 3000
  --           (bloqueo permanente del espacio: denegación de servicio).
  perform pg_temp.debe_fallar('reservar en el pasado',
    format('select public.crear_reserva(%L, now() - interval ''5 days'', now() - interval ''4 days'')', c.espacio));
  perform pg_temp.debe_fallar('reservar 300 años seguidos',
    format('select public.crear_reserva(%L, now() + interval ''1 day'', now() + interval ''300 years'')', c.espacio));
  perform pg_temp.debe_fallar('reservar con 1 año y medio de antelación',
    format('select public.crear_reserva(%L, now() + interval ''550 days'', now() + interval ''550 days 2 hours'')', c.espacio));

  -- ATAQUE 5: meter 40 personas en una sala de 8.
  perform pg_temp.debe_fallar('asistentes por encima del aforo',
    format('select public.crear_reserva(%L, now() + interval ''3 days'', now() + interval ''3 days 1 hour'', 40)', c.espacio));

  -- ATAQUE 6: insertar una reserva a mano poniéndome yo el precio.
  perform pg_temp.como_cliente(format(
    'insert into public.reservas (organizacion_id, espacio_id, usuario_id, inicio, fin, subtotal, total, asistentes)
     values (%L, %L, %L, now() + interval ''4 days'', now() + interval ''4 days 2 hours'', 1, 1, 2)',
    c.org_a, c.espacio, c.atacante));
  perform pg_temp.debe_valer('INSERT directo con precio inventado se recalcula',
    (select total from public.reservas
      where usuario_id = c.atacante and inicio > now() + interval '3 days'
        and inicio < now() + interval '5 days') = 1160.00);

  -- ATAQUE 7: cancelar la reserva de otra persona.
  perform pg_temp.actuar_como(c.victima);
  perform pg_temp.debe_fallar('cancelar la reserva de otro',
    format('select public.cancelar_reserva(%L)', r_atacante));
end $$;


-- ======================================================================
-- 2. PAGOS Y FACTURAS
-- ======================================================================
do $$
declare c record; r uuid; p uuid;
begin
  select * into c from ctx;
  raise notice '';
  raise notice '── Pagos y facturas ─────────────────────────────────────────';

  perform pg_temp.actuar_como(c.atacante);
  r := (public.crear_reserva(c.espacio, now() + interval '6 days',
                             now() + interval '6 days 2 hours', 2)).id;

  -- ATAQUE 8: V1 no acepta NINGÚN pago creado desde el navegador.
  perform pg_temp.debe_fallar('INSERT directo de pago desde navegador',
    format('insert into public.pagos (organizacion_id, reserva_id, usuario_id, metodo, estado, monto)
            values (%L, %L, %L, ''transferencia'', ''aprobado'', 0)',
           c.org_a, r, c.atacante));

  -- El intento real lo crea el servidor/Edge Function.
  perform pg_temp.como_servidor();
  insert into public.pagos (organizacion_id, reserva_id, usuario_id, metodo, estado, monto, moneda, proveedor_id)
  values (c.org_a, r, c.atacante, 'clip', 'pendiente', 1160.00, 'MXN', 'clip-prueba-seguridad')
  returning id into p;

  perform pg_temp.actuar_como(c.atacante);

  -- ATAQUE 9: el navegador tampoco puede aprobar/modificar el intento.
  perform pg_temp.sin_efecto('PATCH de estado de pago desde navegador',
    format('update public.pagos set estado = ''aprobado'', pagado_en = now() where id = %L', p),
    format('(select estado = ''pendiente'' and pagado_en is null from public.pagos where id = %L)', p));

  -- ATAQUE 10: facturación está fuera de V1; una llamada manual a REST
  -- no debe crear solicitudes ocultas ni filas basura.
  perform pg_temp.debe_fallar('INSERT directo de factura desde navegador',
    format('insert into public.facturas (organizacion_id, pago_id, usuario_id, rfc, razon_social, total, estado)
            values (%L, %L, %L, ''XAXX010101000'', ''Mi Empresa'', 99999, ''timbrada'')',
           c.org_a, p, c.atacante));
end $$;

-- ======================================================================
-- 3. RESEÑAS
-- ======================================================================
do $$
declare c record; r uuid; res uuid;
begin
  select * into c from ctx;
  raise notice '';
  raise notice '── Reseñas ──────────────────────────────────────────────────';

  -- ATAQUE 12: opinar sin haber reservado nunca.
  perform pg_temp.actuar_como(c.victima);
  perform pg_temp.debe_fallar('reseña sin reserva',
    format('insert into public.resenas (espacio_id, usuario_id, calificacion, comentario)
            values (%L, %L, 1, ''pésimo'')', c.espacio, c.victima));

  -- Reserva real y ya empezada (la mete el servidor).
  perform pg_temp.como_servidor();
  -- Los importes tienen que cuadrar entre sí: `reserva_total_cuadra`
  -- rechaza una fila con total 1000 y subtotal 0, y hace bien.
  insert into public.reservas (organizacion_id, espacio_id, usuario_id, inicio, fin, estado,
                               subtotal, impuestos, total)
  values (c.org_a, c.espacio, c.victima, now() - interval '3 hours', now() - interval '1 hour', 'completada',
          862.07, 137.93, 1000.00)
  returning id into r;

  perform pg_temp.actuar_como(c.victima);
  perform pg_temp.como_cliente(format(
    'insert into public.resenas (espacio_id, usuario_id, reserva_id, calificacion, comentario, respuesta, visible)
     values (%L, %L, %L, 5, ''Muy bien'', ''Respuesta oficial del centro: somos los mejores'', true)',
    c.espacio, c.victima, r));
  select id into res from public.resenas where reserva_id = r;

  -- ATAQUE 13: firmar como la administración.
  perform pg_temp.debe_valer('la "respuesta oficial" del cliente se descarta',
    (select respuesta is null from public.resenas where id = res));

  perform pg_temp.sin_efecto('PATCH de la respuesta oficial',
    format('update public.resenas set respuesta = ''Contestado por la dirección'',
                   respondido_en = now() where id = %L', res),
    format('(select respuesta is null from public.resenas where id = %L)', res));

  -- ATAQUE 14: mudar la reseña a otro espacio (manipular calificaciones).
  perform pg_temp.sin_efecto('PATCH de espacio_id',
    format('update public.resenas set espacio_id = gen_random_uuid() where id = %L', res),
    format('(select espacio_id = %L from public.resenas where id = %L)', c.espacio, res));

  -- ATAQUE 15: reseñas infinitas con reserva_id nulo.
  perform pg_temp.debe_fallar('reseña sin reserva_id (repetible sin límite)',
    format('insert into public.resenas (espacio_id, usuario_id, reserva_id, calificacion)
            values (%L, %L, null, 5)', c.espacio, c.victima));

  -- El nombre del autor lo pone el servidor.
  perform pg_temp.debe_valer('el autor se copia desde el perfil real',
    (select autor_nombre is not null from public.resenas where id = res));
end $$;


-- ======================================================================
-- 4. AISLAMIENTO ENTRE EMPRESAS Y ESCALADA DE ROL
-- ======================================================================
do $$
declare c record; n_reservas int; n_usuarios int;
begin
  select * into c from ctx;
  raise notice '';
  raise notice '── Multiempresa y roles ─────────────────────────────────────';

  -- ATAQUE 16: el admin de la empresa B lee las reservas de la A.
  perform pg_temp.actuar_como(c.staff_b);
  perform pg_temp.debe_valer('es_staff() ya no cruza empresas',
    public.es_staff(c.org_a) = false and public.es_staff(c.org_b) = true);

  set local role authenticated;
  select count(*) into n_reservas from public.reservas where organizacion_id = c.org_a;
  select count(*) into n_usuarios from public.usuarios where id in (c.victima, c.atacante);
  reset role;
  perform pg_temp.debe_valer('no ve las reservas de la otra empresa', n_reservas = 0);
  perform pg_temp.debe_valer('no ve a los usuarios de la otra empresa', n_usuarios = 0);

  -- ATAQUE 17: autoascenderse a administrador.
  perform pg_temp.actuar_como(c.atacante);
  perform pg_temp.sin_efecto('autoascenso a superadmin',
    format('update public.usuarios set rol = ''superadmin'' where id = %L', c.atacante),
    format('(select rol = ''usuario'' from public.usuarios where id = %L)', c.atacante));

  -- ATAQUE 18: cambiarse de empresa y cambiarse el correo verificado.
  perform pg_temp.sin_efecto('cambio de empresa y de correo verificado',
    format('update public.usuarios set organizacion_id = %L, email = ''jefe@empresa-b.mx'' where id = %L',
           c.org_b, c.atacante),
    format('(select organizacion_id = %L and email = ''atacante@ejemplo.mx''
              from public.usuarios where id = %L)', c.org_a, c.atacante));
end $$;


-- ======================================================================
-- 5. CHAT Y PROMOCIONES
-- ======================================================================
do $$
declare c record; conv uuid; msg uuid; promo uuid; r1 uuid; r2 uuid;
begin
  select * into c from ctx;
  raise notice '';
  raise notice '── Chat y promociones ───────────────────────────────────────';

  perform pg_temp.actuar_como(c.atacante);
  perform pg_temp.como_cliente(format(
    'insert into public.conversaciones (organizacion_id, usuario_id) values (%L, %L)', c.org_a, c.atacante));
  select id into conv from public.conversaciones where usuario_id = c.atacante;

  -- ATAQUE 19: hacerse pasar por el equipo de soporte.
  perform pg_temp.como_cliente(format(
    'insert into public.mensajes (conversacion_id, autor_id, es_staff, cuerpo)
     values (%L, %L, true, ''Soy del banco, mándame tu tarjeta'')', conv, c.victima));
  select id into msg from public.mensajes where conversacion_id = conv;
  perform pg_temp.debe_valer('la insignia de staff y el autor los pone el servidor',
    (select es_staff = false and autor_id = c.atacante from public.mensajes where id = msg));

  -- ATAQUE 20: canjear el mismo cupón una y otra vez.
  perform pg_temp.como_servidor();
  insert into public.promociones (organizacion_id, codigo, titulo, tipo, valor, usos_por_usuario)
  values (c.org_a, 'MITAD', '50 % de descuento', 'porcentaje', 50, 1) returning id into promo;

  perform pg_temp.actuar_como(c.atacante);
  r1 := (public.crear_reserva(c.espacio, now() + interval '20 days',
                              now() + interval '20 days 2 hours', 2, null, 'MITAD')).id;
  perform pg_temp.debe_valer('el primer canje aplica el descuento',
    (select descuento from public.reservas where id = r1) = 500.00);

  perform pg_temp.debe_fallar('segundo canje del mismo cupón',
    format('select public.crear_reserva(%L, now() + interval ''21 days'', now() + interval ''21 days 2 hours'', 2, null, ''MITAD'')', c.espacio));

  -- ATAQUE 21: inventarse un uso de promoción con descuento gigante.
  perform pg_temp.debe_fallar('INSERT directo en promocion_usos',
    format('insert into public.promocion_usos (promocion_id, usuario_id, descuento)
            values (%L, %L, 100000)', promo, c.atacante));
end $$;


-- ======================================================================
-- 6. LO QUE TIENE QUE SEGUIR FUNCIONANDO
-- ======================================================================
do $$
declare c record; r uuid; v public.reservas;
begin
  select * into c from ctx;
  raise notice '';
  raise notice '── Uso normal (no se rompió nada) ───────────────────────────';

  perform pg_temp.actuar_como(c.victima);
  r := (public.crear_reserva(c.espacio, now() + interval '40 days',
                             now() + interval '40 days 3 hours', 6, 'Junta de consejo')).id;
  perform pg_temp.debe_valer('reservar funciona', r is not null);

  perform pg_temp.como_cliente(format(
    'update public.reservas set notas = ''Cambio: traigo proyector'', asistentes = 7 where id = %L', r));
  perform pg_temp.debe_valer('editar notas y asistentes funciona',
    (select asistentes = 7 and notas like 'Cambio%' from public.reservas where id = r));

  v := public.modificar_reserva(r, now() + interval '41 days', now() + interval '41 days 2 hours');
  perform pg_temp.debe_valer('reprogramar funciona y recalcula el precio', v.total = 1160.00);

  v := public.cancelar_reserva(r, 'Ya no viajo');
  perform pg_temp.debe_valer('cancelar funciona', v.estado = 'cancelada');

  perform pg_temp.como_cliente(format(
    'update public.reservas set estado = ''cancelada''
      where usuario_id = %L and estado = ''pendiente'' and inicio > now()', c.victima));
  perform pg_temp.debe_valer('cancelar con un PATCH también funciona',
    not exists (select 1 from public.reservas
                 where usuario_id = c.victima and estado = 'pendiente' and inicio > now()));

  -- El servidor (Edge Functions) conserva todos sus permisos.
  perform pg_temp.como_servidor();
  update public.reservas set estado = 'confirmada' where id = r;
  perform pg_temp.debe_valer('la llave de servicio sigue pudiendo todo',
    (select estado = 'confirmada' from public.reservas where id = r));

  -- Borrado de cuenta: la anonimización tiene que poder seguir.
  update public.reservas set usuario_id = null, cliente_nombre = 'Cuenta eliminada' where id = r;
  perform pg_temp.debe_valer('la anonimización por borrado de cuenta funciona',
    (select usuario_id is null from public.reservas where id = r));
end $$;

do $$ begin
  raise notice '';
  raise notice '══════════════════════════════════════════════════════════════';
  raise notice '  TODAS LAS PRUEBAS DE SEGURIDAD PASARON';
  raise notice '══════════════════════════════════════════════════════════════';
end $$;

rollback;
