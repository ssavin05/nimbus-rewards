-- ======================================================================
-- migracion-10-cerrar-escrituras-pospuestas.sql
-- V1 2.5.0: el navegador sólo cobra con Clip (Edge Function) y la
-- facturación está deshabilitada. Cierra escrituras directas que habían
-- quedado abiertas para transferencia/efectivo y facturación futura.
-- Idempotente: se puede ejecutar más de una vez.
-- ======================================================================

begin;

drop policy if exists "pagos_insert" on public.pagos;
create policy "pagos_insert" on public.pagos for insert to authenticated
  with check (public.es_staff(organizacion_id));

drop policy if exists "facturas_insert" on public.facturas;
create policy "facturas_insert" on public.facturas for insert to authenticated
  with check (public.es_staff(organizacion_id));

create or replace function public.guardia_pago()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.escritura_confiable() or public.es_staff(new.organizacion_id) then
    return new;
  end if;

  raise exception 'Los pagos se registran únicamente desde el servidor'
    using errcode = '42501';
end $$;

commit;

-- Verificación sugerida:
-- select policyname, cmd, with_check
--   from pg_policies
--  where schemaname='public' and tablename in ('pagos','facturas')
--  order by tablename, policyname;
