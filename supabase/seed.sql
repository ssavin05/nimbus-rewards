-- ======================================================================
-- seed.sql — Datos iniciales: una organización, una sede, un edificio,
-- un piso y los 24 espacios del plano arquitectónico real del cliente.
--
-- Las coordenadas están en metros, tomadas de las cotas del plano:
-- pos_x / pos_y = esquina noroeste, ancho / fondo = medidas del espacio.
-- El edificio completo mide 18.70 m × 29.95 m (ver js/data/planta.js).
--
-- Es idempotente: se puede correr varias veces sin duplicar nada.
-- ======================================================================

-- ---------- catálogo de amenidades ----------
insert into public.amenidades (clave, etiqueta, icono, orden) values
  ('wifi',            'WiFi de alta velocidad',    '📶', 1),
  ('ac',              'Aire acondicionado',        '❄️', 2),
  ('proyector',       'Proyector / Pantalla',      '📽️', 3),
  ('pizarron',        'Pizarrón',                  '🖊️', 4),
  ('accesible',       'Acceso para discapacidad',  '♿', 5),
  ('estacionamiento', 'Estacionamiento incluido',  '🚗', 6),
  ('cafe',            'Servicio de café',          '☕', 7),
  ('impresora',       'Impresora / Escáner',       '🖨️', 8),
  ('videollamada',    'Equipo de videollamada',    '🎥', 9),
  ('lockers',         'Lockers',                   '🔒', 10),
  ('recepcion',       'Recepción de visitas',      '🛎️', 11),
  ('cocina',          'Acceso a cocina',           '🍳', 12)
on conflict (clave) do update set etiqueta = excluded.etiqueta, icono = excluded.icono;

-- ---------- organización, sede, edificio, piso ----------
insert into public.organizaciones (id, nombre, slug, moneda, zona_horaria, tasa_impuesto)
values ('11111111-1111-1111-1111-111111111111', 'Smart Hub', 'smart-hub', 'MXN', 'America/Tijuana', 0.16)
on conflict (slug) do nothing;

-- La calle, el teléfono y el correo van en NULL a propósito: los que
-- había («Av. Reforma 1234», '+52 646 000 0000',
-- 'reservas@centrodeoficinas.mx') eran inventados, y una dirección o un
-- teléfono falso publicado manda gente al domicilio de un desconocido.
-- Sólo ciudad y estado son datos confirmados. Coordenadas de «centro de
-- Ensenada» no sirven como ubicación de la oficina y podrían mandar un
-- pin al lugar equivocado, así que también quedan en NULL.
-- Rellena dirección/coordenadas con las reales — ver OWNER_ACTIONS.md.
insert into public.sedes (id, organizacion_id, nombre, slug, direccion, ciudad, estado, lat, lng, telefono, email, orden)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'Sede Ensenada', 'ensenada-centro', null, 'Ensenada', 'Baja California',
        null, null, null, 'savinsaul750@gmail.com', 1)
on conflict (organizacion_id, slug) do nothing;

insert into public.edificios (id, organizacion_id, sede_id, nombre, descripcion, ancho_m, fondo_m, orden)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', 'Edificio Principal',
        'Edificio de una planta con oficinas privadas, sala de juntas, coworking, jardín y patio interior.',
        18.70, 29.95, 1)
on conflict (id) do nothing;

insert into public.pisos (id, edificio_id, nombre, numero, altura_m)
values ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'Planta Baja', 1, 2.6)
on conflict (edificio_id, numero) do nothing;

