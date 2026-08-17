-- ======================================================================
-- migracion-01-borrado-cuenta.sql
--
-- Aplica SÓLO si ya habías corrido la primera versión de schema.sql.
-- Si vas a instalar de cero, schema.sql ya trae estos cambios y no hace
-- falta ejecutar este archivo.
--
-- Qué arregla
-- -----------
-- `reservas`, `pagos` y `facturas` referenciaban a `usuarios` con
-- ON DELETE RESTRICT y NOT NULL. Con eso, borrar una cuenta que hubiera
-- hecho aunque fuera una reserva fallaba con violación de llave foránea:
-- el derecho al olvido quedaba bloqueado por el histórico contable.
--
-- La solución es desacoplar ambas cosas: el comprobante se conserva
-- (obligación fiscal) pero deja de apuntar a una persona, y el nombre y
-- el correo quedan copiados en el propio registro para que el histórico
-- siga siendo legible.
-- ======================================================================

begin;

-- 1. Copia del cliente dentro del propio comprobante
alter table public.reservas add column if not exists cliente_nombre text;
alter table public.reservas add column if not exists cliente_email  text;
alter table public.pagos    add column if not exists cliente_nombre text;
alter table public.pagos    add column if not exists cliente_email  text;

-- Rellena lo que ya existe
update public.reservas r
   set cliente_nombre = coalesce(r.cliente_nombre, u.nombre),
       cliente_email  = coalesce(r.cliente_email,  u.email)
  from public.usuarios u
 where u.id = r.usuario_id
   and (r.cliente_nombre is null or r.cliente_email is null);

update public.pagos p
   set cliente_nombre = coalesce(p.cliente_nombre, u.nombre),
       cliente_email  = coalesce(p.cliente_email,  u.email)
  from public.usuarios u
 where u.id = p.usuario_id
   and (p.cliente_nombre is null or p.cliente_email is null);

-- 2. Permitir que el vínculo con la persona desaparezca
alter table public.reservas alter column usuario_id drop not null;
alter table public.pagos    alter column usuario_id drop not null;
alter table public.facturas alter column usuario_id drop not null;

alter table public.reservas drop constraint if exists reservas_usuario_id_fkey;
alter table public.reservas add  constraint reservas_usuario_id_fkey
  foreign key (usuario_id) references public.usuarios(id) on delete set null;

alter table public.pagos drop constraint if exists pagos_usuario_id_fkey;
alter table public.pagos add  constraint pagos_usuario_id_fkey
  foreign key (usuario_id) references public.usuarios(id) on delete set null;

alter table public.facturas drop constraint if exists facturas_usuario_id_fkey;
alter table public.facturas add  constraint facturas_usuario_id_fkey
  foreign key (usuario_id) references public.usuarios(id) on delete set null;

-- 3. Trigger que copia el nombre y el correo al crear el registro
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

commit;

-- ======================================================================
-- Comprobación rápida: esto debe devolver 'SET NULL' en las tres filas.
--
--   select tc.table_name, rc.delete_rule
--     from information_schema.table_constraints tc
--     join information_schema.referential_constraints rc
--       on rc.constraint_name = tc.constraint_name
--    where tc.table_name in ('reservas','pagos','facturas')
--      and tc.constraint_name like '%usuario_id%';
-- ======================================================================
