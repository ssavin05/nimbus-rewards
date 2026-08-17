-- Arreglo para Supabase Security Advisor:
-- public.v_ocupacion_publica deja de ser SECURITY DEFINER.
-- Puede ejecutarse de forma independiente sobre una base ya desplegada.

begin;

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

commit;
