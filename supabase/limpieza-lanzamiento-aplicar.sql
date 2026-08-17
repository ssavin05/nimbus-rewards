-- ======================================================================
--  B) LIMPIEZA DEFINITIVA   ·   ESTO SÍ BORRA
--
--  Para el SQL Editor de Supabase. Sin meta-comandos de psql.
--
--  ANTES DE CORRER ESTO hay que haber leído
--  `limpieza-lanzamiento-inspeccion.sql`, que no toca nada.
--
--  QUÉ BORRA
--    reservas · pagos · facturas · reseñas · favoritos · lista_espera
--    promocion_usos · notificaciones · conversaciones · mensajes · ritmo
--    la auditoría de esas tablas, y los bloqueos YA TERMINADOS.
--    Pone a cero los contadores pegados al catálogo.
--
--  QUÉ NO TOCA, PASE LO QUE PASE
--    organizaciones · sedes · edificios · pisos · espacios
--    espacio_fotos · amenidades · horarios_operacion · promociones
--    usuarios · organizacion_usuarios · auth.users
--    los BLOQUEOS vigentes o futuros
--    el esquema, las políticas RLS, los disparadores y las funciones
--
--  DOS FRENOS
--    1. Si hay pagos en `aprobado`, `procesando`, `parcial` o
--       `reembolsado`, ABORTA. Pueden ser cobros reales.
--    2. Si al terminar el catálogo o los usuarios quedaran vacíos,
--       aborta y deshace todo.
-- ======================================================================


-- ----------------------------------------------------------------------
--  ── PARA SALTARSE EL FRENO DE LOS PAGOS ──
--
--  Sólo si ya miraste esos pagos en el panel de Stripe y TODOS son de
--  prueba. Quita el comentario de la línea siguiente y vuelve a correr
--  el archivo entero:
--
-- set limpieza.pagos_revisados = 'si';
-- ----------------------------------------------------------------------


-- ----------------------------------------------------------------------
-- A partir de aquí, todo o nada.
-- ----------------------------------------------------------------------
begin;

-- ----------------------------------------------------------------------
-- FRENO 1 · pagos que pueden ser dinero de verdad
--
--    Va DENTRO de la transacción, y es importante que sea así.
--
--    Al principio lo puse fuera, pensando que abortar antes de abrir
--    nada era más limpio. La prueba demostró lo contrario: un cliente
--    que no pare al primer error —psql sin ON_ERROR_STOP, y no está
--    garantizado lo que hace el editor del panel— se salta el
--    RAISE EXCEPTION y sigue con los DELETE tan tranquilo. El freno no
--    frenaba nada: borró los cinco pagos que debía proteger.
--
--    Aquí dentro no depende de la buena voluntad del cliente: si salta,
--    la transacción queda abortada, todo lo que viene detrás falla y el
--    COMMIT del final se convierte en ROLLBACK. No se borra nada.
--
--    Borrar un pago no deshace el cobro en Stripe. Sólo borra la prueba
--    de que ocurrió: después no hay forma de cuadrar la contabilidad ni
--    de devolverle el dinero a quien lo pagó.
-- ----------------------------------------------------------------------
do $$
declare
  v_n       int;
  v_importe numeric;
  v_estados text;
begin
  select count(*), coalesce(sum(monto), 0),
         string_agg(distinct estado::text, ', ' order by estado::text)
    into v_n, v_importe, v_estados
    from public.pagos
   where estado in ('aprobado', 'procesando', 'parcial', 'reembolsado');

  if v_n = 0 then
    raise notice 'Freno 1: no hay pagos con dinero. Se puede continuar.';
    return;
  end if;

  if coalesce(current_setting('limpieza.pagos_revisados', true), '') = 'si' then
    raise warning 'Freno 1 DESACTIVADO a mano: se van a borrar % pago(s) por % (%).',
      v_n, v_importe, v_estados;
    return;
  end if;

  raise exception
    E'ABORTADO. Hay % pago(s) en estado «%» por un total de %.\n'
     '\n'
     'Puede ser dinero real. Borrarlos no deshace el cobro en Stripe:\n'
     'solo borra el rastro, y despues no se puede cuadrar ni devolver.\n'
     '\n'
     'Que hacer:\n'
     '  1. Corre limpieza-lanzamiento-inspeccion.sql y mira el bloque 3.\n'
     '  2. Busca cada proveedor_id (pi_...) en el panel de Stripe.\n'
     '  3. Si TODOS son de prueba, quita el comentario de\n'
     '     "set limpieza.pagos_revisados = ''si'';" en la cabecera de\n'
     '     este archivo y vuelve a ejecutarlo entero.',
    v_n, v_estados, v_importe;