-- ---------- espacios ----------
-- Los reservables llevan precio; los informativos (baños, almacenes,
-- pasillos) se guardan igual para que el mapa 3D dibuje el edificio real.
-- En medio va un tercer grupo: cuartos de verdad que hoy no se rentan.
-- Están en el plano y en el mapa, pero no en el catálogo.
insert into public.espacios (
  organizacion_id, sede_id, edificio_id, piso_id,
  codigo, nombre, tipo, icono, descripcion, capacidad, reservable, estado,
  precio_hora, precio_dia, amenidades, servicios,
  pos_x, pos_y, ancho, fondo, altura, abierto, puerta
) values
-- ===================== ESPACIOS RENTABLES =====================
('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'OF-B','Ejecutiva Compact','oficina','🏢',
 'Oficina angosta en el corazón del edificio, junto al archivero, ideal para uso individual o llamadas privadas.',
 4, true, 'disponible', 180, 1150,
 array['wifi','ac'],
 array['Limpieza diaria'],
 6.53, 13.27, 1.35, 5.65, 1.35, false, '{"side":"e","offset":-0.325,"width":0.9}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'OF-A','Ejecutiva Plus','oficina','🏢',
 'Oficina ubicada en el ala este del edificio, junto al patio. Perfecta para equipos que buscan independencia y comodidad.',
 5, true, 'disponible', 260, 1700,
 array['wifi','ac','proyector','accesible'],
 array['Limpieza diaria','Acceso a cocina'],
 15.29, 11.78, 4.71, 3.51, 1.35, false, '{"side":"w","offset":-0.255,"width":1.0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'OF-D','Ejecutiva Lounge','oficina','🏢',
 'Oficina en el ala este, junto al baño y almacén comunitarios, con acceso directo al pasillo principal.',
 3, true, 'disponible', 220, 1450,
 array['wifi','ac'],
 array['Limpieza diaria'],
 15.29, 15.29, 2.96, 3.63, 1.35, false, '{"side":"s","offset":0,"width":1.0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'OF-C','Premium Patio View','oficina','🏢',
 'Oficina esquinera en la planta baja, junto a la recepción del edificio. Buena opción para negocios que reciben visitas frecuentes.',
 4, true, 'disponible', 240, 1550,
 array['wifi','ac','accesible','estacionamiento','recepcion'],
 array['Recepción de visitas','Limpieza diaria'],
 18.25, 21.21, 1.75, 4.99, 1.35, false, '{"side":"w","offset":0,"width":1.0}'),

-- ===================== FUERA DE CATÁLOGO =====================
-- Cuartos reales del edificio que hoy NO se rentan: siguen en la tabla
-- para que el mapa 3D dibuje el edificio completo, con sus medidas y su
-- altura de siempre, pero van con `reservable = false` y precio 0, así
-- que no salen en el catálogo ni se pueden reservar. Conservan las
-- amenidades (son características del cuarto) y pierden los servicios
-- incluidos (ésos sólo aplican a lo que se renta). Para volver a
-- ponerlos en renta: reservable = true y sus precios de vuelta.
('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'OF-01','Oficina','oficina','🏢',
 'Oficina de 5.10 m de fondo, pegada a la recepción.',
 4, false, 'disponible', 0, null,
 array['wifi','ac','recepcion'],
 '{}',
 11.52, 21.35, 2.69, 4.85, 1.35, false, '{"side":"s","offset":0.005,"width":1.0}'),

-- La Habitación faltaba entera en el seed: el plano tiene 24 espacios y
-- aquí sólo había 23. Sin ella, la base y js/data/planta.js contaban
-- edificios distintos, y el mapa dibujado desde la base salía con un
-- hueco en la esquina noroeste. Hay una prueba que compara ambas listas.
('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'HAB-01','Habitación','oficina','🛏',
 'Cuarto privado en la esquina noroeste, junto a la Oficina Principal.',
 2, false, 'disponible', 0, null,
 array['wifi','ac'],
 '{}',
 0.00, 0.00, 5.15, 2.85, 1.35, false, '{"side":"s","offset":0,"width":0.9}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'OF-PRINCIPAL','Oficina Principal','oficina','🏢',
 'Oficina en la esquina noroeste del edificio, con luz natural directa y acceso rápido al jardín privado.',
 10, false, 'disponible', 0, null,
 array['wifi','ac','proyector','accesible','estacionamiento','videollamada'],
 '{}',
 0.00, 0.00, 6.53, 5.86, 1.35, false, '{"side":"s","offset":1.335,"width":1.0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'SJ-01','Sala de Juntas','sala_juntas','📊',
 'Sala ejecutiva con mesa para diez personas, arriba del lobby.',
 10, false, 'disponible', 0, null,
 array['wifi','ac','proyector','pizarron','accesible','cafe','videollamada'],
 '{}',
 6.94, 0.00, 4.78, 4.92, 1.35, false, '{"side":"s","offset":-0.64,"width":1.0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'EA-01','Espacio Abierto','coworking','🧑‍💻',
 'Gran área de planta abierta junto al jardín privado, con mesas compartidas.',
 18, false, 'disponible', 0, null,
 array['wifi','ac','accesible','cafe','impresora','lockers'],
 '{}',
 0.00, 12.79, 6.53, 13.41, 1.35, true, '{"side":"s","offset":-0.065,"width":1.2}'),

