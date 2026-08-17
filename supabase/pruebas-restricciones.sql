-- ======================================================================
-- pruebas-restricciones.sql — FASE 01 §1.3 y §1.4, comprobadas.
--
-- Aquí NO se prueban triggers ni RLS: eso ya lo hace
-- pruebas-seguridad.sql. Lo que se prueba es la última línea, la que
-- queda cuando todo lo demás falla: los CHECK de PostgreSQL.
--
-- Por eso cada intento se hace COMO SERVIDOR (service_role), que se
-- salta los guardias a propósito. Si el CHECK aguanta contra el rol más
-- privilegiado que existe en la aplicación, aguanta contra cualquiera.
--
--     psql "$DATABASE_URL" -f supabase/pruebas-restricciones.sql
--
-- Todo va dentro de una transacción con ROLLBACK: no deja nada escrito.
-- Aun así, córrelo contra una copia, nunca contra producción.
-- ======================================================================
\set ON_ERROR_STOP on
begin;

set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create or replace function pg_temp.rechaza(p_nombre text, p_sql text)
returns void language plpgsql as $$
declare v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
    -- Sólo cuenta si lo paró una restricción de la base, no un error
    -- de escritura del propio SQL de prueba.
    -- 23xxx: violación de integridad · 22xxx: dato imposible (por
    -- ejemplo, la columna generada `periodo` cuando fin < inicio).
    -- Cualquier 42xxx sería un error de sintaxis MÍO, no de la base.
    if sqlstate not in ('23514', '23505', '23503', '23502', '23P01',
                        '22000', '22001', '22003', '22007', '22P02') then
      raise exception 'PRUEBA MAL ESCRITA -> % : % (%)', p_nombre, v_err, sqlstate;
    end if;
    raise notice '  OK   %  (%)', rpad(p_nombre, 44), left(v_err, 52);
    return;
  end;
  raise exception 'RESTRICCIÓN QUE FALTA -> % : la base ACEPTÓ el dato', p_nombre;
end $$;