end $$;

-- ----------------------------------------------------------------------
-- 1. El borrado, de hijo a padre
--
--    Casi todas las claves foráneas están en cascada, pero se hace
--    explícito: así se ve qué se lleva cada cosa y no depende de cómo
--    estén configuradas las FK.
-- ----------------------------------------------------------------------

-- 1.1 Lo que cuelga de una reserva
delete from public.facturas;
delete from public.pagos;
delete from public.resenas;
delete from public.promocion_usos;

-- 1.2 Las reservas
delete from public.reservas;

-- 1.3 Rastro personal de las pruebas
delete from public.favoritos;
delete from public.lista_espera;
delete from public.notificaciones;
delete from public.mensajes;
delete from public.conversaciones;
delete from public.ritmo;             -- contador anti-abuso, se rellena solo

-- 1.4 Auditoría
--     Sólo la de las tablas transaccionales. Si la administración hizo
--     cambios reales de catálogo, ese historial se queda.
delete from public.auditoria
 where tabla in ('reservas', 'pagos', 'facturas', 'resenas', 'notificaciones')
    or accion = 'desconocida';

-- 1.5 Bloqueos YA TERMINADOS
--     Los vigentes y los futuros NO se tocan: pueden ser mantenimiento
--     real, y borrarlos pondría a la venta un horario que no debe
--     venderse. Se revisan a mano (ver el final del archivo).
delete from public.bloqueos where fin < now();


-- ----------------------------------------------------------------------
-- 2. Contadores derivados a cero
--
--    Se quedan pegados al catálogo aunque se borren las reservas, y son
--    lo que hace que un despacho parezca usado: «87 reservas · 4,6 ★
--    (19 opiniones)» sin una sola reserva detrás.
-- ----------------------------------------------------------------------
update public.espacios
   set total_reservas = 0,
       total_resenas  = 0,
       calificacion   = 0
 where total_reservas <> 0 or total_resenas <> 0 or calificacion <> 0;

update public.promociones
   set usos_actuales = 0
 where usos_actuales <> 0;

update public.conversaciones
   set no_leidos_usuario = 0, no_leidos_staff = 0
 where no_leidos_usuario <> 0 or no_leidos_staff <> 0;


-- ----------------------------------------------------------------------
-- FRENO 2 · el catálogo tiene que seguir ahí
--
--    Si algo se llevó por delante lo que no debía, esto revienta y el
--    COMMIT de abajo no llega a ejecutarse: la transacción se deshace
--    entera.
-- ----------------------------------------------------------------------
do $$
declare v_mal text := '';
begin
  if (select count(*) from public.espacios)       = 0 then v_mal := v_mal || 'espacios '; end if;
  if (select count(*) from public.organizaciones) = 0 then v_mal := v_mal || 'organizaciones '; end if;
  if (select count(*) from public.usuarios)       = 0 then v_mal := v_mal || 'usuarios '; end if;
  if (select count(*) from auth.users)            = 0 then v_mal := v_mal || 'auth.users '; end if;
  if v_mal <> '' then
    raise exception 'ABORTADO: la limpieza vació algo que debía conservarse: %', v_mal;
  end if;
  raise notice 'Freno 2: catálogo, usuarios y configuración intactos.';
end $$;

commit;


