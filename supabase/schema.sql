-- ======================================================================
-- schema.sql — Esquema completo de la base de datos (PostgreSQL / Supabase)
--
-- Cómo aplicarlo:
--   Supabase Studio → SQL Editor → pegar este archivo → Run
--   o bien:  supabase db push
--
-- Orden recomendado: schema.sql → policies.sql → seed.sql
--
-- Notas de diseño:
--   • Todo cuelga de `organizaciones` para soportar multiempresa.
--   • La jerarquía es organización → sede → edificio → piso → espacio.
--   • `reservas` tiene una restricción de exclusión que hace imposible
--     el doble booking a nivel de motor de base de datos, no sólo en la
--     aplicación.
--   • Los identificadores son uuid; las llaves visibles al usuario
--     (folios) son texto corto generado por trigger.
-- ======================================================================

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

-- ======================================================================
-- 1. TIPOS
-- ======================================================================
do $$ begin
  create type rol_usuario as enum ('usuario', 'staff', 'admin', 'superadmin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_espacio as enum ('disponible', 'reservada', 'mantenimiento', 'proximamente', 'inactiva');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_reserva as enum ('pendiente', 'confirmada', 'en_curso', 'completada', 'cancelada', 'no_asistio');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_pago as enum ('pendiente', 'procesando', 'aprobado', 'rechazado', 'reembolsado', 'parcial');
exception when duplicate_object then null; end $$;

do $$ begin
  create type metodo_pago as enum ('clip', 'stripe', 'mercadopago', 'paypal', 'googlepay', 'applepay', 'transferencia', 'efectivo', 'cortesia');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_espacio as enum ('oficina', 'sala_juntas', 'coworking', 'auditorio', 'estacionamiento', 'servicio', 'comun');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_descuento as enum ('porcentaje', 'monto', 'horas_gratis');
exception when duplicate_object then null; end $$;

-- ======================================================================
-- 2. ORGANIZACIONES Y USUARIOS
-- ======================================================================
create table if not exists public.organizaciones (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  slug          text unique not null,
  logo_url      text,
  color_marca   text default '#0ea5e9',
  moneda        char(3) not null default 'MXN',
  zona_horaria  text not null default 'America/Tijuana',
  tasa_impuesto numeric(5,4) not null default 0.16,
  rfc           text,
  activa        boolean not null default true,
  configuracion jsonb not null default '{}'::jsonb,
  creado_en     timestamptz not null default now()
);

-- Perfil extendido del usuario. Se llena por trigger al registrarse.
create table if not exists public.usuarios (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text,
  nombre         text,
  telefono       text,
  avatar_url     text,
  empresa        text,
  rfc            text,
  rol            rol_usuario not null default 'usuario',
  idioma         char(2) not null default 'es',
  tema           text not null default 'auto',
  notif_push     boolean not null default true,
  notif_email    boolean not null default true,
  notif_recordatorios boolean not null default true,
  datos_facturacion jsonb not null default '{}'::jsonb,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Membresía usuario ↔ organización (permite que alguien administre
-- varias empresas o sea usuario en una y admin en otra).
create table if not exists public.organizacion_usuarios (
  id            uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  usuario_id    uuid not null references public.usuarios(id) on delete cascade,
  rol           rol_usuario not null default 'usuario',
  creado_en     timestamptz not null default now(),
  unique (organizacion_id, usuario_id)
);

-- ======================================================================
-- 3. JERARQUÍA FÍSICA: SEDE → EDIFICIO → PISO → ESPACIO
-- ======================================================================
create table if not exists public.sedes (
  id            uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  nombre        text not null,
  slug          text not null,
  direccion     text,
  ciudad        text,
  estado        text,
  pais          text default 'México',
  codigo_postal text,
  lat           numeric(10,7),
  lng           numeric(10,7),
  telefono      text,
  email         text,
  zona_horaria  text,
  activa        boolean not null default true,
  orden         int not null default 0,
  creado_en     timestamptz not null default now(),
  unique (organizacion_id, slug)
);

create table if not exists public.edificios (
  id            uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  sede_id       uuid references public.sedes(id) on delete cascade,
  nombre        text not null,
  descripcion   text,
  -- Dimensiones en metros del plano, usadas por el mapa 3D
  -- Envolvente del plano real (ver js/data/planta.js). Si estos valores
  -- no coinciden con ENVOLVENTE, los bloques del mapa salen descuadrados
  -- respecto al dibujo.
  ancho_m       numeric(8,2) not null default 18.70,
  fondo_m       numeric(8,2) not null default 29.95,
  modelo_3d_url text,                       -- GLTF/GLB opcional
  hdri_url      text,                       -- iluminación HDRI opcional
  activo        boolean not null default true,
  orden         int not null default 0,
  creado_en     timestamptz not null default now()
);

create table if not exists public.pisos (
  id            uuid primary key default gen_random_uuid(),
  edificio_id   uuid not null references public.edificios(id) on delete cascade,
  nombre        text not null,
  numero        int not null default 1,
  plano_url     text,
  modelo_3d_url text,
  altura_m      numeric(6,2) not null default 2.6,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now(),
  unique (edificio_id, numero)
);

create table if not exists public.amenidades (
  clave     text primary key,
  etiqueta  text not null,
  icono     text not null default '•',
  orden     int not null default 0
);

create table if not exists public.espacios (
  id             uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  piso_id        uuid references public.pisos(id) on delete set null,
  edificio_id    uuid references public.edificios(id) on delete cascade,
  sede_id        uuid references public.sedes(id) on delete cascade,

  codigo         text not null,
  nombre         text not null,
  tipo           tipo_espacio not null default 'oficina',
  icono          text default '🏢',
  descripcion    text,
  reglamento     text,
  servicios      text[] not null default '{}',
  amenidades     text[] not null default '{}',

  capacidad      int not null default 1,
  reservable     boolean not null default true,
  estado         estado_espacio not null default 'disponible',

  precio_hora    numeric(10,2) not null default 0,
  precio_dia     numeric(10,2),
  precio_mes     numeric(10,2),
  precio_minimo_horas int not null default 1,

  -- Geometría del plano en metros (esquina noroeste + tamaño)
  pos_x          numeric(8,2) not null default 0,
  pos_y          numeric(8,2) not null default 0,
  ancho          numeric(8,2) not null default 3,
  fondo          numeric(8,2) not null default 3,
  altura         numeric(6,2) not null default 1.35,
  abierto        boolean not null default false,   -- sin muros (patio, cochera)
  puerta         jsonb not null default '{}'::jsonb, -- { side:'s', offset:0, width:1 }
  color_hex      text,

  video_url      text,
  tour_url       text,          -- recorrido virtual (Matterport, etc.)
  panorama_url   text,          -- imagen equirectangular para vista 360°
  modelo_3d_url  text,

  calificacion   numeric(3,2) not null default 0,
  total_resenas  int not null default 0,
  total_reservas int not null default 0,

  metadatos      jsonb not null default '{}'::jsonb,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (organizacion_id, codigo)
);

create index if not exists idx_espacios_org      on public.espacios(organizacion_id) where activo;
create index if not exists idx_espacios_piso     on public.espacios(piso_id);
create index if not exists idx_espacios_sede     on public.espacios(sede_id);
create index if not exists idx_espacios_estado   on public.espacios(estado) where reservable;
create index if not exists idx_espacios_amenid   on public.espacios using gin (amenidades);

create table if not exists public.espacio_fotos (
  id          uuid primary key default gen_random_uuid(),
  espacio_id  uuid not null references public.espacios(id) on delete cascade,
  url         text not null,
  ruta        text,                     -- ruta dentro del bucket de Storage
  titulo      text,
  es_portada  boolean not null default false,
  es_360      boolean not null default false,
  orden       int not null default 0,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_fotos_espacio on public.espacio_fotos(espacio_id, orden);

-- ======================================================================
-- 4. HORARIOS Y DISPONIBILIDAD
-- ======================================================================

-- Horario semanal recurrente. Si un espacio no tiene filas propias,
-- hereda las de su edificio (espacio_id null).
create table if not exists public.horarios_operacion (
  id           uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  espacio_id   uuid references public.espacios(id) on delete cascade,
  edificio_id  uuid references public.edificios(id) on delete cascade,
  dia_semana   int not null check (dia_semana between 0 and 6),  -- 0 = domingo
  abre         time not null default '08:00',
  cierra       time not null default '19:00',
  cerrado      boolean not null default false,
  creado_en    timestamptz not null default now()
);
create index if not exists idx_horarios_espacio on public.horarios_operacion(espacio_id, dia_semana);

-- Cierres puntuales: mantenimiento, días festivos, eventos privados.
create table if not exists public.bloqueos (
  id          uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  espacio_id  uuid references public.espacios(id) on delete cascade,
  edificio_id uuid references public.edificios(id) on delete cascade,
  motivo      text not null default 'Mantenimiento',
  inicio      timestamptz not null,
  fin         timestamptz not null,
  creado_por  uuid references public.usuarios(id) on delete set null,
  creado_en   timestamptz not null default now(),
  check (fin > inicio)
);
create index if not exists idx_bloqueos_rango on public.bloqueos using gist (tstzrange(inicio, fin));

-- ======================================================================
-- 5. RESERVAS
-- ======================================================================
create table if not exists public.reservas (
  id            uuid primary key default gen_random_uuid(),
  folio         text unique,
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  espacio_id    uuid not null references public.espacios(id) on delete restrict,
  -- Se pone a NULL si la persona borra su cuenta: el comprobante fiscal
  -- sobrevive anonimizado, sin bloquear el derecho al olvido.
  usuario_id    uuid references public.usuarios(id) on delete set null,
  cliente_nombre text,
  cliente_email  text,

  inicio        timestamptz not null,
  fin           timestamptz not null,
  -- Columna generada: la usa la restricción de exclusión de abajo.
  periodo       tstzrange generated always as (tstzrange(inicio, fin, '[)')) stored,

  estado        estado_reserva not null default 'pendiente',
  asistentes    int not null default 1,
  notas         text,

  subtotal      numeric(10,2) not null default 0,
  descuento     numeric(10,2) not null default 0,
  impuestos     numeric(10,2) not null default 0,
  total         numeric(10,2) not null default 0,
  moneda        char(3) not null default 'MXN',
  promocion_id  uuid,

  origen        text not null default 'web',   -- web | ios | android | admin | ia
  recordatorio_enviado boolean not null default false,
  cancelada_en  timestamptz,
  cancelada_por uuid references public.usuarios(id) on delete set null,
  motivo_cancelacion text,
  monto_reembolso numeric(10,2) not null default 0,

  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  check (fin > inicio)
);

-- ⛔ Doble booking imposible: dos reservas activas del mismo espacio no
--    pueden solaparse en el tiempo. Lo garantiza el motor, no el cliente.
alter table public.reservas drop constraint if exists reservas_sin_solape;
alter table public.reservas add constraint reservas_sin_solape
  exclude using gist (
    espacio_id with =,
    periodo with &&
  ) where (estado in ('pendiente', 'confirmada', 'en_curso'));

create index if not exists idx_reservas_usuario on public.reservas(usuario_id, inicio desc);
create index if not exists idx_reservas_espacio on public.reservas(espacio_id, inicio);
create index if not exists idx_reservas_estado  on public.reservas(estado, inicio);
create index if not exists idx_reservas_org     on public.reservas(organizacion_id, inicio desc);

-- ======================================================================
-- 6. PAGOS Y FACTURACIÓN
-- ======================================================================
create table if not exists public.pagos (
  id             uuid primary key default gen_random_uuid(),
  folio          text unique,
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  reserva_id     uuid references public.reservas(id) on delete set null,
  usuario_id     uuid references public.usuarios(id) on delete set null,
  cliente_nombre text,
  cliente_email  text,

  metodo         metodo_pago not null,
  estado         estado_pago not null default 'pendiente',
  monto          numeric(10,2) not null,
  moneda         char(3) not null default 'MXN',

  -- Identificadores del proveedor (payment_intent, preference_id, order_id…)
  proveedor_id   text,
  proveedor_ref  text,
  ultimos4       text,
  marca_tarjeta  text,
  respuesta      jsonb not null default '{}'::jsonb,

  reembolsado    numeric(10,2) not null default 0,
  pagado_en      timestamptz,
  creado_en      timestamptz not null default now()
);
create index if not exists idx_pagos_usuario on public.pagos(usuario_id, creado_en desc);
create index if not exists idx_pagos_reserva on public.pagos(reserva_id);

create table if not exists public.facturas (
  id            uuid primary key default gen_random_uuid(),
  folio         text unique,
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  pago_id       uuid references public.pagos(id) on delete set null,
  usuario_id    uuid references public.usuarios(id) on delete set null,
  rfc           text not null,
  razon_social  text not null,
  uso_cfdi      text default 'G03',
  regimen_fiscal text,
  codigo_postal text,
  email         text,
  subtotal      numeric(10,2) not null default 0,
  impuestos     numeric(10,2) not null default 0,
  total         numeric(10,2) not null default 0,
  estado        text not null default 'solicitada',  -- solicitada | timbrada | cancelada | error
  uuid_fiscal   text,
  xml_url       text,
  pdf_url       text,
  creado_en     timestamptz not null default now()
);

-- ======================================================================
-- 7. FAVORITOS, RESEÑAS Y LISTA DE ESPERA
-- ======================================================================
create table if not exists public.favoritos (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  espacio_id uuid not null references public.espacios(id) on delete cascade,
  creado_en  timestamptz not null default now(),
  primary key (usuario_id, espacio_id)
);

create table if not exists public.resenas (
  id           uuid primary key default gen_random_uuid(),
  espacio_id   uuid not null references public.espacios(id) on delete cascade,
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  reserva_id   uuid references public.reservas(id) on delete set null,
  calificacion int not null check (calificacion between 1 and 5),
  comentario   text,
  respuesta    text,                  -- respuesta de la administración
  respondido_en timestamptz,
  visible      boolean not null default true,
  creado_en    timestamptz not null default now(),
  unique (usuario_id, reserva_id)
);
create index if not exists idx_resenas_espacio on public.resenas(espacio_id, creado_en desc);

create table if not exists public.lista_espera (
  id          uuid primary key default gen_random_uuid(),
  espacio_id  uuid not null references public.espacios(id) on delete cascade,
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  fecha       date not null,
  bloque      text,                   -- '08:00-09:00' o null = cualquier hora
  notificado  boolean not null default false,
  notificado_en timestamptz,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (espacio_id, usuario_id, fecha, bloque)
);
create index if not exists idx_espera_busqueda on public.lista_espera(espacio_id, fecha) where activo;

-- ======================================================================
-- 8. PROMOCIONES
-- ======================================================================
create table if not exists public.promociones (
  id            uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  codigo        text not null,
  titulo        text not null,
  descripcion   text,
  tipo          tipo_descuento not null default 'porcentaje',
  valor         numeric(10,2) not null,
  minimo_compra numeric(10,2) not null default 0,
  espacios      uuid[] not null default '{}',   -- vacío = aplica a todos
  inicia        timestamptz not null default now(),
  termina       timestamptz,
  usos_maximos  int,
  usos_por_usuario int not null default 1,
  usos_actuales int not null default 0,
  imagen_url    text,
  activa        boolean not null default true,
  creado_en     timestamptz not null default now(),
  unique (organizacion_id, codigo)
);

create table if not exists public.promocion_usos (
  id           uuid primary key default gen_random_uuid(),
  promocion_id uuid not null references public.promociones(id) on delete cascade,
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  reserva_id   uuid references public.reservas(id) on delete cascade,
  descuento    numeric(10,2) not null default 0,
  creado_en    timestamptz not null default now()
);

-- ======================================================================
-- 9. NOTIFICACIONES Y CHAT
-- ======================================================================
create table if not exists public.notificaciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  tipo        text not null default 'info',     -- info | reserva | pago | promo | recordatorio | espera
  titulo      text not null,
  cuerpo      text,
  enlace      text,
  datos       jsonb not null default '{}'::jsonb,
  leida       boolean not null default false,
  enviada_push boolean not null default false,
  programada_para timestamptz,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_notif_usuario on public.notificaciones(usuario_id, creado_en desc);
create index if not exists idx_notif_pendientes on public.notificaciones(programada_para)
  where enviada_push = false and programada_para is not null;

create table if not exists public.push_suscripciones (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  agente     text,
  creado_en  timestamptz not null default now()
);

create table if not exists public.conversaciones (
  id           uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  asunto       text default 'Consulta',
  estado       text not null default 'abierta',  -- abierta | cerrada
  ultimo_mensaje_en timestamptz not null default now(),
  no_leidos_usuario int not null default 0,
  no_leidos_staff   int not null default 0,
  creado_en    timestamptz not null default now()
);

create table if not exists public.mensajes (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.conversaciones(id) on delete cascade,
  autor_id        uuid references public.usuarios(id) on delete set null,
  es_staff        boolean not null default false,
  es_ia           boolean not null default false,
  cuerpo          text not null,
  adjunto_url     text,
  leido           boolean not null default false,
  creado_en       timestamptz not null default now()
);
create index if not exists idx_mensajes_conv on public.mensajes(conversacion_id, creado_en);

-- ======================================================================
-- 10. AUDITORÍA
-- ======================================================================
create table if not exists public.auditoria (
  id         bigserial primary key,
  usuario_id uuid references public.usuarios(id) on delete set null,
  tabla      text not null,
  registro_id text,
  accion     text not null,        -- insert | update | delete
  antes      jsonb,
  despues    jsonb,
  creado_en  timestamptz not null default now()
);
create index if not exists idx_auditoria_tabla on public.auditoria(tabla, creado_en desc);

-- ======================================================================
-- 11. FUNCIONES Y TRIGGERS
-- ======================================================================

-- Crea el perfil automáticamente cuando alguien se registra.
create or replace function public.manejar_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, email, nombre, telefono, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre',
             new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(coalesce(new.email, 'usuario'), '@', 1)),
    nullif(btrim(new.raw_user_meta_data->>'telefono'), ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update
    set email = excluded.email,
        avatar_url = coalesce(public.usuarios.avatar_url, excluded.avatar_url);
  return new;
end $$;

drop trigger if exists trg_nuevo_usuario on auth.users;
create trigger trg_nuevo_usuario
  after insert on auth.users
  for each row execute function public.manejar_nuevo_usuario();

-- `actualizado_en` siempre al día.
create or replace function public.tocar_actualizado()
returns trigger language plpgsql as $$
begin new.actualizado_en = now(); return new; end $$;

drop trigger if exists trg_tocar_espacios on public.espacios;
create trigger trg_tocar_espacios before update on public.espacios
  for each row execute function public.tocar_actualizado();

drop trigger if exists trg_tocar_reservas on public.reservas;
create trigger trg_tocar_reservas before update on public.reservas
  for each row execute function public.tocar_actualizado();

drop trigger if exists trg_tocar_usuarios on public.usuarios;
create trigger trg_tocar_usuarios before update on public.usuarios
  for each row execute function public.tocar_actualizado();

-- Folios legibles: RES-2026-0001, PAG-2026-0001, FAC-2026-0001
create sequence if not exists public.seq_folio_reserva;
create sequence if not exists public.seq_folio_pago;
create sequence if not exists public.seq_folio_factura;

create or replace function public.generar_folio()
returns trigger language plpgsql as $$
declare prefijo text; seq text;
begin
  if new.folio is not null then return new; end if;
  if tg_table_name = 'reservas' then
    prefijo := 'RES'; seq := lpad(nextval('public.seq_folio_reserva')::text, 5, '0');
  elsif tg_table_name = 'pagos' then
    prefijo := 'PAG'; seq := lpad(nextval('public.seq_folio_pago')::text, 5, '0');
  else
    prefijo := 'FAC'; seq := lpad(nextval('public.seq_folio_factura')::text, 5, '0');
  end if;
  new.folio := prefijo || '-' || to_char(now(), 'YYYY') || '-' || seq;
  return new;
end $$;

drop trigger if exists trg_folio_reserva on public.reservas;
create trigger trg_folio_reserva before insert on public.reservas
  for each row execute function public.generar_folio();

drop trigger if exists trg_folio_pago on public.pagos;
create trigger trg_folio_pago before insert on public.pagos
  for each row execute function public.generar_folio();

drop trigger if exists trg_folio_factura on public.facturas;
create trigger trg_folio_factura before insert on public.facturas
  for each row execute function public.generar_folio();

-- Guarda una copia del nombre y el correo en la reserva y en el pago.
-- Así el histórico contable sigue siendo legible aunque la persona
-- borre su cuenta y el `usuario_id` quede en NULL.
create or replace function public.copiar_datos_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.usuario_id is null then return new; end if;
  select coalesce(new.cliente_nombre, u.nombre), coalesce(new.cliente_email, u.email)
    into new.cliente_nombre, new.cliente_email
    from public.usuarios u where u.id = new.usuario_id;
  return new;
end $$;

drop trigger if exists trg_cliente_reserva on public.reservas;
create trigger trg_cliente_reserva before insert on public.reservas
  for each row execute function public.copiar_datos_cliente();

drop trigger if exists trg_cliente_pago on public.pagos;
create trigger trg_cliente_pago before insert on public.pagos
  for each row execute function public.copiar_datos_cliente();

-- Recalcula la calificación del espacio cuando cambia una reseña.
create or replace function public.recalcular_calificacion()
returns trigger language plpgsql as $$
declare eid uuid;
begin
  eid := coalesce(new.espacio_id, old.espacio_id);
  update public.espacios e
     set calificacion  = coalesce((select round(avg(calificacion)::numeric, 2) from public.resenas r where r.espacio_id = eid and r.visible), 0),
         total_resenas = (select count(*) from public.resenas r where r.espacio_id = eid and r.visible)
   where e.id = eid;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_calificacion on public.resenas;
create trigger trg_calificacion after insert or update or delete on public.resenas
  for each row execute function public.recalcular_calificacion();

-- Contador de reservas del espacio.
create or replace function public.contar_reserva()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.espacios set total_reservas = total_reservas + 1 where id = new.espacio_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_contar_reserva on public.reservas;
create trigger trg_contar_reserva after insert on public.reservas
  for each row execute function public.contar_reserva();

-- Al cancelarse una reserva, avisa a quien esté en lista de espera.
create or replace function public.avisar_lista_espera()
returns trigger language plpgsql security definer set search_path = public as $$
declare fila record; nombre_espacio text;
begin
  if new.estado <> 'cancelada' or old.estado = 'cancelada' then return new; end if;
  select nombre into nombre_espacio from public.espacios where id = new.espacio_id;
  for fila in
    select * from public.lista_espera
     where espacio_id = new.espacio_id
       and fecha = (new.inicio at time zone 'UTC')::date
       and activo and not notificado
  loop
    insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, datos)
    values (fila.usuario_id, 'espera',
            'Se liberó un horario',
            coalesce(nombre_espacio, 'Un espacio') || ' quedó libre el ' || to_char(new.inicio, 'DD/MM') || '. ¡Resérvalo ya!',
            '/espacios/' || new.espacio_id,
            jsonb_build_object('espacio_id', new.espacio_id, 'inicio', new.inicio));
    update public.lista_espera set notificado = true, notificado_en = now() where id = fila.id;
  end loop;
  return new;
end $$;

drop trigger if exists trg_lista_espera on public.reservas;
create trigger trg_lista_espera after update on public.reservas
  for each row execute function public.avisar_lista_espera();

-- Programa los recordatorios de una reserva confirmada (24 h y 1 h antes).
create or replace function public.programar_recordatorios()
returns trigger language plpgsql security definer set search_path = public as $$
declare nombre_espacio text;
begin
  if new.estado <> 'confirmada' then return new; end if;
  if tg_op = 'UPDATE' and old.estado = 'confirmada' then return new; end if;
  select nombre into nombre_espacio from public.espacios where id = new.espacio_id;

  insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, programada_para, datos)
  select new.usuario_id, 'recordatorio',
         'Tu reserva es mañana',
         coalesce(nombre_espacio,'Tu espacio') || ' · ' || to_char(new.inicio, 'DD/MM HH24:MI'),
         '/reservas/' || new.id,
         new.inicio - interval '24 hours',
         jsonb_build_object('reserva_id', new.id)
  where new.inicio - interval '24 hours' > now();

  insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, programada_para, datos)
  values (new.usuario_id, 'recordatorio',
          'Tu reserva empieza en 1 hora',
          coalesce(nombre_espacio,'Tu espacio') || ' · ' || to_char(new.inicio, 'HH24:MI'),
          '/reservas/' || new.id,
          new.inicio - interval '1 hour',
          jsonb_build_object('reserva_id', new.id));
  return new;
