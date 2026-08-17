-- ======================================================================
-- migracion-06-unificar-catalogo.sql
--
-- 🚨 IMPORTANTE. Léela antes de ejecutarla: cambia el catálogo visible.
--    Si instalas de cero, seed.sql ya trae todo esto.
--
-- Qué problema resuelve
-- ---------------------
-- Había TRES catálogos distintos que decían ser el mismo edificio:
--
--   js/data/planta.js   24 espacios · 4 en renta · códigos OF-A, CO-01…
--   supabase/seed.sql   23 espacios · faltaba la Habitación · OF-05, SRV-02
--   la base REAL        18 espacios · códigos ESP-001…ESP-018
--                       y los 18 marcados como reservables
--
-- La base nunca se sembró con seed.sql: trae un conjunto anterior, hecho
-- a mano, con códigos ESP-nnn. Por eso las migraciones anteriores que
-- buscaban 'OF-PRINCIPAL', 'SJ-01' o 'EA-01' NO encontraban nada allí:
-- el catálogo seguía ofreciendo en renta el jardín, el patio, el
-- almacén, la cochera y la recepción.
--
-- Qué hace esta migración
-- -----------------------
--   1. Avisa de las reservas futuras sobre espacios que dejan de rentarse.
--   2. Renombra los códigos ESP-nnn a los del plano, emparejando por
--      NOMBRE —porque los códigos no coinciden— y sólo si el código
--      destino está libre. Renombrar NO pierde reservas: reservas.espacio_id
--      apunta al uuid de la fila, no al código.
--   3. Pone tipo, reservable y geometría según el plano, que es la única
--      fuente de verdad declarada del edificio.
--   4. Inserta los espacios del plano que falten (baños, lobby, cocina…).
--      Son informativos y no se reservan, así que no hay nada que perder.
--   5. Informa de lo que quede sin equivalencia SIN borrarlo.
--
-- Qué NO hace, a propósito
-- ------------------------
--   · No borra nada. Ni un espacio, ni una reserva.
--   · No toca el PRECIO de lo que sigue en renta: son datos de tu
--     negocio y los de la base no coinciden con los del plano. Decide tú
--     cuál vale — ver OWNER_ACTIONS.md §11.
--
-- Se puede ejecutar varias veces sin problema.
-- ======================================================================

begin;

-- Tabla de correspondencias, generada desde js/data/planta.js.
create temporary table plano_ref (
  codigo text primary key, nombre text, tipo text, reservable boolean,
  pos_x numeric, pos_y numeric, ancho numeric, fondo numeric,
  altura numeric, abierto boolean, capacidad int, icono text, descripcion text
) on commit drop;

-- Minúsculas y sin tildes: «Almacen» y «Almacén» tienen que ser lo mismo.
create or replace function pg_temp.normalizar(t text) returns text
language sql immutable as $fn$
  select lower(translate(coalesce(t,''), 'áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙäëïöüÄËÏÖÜñÑ', 'aeiouAEIOUaeiouAEIOUaeiouAEIOUnN'));
$fn$;

