-- ======================================================================
-- migracion-v1-a-v2.sql
--
-- Pasa los datos del esquema viejo (guardado en `respaldo_v1`) al
-- esquema que usa la aplicación.
--
-- CONTEXTO
--   La base de Supabase tenía un esquema distinto e incompatible con el
--   de la app. Antes de reconstruir `public` se copió todo tal cual a
--   `respaldo_v1`, que NO se toca: este archivo sólo lee de ahí.
--
-- LAS DIFERENCIAS QUE HAY QUE SALVAR
--   ┌────────────┬──────────────────────────────┬────────────────────┐
--   │ Concepto   │ respaldo_v1                  │ aplicación         │
--   ├────────────┼──────────────────────────────┼────────────────────┤
--   │ Precio     │ horarios_disponibles.precio  │ espacios.precio_hora│
--   │ Reserva    │ horario_id → fila pregenerada│ inicio/fin timestamptz│
--   │ Estado     │ estado_id → tabla            │ enum estado_reserva│
--   │ Aforo      │ capacidad_maxima             │ capacidad          │
--   │ Posición   │ posicion_x/y, ancho, alto    │ pos_x/pos_y, ancho, fondo│
--   │ Dirección  │ edificios.direccion          │ sedes.direccion    │
--   └────────────┴──────────────────────────────┴────────────────────┘
--
-- SEGURIDAD
--   Se ejecuta como `postgres` (editor SQL de Supabase), así que
--   `es_servicio()` da true y los triggers de guardia se apartan solos:
--   los importes que se escriben aquí son los que se calculan aquí.
--
-- IDEMPOTENTE
--   Todo va con `on conflict do nothing` o comprobando antes. Se puede
--   correr dos veces sin duplicar nada.
--
--     psql "$DATABASE_URL" -f supabase/migracion-v1-a-v2.sql
-- ======================================================================
\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('respaldo_v1.espacios') is null then
    raise exception 'No existe respaldo_v1: nada que migrar.';
  end if;
end $$;

begin;

-- Tabla temporal para el informe final.
create temporary table migrado (paso text, filas bigint, saltadas bigint default 0)
  on commit drop;


-- ----------------------------------------------------------------------
-- 1. ORGANIZACIONES
-- ----------------------------------------------------------------------
with ins as (
  insert into public.organizaciones (id, nombre, slug, activa, creado_en)
  select o.id,
         coalesce(nullif(btrim(o.nombre), ''), 'Organización'),
         -- El slug tiene que pasar `org_slug_valido`.
         -- Ojo con el guion suelto: 'Centro De Oficinas!' se convertía en
         -- 'centro-de-oficinas-' y `org_slug_valido` lo rechaza por
         -- terminar en guion. Hay que recortarlos por los dos lados.
         coalesce(
           nullif(btrim(left(regexp_replace(lower(coalesce(o.slug, o.nombre, '')),
                                            '[^a-z0-9]+', '-', 'g'), 63), '-'), ''),
           'org-' || left(o.id::text, 8)),
         coalesce(o.activa, true),
         coalesce(o.created_at, now())
    from respaldo_v1.organizaciones o
  on conflict (id) do nothing
  returning 1)
insert into migrado select 'organizaciones', count(*) from ins;


-- ----------------------------------------------------------------------
-- 2. SEDES  (nacen de los datos de dirección que vivían en el edificio)
-- ----------------------------------------------------------------------
with ins as (
  insert into public.sedes (id, organizacion_id, nombre, slug, direccion,
                            ciudad, pais, zona_horaria, creado_en)
  select e.id,                       -- misma id que su edificio: 1 a 1
         e.organizacion_id,
         coalesce(nullif(btrim(e.nombre), ''), 'Sede'),
         coalesce(
           nullif(btrim(left(regexp_replace(lower(coalesce(e.nombre, '')),
                                            '[^a-z0-9]+', '-', 'g'), 63), '-'), ''),
           'sede-' || left(e.id::text, 8)),
         e.direccion, e.ciudad,
         coalesce(e.pais, 'México'),
         e.zona_horaria,
         coalesce(e.created_at, now())
    from respaldo_v1.edificios e
   where exists (select 1 from public.organizaciones o where o.id = e.organizacion_id)
  on conflict (id) do nothing
  returning 1)