end $$;

drop trigger if exists trg_recordatorios on public.reservas;
create trigger trg_recordatorios after insert or update of estado on public.reservas
  for each row execute function public.programar_recordatorios();

-- ======================================================================
-- 12. FUNCIONES DE CONSULTA (API RPC)
-- ======================================================================

-- ¿Está libre el espacio en ese rango? Considera reservas y bloqueos.
create or replace function public.esta_disponible(
  p_espacio uuid, p_inicio timestamptz, p_fin timestamptz, p_excluir_reserva uuid default null
) returns boolean language sql stable as $$
  select not exists (
    select 1 from public.reservas r
     where r.espacio_id = p_espacio
       and r.estado in ('pendiente','confirmada','en_curso')
       and (p_excluir_reserva is null or r.id <> p_excluir_reserva)
       and r.periodo && tstzrange(p_inicio, p_fin, '[)')
  ) and not exists (
    select 1 from public.bloqueos b
     where (b.espacio_id = p_espacio
            or b.edificio_id = (select edificio_id from public.espacios where id = p_espacio))
       and tstzrange(b.inicio, b.fin) && tstzrange(p_inicio, p_fin, '[)')
  );
$$;

-- Disponibilidad de un espacio en un día, bloque por bloque.
-- Cada hora se interpreta en la zona de la organización, no en la zona
-- de la conexión PostgreSQL (en la nube suele ser UTC).
create or replace function public.disponibilidad_dia(
  p_espacio uuid, p_fecha date, p_bloques text[] default array['08:00-09:00','09:00-10:00','10:00-11:00','11:00-12:00','12:00-13:00','13:00-14:00','14:00-15:00','15:00-16:00','16:00-17:00','17:00-18:00','18:00-19:00']
) returns table (bloque text, libre boolean)
language plpgsql stable as $$
declare b text; ini timestamptz; fin timestamptz; v_zona text;
begin
  select o.zona_horaria into v_zona
    from public.espacios e
    join public.organizaciones o on o.id = e.organizacion_id
   where e.id = p_espacio;
  if not found then return; end if;

  foreach b in array p_bloques loop
    bloque := b;
    begin
      ini := (p_fecha + split_part(b, '-', 1)::time) at time zone v_zona;
      fin := (p_fecha + split_part(b, '-', 2)::time) at time zone v_zona;
      libre := fin > now() and public.esta_disponible(p_espacio, ini, fin);
    exception when others then
      libre := false;
    end;
    return next;
  end loop;