insert into plano_ref values
  ('HAB-01', 'Habitación', 'oficina', false, 0, 0, 5.15, 2.85, 0.85, false, 2, '🛏', 'Cuarto privado en la esquina noroeste, junto a la Oficina Principal.'),
  ('OF-PRINCIPAL', 'Oficina Principal', 'oficina', false, 0, 2.85, 5.15, 5.35, 0.85, false, 10, '🏢', 'La oficina más grande del edificio: 5.15 × 5.35 m, con baño propio en la esquina y salida al jardín privado.'),
  ('WC-01', 'Baño', 'servicio', false, 0, 6.8, 1.8, 1.4, 0.55, false, 0, '🚻', 'Baño privado, dentro de la Oficina Principal.'),
  ('JP-01', 'Jardín Privado', 'comun', false, 0, 8.2, 5.15, 4.25, 0.12, true, 0, '🌿', 'Jardín exterior contiguo a la Oficina Principal.'),
  ('EA-01', 'Espacio Abierto', 'coworking', false, 0, 12.45, 5.8, 17.5, 0.12, true, 18, '🧑‍💻', 'Planta libre de coworking: 5.80 × 17.50 m, la superficie más grande del edificio.'),
  ('SJ-01', 'Sala de Juntas', 'sala_juntas', false, 5.9, 0.3, 4.6, 4, 0.85, false, 10, '📊', 'Sala ejecutiva de 4.60 × 4.00 m con mesa para diez personas, arriba del lobby.'),
  ('LB-01', 'Lobby', 'comun', false, 5.9, 4.6, 2.2, 2.1, 0.55, false, 0, '🛋', 'Vestíbulo de entrada, debajo de la Sala de Juntas.'),
  ('WC-02', 'Baño', 'servicio', false, 5.9, 7.1, 1.55, 2, 0.55, false, 0, '🚻', 'Baño de servicio junto al lobby.'),
  ('OF-B', 'Ejecutiva Compact', 'oficina', true, 5.8, 12.9, 3, 4.8, 0.85, false, 4, '🏢', 'Oficina de 3.00 × 4.80 m, entre el muro poniente y la cocina. Baja más que la fila de servicios.'),
  ('AR-01', 'Archivero', 'servicio', false, 5.8, 19.6, 2.7, 3, 0.55, false, 0, '🗄', 'Archivo y almacenamiento documental, debajo de la Oficina B.'),
  ('PT-01', 'Patio', 'comun', false, 10.7, 0, 4.2, 12.9, 0.12, true, 0, '🌳', 'Patio interior con pendiente al poniente. Da luz y ventilación al centro del edificio.'),
  ('CM-01', 'Comunitario', 'comun', false, 14.9, 0, 3.8, 12.9, 0.12, true, 0, '☕', 'Área común al aire libre con una mesa redonda de 2.50 m y dos de 1.20 m.'),
  ('CO-01', 'Cocina', 'servicio', false, 8.8, 12.9, 2.7, 2.6, 0.55, false, 0, '🍳', 'Cocina compartida con cafetera, microondas y refrigerador.'),
  ('WC-03', 'Baño', 'servicio', false, 11.5, 12.9, 1.8, 2.6, 0.55, false, 0, '🚻', 'Baño de uso común junto a la cocina.'),
  ('SRV-01', 'Servicio', 'servicio', false, 13.3, 12.9, 2.2, 2.6, 0.55, false, 0, '🧹', 'Cuarto de servicio y limpieza.'),
  ('OF-A', 'Ejecutiva Plus', 'oficina', true, 15.5, 12.9, 3.2, 4.1, 0.85, false, 5, '🏢', 'Oficina de 3.20 × 4.10 m en el ala oriente, al final de la fila de servicios.'),
  ('AL-01', 'Almacén', 'servicio', false, 8.5, 18.5, 6.9, 4.6, 0.55, false, 0, '📦', 'Bodega general de 6.90 × 4.60 m, en el centro de la planta.'),
  ('OF-D', 'Ejecutiva Lounge', 'oficina', true, 15.5, 18.5, 3.2, 3.6, 0.85, false, 3, '🏢', 'Oficina de 3.20 × 3.60 m en el ala oriente, junto al almacén.'),
  ('WC-04', 'Baño', 'servicio', false, 17.1, 22.3, 1.6, 1.4, 0.55, false, 0, '🚻', 'Baño de uso común del ala oriente.'),
  ('AL-02', 'Almacén', 'servicio', false, 17.1, 23.7, 1.6, 1.9, 0.55, false, 0, '📦', 'Bodega pequeña, arriba de la Oficina C.'),
  ('PK-01', 'Cochera', 'estacionamiento', false, 5.9, 23.75, 5, 6.2, 0.12, true, 0, '🚗', 'Cochera techada de 5.00 × 6.20 m con acceso directo desde la calle.'),
  ('OF-01', 'Oficina', 'oficina', false, 11, 24.85, 2, 5.1, 0.85, false, 4, '🏢', 'Oficina de 5.10 m de fondo, pegada a la recepción.'),
  ('RC-01', 'Recepción', 'comun', false, 13.1, 24.85, 1.9, 5.1, 0.55, false, 0, '🛎', 'Recepción principal del edificio, en el acceso desde la calle.'),
  ('OF-C', 'Premium Patio View', 'oficina', true, 15.1, 25.65, 3.6, 4.3, 0.85, false, 4, '🏢', 'Oficina esquinera del sureste, 3.60 × 4.30 m, pegada a la recepción.');

-- ----------------------------------------------------------------------
-- 1. Aviso: reservas futuras sobre espacios que dejarán de rentarse
-- ----------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.reservas r
    join public.espacios e on e.id = r.espacio_id
    join plano_ref p on p.nombre = e.nombre
   where not p.reservable
     and r.estado in ('pendiente','confirmada','en_curso')
     and r.fin > now();
  if v_n > 0 then
    raise warning 'Hay % reserva(s) futura(s) sobre espacios que dejan de rentarse. NO se cancelan: revísalas y avisa a esas personas.', v_n;
  end if;
end $$;

-- ----------------------------------------------------------------------
-- 2. Renombrar al código del plano, emparejando por nombre.
--
--    Dos cuidados que no son evidentes:
--
--    · TILDES. La base escribe «Almacen» y el plano «Almacén». Comparar
--      exacto deja ese espacio sin emparejar y luego aparece como
--      sobrante. Se normaliza a minúsculas y sin acentos.
--
--    · NOMBRES REPETIDOS. En el plano hay cuatro «Baño» y dos «Almacén»,
--      así que el nombre NO identifica de forma única. Se emparejan sólo
--      los nombres que aparecen una sola vez en el plano; los repetidos
--      se resuelven abajo por tamaño, que sí los distingue.
--
--    Y sólo si el código destino está libre, para no chocar con la
--    restricción unique (organizacion_id, codigo) ni duplicar nada.
-- ----------------------------------------------------------------------
create temporary view plano_unico as
  select * from plano_ref
   where pg_temp.normalizar(nombre) in (
     select pg_temp.normalizar(nombre) from plano_ref group by 1 having count(*) = 1
   );