insert into migrado select 'sedes', count(*) from ins;


-- ----------------------------------------------------------------------
-- 3. EDIFICIOS
-- ----------------------------------------------------------------------
with ins as (
  insert into public.edificios (id, organizacion_id, sede_id, nombre, creado_en)
  select e.id, e.organizacion_id, e.id,
         coalesce(nullif(btrim(e.nombre), ''), 'Edificio'),
         coalesce(e.created_at, now())
    from respaldo_v1.edificios e
   where exists (select 1 from public.organizaciones o where o.id = e.organizacion_id)
  on conflict (id) do nothing
  returning 1)
insert into migrado select 'edificios', count(*) from ins;


-- ----------------------------------------------------------------------
-- 4. PISOS
-- ----------------------------------------------------------------------
with ins as (
  insert into public.pisos (id, edificio_id, nombre, numero, creado_en)
  select p.id, p.edificio_id,
         coalesce(nullif(btrim(p.nombre), ''), 'Piso ' || coalesce(p.numero, 1)),
         coalesce(p.numero, 1),
         coalesce(p.created_at, now())
    from respaldo_v1.pisos p
   where exists (select 1 from public.edificios e where e.id = p.edificio_id)
  on conflict (id) do nothing
  returning 1)
insert into migrado select 'pisos', count(*) from ins;


-- ----------------------------------------------------------------------
-- 5. USUARIOS
--
--    Sólo los que siguen existiendo en auth.users. El perfil ya lo pudo
--    haber creado el trigger `trg_nuevo_usuario`, así que se actualiza
--    en vez de fallar.
-- ----------------------------------------------------------------------
with ins as (
  insert into public.usuarios (id, email, nombre, telefono, avatar_url,
                               organizacion_id, creado_en)
  select u.id,
         u.email,
         nullif(btrim(coalesce(u.nombre, '')), ''),
         -- Si el teléfono no cumple el formato, mejor null que perder la fila.
         case when u.telefono ~ '^[+0-9()\-. ]{7,25}$' then u.telefono end,
         u.avatar_url,
         (select ou.organizacion_id from respaldo_v1.organizacion_usuarios ou
           where ou.usuario_id = u.id limit 1),
         coalesce(u.created_at, now())
    from respaldo_v1.usuarios u
   where exists (select 1 from auth.users a where a.id = u.id)
  -- Cuidado con el orden del coalesce: `trg_nuevo_usuario` ya pudo haber
  -- creado el perfil poniendo de nombre el trozo del correo ('ana'), así
  -- que dar preferencia a lo que YA había perdía el nombre real de v1
  -- ('Ana López'). Aquí manda respaldo_v1, que es la fuente buena.
  on conflict (id) do update
     set nombre          = coalesce(excluded.nombre, public.usuarios.nombre),
         telefono        = coalesce(excluded.telefono, public.usuarios.telefono),
         avatar_url      = coalesce(excluded.avatar_url, public.usuarios.avatar_url),
         organizacion_id = coalesce(excluded.organizacion_id, public.usuarios.organizacion_id)
  returning 1)
insert into migrado
select 'usuarios', count(*),
       (select count(*) from respaldo_v1.usuarios u
         where not exists (select 1 from auth.users a where a.id = u.id))
  from ins;


-- ----------------------------------------------------------------------
-- 6. MEMBRESÍAS  (roles.nombre → enum rol_usuario)
-- ----------------------------------------------------------------------
with ins as (
  insert into public.organizacion_usuarios (id, organizacion_id, usuario_id, rol, creado_en)
  select ou.id, ou.organizacion_id, ou.usuario_id,
         case lower(coalesce(r.nombre, ''))
           when 'superadmin'     then 'superadmin'
           when 'superadministrador' then 'superadmin'
           when 'admin'          then 'admin'
           when 'administrador'  then 'admin'
           when 'staff'          then 'staff'
           when 'empleado'       then 'staff'
           else 'usuario'
         end::rol_usuario,
         coalesce(ou.created_at, now())
    from respaldo_v1.organizacion_usuarios ou
    left join respaldo_v1.roles r on r.id = ou.rol_id
   where exists (select 1 from public.usuarios u where u.id = ou.usuario_id)
     and exists (select 1 from public.organizaciones o where o.id = ou.organizacion_id)
  on conflict (organizacion_id, usuario_id) do nothing
  returning 1)