end $$;

-- Disponibilidad de TODOS los espacios de una organización en un día.
-- Una sola llamada alimenta el semáforo de colores del mapa 3D.
create or replace function public.disponibilidad_mapa(
  p_organizacion uuid, p_fecha date
) returns table (espacio_id uuid, libres int, total int)
language sql stable as $$
  with cfg as (
    select zona_horaria from public.organizaciones where id = p_organizacion
  ),
  bloques as (
    select unnest(array['08:00-09:00','09:00-10:00','10:00-11:00','11:00-12:00','12:00-13:00','13:00-14:00','14:00-15:00','15:00-16:00','16:00-17:00','17:00-18:00','18:00-19:00']) as b
  ),
  reservables as (
    select id from public.espacios
     where organizacion_id = p_organizacion and reservable and activo and estado = 'disponible'
  )
  select e.id,
         count(*) filter (
           where ((p_fecha + split_part(bl.b,'-',2)::time) at time zone cfg.zona_horaria) > now()
             and public.esta_disponible(
             e.id,
             (p_fecha + split_part(bl.b,'-',1)::time) at time zone cfg.zona_horaria,
             (p_fecha + split_part(bl.b,'-',2)::time) at time zone cfg.zona_horaria
           )
         )::int as libres,
         count(*) filter (
           where ((p_fecha + split_part(bl.b,'-',2)::time) at time zone cfg.zona_horaria) > now()
         )::int as total
    from reservables e cross join bloques bl cross join cfg
   group by e.id;