update public.espacios e
   set codigo = p.codigo
  from plano_unico p
 where pg_temp.normalizar(p.nombre) = pg_temp.normalizar(e.nombre)
   and e.codigo <> p.codigo
   and not exists (
     select 1 from public.espacios otro
      where otro.organizacion_id = e.organizacion_id
        and otro.codigo = p.codigo
        and otro.id <> e.id
   );

-- Los de nombre repetido, por tamaño: el almacén grande del centro
-- (6.90 × 4.60) es AL-01; el pequeño de arriba de la Oficina C, AL-02.
update public.espacios e
   set codigo = p.codigo
  from plano_ref p
 where pg_temp.normalizar(p.nombre) = pg_temp.normalizar(e.nombre)
   and e.codigo <> p.codigo
   and abs(coalesce(e.ancho,0) - p.ancho) < 0.25
   and abs(coalesce(e.fondo,0) - p.fondo) < 0.25
   and not exists (
     select 1 from public.espacios otro
      where otro.organizacion_id = e.organizacion_id
        and otro.codigo = p.codigo
        and otro.id <> e.id
   );

-- ----------------------------------------------------------------------
-- 3. Alinear tipo, disponibilidad comercial y geometría con el plano.
--    El precio NO se toca si el espacio sigue en renta; si deja de
--    rentarse se pone a 0, porque enseñar tarifa de algo que no se
--    alquila es peor que no enseñar nada.
-- ----------------------------------------------------------------------
update public.espacios e
   set nombre     = p.nombre,
       tipo       = p.tipo::public.tipo_espacio,
       reservable = p.reservable,
       icono      = p.icono,
       descripcion = p.descripcion,
       capacidad  = p.capacidad,
       pos_x      = p.pos_x,
       pos_y      = p.pos_y,
       ancho      = p.ancho,
       fondo      = p.fondo,
       altura     = p.altura,
       abierto    = p.abierto,
       precio_hora = case when p.reservable then e.precio_hora else 0 end,
       precio_dia  = case when p.reservable then e.precio_dia  else null end,
       servicios   = case when p.reservable then e.servicios   else '{}' end
  from plano_ref p
 where p.codigo = e.codigo;

-- ----------------------------------------------------------------------
-- 4. Insertar los espacios del plano que falten. Todos los que faltan
--    son informativos (baños, lobby, cocina, archivo): no se reservan,
--    así que aparecen sin precio y sin aforo.
-- ----------------------------------------------------------------------
insert into public.espacios (
  organizacion_id, sede_id, edificio_id, piso_id,
  codigo, nombre, tipo, icono, descripcion, capacidad, reservable, estado,
  precio_hora, precio_dia, pos_x, pos_y, ancho, fondo, altura, abierto, activo)
select o.organizacion_id, o.sede_id, o.edificio_id, o.piso_id,
       p.codigo, p.nombre, p.tipo::public.tipo_espacio, p.icono, p.descripcion, p.capacidad,
       p.reservable, 'disponible',
       case when p.reservable then 0 else 0 end, null,
       p.pos_x, p.pos_y, p.ancho, p.fondo, p.altura, p.abierto, true
  from plano_ref p
 cross join lateral (
   select organizacion_id, sede_id, edificio_id, piso_id
     from public.espacios order by creado_en limit 1
 ) o
 where not exists (
   select 1 from public.espacios e where e.codigo = p.codigo
 );

-- ----------------------------------------------------------------------
-- 5. Qué ha quedado sin equivalencia en el plano
-- ----------------------------------------------------------------------
-- Lo que no está en el plano se DESACTIVA: deja de venderse y deja de
-- dibujarse, pero no se borra. Borrar sería irreversible y podría
-- llevarse por delante reservas; desactivar se deshace con un UPDATE.
update public.espacios e
   set activo = false, reservable = false, precio_hora = 0, precio_dia = null
 where not exists (select 1 from plano_ref p where p.codigo = e.codigo)
   and (e.activo or e.reservable);

do $$
declare v_sobran text;
begin
  select string_agg(e.codigo || ' («' || e.nombre || '»)', ', ' order by e.codigo)
    into v_sobran
    from public.espacios e
   where not exists (select 1 from plano_ref p where p.codigo = e.codigo);

  if v_sobran is not null then
    raise warning 'Estos espacios no existen en el plano: %. Se han DESACTIVADO (no borrado): ya no se venden ni se dibujan, y sus reservas siguen intactas. Decide si son reales —y entonces añádelos a js/data/planta.js— o bórralos tú cuando lo confirmes.', v_sobran;
  end if;
end $$;

commit;

-- ----------------------------------------------------------------------
-- Comprobación después de aplicar:
--
--   select count(*) as fisicos,
--          count(*) filter (where reservable) as en_renta
--     from public.espacios;
--     -- se esperan 24 físicos y 4 en renta (OF-A, OF-B, OF-C, OF-D)
--
--   select codigo, nombre, precio_hora from public.espacios
--    where reservable order by codigo;
--     -- revisa que los precios sean los que quieres cobrar
-- ----------------------------------------------------------------------