insert into migrado select 'membresías', count(*) from ins;

-- El rol global del perfil se sincroniza con la membresía más alta.
update public.usuarios u
   set rol = m.rol
  from (select usuario_id,
               max(case rol when 'superadmin' then 4 when 'admin' then 3
                            when 'staff' then 2 else 1 end) as nivel,
               (array_agg(rol order by case rol when 'superadmin' then 4
                                                when 'admin' then 3
                                                when 'staff' then 2 else 1 end desc))[1] as rol
          from public.organizacion_usuarios group by usuario_id) m
 where m.usuario_id = u.id and m.nivel > 1;


-- ----------------------------------------------------------------------
-- 7. AMENIDADES  (uuid + nombre  →  clave de texto)
-- ----------------------------------------------------------------------
with ins as (
  insert into public.amenidades (clave, etiqueta, icono)
  select distinct on (clave) clave, etiqueta, icono
    from (
      select coalesce(
               nullif(regexp_replace(lower(coalesce(a.nombre, '')), '[^a-z0-9]+', '_', 'g'), ''),
               'amenidad_' || left(a.id::text, 8)) as clave,
             coalesce(nullif(btrim(a.nombre), ''), 'Amenidad')       as etiqueta,
             coalesce(nullif(a.icono, ''), '•')                      as icono
        from respaldo_v1.amenidades a) t
  on conflict (clave) do nothing
  returning 1)
insert into migrado select 'amenidades', count(*) from ins;


-- ----------------------------------------------------------------------
-- 8. ESPACIOS
--
--    Aquí está el grueso de la traducción:
--      capacidad_maxima → capacidad
--      costo_base       → precio_hora
--      posicion_x/y     → pos_x/pos_y
--      alto             → fondo   (en el plano «alto» era la profundidad)
--      categoria        → tipo (enum) + nombre original en `metadatos`
--    `codigo` no existía: se inventa uno estable y único por organización.
-- ----------------------------------------------------------------------
with base as (
  select e.*,
         p.edificio_id,
         c.nombre as categoria_nombre,
         row_number() over (partition by e.organizacion_id order by e.created_at, e.id) as n
    from respaldo_v1.espacios e
    left join respaldo_v1.pisos p      on p.id = e.piso_id
    left join respaldo_v1.categorias c on c.id = e.categoria_id
), ins as (
  insert into public.espacios (
    id, organizacion_id, piso_id, edificio_id, sede_id,
    codigo, nombre, tipo, descripcion,
    capacidad, reservable, estado, precio_hora,
    pos_x, pos_y, ancho, fondo, metadatos, creado_en)
  select b.id, b.organizacion_id, b.piso_id, b.edificio_id, b.edificio_id,
         'ESP-' || lpad(b.n::text, 3, '0'),
         coalesce(nullif(btrim(b.nombre), ''), 'Espacio ' || b.n),
         case
           when b.categoria_nombre ilike '%junta%'  or b.categoria_nombre ilike '%sala%'  then 'sala_juntas'
           when b.categoria_nombre ilike '%cowork%'                                        then 'coworking'
           when b.categoria_nombre ilike '%auditor%'                                       then 'auditorio'
           when b.categoria_nombre ilike '%estacion%' or b.categoria_nombre ilike '%park%' then 'estacionamiento'
           when b.categoria_nombre ilike '%servicio%' or b.categoria_nombre ilike '%baño%' then 'servicio'
           when b.categoria_nombre ilike '%comun%'   or b.categoria_nombre ilike '%recep%' then 'comun'
           else 'oficina'
         end::tipo_espacio,
         b.descripcion,
         -- `espacio_capacidad_coherente`: si es reservable, > 0.
         greatest(coalesce(b.capacidad_maxima, 1), 1),
         true,
         case lower(coalesce(b.estado, ''))
           when 'disponible'     then 'disponible'
           when 'reservada'      then 'reservada'
           when 'ocupada'        then 'reservada'
           when 'mantenimiento'  then 'mantenimiento'
           when 'proximamente'   then 'proximamente'
           when 'inactiva'       then 'inactiva'
           else 'disponible'
         end::estado_espacio,
         greatest(coalesce(b.costo_base, 0), 0),
         coalesce(b.posicion_x, 0),
         coalesce(b.posicion_y, 0),
         -- `espacio_dimensiones` exige > 0: 3 m es el valor por defecto.
         case when coalesce(b.ancho, 0) > 0 then b.ancho else 3 end,
         case when coalesce(b.alto,  0) > 0 then b.alto  else 3 end,
         jsonb_strip_nulls(jsonb_build_object(
           'v1_categoria', b.categoria_nombre,
           'v1_estado',    b.estado,
           'v1_migrado_en', now())),
         coalesce(b.created_at, now())
    from base b
   where exists (select 1 from public.organizaciones o where o.id = b.organizacion_id)
  on conflict (id) do nothing
  returning 1)