-- ===================== ESPACIOS INFORMATIVOS =====================
('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'WC-01','Baño','servicio','🚻','Servicio sanitario de la Oficina Principal.',
 0, false, 'disponible', 0, null, '{}', '{}', 0.00, 5.86, 2.90, 2.09, 0.9, false, '{"side":"e","offset":-0.045,"width":0.85}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'LB-01','Lobby','comun','🛋','Vestíbulo de entrada del edificio, junto a la Sala de Juntas.',
 0, false, 'disponible', 0, null, '{}', '{}', 6.94, 4.92, 2.29, 3.03, 0.9, false, '{"side":"e","offset":-0.02,"width":1.0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'JP-01','Jardín Privado','comun','🌿','Jardín privado exterior contiguo a la Oficina Principal.',
 0, false, 'disponible', 0, null, '{}', '{}', 0.00, 7.95, 6.53, 4.84, 0.32, true, '{"side":"n","offset":0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'PT-01','Patio','comun','🌳','Patio interior techado, disponible como espacio de descanso para todo el edificio.',
 0, false, 'disponible', 0, null, '{}', '{}', 9.23, 0.00, 9.02, 11.78, 0.32, true, '{"side":"w","offset":0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'CM-01','Comunitario','comun','🌳','Franja de jardín comunitario en el costado este del edificio.',
 0, false, 'disponible', 0, null, '{}', '{}', 18.25, 0.00, 1.75, 11.78, 0.32, true, '{"side":"w","offset":0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'WC-02','Baño','servicio','🚻','Servicio sanitario junto a la Oficina B.',
 0, false, 'disponible', 0, null, '{}', '{}', 6.53, 11.78, 1.35, 1.49, 0.9, false, '{"side":"e","offset":0,"width":0.8}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'CO-01','Cocina','servicio','🍳','Cocina compartida con cafetera, microondas y refrigerador.',
 0, false, 'disponible', 0, null, '{}', '{}', 7.88, 11.78, 3.64, 2.56, 0.9, false, '{"side":"s","offset":-0.02,"width":1.0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'WC-03','Baño Comunitario','servicio','🚻','Servicio sanitario de uso común junto a la cocina.',
 0, false, 'disponible', 0, null, '{}', '{}', 11.52, 11.78, 1.07, 2.56, 0.9, false, '{"side":"s","offset":0,"width":0.8}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'SRV-01','Servicio','servicio','🧹','Cuarto de servicio y limpieza.',
 0, false, 'disponible', 0, null, '{}', '{}', 12.59, 11.78, 2.70, 2.56, 0.9, false, '{"side":"s","offset":0,"width":1.0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'AR-01','Archivero','servicio','🗄️','Área de archivo muerto y almacenamiento documental.',
 0, false, 'disponible', 0, null, '{}', '{}', 6.53, 18.92, 2.70, 2.43, 0.9, false, '{"side":"n","offset":0,"width":1.0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'AL-01','Almacén','servicio','📦','Bodega general del edificio, entre la cocina y la oficina D.',
 0, false, 'disponible', 0, null, '{}', '{}', 7.88, 14.88, 7.41, 4.04, 0.9, false, '{"side":"n","offset":-1.2,"width":1.0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'WC-04','Baño Comunitario','servicio','🚻','Servicio sanitario de uso común, junto a la Oficina D.',
 0, false, 'disponible', 0, null, '{}', '{}', 18.25, 15.29, 1.75, 3.63, 0.9, false, '{"side":"w","offset":0,"width":0.8}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'AL-02','Almacén','servicio','📦','Bodega pequeña junto a la Oficina C.',
 0, false, 'disponible', 0, null, '{}', '{}', 18.25, 18.92, 1.75, 2.29, 0.9, false, '{"side":"w","offset":0,"width":0.8}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'PK-01','Cochera','estacionamiento','🚗','Cochera techada con cajón asignado para visitas.',
 0, false, 'disponible', 0, null, '{}', '{}', 6.53, 21.35, 4.99, 4.85, 0.32, true, '{"side":"s","offset":0}'),

('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'RC-01','Recepción','comun','🛎️','Recepción principal de acceso al edificio, junto a la Oficina C.',
 0, false, 'disponible', 0, null, '{}', '{}', 14.21, 21.35, 4.04, 4.85, 0.9, false, '{"side":"s","offset":-0.67,"width":1.0}')

on conflict (organizacion_id, codigo) do update set
  nombre = excluded.nombre, descripcion = excluded.descripcion,
  pos_x = excluded.pos_x, pos_y = excluded.pos_y,
  ancho = excluded.ancho, fondo = excluded.fondo,
  abierto = excluded.abierto, puerta = excluded.puerta;