$$;

-- Crea una reserva validando disponibilidad de forma atómica.
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
  v_reserva public.reservas;
begin
  if auth.uid() is null then raise exception 'Se requiere sesión'; end if;

  select * into v_espacio from public.espacios where id = p_espacio;
  if not found then raise exception 'El espacio no existe'; end if;
  if not v_espacio.reservable or v_espacio.estado <> 'disponible' then
    raise exception 'Este espacio no está disponible para reservar';
  end if;
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
       and (cardinality(espacios) = 0 or p_espacio = any(espacios));
    if found and v_sub >= v_promo.minimo_compra then
      v_desc := case v_promo.tipo
                  when 'porcentaje'   then round(v_sub * v_promo.valor / 100.0, 2)
                  when 'monto'        then least(v_promo.valor, v_sub)
                  when 'horas_gratis' then round(least(v_promo.valor, v_horas) * v_espacio.precio_hora, 2)
                end;
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
    greatest(p_asistentes, 1), p_notas, v_sub, v_desc, v_imp, v_sub - v_desc + v_imp,
    (select moneda from public.organizaciones where id = v_espacio.organizacion_id),
    v_promo.id, p_origen
  ) returning * into v_reserva;

  if v_promo.id is not null and v_desc > 0 then
    insert into public.promocion_usos (promocion_id, usuario_id, reserva_id, descuento)
    values (v_promo.id, auth.uid(), v_reserva.id, v_desc);
    update public.promociones set usos_actuales = usos_actuales + 1 where id = v_promo.id;
  end if;

  return v_reserva;