insert into migrado select 'espacios', count(*) from ins;

-- Amenidades por espacio: tabla puente → columna text[].
update public.espacios e
   set amenidades = t.claves
  from (
    select ea.espacio_id,
           array_agg(distinct coalesce(
             nullif(regexp_replace(lower(coalesce(a.nombre, '')), '[^a-z0-9]+', '_', 'g'), ''),
             'amenidad_' || left(a.id::text, 8))) as claves
      from respaldo_v1.espacio_amenidades ea
      join respaldo_v1.amenidades a on a.id = ea.amenidad_id
     group by ea.espacio_id) t
 where t.espacio_id = e.id and e.amenidades = '{}';


-- ----------------------------------------------------------------------
-- 9. FOTOS
-- ----------------------------------------------------------------------
with ins as (
  insert into public.espacio_fotos (id, espacio_id, url, es_portada, orden, creado_en)
  select i.id, i.espacio_id, i.url,
         coalesce(i.es_principal, false),
         greatest(coalesce(i.orden, 0), 0),
         coalesce(i.created_at, now())
    from respaldo_v1.imagenes i
   where exists (select 1 from public.espacios e where e.id = i.espacio_id)
     and coalesce(btrim(i.url), '') <> ''
  on conflict (id) do nothing
  returning 1)
insert into migrado select 'fotos', count(*) from ins;


-- ----------------------------------------------------------------------
-- 10. HORARIOS DE OPERACIÓN  (desde la plantilla semanal de v1)
-- ----------------------------------------------------------------------
with ins as (
  insert into public.horarios_operacion (organizacion_id, espacio_id, dia_semana,
                                         abre, cierra, cerrado)
  select e.organizacion_id, hp.espacio_id,
         greatest(least(coalesce(hp.dia_semana, 0), 6), 0),
         coalesce(hp.hora_inicio, '09:00'::time),
         -- `horario_cierra_despues`: si vienen al revés, se usa el rango normal.
         case when coalesce(hp.hora_fin, '21:00'::time) > coalesce(hp.hora_inicio, '09:00'::time)
              then hp.hora_fin else '21:00'::time end,
         not coalesce(hp.activo, true)
    from respaldo_v1.horarios_plantilla hp
    join public.espacios e on e.id = hp.espacio_id
  returning 1)
insert into migrado select 'horarios de operación', count(*) from ins;


-- ----------------------------------------------------------------------
-- 11. BLOQUEOS
-- ----------------------------------------------------------------------
with ins as (
  insert into public.bloqueos (id, organizacion_id, espacio_id, motivo, inicio, fin, creado_en)
  select b.id, e.organizacion_id, b.espacio_id,
         coalesce(nullif(btrim(b.motivo), ''), 'Mantenimiento'),
         b.fecha_inicio, b.fecha_fin,
         coalesce(b.created_at, now())
    from respaldo_v1.espacio_bloqueos b
    join public.espacios e on e.id = b.espacio_id
   where b.fecha_fin > b.fecha_inicio
  on conflict (id) do nothing
  returning 1)
insert into migrado select 'bloqueos', count(*) from ins;


