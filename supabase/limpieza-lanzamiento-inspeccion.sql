-- ======================================================================
--  A) INSPECCIÓN ANTES DE LIMPIAR   ·   SÓLO LECTURA
--
--  Para el SQL Editor de Supabase. No hace falta psql.
--
--  Este archivo NO CAMBIA NADA. No borra, no actualiza, no toca
--  secuencias y no abre transacción. Se puede correr las veces que sea,
--  en producción, sin riesgo.
--
--  Sirve para decidir. Primero se lee esto; sólo después, y si lo que
--  sale cuadra, se corre `limpieza-lanzamiento-aplicar.sql`.
--
--  Cada bloque devuelve su propia tabla de resultados. En el SQL Editor
--  se ven una detrás de otra.
-- ======================================================================


-- ----------------------------------------------------------------------
-- 1. Cuánto hay de cada cosa
--
--    Arriba, lo que la limpieza se lleva. Abajo, marcado «CONSERVA», lo
--    que no se toca — está aquí para poder comprobar después que sigue
--    igual.
-- ----------------------------------------------------------------------
select * from (
  select 1 as orden, 'BORRA'    as grupo, 'reservas'            as tabla, count(*) as filas from public.reservas
  union all select 1, 'BORRA', 'pagos',              count(*) from public.pagos
  union all select 1, 'BORRA', 'facturas',           count(*) from public.facturas
  union all select 1, 'BORRA', 'resenas',            count(*) from public.resenas
  union all select 1, 'BORRA', 'favoritos',          count(*) from public.favoritos
  union all select 1, 'BORRA', 'lista_espera',       count(*) from public.lista_espera
  union all select 1, 'BORRA', 'promocion_usos',     count(*) from public.promocion_usos
  union all select 1, 'BORRA', 'notificaciones',     count(*) from public.notificaciones
  union all select 1, 'BORRA', 'conversaciones',     count(*) from public.conversaciones
  union all select 1, 'BORRA', 'mensajes',           count(*) from public.mensajes
  union all select 1, 'BORRA', 'ritmo',              count(*) from public.ritmo
  union all select 2, 'PARCIAL', 'auditoria (sólo filas transaccionales)', count(*) from public.auditoria
  union all select 2, 'NO BORRA', 'bloqueos (los revisas tú, ver bloque 4)', count(*) from public.bloqueos
  union all select 3, 'CONSERVA', 'organizaciones',  count(*) from public.organizaciones
  union all select 3, 'CONSERVA', 'sedes',           count(*) from public.sedes
  union all select 3, 'CONSERVA', 'edificios',       count(*) from public.edificios
  union all select 3, 'CONSERVA', 'pisos',           count(*) from public.pisos
  union all select 3, 'CONSERVA', 'espacios',        count(*) from public.espacios
  union all select 3, 'CONSERVA', 'espacio_fotos',   count(*) from public.espacio_fotos
  union all select 3, 'CONSERVA', 'amenidades',      count(*) from public.amenidades
  union all select 3, 'CONSERVA', 'horarios_operacion', count(*) from public.horarios_operacion
  union all select 3, 'CONSERVA', 'promociones',     count(*) from public.promociones
  union all select 3, 'CONSERVA', 'usuarios',        count(*) from public.usuarios
  union all select 3, 'CONSERVA', 'organizacion_usuarios', count(*) from public.organizacion_usuarios
  union all select 3, 'CONSERVA', 'auth.users',      count(*) from auth.users
) t
order by orden, tabla;


-- ----------------------------------------------------------------------
-- 2. Pagos por estado, con importe
--
--    LO MÁS IMPORTANTE DE TODO EL ARCHIVO.
--
--    Un pago en `aprobado`, `procesando`, `parcial` o `reembolsado`
--    puede ser un cobro REAL en Stripe. Borrarlo no deshace el cobro:
--    sólo borra el rastro de que existió, y entonces ya no hay forma de
--    cuadrar la contabilidad ni de devolverle el dinero a nadie.
--
--    Si aquí aparece cualquiera de esos cuatro estados con filas, hay
--    que mirarlo en el panel de Stripe ANTES de seguir. El script de
--    aplicar se niega a correr mientras existan.
-- ----------------------------------------------------------------------
select
  p.estado,
  count(*)                        as pagos,
  coalesce(sum(p.monto), 0)       as importe_total,
  coalesce(sum(p.reembolsado), 0) as ya_reembolsado,
  min(p.creado_en)                as el_mas_antiguo,
  max(p.creado_en)                as el_mas_reciente,
  case
    when p.estado in ('aprobado', 'procesando', 'parcial', 'reembolsado')
      then '⚠️  DINERO — revisar en Stripe antes de borrar'
    else 'sin cobro asociado'
  end                             as aviso
from public.pagos p
group by p.estado
order by
  (p.estado in ('aprobado', 'procesando', 'parcial', 'reembolsado')) desc,
  p.estado;


-- ----------------------------------------------------------------------
-- 3. Los pagos con dinero, uno por uno
--
--    Para poder buscarlos en Stripe por `proveedor_id` (el
--    `pi_…` del PaymentIntent) sin tener que adivinar.
--    Si el bloque 2 sale vacío de estos cuatro estados, esto también.
-- ----------------------------------------------------------------------
select
  p.folio,
  p.estado,
  p.monto,
  p.reembolsado,
  p.moneda,
  p.metodo,
  p.proveedor_id            as stripe_payment_intent,
  p.pagado_en,
  r.folio                   as reserva,
  r.estado                  as estado_reserva,
  e.nombre                  as espacio,
  u.email                   as cliente