end $$;

-- Cancela aplicando la política de reembolso.
create or replace function public.cancelar_reserva(
  p_reserva uuid, p_motivo text default null
) returns public.reservas
language plpgsql security definer set search_path = public as $$
declare v public.reservas; v_horas numeric; v_reembolso numeric;
begin
  select * into v from public.reservas where id = p_reserva;
  if not found then raise exception 'La reserva no existe'; end if;
  if v.usuario_id <> auth.uid() and not public.es_staff(v.organizacion_id) then
    raise exception 'No puedes cancelar esta reserva';
  end if;
  if v.estado in ('cancelada','completada') then raise exception 'La reserva ya no se puede cancelar'; end if;

  v_horas := extract(epoch from (v.inicio - now())) / 3600.0;
  v_reembolso := case when v_horas >= 24 then v.total else round(v.total * 0.5, 2) end;

  update public.reservas
     set estado = 'cancelada', cancelada_en = now(), cancelada_por = auth.uid(),
         motivo_cancelacion = p_motivo, monto_reembolso = v_reembolso
   where id = p_reserva
  returning * into v;

  insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, enlace)
  values (v.usuario_id, 'reserva', 'Reserva cancelada',
          'Tu reserva ' || v.folio || ' fue cancelada. Reembolso estimado: $' || v_reembolso,
          '/reservas/' || v.id);
  return v;
