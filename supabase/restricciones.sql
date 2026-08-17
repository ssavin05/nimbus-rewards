-- ======================================================================
--  FASE 01 §1.3 — RESTRICCIONES EN POSTGRESQL
--
--  «No confíes en JavaScript.»
--
--  Todo lo que hay aquí abajo lo puede romper un `fetch()` a mano si sólo
--  lo valida el navegador. Un CHECK de PostgreSQL no se puede saltar:
--  ni con DevTools, ni con curl, ni con un cliente propio, ni por un bug
--  en un trigger, ni por una RPC mal escrita mañana.
--
--  Los triggers de seguridad.sql y los CHECK de aquí NO son redundantes:
--  el trigger CALCULA (y por tanto puede tener errores), el CHECK VERIFICA
--  (y aborta la transacción si el cálculo salió mal). El más importante de
--  todos es `reservas_total_cuadra`: convierte la regla de precios de
--  FASE 01 §1.4 en una invariante que la base impone.
--
--  Idempotente: se puede correr las veces que haga falta.
--
--  Orden:  schema.sql → policies.sql → seguridad.sql → restricciones.sql
-- ======================================================================

-- Añade un CHECK sólo si no existe ya, y avisa (sin abortar) cuando los
-- datos actuales lo violan: así este archivo se puede correr sobre una
-- base que ya tiene historia sin dejarla a medias.
create or replace function public.agregar_check(
  p_tabla text, p_nombre text, p_expresion text
) returns void language plpgsql as $$
declare v_malas bigint;
begin
  if exists (select 1 from pg_constraint where conname = p_nombre
              and conrelid = ('public.' || p_tabla)::regclass) then
    return;
  end if;
  execute format('select count(*) from public.%I where not (%s)', p_tabla, p_expresion)
     into v_malas;
  if v_malas > 0 then
    raise warning 'restricciones: % filas de %.% incumplen "%" — se salta',
      v_malas, 'public', p_tabla, p_nombre;
    return;
  end if;
  execute format('alter table public.%I add constraint %I check (%s)',
                 p_tabla, p_nombre, p_expresion);
end $$;

-- ----------------------------------------------------------------------
-- 1. ORGANIZACIONES
-- ----------------------------------------------------------------------

-- Un impuesto es una fracción, no un porcentaje: 0.16, nunca 16.
select public.agregar_check('organizaciones', 'org_tasa_valida',
  'tasa_impuesto >= 0 and tasa_impuesto <= 1');
select public.agregar_check('organizaciones', 'org_moneda_iso',
  $q$moneda ~ '^[A-Z]{3}$'$q$);