-- ----------------------------------------------------------------------
-- 3. Los folios, DESPUÉS del COMMIT y fuera de la transacción
--
--    `setval` no obedece a ROLLBACK: en PostgreSQL las secuencias no
--    son transaccionales. Si esto estuviera dentro y la transacción se
--    deshiciera, el contador se quedaría en 1 con las reservas todavía
--    ahí, y la siguiente chocaría:
--
--      duplicate key value violates unique constraint "reservas_folio_key"
--      Key (folio)=(RES-2026-00013) already exists
--
--    Por eso el valor se deduce de los folios que QUEDAN en la tabla.
--    Sale bien tanto si arriba se limpió como si se abortó, y se puede
--    correr las veces que haga falta.
-- ----------------------------------------------------------------------
do $$
declare
  v_n bigint;
  t   record;
begin
  for t in
    select 'reservas' tabla, 'RES' pre, 'public.seq_folio_reserva' seq
    union all select 'pagos',    'PAG', 'public.seq_folio_pago'
    union all select 'facturas', 'FAC', 'public.seq_folio_factura'
  loop
    execute format(
      'select coalesce(max(split_part(folio, ''-'', 3)::bigint), 0)
         from public.%I where folio ~ %L',
      t.tabla, '^' || t.pre || '-[0-9]{4}-[0-9]+$')
    into v_n;
    -- is_called = false con 1 → el siguiente folio es 00001.
    -- is_called = true  con N → el siguiente folio es N+1.
    perform setval(t.seq, greatest(v_n, 1), v_n > 0);
    raise notice 'Folio %: el siguiente será %',
      t.pre, lpad((greatest(v_n, 1) + (case when v_n > 0 then 1 else 0 end))::text, 5, '0');
  end loop;
end $$;


-- ----------------------------------------------------------------------
-- 4. Cómo quedó
-- ----------------------------------------------------------------------
select 'reservas' as tabla, count(*) as filas from public.reservas
union all select 'pagos',          count(*) from public.pagos
union all select 'facturas',       count(*) from public.facturas
union all select 'resenas',        count(*) from public.resenas
union all select 'favoritos',      count(*) from public.favoritos
union all select 'lista_espera',   count(*) from public.lista_espera
union all select 'promocion_usos', count(*) from public.promocion_usos
union all select 'notificaciones', count(*) from public.notificaciones
union all select 'conversaciones', count(*) from public.conversaciones
union all select 'mensajes',       count(*) from public.mensajes
union all select 'ritmo',          count(*) from public.ritmo
union all select 'auditoria',      count(*) from public.auditoria
union all select '· bloqueos vigentes (conservados)', count(*) from public.bloqueos
union all select '· espacios (conservados)',      count(*) from public.espacios
union all select '· promociones (conservadas)',   count(*) from public.promociones
union all select '· usuarios (conservados)',      count(*) from public.usuarios
union all select '· auth.users (conservados)',    count(*) from auth.users
order by tabla;


-- ======================================================================
--  LO QUE QUEDA POR HACER A MANO
--
--  1. LOS BLOQUEOS VIGENTES Y FUTUROS siguen ahí, a propósito.
--     Míralos y borra sólo los que sobren, uno a uno:
--
--       select id, espacio_id, edificio_id, inicio, fin, motivo
--         from public.bloqueos where fin >= now() order by inicio;
--
--       -- delete from public.bloqueos where id = 'pega-aquí-el-id';
--
--  2. EN LA APLICACIÓN, cambia `app.epocaLanzamiento` en
--     `js/core/config.js` por la fecha de hoy y vuelve a publicar.
--
--     Sin eso, los equipos que ya abrieron la app siguen enseñando los
--     horarios ocupados que acabas de borrar: esa ocupación está en su
--     IndexedDB y en la caché del Service Worker, y la base de datos no
--     puede alcanzarla. Al cambiar la fecha, cada equipo la purga solo
--     la primera vez que abre. No cierra la sesión de nadie.
-- ======================================================================
