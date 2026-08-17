-- ======================================================================
-- policies.sql — Row Level Security (RLS).
--
-- Regla base: TODO está cerrado salvo lo que estas políticas abren.
-- Los datos personales (reservas, pagos, facturas, chats) sólo son
-- visibles para su dueño y para el staff de la organización.
--
-- Aplicar DESPUÉS de schema.sql.
-- ======================================================================

alter table public.organizaciones        enable row level security;
alter table public.organizacion_usuarios enable row level security;
alter table public.usuarios              enable row level security;
alter table public.sedes                 enable row level security;
alter table public.edificios             enable row level security;
alter table public.pisos                 enable row level security;
alter table public.amenidades            enable row level security;
alter table public.espacios              enable row level security;
alter table public.espacio_fotos         enable row level security;
alter table public.horarios_operacion    enable row level security;
alter table public.bloqueos              enable row level security;
alter table public.reservas              enable row level security;
alter table public.pagos                 enable row level security;
alter table public.facturas              enable row level security;
alter table public.favoritos             enable row level security;
alter table public.resenas               enable row level security;
alter table public.lista_espera          enable row level security;
alter table public.promociones           enable row level security;
alter table public.promocion_usos        enable row level security;
alter table public.notificaciones        enable row level security;
alter table public.push_suscripciones    enable row level security;
alter table public.conversaciones        enable row level security;
alter table public.mensajes              enable row level security;
alter table public.auditoria             enable row level security;

