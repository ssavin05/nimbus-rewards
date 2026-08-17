-- ======================================================================
-- auth-simulado.sql — un `auth` mínimo para probar en PostgreSQL a secas.
--
-- En Supabase el esquema `auth` lo crea GoTrue. En un PostgreSQL normal
-- no existe, así que schema.sql no se puede aplicar ni se pueden correr
-- las pruebas SQL.
--
-- Esto reproduce SÓLO lo que la aplicación usa:
--   · auth.users            — con las columnas que leen los triggers
--   · auth.uid()            — lee request.jwt.claim.sub, igual que PostgREST
--   · auth.role() / auth.jwt()
--   · los roles anon / authenticated / service_role
--
-- NO reproduce contraseñas, tokens ni sesiones: de eso se encarga
-- Supabase Auth y no queremos imitarlo (FASE 02 §2.2).
--
--     ⚠️  Esto es para pruebas locales. NUNCA se aplica en Supabase.
--
-- Uso:
--   createdb app
--   psql -d app -f supabase/local/auth-simulado.sql
--   psql -d app -f supabase/schema.sql
--   psql -d app -f supabase/policies.sql
--   psql -d app -f supabase/seguridad.sql
--   psql -d app -f supabase/restricciones.sql
-- ======================================================================

create schema if not exists auth;

-- Los tres roles que usa PostgREST.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Igual que en Supabase: el uid sale del JWT que trae la petición.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

-- `storage` también lo crea Supabase; policies.sql escribe en él.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id) on delete cascade,
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(name, '/');
$$;

do $$
begin
  raise notice 'auth-simulado.sql aplicado (SÓLO para pruebas locales).';
end $$;