end $$;

-- Cambia fecha/hora de una reserva existente.
create or replace function public.modificar_reserva(
  p_reserva uuid, p_inicio timestamptz, p_fin timestamptz
) returns public.reservas
language plpgsql security definer set search_path = public as $$
declare v public.reservas; v_espacio public.espacios; v_horas numeric; v_sub numeric; v_tasa numeric;
begin
  select * into v from public.reservas where id = p_reserva;
  if not found then raise exception 'La reserva no existe'; end if;
  if v.usuario_id <> auth.uid() and not public.es_staff(v.organizacion_id) then
    raise exception 'No puedes modificar esta reserva';
  end if;
  if v.estado in ('cancelada','completada') then raise exception 'La reserva ya no se puede modificar'; end if;
  if not public.esta_disponible(v.espacio_id, p_inicio, p_fin, p_reserva) then
    raise exception 'conflicto_horario: ese horario ya está ocupado';
  end if;

  select * into v_espacio from public.espacios where id = v.espacio_id;
  select tasa_impuesto into v_tasa from public.organizaciones where id = v.organizacion_id;
  v_horas := extract(epoch from (p_fin - p_inicio)) / 3600.0;
  v_sub := round(v_espacio.precio_hora * v_horas, 2);

  update public.reservas
     set inicio = p_inicio, fin = p_fin,
         subtotal = v_sub,
         impuestos = round((v_sub - descuento) * coalesce(v_tasa, 0.16), 2),
         total = v_sub - descuento + round((v_sub - descuento) * coalesce(v_tasa, 0.16), 2),
         recordatorio_enviado = false
   where id = p_reserva
  returning * into v;
  return v;