from public.pagos p
left join public.reservas r on r.id = p.reserva_id
left join public.espacios e on e.id = r.espacio_id
left join public.usuarios u on u.id = p.usuario_id
where p.estado in ('aprobado', 'procesando', 'parcial', 'reembolsado')
order by p.creado_en desc;


-- ----------------------------------------------------------------------
-- 4. BLOQUEOS FUTUROS  ·  esto lo decides tú
--
--    Un bloqueo es un horario cerrado a la venta: mantenimiento, obra,
--    un evento privado.
--
--    El script de aplicar sólo borra los YA TERMINADOS (`fin < now()`),
--    que no pueden afectar a nada. Los de esta lista —vigentes y
--    futuros— NO los toca.
--
--    Son los que importan: si borras uno que era real, ese horario se
--    pone a la venta y se puede reservar un espacio que está en obras.
--    Míralos aquí y, si alguno sobra, bórralo a mano — al final del
--    script de aplicar hay una consulta preparada.
-- ----------------------------------------------------------------------
select
  b.id,
  b.espacio_id,
  e.nombre                  as espacio,
  b.edificio_id,
  ed.nombre                 as edificio,
  b.inicio,
  b.fin,
  b.motivo,
  b.creado_en,
  u.email                   as creado_por,
  case
    when b.inicio > now() then 'FUTURO — aún no empieza'
    else 'EN CURSO — ya empezó y todavía no termina'
  end                       as situacion
from public.bloqueos b
left join public.espacios  e  on e.id  = b.espacio_id
left join public.edificios ed on ed.id = b.edificio_id
left join public.usuarios  u  on u.id  = b.creado_por
where b.fin >= now()
order by b.inicio;


-- ----------------------------------------------------------------------
-- 5. Bloqueos ya terminados
--
--    Sólo informativo. Tampoco se borran solos.
-- ----------------------------------------------------------------------
select
  count(*)      as bloqueos_pasados,
  min(b.inicio) as el_mas_antiguo,
  max(b.fin)    as el_ultimo_en_terminar
from public.bloqueos b
where b.fin < now();


-- ----------------------------------------------------------------------
-- 6. Reservas por estado
--
--    Para saber qué se va exactamente. Una reserva `confirmada` en el
--    futuro es un cliente que espera entrar por la puerta ese día: si
--    aparece alguna, no es una prueba y hay que hablar con esa persona
--    antes de borrarla.
-- ----------------------------------------------------------------------
select
  r.estado,
  count(*)                                            as reservas,
  count(*) filter (where r.inicio > now())            as en_el_futuro,
  coalesce(sum(r.total), 0)                           as importe_total,
  min(r.inicio)                                       as la_mas_temprana,
  max(r.inicio)                                       as la_mas_tardia
from public.reservas r
group by r.estado
order by r.estado;


-- ----------------------------------------------------------------------
-- 7. Reservas confirmadas que todavía no han ocurrido
--
--    Si esto devuelve algo, NO se limpia sin avisar a esas personas.
-- ----------------------------------------------------------------------
select
  r.folio,
  r.estado,
  r.inicio,
  r.fin,
  r.total,
  e.nombre  as espacio,
  u.email   as cliente,
  u.telefono
from public.reservas r
left join public.espacios e on e.id = r.espacio_id
left join public.usuarios u on u.id = r.usuario_id
where r.estado in ('confirmada', 'en_curso')
  and r.inicio > now()
order by r.inicio;


-- ----------------------------------------------------------------------
-- 8. Contadores derivados que la limpieza pone a cero
--
--    No son reservas: son los números pegados al catálogo que hacen que
--    un despacho parezca usado. Si no se ponen a cero, la app abre
--    diciendo «87 reservas · 4,6 ★ (19 opiniones)» sin una sola reserva
--    detrás.
-- ----------------------------------------------------------------------
select
  'espacios con total_reservas > 0' as contador,
  count(*)                          as filas,
  max(total_reservas)::text         as valor_maximo
from public.espacios where total_reservas > 0
union all
select 'espacios con total_resenas > 0', count(*), max(total_resenas)::text
  from public.espacios where total_resenas > 0
union all
select 'espacios con calificacion > 0', count(*), max(calificacion)::text
  from public.espacios where calificacion > 0
union all
select 'promociones con usos_actuales > 0', count(*), max(usos_actuales)::text
  from public.promociones where usos_actuales > 0
union all
select 'conversaciones con no leídos', count(*),
       max(no_leidos_usuario + no_leidos_staff)::text
  from public.conversaciones where no_leidos_usuario > 0 or no_leidos_staff > 0;


-- ----------------------------------------------------------------------
-- 9. Dónde están los folios ahora
--
--    Después de limpiar, el script de aplicar los reajusta. Esto es la
--    foto de antes.
-- ----------------------------------------------------------------------
select 'reservas' as tabla,
       (select last_value from public.seq_folio_reserva) as secuencia,
       (select max(folio) from public.reservas)          as folio_mas_alto
union all
select 'pagos',
       (select last_value from public.seq_folio_pago),
       (select max(folio) from public.pagos)
union all
select 'facturas',
       (select last_value from public.seq_folio_factura),
       (select max(folio) from public.facturas);


-- ======================================================================
--  QUÉ MIRAR ANTES DE SEGUIR
--
--    Bloque 2 y 3 · ¿hay pagos con dinero? → míralos en Stripe.
--                   Mientras existan, el script de aplicar se niega
--                   a correr. Es a propósito.
--
--    Bloque 4     · ¿hay bloqueos futuros de verdad? → no los borres.
--                   No se borran solos.
--
--    Bloque 7     · ¿hay clientes con reserva confirmada por venir?
--                   → avísales antes.
--
--  Si los tres salen vacíos, limpiar es seguro.
-- ======================================================================
