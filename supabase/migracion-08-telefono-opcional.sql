-- =====================================================================
-- migracion-08-telefono-opcional.sql
-- Corrige registros donde el teléfono opcional llega como cadena vacía.
-- La restricción usuario_telefono_razonable acepta NULL o 7–25 caracteres;
-- convertir "" a NULL evita que Auth falle con HTTP 500 al crear el perfil.
-- Idempotente: CREATE OR REPLACE.
-- =====================================================================

create or replace function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuarios (id, email, nombre, telefono, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'nombre',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, 'usuario'), '@', 1)
    ),
    nullif(btrim(new.raw_user_meta_data->>'telefono'), ''),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        avatar_url = coalesce(public.usuarios.avatar_url, excluded.avatar_url);

  return new;
end
$$;

-- El trigger existente apunta a esta función por OID y no necesita recrearse.