end $$;

-- ¿El usuario actual es staff/admin de esa organización?
create or replace function public.es_staff(p_org uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios u
     where u.id = auth.uid() and u.rol in ('staff','admin','superadmin')
  ) or exists (
    select 1 from public.organizacion_usuarios ou
     where ou.usuario_id = auth.uid()
       and (p_org is null or ou.organizacion_id = p_org)
       and ou.rol in ('staff','admin','superadmin')
  );
$$;

create or replace function public.es_admin(p_org uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.rol in ('admin','superadmin')
  ) or exists (
    select 1 from public.organizacion_usuarios ou
     where ou.usuario_id = auth.uid()
       and (p_org is null or ou.organizacion_id = p_org)
       and ou.rol in ('admin','superadmin')
  );
$$;

-- ======================================================================
-- 13. VISTAS DE ANALÍTICA
-- ======================================================================
create or replace view public.v_metricas_diarias as
select r.organizacion_id,
       date_trunc('day', r.inicio)::date as dia,
       count(*)                                          as reservas,
       count(*) filter (where r.estado = 'cancelada')     as canceladas,
       coalesce(sum(r.total) filter (where r.estado <> 'cancelada'), 0) as ingresos,
       coalesce(sum(extract(epoch from (r.fin - r.inicio)) / 3600.0)
                filter (where r.estado <> 'cancelada'), 0) as horas
  from public.reservas r
 group by 1, 2;