-- ----------------------------------------------------------------------
-- Canon del plano para instalaciones nuevas.
--
-- El seed conservó durante meses coordenadas de una maqueta antigua,
-- mientras js/data/planta.js ya usaba las cotas arquitectónicas finales.
-- Las puertas permanecen como metadato del seed, pero la geometría y el
-- catálogo se normalizan aquí al mismo canon que usa migracion-06.
-- ----------------------------------------------------------------------
with plano_canonico(
  codigo, nombre, tipo, icono, descripcion, capacidad, reservable,
  precio_hora, precio_dia, pos_x, pos_y, ancho, fondo, altura, abierto, amenidades
) as (values
  ('HAB-01', 'Habitación', 'oficina', '🛏', 'Cuarto privado en la esquina noroeste, junto a la Oficina Principal.', 2, false, 0, null, 0, 0, 5.15, 2.85, 0.85, false, array['wifi','ac']::text[]),
  ('OF-PRINCIPAL', 'Oficina Principal', 'oficina', '🏢', 'La oficina más grande del edificio: 5.15 × 5.35 m, con baño propio en la esquina y salida al jardín privado.', 10, false, 0, null, 0, 2.85, 5.15, 5.35, 0.85, false, array['wifi','ac','proyector','accesible','estacionamiento','videollamada']::text[]),
  ('WC-01', 'Baño', 'servicio', '🚻', 'Baño privado, dentro de la Oficina Principal.', 0, false, 0, null, 0, 6.8, 1.8, 1.4, 0.55, false, '{}'::text[]),
  ('JP-01', 'Jardín Privado', 'comun', '🌿', 'Jardín exterior contiguo a la Oficina Principal.', 0, false, 0, null, 0, 8.2, 5.15, 4.25, 0.12, true, '{}'::text[]),
  ('EA-01', 'Espacio Abierto', 'coworking', '🧑‍💻', 'Planta libre de coworking: 5.80 × 17.50 m, la superficie más grande del edificio.', 18, false, 0, null, 0, 12.45, 5.8, 17.5, 0.12, true, array['wifi','ac','accesible','cafe','impresora','lockers']::text[]),
  ('SJ-01', 'Sala de Juntas', 'sala_juntas', '📊', 'Sala ejecutiva de 4.60 × 4.00 m con mesa para diez personas, arriba del lobby.', 10, false, 0, null, 5.9, 0.3, 4.6, 4, 0.85, false, array['wifi','ac','proyector','pizarron','accesible','cafe','videollamada']::text[]),
  ('LB-01', 'Lobby', 'comun', '🛋', 'Vestíbulo de entrada, debajo de la Sala de Juntas.', 0, false, 0, null, 5.9, 4.6, 2.2, 2.1, 0.55, false, '{}'::text[]),
  ('WC-02', 'Baño', 'servicio', '🚻', 'Baño de servicio junto al lobby.', 0, false, 0, null, 5.9, 7.1, 1.55, 2, 0.55, false, '{}'::text[]),
  ('OF-B', 'Ejecutiva Compact', 'oficina', '🏢', 'Oficina de 3.00 × 4.80 m, entre el muro poniente y la cocina. Baja más que la fila de servicios.', 4, true, 180, 1150, 5.8, 12.9, 3, 4.8, 0.85, false, array['wifi','ac']::text[]),
  ('AR-01', 'Archivero', 'servicio', '🗄', 'Archivo y almacenamiento documental, debajo de la Oficina B.', 0, false, 0, null, 5.8, 19.6, 2.7, 3, 0.55, false, '{}'::text[]),
  ('PT-01', 'Patio', 'comun', '🌳', 'Patio interior con pendiente al poniente. Da luz y ventilación al centro del edificio.', 0, false, 0, null, 10.7, 0, 4.2, 12.9, 0.12, true, '{}'::text[]),
  ('CM-01', 'Comunitario', 'comun', '☕', 'Área común al aire libre con una mesa redonda de 2.50 m y dos de 1.20 m.', 0, false, 0, null, 14.9, 0, 3.8, 12.9, 0.12, true, '{}'::text[]),
  ('CO-01', 'Cocina', 'servicio', '🍳', 'Cocina compartida con cafetera, microondas y refrigerador.', 0, false, 0, null, 8.8, 12.9, 2.7, 2.6, 0.55, false, '{}'::text[]),
  ('WC-03', 'Baño', 'servicio', '🚻', 'Baño de uso común junto a la cocina.', 0, false, 0, null, 11.5, 12.9, 1.8, 2.6, 0.55, false, '{}'::text[]),
  ('SRV-01', 'Servicio', 'servicio', '🧹', 'Cuarto de servicio y limpieza.', 0, false, 0, null, 13.3, 12.9, 2.2, 2.6, 0.55, false, '{}'::text[]),
  ('OF-A', 'Ejecutiva Plus', 'oficina', '🏢', 'Oficina de 3.20 × 4.10 m en el ala oriente, al final de la fila de servicios.', 5, true, 260, 1700, 15.5, 12.9, 3.2, 4.1, 0.85, false, array['wifi','ac','proyector','accesible']::text[]),
  ('AL-01', 'Almacén', 'servicio', '📦', 'Bodega general de 6.90 × 4.60 m, en el centro de la planta.', 0, false, 0, null, 8.5, 18.5, 6.9, 4.6, 0.55, false, '{}'::text[]),
  ('OF-D', 'Ejecutiva Lounge', 'oficina', '🏢', 'Oficina de 3.20 × 3.60 m en el ala oriente, junto al almacén.', 3, true, 220, 1450, 15.5, 18.5, 3.2, 3.6, 0.85, false, array['wifi','ac']::text[]),
  ('WC-04', 'Baño', 'servicio', '🚻', 'Baño de uso común del ala oriente.', 0, false, 0, null, 17.1, 22.3, 1.6, 1.4, 0.55, false, '{}'::text[]),
  ('AL-02', 'Almacén', 'servicio', '📦', 'Bodega pequeña, arriba de la Oficina C.', 0, false, 0, null, 17.1, 23.7, 1.6, 1.9, 0.55, false, '{}'::text[]),
  ('PK-01', 'Cochera', 'estacionamiento', '🚗', 'Cochera techada de 5.00 × 6.20 m con acceso directo desde la calle.', 0, false, 0, null, 5.9, 23.75, 5, 6.2, 0.12, true, '{}'::text[]),
  ('OF-01', 'Oficina', 'oficina', '🏢', 'Oficina de 5.10 m de fondo, pegada a la recepción.', 4, false, 0, null, 11, 24.85, 2, 5.1, 0.85, false, array['wifi','ac','recepcion']::text[]),
  ('RC-01', 'Recepción', 'comun', '🛎', 'Recepción principal del edificio, en el acceso desde la calle.', 0, false, 0, null, 13.1, 24.85, 1.9, 5.1, 0.55, false, '{}'::text[]),
  ('OF-C', 'Premium Patio View', 'oficina', '🏢', 'Oficina esquinera del sureste, 3.60 × 4.30 m, pegada a la recepción.', 4, true, 240, 1550, 15.1, 25.65, 3.6, 4.3, 0.85, false, array['wifi','ac','accesible','estacionamiento','recepcion']::text[])
)
update public.espacios e
   set nombre       = p.nombre,
       tipo         = p.tipo::public.tipo_espacio,
       icono        = p.icono,
       descripcion  = p.descripcion,
       capacidad    = p.capacidad,
       reservable   = p.reservable,
       precio_hora  = p.precio_hora,
       precio_dia   = p.precio_dia,
       pos_x        = p.pos_x,
       pos_y        = p.pos_y,
       ancho        = p.ancho,
       fondo        = p.fondo,
       altura       = p.altura,
       abierto      = p.abierto,
       amenidades   = p.amenidades
  from plano_canonico p
 where e.organizacion_id = '11111111-1111-1111-1111-111111111111'
   and e.codigo = p.codigo;

-- ---------- horarios de operación (todos los días, 08:00–19:00) ----------
insert into public.horarios_operacion (organizacion_id, edificio_id, dia_semana, abre, cierra, cerrado)
select '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
       d, '08:00'::time, '19:00'::time, false
  from generate_series(0, 6) d
 where not exists (
   select 1 from public.horarios_operacion h
    where h.edificio_id = '33333333-3333-3333-3333-333333333333' and h.dia_semana = d and h.espacio_id is null
 );

-- ---------- promociones ----------
-- V1 no instala descuentos de ejemplo. Una promoción con un código fácil
-- de adivinar es dinero real: se crea desde administración sólo cuando el
-- negocio haya aprobado importe, vigencia y límites.

-- ======================================================================
-- Para convertir tu propia cuenta en administrador, ejecuta después de
-- registrarte (sustituye el correo):
--
--   update public.usuarios set rol = 'admin' where email = 'tucorreo@ejemplo.com';
--   insert into public.organizacion_usuarios (organizacion_id, usuario_id, rol)
--   select '11111111-1111-1111-1111-111111111111', id, 'admin'
--     from public.usuarios where email = 'tucorreo@ejemplo.com'
--   on conflict do nothing;
-- ======================================================================