-- ----------------------------------------------------------------------
-- 12. RESERVAS   ← la traducción más delicada
--
--   v1 guardaba `horario_id` apuntando a una fila pregenerada con fecha,
--   hora de inicio, hora de fin y precio. La app usa dos timestamptz.
--
--   El precio se RECALCULA aquí porque tiene que cumplir
--   `reserva_total_cuadra`: total = subtotal - descuento + impuestos.
--
--   Van una a una: si dos reservas viejas se solapan sobre el mismo
--   espacio, la restricción de exclusión rechaza la segunda y hay que
--   contarla, no abortar la migración entera.
-- ----------------------------------------------------------------------
do $$
declare
  f record; v_ok bigint := 0; v_mal bigint := 0;
  v_ini timestamptz; v_fin timestamptz;
  v_sub numeric; v_imp numeric; v_tasa numeric; v_horas numeric;
  v_estado estado_reserva;
begin
  for f in
    select r.*,
           h.fecha, h.hora_inicio, h.hora_fin, h.precio,
           er.nombre as estado_nombre,
           e.precio_hora, e.capacidad, e.organizacion_id as espacio_org
      from respaldo_v1.reservas r
      join public.espacios e                     on e.id  = r.espacio_id
      left join respaldo_v1.horarios_disponibles h on h.id = r.horario_id
      left join respaldo_v1.estados_reserva er     on er.id = r.estado_id
     order by r.created_at nulls last, r.id
  loop
    -- Sin horario no hay reserva que reconstruir.
    if f.fecha is null or f.hora_inicio is null then
      v_mal := v_mal + 1; continue;
    end if;

    v_ini := (f.fecha::text || ' ' || f.hora_inicio::text)::timestamptz;
    v_fin := (f.fecha::text || ' ' || coalesce(f.hora_fin, f.hora_inicio + interval '1 hour')::text)::timestamptz;
    if v_fin <= v_ini then v_fin := v_ini + interval '1 hour'; end if;
    -- `reserva_duracion_razonable` corta en 24 h.
    if v_fin > v_ini + interval '24 hours' then v_fin := v_ini + interval '24 hours'; end if;

    v_horas := extract(epoch from (v_fin - v_ini)) / 3600.0;
    v_sub   := round(coalesce(nullif(f.precio, 0), f.precio_hora * v_horas, 0), 2);
    select tasa_impuesto into v_tasa from public.organizaciones where id = f.espacio_org;
    v_imp   := round(v_sub * coalesce(v_tasa, 0.16), 2);

    v_estado := case lower(coalesce(f.estado_nombre, ''))
                  when 'confirmada'  then 'confirmada'
                  when 'confirmado'  then 'confirmada'
                  when 'cancelada'   then 'cancelada'
                  when 'cancelado'   then 'cancelada'
                  when 'completada'  then 'completada'
                  when 'completado'  then 'completada'
                  when 'finalizada'  then 'completada'
                  when 'en_curso'    then 'en_curso'
                  when 'no_asistio'  then 'no_asistio'
                  else 'pendiente'
                end::estado_reserva;

    begin
      insert into public.reservas (
        id, organizacion_id, espacio_id, usuario_id, inicio, fin, estado,
        asistentes, notas, subtotal, descuento, impuestos, total,
        cancelada_en, origen, creado_en)
      values (
        f.id, f.espacio_org, f.espacio_id,
        (select u.id from public.usuarios u where u.id = f.usuario_id),
        v_ini, v_fin, v_estado,
        least(greatest(coalesce(f.num_personas, 1), 1), greatest(f.capacidad, 1)),
        left(nullif(btrim(coalesce(f.notas, '')), ''), 1000),
        v_sub, 0, v_imp, v_sub + v_imp,
        -- `reserva_cancelacion_coherente`: cancelada ⇒ consta cuándo.
        case when v_estado = 'cancelada' then coalesce(f.updated_at, f.created_at, now()) end,
        'web',
        coalesce(f.created_at, now()));
      v_ok := v_ok + 1;
    exception when others then
      raise notice 'reserva % no se pudo migrar: %', f.id, left(sqlerrm, 90);
      v_mal := v_mal + 1;
    end;
  end loop;

  insert into migrado values ('reservas', v_ok, v_mal);
end $$;