select public.agregar_check('organizaciones', 'org_slug_valido',
  $q$slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'$q$);
select public.agregar_check('organizaciones', 'org_nombre_no_vacio',
  $q$length(btrim(nombre)) between 1 and 200$q$);

-- ----------------------------------------------------------------------
-- 2. USUARIOS
-- ----------------------------------------------------------------------

select public.agregar_check('usuarios', 'usuario_email_valido',
  $q$email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'$q$);
select public.agregar_check('usuarios', 'usuario_tema_valido',
  $q$tema in ('auto','claro','oscuro')$q$);
select public.agregar_check('usuarios', 'usuario_idioma_valido',
  $q$idioma ~ '^[a-z]{2}$'$q$);
select public.agregar_check('usuarios', 'usuario_nombre_razonable',
  $q$nombre is null or length(nombre) <= 120$q$);
select public.agregar_check('usuarios', 'usuario_telefono_razonable',
  $q$telefono is null or telefono ~ '^[+0-9()\-. ]{7,25}$'$q$);
-- El RFC mexicano: 3 letras (moral) o 4 (física), fecha, homoclave.
select public.agregar_check('usuarios', 'usuario_rfc_valido',
  $q$rfc is null or rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'$q$);

-- ----------------------------------------------------------------------
-- 3. SEDES, EDIFICIOS Y PISOS  (geometría y geografía)
-- ----------------------------------------------------------------------

select public.agregar_check('sedes', 'sede_lat_valida',
  'lat is null or (lat >= -90 and lat <= 90)');
select public.agregar_check('sedes', 'sede_lng_valida',
  'lng is null or (lng >= -180 and lng <= 180)');
select public.agregar_check('sedes', 'sede_slug_valido',
  $q$slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'$q$);

-- Un edificio con ancho 0 rompe el mapa y cualquier cálculo de área.
select public.agregar_check('edificios', 'edificio_dimensiones',
  'ancho_m > 0 and fondo_m > 0 and ancho_m <= 1000 and fondo_m <= 1000');
select public.agregar_check('pisos', 'piso_altura_valida',
  'altura_m > 0 and altura_m <= 30');
select public.agregar_check('pisos', 'piso_numero_valido',
  'numero between -10 and 200');

-- ----------------------------------------------------------------------
-- 4. ESPACIOS  —  precios y aforo
-- ----------------------------------------------------------------------

-- «precio >= 0» y «capacidad > 0», textualmente lo que pide FASE 01 §1.3.
select public.agregar_check('espacios', 'espacio_precios_no_negativos',
  'precio_hora >= 0
   and (precio_dia is null or precio_dia >= 0)
   and (precio_mes is null or precio_mes >= 0)');
-- Ojo con «capacidad > 0» a secas: la recepción, los pasillos y los
-- baños son espacios reales del plano con aforo 0, y no se reservan.
-- La regla correcta es: si se puede reservar, tiene que caber alguien.
alter table public.espacios drop constraint if exists espacio_capacidad_positiva;
select public.agregar_check('espacios', 'espacio_capacidad_coherente',
  'capacidad >= 0 and capacidad <= 10000 and (not reservable or capacidad > 0)');
select public.agregar_check('espacios', 'espacio_minimo_horas',
  'precio_minimo_horas >= 1 and precio_minimo_horas <= 24');
select public.agregar_check('espacios', 'espacio_dimensiones',
  'ancho > 0 and fondo > 0 and altura > 0');
select public.agregar_check('espacios', 'espacio_calificacion_rango',
  'calificacion >= 0 and calificacion <= 5');
select public.agregar_check('espacios', 'espacio_contadores_no_negativos',
  'total_resenas >= 0 and total_reservas >= 0');
select public.agregar_check('espacios', 'espacio_codigo_valido',
  $q$length(btrim(codigo)) between 1 and 40$q$);
select public.agregar_check('espacios', 'espacio_nombre_no_vacio',
  $q$length(btrim(nombre)) between 1 and 160$q$);
select public.agregar_check('espacios', 'espacio_color_hex',
  $q$color_hex is null or color_hex ~ '^#[0-9a-fA-F]{6}$'$q$);

select public.agregar_check('espacio_fotos', 'foto_orden_no_negativo',
  'orden >= 0');

-- ----------------------------------------------------------------------
-- 5. HORARIOS Y BLOQUEOS
-- ----------------------------------------------------------------------

select public.agregar_check('horarios_operacion', 'horario_cierra_despues',
  'cerrado or cierra > abre');
-- Un bloqueo tiene que colgar de algo: si no, no bloquea nada.
select public.agregar_check('bloqueos', 'bloqueo_tiene_destino',
  'espacio_id is not null or edificio_id is not null');

-- ----------------------------------------------------------------------
-- 6. RESERVAS  —  el núcleo
-- ----------------------------------------------------------------------

select public.agregar_check('reservas', 'reserva_asistentes_positivos',
  'asistentes > 0 and asistentes <= 10000');
select public.agregar_check('reservas', 'reserva_importes_no_negativos',
  'subtotal >= 0 and descuento >= 0 and impuestos >= 0 and total >= 0
   and monto_reembolso >= 0');
-- Un descuento mayor que el subtotal es dinero salido de la nada.
select public.agregar_check('reservas', 'reserva_descuento_acotado',
  'descuento <= subtotal');
select public.agregar_check('reservas', 'reserva_reembolso_acotado',
  'monto_reembolso <= total');

--  ⭐ LA IMPORTANTE (FASE 01 §1.4).
--  El total no es un dato que mande el cliente: es una consecuencia
--  aritmética de subtotal, descuento e impuestos. Con este CHECK, un
--  PATCH con {"total": 1} no falla "porque un trigger lo revisó", falla
--  porque la fila es imposible. El margen de 0.01 absorbe el redondeo
--  del IVA, nada más.
select public.agregar_check('reservas', 'reserva_total_cuadra',
  'abs(total - (subtotal - descuento + impuestos)) <= 0.01');

select public.agregar_check('reservas', 'reserva_moneda_iso',
  $q$moneda ~ '^[A-Z]{3}$'$q$);
select public.agregar_check('reservas', 'reserva_origen_conocido',
  $q$origen in ('web','ios','android','admin','ia')$q$);
select public.agregar_check('reservas', 'reserva_notas_acotadas',
  'notas is null or length(notas) <= 1000');
-- Misma ventana que validar_ventana_reserva(), pero aquí es inviolable.
select public.agregar_check('reservas', 'reserva_duracion_razonable',
  $q$fin >= inicio + interval '15 minutes' and fin <= inicio + interval '24 hours'$q$);
-- Coherencia del estado: cancelada ⇒ hay fecha de cancelación, y al revés.
select public.agregar_check('reservas', 'reserva_cancelacion_coherente',
  $q$(estado = 'cancelada') = (cancelada_en is not null)$q$);

-- ----------------------------------------------------------------------
-- 7. PAGOS
-- ----------------------------------------------------------------------

select public.agregar_check('pagos', 'pago_monto_no_negativo',
  'monto >= 0');
select public.agregar_check('pagos', 'pago_reembolso_acotado',
  'reembolsado >= 0 and reembolsado <= monto');
select public.agregar_check('pagos', 'pago_moneda_iso',
  $q$moneda ~ '^[A-Z]{3}$'$q$);
-- Nunca guardamos el número de tarjeta: si `ultimos4` trae más de cuatro
-- dígitos es que alguien está intentando meter el PAN completo.
select public.agregar_check('pagos', 'pago_ultimos4_son_cuatro',
  $q$ultimos4 is null or ultimos4 ~ '^[0-9]{4}$'$q$);
select public.agregar_check('pagos', 'pago_marca_conocida',
  $q$marca_tarjeta is null or marca_tarjeta in
    ('visa','mastercard','amex','discover','diners','jcb','unionpay','otra')$q$);
-- Aprobado ⇒ tiene que constar cuándo. Y al revés.
select public.agregar_check('pagos', 'pago_aprobado_con_fecha',
  $q$(estado = 'aprobado') = (pagado_en is not null)$q$);

-- ----------------------------------------------------------------------
-- 8. FACTURAS
-- ----------------------------------------------------------------------

select public.agregar_check('facturas', 'factura_importes_no_negativos',
  'subtotal >= 0 and impuestos >= 0 and total >= 0');
select public.agregar_check('facturas', 'factura_total_cuadra',
  'abs(total - (subtotal + impuestos)) <= 0.01');
select public.agregar_check('facturas', 'factura_rfc_valido',
  $q$rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'$q$);
select public.agregar_check('facturas', 'factura_estado_conocido',
  $q$estado in ('solicitada','timbrada','cancelada','error')$q$);
select public.agregar_check('facturas', 'factura_cp_valido',
  $q$codigo_postal is null or codigo_postal ~ '^[0-9]{5}$'$q$);

-- ----------------------------------------------------------------------
-- 9. PROMOCIONES
-- ----------------------------------------------------------------------

select public.agregar_check('promociones', 'promo_valor_no_negativo',
  'valor >= 0 and minimo_compra >= 0');
-- Un «descuento» del 300 % es dinero regalado.
select public.agregar_check('promociones', 'promo_porcentaje_acotado',
  $q$tipo <> 'porcentaje' or valor <= 100$q$);
select public.agregar_check('promociones', 'promo_usos_coherentes',
  'usos_actuales >= 0 and usos_por_usuario >= 1
   and (usos_maximos is null or usos_maximos >= 1)');
select public.agregar_check('promociones', 'promo_ventana_valida',
  'termina is null or termina > inicia');
select public.agregar_check('promociones', 'promo_codigo_valido',
  $q$codigo ~ '^[A-Za-z0-9_-]{3,32}$'$q$);
select public.agregar_check('promocion_usos', 'uso_descuento_no_negativo',
  'descuento >= 0');

-- ----------------------------------------------------------------------
-- 10. LISTA DE ESPERA, RESEÑAS, MENSAJES, NOTIFICACIONES
-- ----------------------------------------------------------------------

-- Mismo formato que `bloqueValido()` en js/core/utils.js. Sin esto, un
-- bloque tipo "HOLA-MUNDO" se colaba y luego el cliente lo interpretaba
-- como un día entero.
select public.agregar_check('lista_espera', 'espera_bloque_valido',
  $q$bloque is null or bloque ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$'$q$);
select public.agregar_check('lista_espera', 'espera_fecha_razonable',
  $q$fecha >= date '2020-01-01' and fecha <= date '2100-01-01'$q$);

select public.agregar_check('resenas', 'resena_comentario_acotado',
  'comentario is null or length(comentario) <= 2000');
select public.agregar_check('resenas', 'resena_respuesta_acotada',
  'respuesta is null or length(respuesta) <= 2000');
-- Respondida ⇒ consta cuándo.
select public.agregar_check('resenas', 'resena_respuesta_coherente',
  '(respuesta is null) = (respondido_en is null)');

select public.agregar_check('mensajes', 'mensaje_cuerpo_acotado',
  'length(cuerpo) between 1 and 4000');
select public.agregar_check('conversaciones', 'conv_estado_conocido',
  $q$estado in ('abierta','cerrada','archivada')$q$);
select public.agregar_check('conversaciones', 'conv_no_leidos_no_negativos',
  'no_leidos_usuario >= 0 and no_leidos_staff >= 0');

select public.agregar_check('notificaciones', 'notif_titulo_acotado',
  'length(btrim(titulo)) between 1 and 200');
select public.agregar_check('notificaciones', 'notif_cuerpo_acotado',
  'cuerpo is null or length(cuerpo) <= 1000');

-- ----------------------------------------------------------------------
-- 11. ÍNDICES QUE FALTABAN
--
--  Toda clave foránea por la que se filtra o se borra en cascada necesita
--  índice: sin él, cada DELETE del padre hace un recorrido completo de la
--  tabla hija.
-- ----------------------------------------------------------------------

create index if not exists idx_orgusuarios_usuario  on public.organizacion_usuarios(usuario_id);
create index if not exists idx_orgusuarios_org      on public.organizacion_usuarios(organizacion_id);
create index if not exists idx_sedes_org            on public.sedes(organizacion_id);
create index if not exists idx_edificios_org        on public.edificios(organizacion_id);
create index if not exists idx_edificios_sede       on public.edificios(sede_id);
create index if not exists idx_pisos_edificio       on public.pisos(edificio_id);
create index if not exists idx_espacios_edificio    on public.espacios(edificio_id);
create index if not exists idx_bloqueos_espacio     on public.bloqueos(espacio_id);
create index if not exists idx_bloqueos_edificio    on public.bloqueos(edificio_id);
create index if not exists idx_bloqueos_org         on public.bloqueos(organizacion_id);
create index if not exists idx_pagos_org            on public.pagos(organizacion_id, creado_en desc);
create index if not exists idx_pagos_estado         on public.pagos(estado, creado_en desc);
create index if not exists idx_facturas_usuario     on public.facturas(usuario_id, creado_en desc);
create index if not exists idx_facturas_pago        on public.facturas(pago_id);
create index if not exists idx_facturas_org         on public.facturas(organizacion_id, creado_en desc);
create index if not exists idx_favoritos_espacio    on public.favoritos(espacio_id);
create index if not exists idx_resenas_usuario      on public.resenas(usuario_id);
create index if not exists idx_resenas_reserva      on public.resenas(reserva_id);
create index if not exists idx_espera_usuario       on public.lista_espera(usuario_id);
create index if not exists idx_promociones_org      on public.promociones(organizacion_id) where activa;
create index if not exists idx_promousos_promo      on public.promocion_usos(promocion_id, usuario_id);
create index if not exists idx_promousos_reserva    on public.promocion_usos(reserva_id);
create index if not exists idx_push_usuario         on public.push_suscripciones(usuario_id);
create index if not exists idx_conv_usuario         on public.conversaciones(usuario_id, ultimo_mensaje_en desc);
create index if not exists idx_conv_org             on public.conversaciones(organizacion_id, ultimo_mensaje_en desc);
create index if not exists idx_mensajes_autor       on public.mensajes(autor_id);
create index if not exists idx_auditoria_usuario    on public.auditoria(usuario_id, creado_en desc);
create index if not exists idx_horarios_org         on public.horarios_operacion(organizacion_id);
create index if not exists idx_horarios_edificio    on public.horarios_operacion(edificio_id);
create index if not exists idx_reservas_promocion   on public.reservas(promocion_id) where promocion_id is not null;
create index if not exists idx_reservas_cancelador  on public.reservas(cancelada_por) where cancelada_por is not null;
create index if not exists idx_bloqueos_creador     on public.bloqueos(creado_por) where creado_por is not null;

-- La consulta que más pesa: «mis próximas reservas».
create index if not exists idx_reservas_proximas
  on public.reservas(usuario_id, inicio)
  where estado in ('pendiente','confirmada','en_curso');

-- ----------------------------------------------------------------------
-- 12. LA CLAVE FORÁNEA QUE FALTABA
--
--  `reservas.promocion_id` era un uuid suelto: apuntaba a una promoción
--  que podía no existir, y borrar la promoción dejaba la reserva
--  señalando al vacío.
-- ----------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservas_promocion_fk') then
    -- Primero se limpian los huérfanos que pudiera haber.
    update public.reservas r set promocion_id = null
     where promocion_id is not null
       and not exists (select 1 from public.promociones p where p.id = r.promocion_id);
    alter table public.reservas
      add constraint reservas_promocion_fk
      foreign key (promocion_id) references public.promociones(id) on delete set null;
  end if;
end $$;

-- ----------------------------------------------------------------------
-- 13. INFORME
-- ----------------------------------------------------------------------

do $$
declare v_checks int; v_indices int; v_fks int;
begin
  select count(*) into v_checks from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'public' and c.contype = 'c';
  select count(*) into v_fks from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'public' and c.contype = 'f';
  select count(*) into v_indices from pg_indexes where schemaname = 'public';
  raise notice 'restricciones.sql · CHECK: %  ·  claves foráneas: %  ·  índices: %',
    v_checks, v_fks, v_indices;
end $$;

drop function if exists public.agregar_check(text, text, text);