create or replace view public.v_espacios_populares as
select e.organizacion_id, e.id as espacio_id, e.nombre, e.codigo,
       count(r.id)                                        as reservas,
       coalesce(sum(r.total) filter (where r.estado <> 'cancelada'), 0) as ingresos,
       e.calificacion, e.total_resenas
  from public.espacios e
  left join public.reservas r on r.espacio_id = e.id
 group by e.organizacion_id, e.id, e.nombre, e.codigo, e.calificacion, e.total_resenas;

create or replace view public.v_horarios_pico as
select r.organizacion_id,
       to_char(r.inicio, 'HH24:00')  as hora,
       extract(dow from r.inicio)::int as dia_semana,
       count(*)                      as reservas
  from public.reservas r
 where r.estado <> 'cancelada'
 group by 1, 2, 3;

create or replace view public.v_ocupacion_espacio as
select e.organizacion_id, e.id as espacio_id, e.nombre,
       date_trunc('month', r.inicio)::date as mes,
       coalesce(sum(extract(epoch from (r.fin - r.inicio)) / 3600.0), 0) as horas_reservadas,
       -- 12 h reservables x ~30 días
       round(coalesce(sum(extract(epoch from (r.fin - r.inicio)) / 3600.0), 0) / 360.0, 4) as ocupacion
  from public.espacios e
  left join public.reservas r
         on r.espacio_id = e.id and r.estado not in ('cancelada')
 where e.reservable
 group by e.organizacion_id, e.id, e.nombre, date_trunc('month', r.inicio);

-- ======================================================================
-- 14. REALTIME
-- ======================================================================
-- Publica las tablas que la app escucha en vivo. Es idempotente: si la
-- tabla ya está publicada, se ignora el error.
do $$
declare t text;
begin
  foreach t in array array['reservas','espacios','notificaciones','mensajes','lista_espera'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when undefined_object then null;
    end;
  end loop;
end $$;

-- Realtime necesita la fila completa para calcular los cambios.
alter table public.reservas       replica identity full;
alter table public.espacios       replica identity full;
alter table public.notificaciones replica identity full;
alter table public.mensajes       replica identity full;

-- ======================================================================
-- 15. PERMISOS BASE
-- ======================================================================
-- Supabase ya concede esto por omisión, pero dejarlo explícito hace que
-- el esquema funcione también en una base creada a mano (y en las
-- pruebas). Quién ve QUÉ lo siguen decidiendo las políticas RLS: esto
-- sólo abre la puerta para que RLS pueda opinar.
grant usage on schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- Los permisos de TABLA. Un proyecto de Supabase ya los trae puestos por
-- defecto, así que esto parecía sobrar... hasta que se reconstruye el
-- esquema `public` desde cero (o se levanta la base en un PostgreSQL
-- normal para probar): entonces `authenticated` se queda sin nada y la
-- aplicación entera responde «permission denied for table reservas».
--
-- Que aquí diga `all tables` NO significa que todo el mundo pueda con
-- todo: GRANT sólo abre la puerta, RLS decide quién pasa. Una tabla con
-- RLS activo y sin política para una operación la sigue negando. Se
-- concede lo mismo que concede Supabase para que las pruebas locales se
-- comporten igual que producción y no escondan un fallo de permisos.
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
alter default privileges in schema public
  grant select on tables to anon, authenticated;
alter default privileges in schema public
  grant insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;

-- A propósito NO se concede EXECUTE explícito a `anon`/`authenticated`
-- sobre las funciones: PostgreSQL ya las crea con EXECUTE para PUBLIC,
-- y seguridad.sql cierra las peligrosas con `revoke ... from public`.
-- Un GRANT nominal aquí sobreviviría a ese REVOKE y volvería a dejar
-- expuestas RPC como `limitar_ritmo` o `validar_ventana_reserva`.