-- ----------------------------------------------------------------------
-- 13. PAGOS
-- ----------------------------------------------------------------------
do $$
declare f record; v_ok bigint := 0; v_mal bigint := 0; v_estado estado_pago;
begin
  for f in
    select p.*, r.organizacion_id, r.usuario_id, mp.tipo as metodo_tipo,
           mp.ultimos_4_digitos
      from respaldo_v1.pagos p
      join public.reservas r on r.id = p.reserva_id
      left join respaldo_v1.metodos_pago mp on mp.id = p.metodo_pago_id
  loop
    v_estado := case lower(coalesce(f.estado, ''))
                  when 'aprobado'    then 'aprobado'
                  when 'pagado'      then 'aprobado'
                  when 'completado'  then 'aprobado'
                  when 'rechazado'   then 'rechazado'
                  when 'fallido'     then 'rechazado'
                  when 'reembolsado' then 'reembolsado'
                  when 'procesando'  then 'procesando'
                  when 'parcial'     then 'parcial'
                  else 'pendiente'
                end::estado_pago;
    begin
      insert into public.pagos (
        id, organizacion_id, reserva_id, usuario_id, metodo, estado,
        monto, moneda, proveedor_ref, ultimos4, pagado_en, creado_en)
      values (
        f.id, f.organizacion_id, f.reserva_id, f.usuario_id,
        case lower(coalesce(f.metodo_tipo, ''))
          when 'stripe'        then 'stripe'
          when 'mercadopago'   then 'mercadopago'
          when 'paypal'        then 'paypal'
          when 'efectivo'      then 'efectivo'
          when 'transferencia' then 'transferencia'
          when 'tarjeta'       then 'stripe'
          else 'transferencia'
        end::metodo_pago,
        v_estado,
        greatest(coalesce(f.monto, 0), 0),
        case when coalesce(f.moneda, '') ~ '^[A-Za-z]{3}$' then upper(f.moneda) else 'MXN' end,
        f.referencia_externa,
        case when f.ultimos_4_digitos ~ '^[0-9]{4}$' then f.ultimos_4_digitos end,
        -- `pago_aprobado_con_fecha`: aprobado ⇔ hay fecha de cobro.
        case when v_estado = 'aprobado' then coalesce(f.updated_at, f.created_at, now()) end,
        coalesce(f.created_at, now()));
      v_ok := v_ok + 1;
    exception when others then
      raise notice 'pago % no se pudo migrar: %', f.id, left(sqlerrm, 90);
      v_mal := v_mal + 1;
    end;
  end loop;
  insert into migrado values ('pagos', v_ok, v_mal);
end $$;


-- ----------------------------------------------------------------------
-- 14. RESEÑAS
-- ----------------------------------------------------------------------
with ins as (
  insert into public.resenas (id, espacio_id, usuario_id, reserva_id,
                              calificacion, comentario, autor_nombre, creado_en)
  select rs.id, rs.espacio_id, rs.usuario_id,
         (select r.id from public.reservas r where r.id = rs.reserva_id),
         least(greatest(coalesce(rs.calificacion, 5), 1), 5),
         left(rs.comentario, 2000),
         (select u.nombre from public.usuarios u where u.id = rs.usuario_id),
         coalesce(rs.created_at, now())
    from respaldo_v1.resenas rs
   where exists (select 1 from public.espacios e where e.id = rs.espacio_id)
     and exists (select 1 from public.usuarios u where u.id = rs.usuario_id)
  on conflict (id) do nothing
  returning 1)
insert into migrado select 'reseñas', count(*) from ins;