create or replace function pg_temp.acepta(p_nombre text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice '  OK   %  (aceptado, como debe ser)', rpad(p_nombre, 44);
end $$;


-- ----------------------------------------------------------------------
-- Escenario mínimo
-- ----------------------------------------------------------------------
create temporary table ctx (
  org uuid, sede uuid, edif uuid, piso uuid, espacio uuid,
  usuario uuid, reserva uuid, pago uuid
) on commit drop;

do $$
declare
  v_org uuid; v_sede uuid; v_edif uuid; v_piso uuid;
  v_espacio uuid; v_usuario uuid; v_reserva uuid; v_pago uuid;
begin
  insert into public.organizaciones (nombre, slug, moneda, tasa_impuesto)
  values ('Pruebas Restricciones', 'pruebas-restricciones', 'MXN', 0.16)
  returning id into v_org;

  insert into public.sedes (organizacion_id, nombre, slug)
  values (v_org, 'Sede', 'sede-restricciones') returning id into v_sede;

  insert into public.edificios (organizacion_id, sede_id, nombre)
  values (v_org, v_sede, 'Edificio') returning id into v_edif;

  insert into public.pisos (edificio_id, nombre, numero)
  values (v_edif, 'Planta baja', 1) returning id into v_piso;

  insert into public.espacios (organizacion_id, sede_id, edificio_id, piso_id,
                               codigo, nombre, capacidad, precio_hora)
  values (v_org, v_sede, v_edif, v_piso, 'RES-01', 'Oficina de prueba', 8, 500)
  returning id into v_espacio;

  insert into auth.users (id, email) values (gen_random_uuid(), 'restricciones@ejemplo.mx')
  returning id into v_usuario;
  update public.usuarios set organizacion_id = v_org, nombre = 'Persona'
   where id = v_usuario;

  insert into public.reservas (organizacion_id, espacio_id, usuario_id, inicio, fin,
                               subtotal, impuestos, total)
  values (v_org, v_espacio, v_usuario,
          now() + interval '3 days', now() + interval '3 days 2 hours',
          1000.00, 160.00, 1160.00)
  returning id into v_reserva;

  insert into public.pagos (organizacion_id, reserva_id, usuario_id, metodo, monto, moneda)
  values (v_org, v_reserva, v_usuario, 'transferencia', 1160.00, 'MXN')
  returning id into v_pago;

  insert into ctx values (v_org, v_sede, v_edif, v_piso, v_espacio, v_usuario, v_reserva, v_pago);
end $$;


-- ----------------------------------------------------------------------
--  §1.4 — EL PRECIO LO MANDA EL SERVIDOR
--
--  Este es el bloque que de verdad importa. El escenario del enunciado:
--  el navegador manda {"total": 1}. Aquí se intenta lo mismo pero con la
--  llave de servicio, es decir, sin ningún trigger que estorbe.
-- ----------------------------------------------------------------------
do $$
declare c ctx; begin select * into c from ctx;
  raise notice '';
  raise notice '── §1.4  El total no lo decide el cliente ───────────────────';

  perform pg_temp.rechaza('UPDATE total = 1',
    format('update public.reservas set total = 1 where id = %L', c.reserva));

  perform pg_temp.rechaza('UPDATE total = 0',
    format('update public.reservas set total = 0 where id = %L', c.reserva));

  perform pg_temp.rechaza('UPDATE total negativo',
    format('update public.reservas set total = -500 where id = %L', c.reserva));

  -- Bajar el subtotal sin tocar el total tampoco cuadra.
  perform pg_temp.rechaza('UPDATE subtotal = 1 dejando el total',
    format('update public.reservas set subtotal = 1 where id = %L', c.reserva));

  -- Un descuento mayor que el subtotal es dinero inventado.
  perform pg_temp.rechaza('descuento > subtotal',
    format('update public.reservas set descuento = 99999 where id = %L', c.reserva));

  -- INSERT desde cero con el precio puesto a mano.
  perform pg_temp.rechaza('INSERT con total inventado',
    format($q$insert into public.reservas
             (organizacion_id, espacio_id, usuario_id, inicio, fin, subtotal, impuestos, total)
             values (%L, %L, %L, now() + interval '9 days', now() + interval '9 days 2 hours',
                     1000, 160, 1)$q$, c.org, c.espacio, c.usuario));

  -- Y la versión buena: si los tres números cuadran, pasa.
  perform pg_temp.acepta('total = subtotal - descuento + impuestos',
    format($q$update public.reservas
                set subtotal = 2000, descuento = 200, impuestos = 288, total = 2088
              where id = %L$q$, c.reserva));

  -- El redondeo del IVA (±1 centavo) no puede tumbar una reserva real.
  perform pg_temp.acepta('tolerancia de 1 centavo por redondeo',
    format($q$update public.reservas
                set subtotal = 333.33, descuento = 0, impuestos = 53.33, total = 386.67
              where id = %L$q$, c.reserva));
end $$;


-- ----------------------------------------------------------------------
--  §1.3 — PRECIOS Y AFORO
-- ----------------------------------------------------------------------
do $$
declare c ctx; begin select * into c from ctx;
  raise notice '';
  raise notice '── §1.3  precio >= 0  ·  capacidad > 0 ──────────────────────';

  perform pg_temp.rechaza('precio_hora negativo',
    format('update public.espacios set precio_hora = -1 where id = %L', c.espacio));
  perform pg_temp.rechaza('precio_dia negativo',
    format('update public.espacios set precio_dia = -100 where id = %L', c.espacio));
  perform pg_temp.rechaza('capacidad 0',
    format('update public.espacios set capacidad = 0 where id = %L', c.espacio));
  perform pg_temp.rechaza('capacidad negativa',
    format('update public.espacios set capacidad = -5 where id = %L', c.espacio));
  perform pg_temp.rechaza('capacidad absurda (99999)',
    format('update public.espacios set capacidad = 99999 where id = %L', c.espacio));
  perform pg_temp.rechaza('ancho 0 (rompe el mapa)',
    format('update public.espacios set ancho = 0 where id = %L', c.espacio));
  perform pg_temp.rechaza('calificación 7 sobre 5',
    format('update public.espacios set calificacion = 7 where id = %L', c.espacio));
  perform pg_temp.rechaza('contador de reservas negativo',
    format('update public.espacios set total_reservas = -3 where id = %L', c.espacio));
  perform pg_temp.rechaza('nombre en blanco',
    format($q$update public.espacios set nombre = '   ' where id = %L$q$, c.espacio));
  perform pg_temp.rechaza('color que no es un color',
    format($q$update public.espacios set color_hex = 'javascript:alert(1)' where id = %L$q$, c.espacio));

  perform pg_temp.acepta('precio 0 (un espacio gratis es legítimo)',
    format('update public.espacios set precio_hora = 0 where id = %L', c.espacio));
  perform pg_temp.acepta('precio normal',
    format('update public.espacios set precio_hora = 500 where id = %L', c.espacio));
end $$;


-- ----------------------------------------------------------------------
--  §1.3 — FECHAS
-- ----------------------------------------------------------------------
do $$
declare c ctx; begin select * into c from ctx;
  raise notice '';
  raise notice '── §1.3  fecha_fin > fecha_inicio ───────────────────────────';

  perform pg_temp.rechaza('fin anterior al inicio',
    format($q$update public.reservas set fin = inicio - interval '1 hour' where id = %L$q$, c.reserva));
  perform pg_temp.rechaza('fin igual al inicio',
    format('update public.reservas set fin = inicio where id = %L', c.reserva));
  perform pg_temp.rechaza('reserva de 300 años',
    format($q$update public.reservas set fin = inicio + interval '300 years' where id = %L$q$, c.reserva));
  perform pg_temp.rechaza('reserva de 1 minuto',
    format($q$update public.reservas set fin = inicio + interval '1 minute' where id = %L$q$, c.reserva));
  perform pg_temp.rechaza('bloqueo que termina antes de empezar',
    format($q$insert into public.bloqueos (organizacion_id, espacio_id, inicio, fin)
             values (%L, %L, now() + interval '2 days', now() + interval '1 day')$q$,
           c.org, c.espacio));
  perform pg_temp.rechaza('horario que cierra antes de abrir',
    format($q$insert into public.horarios_operacion (organizacion_id, espacio_id, dia_semana, abre, cierra)
             values (%L, %L, 1, '18:00', '09:00')$q$, c.org, c.espacio));
  perform pg_temp.rechaza('día de la semana 9',
    format($q$insert into public.horarios_operacion (organizacion_id, espacio_id, dia_semana, abre, cierra)
             values (%L, %L, 9, '09:00', '18:00')$q$, c.org, c.espacio));
end $$;


-- ----------------------------------------------------------------------
--  §1.3 — ESTADOS PERMITIDOS
-- ----------------------------------------------------------------------
do $$
declare c ctx; begin select * into c from ctx;
  raise notice '';
  raise notice '── §1.3  estado ∈ estados permitidos ────────────────────────';

  -- Los enum ya lo impiden: el error es 22P02, no un CHECK, así que se
  -- comprueba aparte.
  begin
    execute format($q$update public.reservas set estado = 'pagada_supongo' where id = %L$q$, c.reserva);
    raise exception 'RESTRICCIÓN QUE FALTA -> estado inventado: la base lo ACEPTÓ';
  exception when invalid_text_representation then
    raise notice '  OK   %  (enum estado_reserva)', rpad('estado inventado en reservas', 44);
  end;

  begin
    execute format($q$update public.pagos set estado = 'pagadisimo' where id = %L$q$, c.pago);
    raise exception 'RESTRICCIÓN QUE FALTA -> estado de pago inventado: ACEPTADO';
  exception when invalid_text_representation then
    raise notice '  OK   %  (enum estado_pago)', rpad('estado inventado en pagos', 44);
  end;

  perform pg_temp.rechaza('estado de factura inventado',
    format($q$insert into public.facturas (organizacion_id, usuario_id, rfc, razon_social, estado,
                                           subtotal, impuestos, total)
             values (%L, %L, 'XAXX010101000', 'Quien sea', 'ya_la_pagué', 100, 16, 116)$q$,
           c.org, c.usuario));

  perform pg_temp.rechaza('origen de reserva inventado',
    format($q$update public.reservas set origen = 'curl' where id = %L$q$, c.reserva));

  perform pg_temp.rechaza('cancelada sin fecha de cancelación',
    format($q$update public.reservas set estado = 'cancelada' where id = %L$q$, c.reserva));

  perform pg_temp.rechaza('estado de conversación inventado',
    format($q$insert into public.conversaciones (organizacion_id, usuario_id, estado)
             values (%L, %L, 'zombi')$q$, c.org, c.usuario));
end $$;


-- ----------------------------------------------------------------------
--  §1.3 — DINERO EN PAGOS Y FACTURAS
-- ----------------------------------------------------------------------
do $$
declare c ctx; begin select * into c from ctx;
  raise notice '';
  raise notice '── §1.3  Dinero ─────────────────────────────────────────────';

  perform pg_temp.rechaza('pago de monto negativo',
    format('update public.pagos set monto = -100 where id = %L', c.pago));
  perform pg_temp.rechaza('reembolso mayor que el pago',
    format('update public.pagos set reembolsado = 999999 where id = %L', c.pago));
  perform pg_temp.rechaza('aprobado sin fecha de cobro',
    format($q$update public.pagos set estado = 'aprobado' where id = %L$q$, c.pago));

  -- El número de tarjeta completo NUNCA debe caber en la base.
  perform pg_temp.rechaza('PAN completo en ultimos4',
    format($q$update public.pagos set ultimos4 = '4111111111111111' where id = %L$q$, c.pago));
  perform pg_temp.rechaza('ultimos4 con letras',
    format($q$update public.pagos set ultimos4 = 'ABCD' where id = %L$q$, c.pago));

  -- 'mxn' cabe en char(3): lo tiene que parar el CHECK, no el tipo.
  perform pg_temp.rechaza('moneda en minúsculas',
    format($q$update public.pagos set moneda = 'mxn' where id = %L$q$, c.pago));
  perform pg_temp.rechaza('moneda con dígitos',
    format($q$update public.pagos set moneda = 'M1X' where id = %L$q$, c.pago));
  perform pg_temp.rechaza('IVA del 300 %',
    format('update public.organizaciones set tasa_impuesto = 3 where id = %L', c.org));
  perform pg_temp.rechaza('RFC que no es un RFC',
    format($q$insert into public.facturas (organizacion_id, usuario_id, rfc, razon_social,
                                           subtotal, impuestos, total)
             values (%L, %L, 'HOLA', 'Quien sea', 100, 16, 116)$q$, c.org, c.usuario));
  perform pg_temp.rechaza('factura cuyo total no cuadra',
    format($q$insert into public.facturas (organizacion_id, usuario_id, rfc, razon_social,
                                           subtotal, impuestos, total)
             values (%L, %L, 'XAXX010101000', 'Quien sea', 100, 16, 5000)$q$, c.org, c.usuario));

  perform pg_temp.acepta('pago aprobado CON fecha de cobro',
    format($q$update public.pagos set estado = 'aprobado', pagado_en = now() where id = %L$q$, c.pago));
  perform pg_temp.acepta('últimos 4 dígitos de verdad',
    format($q$update public.pagos set ultimos4 = '4242', marca_tarjeta = 'visa' where id = %L$q$, c.pago));
end $$;


-- ----------------------------------------------------------------------
--  §1.3 — PROMOCIONES
-- ----------------------------------------------------------------------
do $$
declare c ctx; begin select * into c from ctx;
  raise notice '';
  raise notice '── §1.3  Promociones ────────────────────────────────────────';

  perform pg_temp.rechaza('descuento del 300 %',
    format($q$insert into public.promociones (organizacion_id, codigo, titulo, tipo, valor)
             values (%L, 'TRESCIENTOS', 'Regalo', 'porcentaje', 300)$q$, c.org));
  perform pg_temp.rechaza('descuento negativo',
    format($q$insert into public.promociones (organizacion_id, codigo, titulo, tipo, valor)
             values (%L, 'NEGATIVO', 'Cobro de más', 'monto', -50)$q$, c.org));
  perform pg_temp.rechaza('promoción que termina antes de empezar',
    format($q$insert into public.promociones (organizacion_id, codigo, titulo, tipo, valor, inicia, termina)
             values (%L, 'ALREVES', 'Al revés', 'monto', 50,
                     now() + interval '10 days', now())$q$, c.org));
  perform pg_temp.rechaza('código con espacios y símbolos',
    format($q$insert into public.promociones (organizacion_id, codigo, titulo, tipo, valor)
             values (%L, '<script>x</script>', 'XSS', 'monto', 50)$q$, c.org));

  perform pg_temp.acepta('promoción normal del 20 %',
    format($q$insert into public.promociones (organizacion_id, codigo, titulo, tipo, valor)
             values (%L, 'VEINTE', 'Veinte por ciento', 'porcentaje', 20)$q$, c.org));
end $$;


-- ----------------------------------------------------------------------
--  §1.3 — TEXTO Y FORMATOS
-- ----------------------------------------------------------------------
do $$
declare c ctx; begin select * into c from ctx;
  raise notice '';
  raise notice '── §1.3  Texto, correos y formatos ──────────────────────────';

  perform pg_temp.rechaza('correo sin arroba',
    format($q$update public.usuarios set email = 'no-es-un-correo' where id = %L$q$, c.usuario));
  perform pg_temp.rechaza('tema inexistente',
    format($q$update public.usuarios set tema = 'neón' where id = %L$q$, c.usuario));
  perform pg_temp.rechaza('idioma de 5 letras',
    format($q$update public.usuarios set idioma = 'espa' where id = %L$q$, c.usuario));
  perform pg_temp.rechaza('notas de 5000 caracteres',
    format($q$update public.reservas set notas = repeat('x', 5000) where id = %L$q$, c.reserva));
  -- Nota: el cuerpo vacío de un mensaje lo para antes `guardia_mensaje`,
  -- así que ese caso vive en pruebas-seguridad.sql. Aquí se comprueba
  -- una tabla sin trigger, donde el CHECK es lo único que hay.
  perform pg_temp.rechaza('notificación sin título',
    format($q$insert into public.notificaciones (usuario_id, titulo)
             values (%L, '   ')$q$, c.usuario));
  -- El bloque horario: mismo formato que bloqueValido() en el cliente.
  perform pg_temp.rechaza('bloque horario "HOLA-MUNDO"',
    format($q$insert into public.lista_espera (espacio_id, usuario_id, fecha, bloque)
             values (%L, %L, current_date + 1, 'HOLA-MUNDO')$q$, c.espacio, c.usuario));
  perform pg_temp.rechaza('bloque horario "25:99-99:99"',
    format($q$insert into public.lista_espera (espacio_id, usuario_id, fecha, bloque)
             values (%L, %L, current_date + 2, '25:99-99:99')$q$, c.espacio, c.usuario));
  perform pg_temp.rechaza('coordenadas fuera del planeta',
    format('update public.sedes set lat = 500 where id = %L', c.sede));
  perform pg_temp.rechaza('slug con mayúsculas y espacios',
    format($q$update public.organizaciones set slug = 'Mi Empresa!' where id = %L$q$, c.org));

  perform pg_temp.acepta('bloque horario válido',
    format($q$insert into public.lista_espera (espacio_id, usuario_id, fecha, bloque)
             values (%L, %L, current_date + 3, '08:00-09:00')$q$, c.espacio, c.usuario));
  perform pg_temp.acepta('correo normal',
    format($q$update public.usuarios set email = 'alguien@ejemplo.mx' where id = %L$q$, c.usuario));
end $$;


-- ----------------------------------------------------------------------
--  Integridad referencial: qué pasa cuando se borra el padre
-- ----------------------------------------------------------------------
do $$
declare c ctx; v_n int; v_reserva uuid; begin select * into c from ctx;
  raise notice '';
  raise notice '── Integridad referencial ───────────────────────────────────';

  perform pg_temp.rechaza('reserva de un espacio inexistente',
    format($q$insert into public.reservas (organizacion_id, espacio_id, usuario_id, inicio, fin)
             values (%L, gen_random_uuid(), %L,
                     now() + interval '5 days', now() + interval '5 days 2 hours')$q$,
           c.org, c.usuario));

  perform pg_temp.rechaza('promoción inexistente en una reserva',
    format('update public.reservas set promocion_id = gen_random_uuid() where id = %L', c.reserva));

  -- Un espacio con reservas NO se puede borrar: `on delete restrict`
  -- protege el histórico contable.
  perform pg_temp.rechaza('borrar un espacio que tiene reservas',
    format('delete from public.espacios where id = %L', c.espacio));

  -- Doble reserva: la exclusión GiST es la que de verdad lo impide.
  update public.reservas set estado = 'confirmada' where id = c.reserva;
  perform pg_temp.rechaza('mismo espacio, mismo horario, dos veces',
    format($q$insert into public.reservas (organizacion_id, espacio_id, usuario_id, inicio, fin,
                                           estado, subtotal, impuestos, total)
             select organizacion_id, espacio_id, usuario_id, inicio, fin,
                    'confirmada', subtotal, impuestos, total
               from public.reservas where id = %L$q$, c.reserva));

  raise notice '  ·    la exclusión GiST es lo que impide la doble reserva';
end $$;


-- ----------------------------------------------------------------------
--  Inventario final
-- ----------------------------------------------------------------------
do $$
declare v_checks int; v_fks int; v_idx int; v_rls int; v_sin_rls text;
begin
  select count(*) into v_checks from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'public' and c.contype = 'c';
  select count(*) into v_fks from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'public' and c.contype = 'f';
  select count(*) into v_idx from pg_indexes where schemaname = 'public';
  select count(*) into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;
  select string_agg(c.relname, ', ') into v_sin_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  raise notice '';
  raise notice '══════════════════════════════════════════════════════════════';
  raise notice '  CHECK: %   ·   claves foráneas: %   ·   índices: %', v_checks, v_fks, v_idx;
  raise notice '  Tablas con RLS: %', v_rls;
  if v_sin_rls is not null then
    raise exception 'TABLAS SIN RLS -> %', v_sin_rls;
  end if;
  raise notice '  TODAS LAS PRUEBAS DE RESTRICCIONES PASARON';
  raise notice '══════════════════════════════════════════════════════════════';
end $$;

rollback;