-- ----------------------------------------------------------------------
-- CATÁLOGO PÚBLICO — lectura para cualquiera (incluso sin sesión), para
-- que el mapa y los precios se puedan ver antes de registrarse.
-- Escritura sólo para administración.
-- ----------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['organizaciones','sedes','edificios','pisos','espacios','espacio_fotos','horarios_operacion','amenidades','promociones'] loop
    execute format('drop policy if exists "lectura_publica" on public.%I', t);
    execute format('create policy "lectura_publica" on public.%I for select using (true)', t);

    execute format('drop policy if exists "escritura_admin" on public.%I', t);
    execute format('create policy "escritura_admin" on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

-- Los bloqueos también se leen en público (afectan la disponibilidad).
drop policy if exists "bloqueos_lectura" on public.bloqueos;
create policy "bloqueos_lectura" on public.bloqueos for select using (true);
drop policy if exists "bloqueos_staff" on public.bloqueos;
create policy "bloqueos_staff" on public.bloqueos for all to authenticated
  using (public.es_staff(organizacion_id)) with check (public.es_staff(organizacion_id));

-- ----------------------------------------------------------------------
-- USUARIOS — cada quien ve y edita su perfil; el staff puede consultarlos.
-- ----------------------------------------------------------------------
drop policy if exists "perfil_propio_select" on public.usuarios;
create policy "perfil_propio_select" on public.usuarios for select to authenticated
  using (id = auth.uid() or public.es_staff());

drop policy if exists "perfil_propio_update" on public.usuarios;
create policy "perfil_propio_update" on public.usuarios for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- El rol NO se puede escalar desde el cliente: sólo un admin cambia roles.
drop policy if exists "perfil_admin_update" on public.usuarios;
create policy "perfil_admin_update" on public.usuarios for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists "perfil_insert" on public.usuarios;
create policy "perfil_insert" on public.usuarios for insert to authenticated
  with check (id = auth.uid());

-- Protege el campo `rol` frente a auto-ascensos.
create or replace function public.proteger_rol()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol is distinct from old.rol and not public.es_admin() then
    new.rol := old.rol;
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_rol on public.usuarios;
create trigger trg_proteger_rol before update on public.usuarios
  for each row execute function public.proteger_rol();

-- ----------------------------------------------------------------------
-- MEMBRESÍAS
-- ----------------------------------------------------------------------
drop policy if exists "membresia_propia" on public.organizacion_usuarios;
create policy "membresia_propia" on public.organizacion_usuarios for select to authenticated
  using (usuario_id = auth.uid() or public.es_staff(organizacion_id));

drop policy if exists "membresia_admin" on public.organizacion_usuarios;
create policy "membresia_admin" on public.organizacion_usuarios for all to authenticated
  using (public.es_admin(organizacion_id)) with check (public.es_admin(organizacion_id));

-- ----------------------------------------------------------------------
-- RESERVAS — dueño + staff. Crear sólo para uno mismo.
-- ----------------------------------------------------------------------
drop policy if exists "reservas_select" on public.reservas;
create policy "reservas_select" on public.reservas for select to authenticated
  using (usuario_id = auth.uid() or public.es_staff(organizacion_id));

drop policy if exists "reservas_insert" on public.reservas;
create policy "reservas_insert" on public.reservas for insert to authenticated
  with check (usuario_id = auth.uid() or public.es_staff(organizacion_id));

drop policy if exists "reservas_update" on public.reservas;
create policy "reservas_update" on public.reservas for update to authenticated
  using (usuario_id = auth.uid() or public.es_staff(organizacion_id))
  with check (usuario_id = auth.uid() or public.es_staff(organizacion_id));

drop policy if exists "reservas_delete" on public.reservas;
create policy "reservas_delete" on public.reservas for delete to authenticated
  using (public.es_admin(organizacion_id));

-- Disponibilidad pública segura: la vista ya NO ejecuta con los permisos
-- de su dueño. La función encapsula únicamente los tres campos que son
-- públicos y mantiene el bypass de RLS limitado a esos datos.
create or replace function public.ocupacion_publica_segura()
returns table (
  espacio_id uuid,
  inicio timestamptz,
  fin timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.espacio_id, r.inicio, r.fin
    from public.reservas as r
   where r.estado in (
     'pendiente'::public.estado_reserva,
     'confirmada'::public.estado_reserva,
     'en_curso'::public.estado_reserva
   );
$$;

revoke all on function public.ocupacion_publica_segura() from public;
grant execute on function public.ocupacion_publica_segura() to anon, authenticated;

create or replace view public.v_ocupacion_publica
with (security_invoker = true, security_barrier = true) as
  select espacio_id, inicio, fin
    from public.ocupacion_publica_segura();

revoke all on public.v_ocupacion_publica from anon, authenticated;
grant select on public.v_ocupacion_publica to anon, authenticated;

-- ----------------------------------------------------------------------
-- PAGOS Y FACTURAS
-- ----------------------------------------------------------------------
drop policy if exists "pagos_select" on public.pagos;
create policy "pagos_select" on public.pagos for select to authenticated
  using (usuario_id = auth.uid() or public.es_staff(organizacion_id));

drop policy if exists "pagos_insert" on public.pagos;
create policy "pagos_insert" on public.pagos for insert to authenticated
  with check (public.es_staff(organizacion_id));

-- El estado del pago sólo lo mueve el servidor (service_role, vía webhook).
drop policy if exists "pagos_update_staff" on public.pagos;
create policy "pagos_update_staff" on public.pagos for update to authenticated
  using (public.es_admin(organizacion_id)) with check (public.es_admin(organizacion_id));

drop policy if exists "facturas_select" on public.facturas;
create policy "facturas_select" on public.facturas for select to authenticated
  using (usuario_id = auth.uid() or public.es_staff(organizacion_id));

drop policy if exists "facturas_insert" on public.facturas;
create policy "facturas_insert" on public.facturas for insert to authenticated
  with check (public.es_staff(organizacion_id));

drop policy if exists "facturas_admin" on public.facturas;
create policy "facturas_admin" on public.facturas for update to authenticated
  using (public.es_staff(organizacion_id)) with check (public.es_staff(organizacion_id));

-- ----------------------------------------------------------------------
-- FAVORITOS
-- ----------------------------------------------------------------------
drop policy if exists "favoritos_propios" on public.favoritos;
create policy "favoritos_propios" on public.favoritos for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- ----------------------------------------------------------------------
-- RESEÑAS — lectura pública; sólo escribe quien tuvo una reserva.
-- ----------------------------------------------------------------------
drop policy if exists "resenas_lectura" on public.resenas;
create policy "resenas_lectura" on public.resenas for select using (visible or usuario_id = auth.uid() or public.es_staff());

drop policy if exists "resenas_insert" on public.resenas;
create policy "resenas_insert" on public.resenas for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and exists (
      select 1 from public.reservas r
       where r.usuario_id = auth.uid()
         and r.espacio_id = resenas.espacio_id
         and r.estado in ('completada','confirmada','en_curso')
    )
  );

drop policy if exists "resenas_update" on public.resenas;
create policy "resenas_update" on public.resenas for update to authenticated
  using (usuario_id = auth.uid() or public.es_staff())
  with check (usuario_id = auth.uid() or public.es_staff());

drop policy if exists "resenas_delete" on public.resenas;
create policy "resenas_delete" on public.resenas for delete to authenticated
  using (usuario_id = auth.uid() or public.es_admin());

-- ----------------------------------------------------------------------
-- LISTA DE ESPERA
-- ----------------------------------------------------------------------
drop policy if exists "espera_propia" on public.lista_espera;
create policy "espera_propia" on public.lista_espera for all to authenticated
  using (usuario_id = auth.uid() or public.es_staff())
  with check (usuario_id = auth.uid());

-- ----------------------------------------------------------------------
-- PROMOCIONES — el catálogo activo es público; los usos son privados.
-- ----------------------------------------------------------------------
drop policy if exists "usos_propios" on public.promocion_usos;
create policy "usos_propios" on public.promocion_usos for select to authenticated
  using (usuario_id = auth.uid() or public.es_staff());

drop policy if exists "usos_insert" on public.promocion_usos;
create policy "usos_insert" on public.promocion_usos for insert to authenticated
  with check (usuario_id = auth.uid());

-- ----------------------------------------------------------------------
-- NOTIFICACIONES Y PUSH
-- ----------------------------------------------------------------------
drop policy if exists "notif_propias" on public.notificaciones;
create policy "notif_propias" on public.notificaciones for select to authenticated
  using (usuario_id = auth.uid());

drop policy if exists "notif_marcar" on public.notificaciones;
create policy "notif_marcar" on public.notificaciones for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "notif_staff_insert" on public.notificaciones;
create policy "notif_staff_insert" on public.notificaciones for insert to authenticated
  with check (public.es_staff());

drop policy if exists "push_propias" on public.push_suscripciones;
create policy "push_propias" on public.push_suscripciones for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- ----------------------------------------------------------------------
-- CHAT
-- ----------------------------------------------------------------------
drop policy if exists "conv_propias" on public.conversaciones;
create policy "conv_propias" on public.conversaciones for select to authenticated
  using (usuario_id = auth.uid() or public.es_staff(organizacion_id));

drop policy if exists "conv_crear" on public.conversaciones;
create policy "conv_crear" on public.conversaciones for insert to authenticated
  with check (usuario_id = auth.uid());

drop policy if exists "conv_actualizar" on public.conversaciones;
create policy "conv_actualizar" on public.conversaciones for update to authenticated
  using (usuario_id = auth.uid() or public.es_staff(organizacion_id))
  with check (usuario_id = auth.uid() or public.es_staff(organizacion_id));

drop policy if exists "mensajes_leer" on public.mensajes;
create policy "mensajes_leer" on public.mensajes for select to authenticated
  using (exists (
    select 1 from public.conversaciones c
     where c.id = mensajes.conversacion_id
       and (c.usuario_id = auth.uid() or public.es_staff(c.organizacion_id))
  ));

drop policy if exists "mensajes_escribir" on public.mensajes;
create policy "mensajes_escribir" on public.mensajes for insert to authenticated
  with check (exists (
    select 1 from public.conversaciones c
     where c.id = mensajes.conversacion_id
       and (c.usuario_id = auth.uid() or public.es_staff(c.organizacion_id))
  ));

-- ----------------------------------------------------------------------
-- AUDITORÍA — sólo lectura para administración.
-- ----------------------------------------------------------------------
drop policy if exists "auditoria_admin" on public.auditoria;
create policy "auditoria_admin" on public.auditoria for select to authenticated
  using (public.es_admin());

-- ======================================================================
-- STORAGE — buckets y permisos de archivos
-- ======================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatares',   'avatares',   true,  3145728,  array['image/png','image/jpeg','image/webp','image/gif']),
  ('espacios',   'espacios',   true,  10485760, array['image/png','image/jpeg','image/webp','image/avif','video/mp4']),
  ('modelos-3d', 'modelos-3d', true,  52428800, array['model/gltf-binary','model/gltf+json','application/octet-stream']),
  ('facturas',   'facturas',   false, 5242880,  array['application/pdf','application/xml','text/xml'])
on conflict (id) do nothing;

-- Avatares: cada quien escribe en su carpeta `<uid>/…`; lectura pública.
drop policy if exists "avatares_lectura" on storage.objects;
create policy "avatares_lectura" on storage.objects for select
  using (bucket_id = 'avatares');

drop policy if exists "avatares_escritura" on storage.objects;
create policy "avatares_escritura" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatares_actualizar" on storage.objects;
create policy "avatares_actualizar" on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatares_borrar" on storage.objects;
create policy "avatares_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

-- Fotos de espacios y modelos 3D: lectura pública, escritura de staff.
drop policy if exists "espacios_lectura" on storage.objects;
create policy "espacios_lectura" on storage.objects for select
  using (bucket_id in ('espacios','modelos-3d'));

drop policy if exists "espacios_escritura" on storage.objects;
create policy "espacios_escritura" on storage.objects for all to authenticated
  using (bucket_id in ('espacios','modelos-3d') and public.es_staff())
  with check (bucket_id in ('espacios','modelos-3d') and public.es_staff());

-- Facturas: privadas, sólo su dueño y el staff.
drop policy if exists "facturas_archivos" on storage.objects;
create policy "facturas_archivos" on storage.objects for select to authenticated
  using (bucket_id = 'facturas' and ((storage.foldername(name))[1] = auth.uid()::text or public.es_staff()));