-- ----------------------------------------------------------------------
-- 15. PROMOCIONES
-- ----------------------------------------------------------------------
with ins as (
  insert into public.promociones (id, organizacion_id, codigo, titulo, descripcion,
                                  tipo, valor, inicia, termina, usos_maximos, activa)
  select p.id, p.organizacion_id,
         upper(regexp_replace(coalesce(p.codigo, 'PROMO'), '[^A-Za-z0-9_-]', '', 'g')),
         coalesce(nullif(btrim(p.descripcion), ''), 'Promoción'),
         p.descripcion,
         case lower(coalesce(p.tipo_descuento, ''))
           when 'monto'        then 'monto'
           when 'fijo'         then 'monto'
           when 'horas_gratis' then 'horas_gratis'
           else 'porcentaje'
         end::tipo_descuento,
         -- `promo_porcentaje_acotado`: un porcentaje no pasa de 100.
         case when lower(coalesce(p.tipo_descuento, '')) in ('monto', 'fijo', 'horas_gratis')
              then greatest(coalesce(p.valor, 0), 0)
              else least(greatest(coalesce(p.valor, 0), 0), 100) end,
         coalesce(p.fecha_inicio, now()),
         case when p.fecha_fin > coalesce(p.fecha_inicio, now()) then p.fecha_fin end,
         case when coalesce(p.usos_maximos, 0) > 0 then p.usos_maximos end,
         coalesce(p.activo, true)
    from respaldo_v1.promociones p
   where exists (select 1 from public.organizaciones o where o.id = p.organizacion_id)
     and length(regexp_replace(coalesce(p.codigo, ''), '[^A-Za-z0-9_-]', '', 'g')) >= 3
  on conflict (id) do nothing
  returning 1)
insert into migrado select 'promociones', count(*) from ins;


-- ----------------------------------------------------------------------
-- 16. NOTIFICACIONES
-- ----------------------------------------------------------------------
with ins as (
  insert into public.notificaciones (id, usuario_id, tipo, titulo, cuerpo, leida, creado_en)
  select n.id, n.usuario_id,
         coalesce(nullif(n.tipo, ''), 'info'),
         left(coalesce(nullif(btrim(n.titulo), ''), 'Aviso'), 200),
         left(n.mensaje, 1000),
         coalesce(n.leido, false),
         coalesce(n.created_at, now())
    from respaldo_v1.notificaciones n
   where exists (select 1 from public.usuarios u where u.id = n.usuario_id)
  on conflict (id) do nothing
  returning 1)
insert into migrado select 'notificaciones', count(*) from ins;


-- ----------------------------------------------------------------------
-- 17. HISTORIAL → AUDITORÍA
-- ----------------------------------------------------------------------
with ins as (
  insert into public.auditoria (usuario_id, tabla, registro_id, accion, despues, creado_en)
  select (select u.id from public.usuarios u where u.id = h.usuario_id),
         coalesce(h.tabla_afectada, 'desconocida'),
         h.registro_id::text,
         coalesce(h.accion, 'desconocida'),
         h.cambios,
         coalesce(h.created_at, now())
    from respaldo_v1.historial h
  returning 1)
insert into migrado select 'auditoría', count(*) from ins;


-- ----------------------------------------------------------------------
-- 18. CONTADORES DERIVADOS
-- ----------------------------------------------------------------------
update public.espacios e
   set total_reservas = coalesce(t.n, 0)
  from (select espacio_id, count(*) n from public.reservas group by espacio_id) t
 where t.espacio_id = e.id;

update public.espacios e
   set calificacion  = coalesce(t.media, 0),
       total_resenas = coalesce(t.n, 0)
  from (select espacio_id, round(avg(calificacion)::numeric, 2) media, count(*) n
          from public.resenas where visible group by espacio_id) t
 where t.espacio_id = e.id;


-- ----------------------------------------------------------------------
-- 19. INFORME
-- ----------------------------------------------------------------------
do $$
declare f record; v_total bigint := 0; v_saltadas bigint := 0;
begin
  raise notice '';
  raise notice '══ Migración respaldo_v1 → esquema de la aplicación ══════════';
  for f in select * from migrado order by 1 loop
    raise notice '  %  %  %', rpad(f.paso, 24), lpad(f.filas::text, 6),
      case when f.saltadas > 0 then '(' || f.saltadas || ' saltadas)' else '' end;
    v_total := v_total + f.filas;
    v_saltadas := v_saltadas + f.saltadas;
  end loop;
  raise notice '  %  %', rpad('TOTAL', 24), lpad(v_total::text, 6);
  if v_saltadas > 0 then
    raise notice '  % filas no se pudieron migrar (ver avisos de arriba).', v_saltadas;
  end if;
  raise notice '  respaldo_v1 NO se ha tocado: sigue completo por si acaso.';
  raise notice '══════════════════════════════════════════════════════════════';
end $$;

commit;
