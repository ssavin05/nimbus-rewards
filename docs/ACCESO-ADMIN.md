# Acceso al panel administrativo

El panel se abre desde **Perfil → Entrar al panel administrativo** o desde
el menú lateral. La ruta directa es `#/admin`.

## Si la cuenta aparece como usuario

En Supabase, abre **SQL Editor** y ejecuta reemplazando el correo:

```sql
update public.usuarios
set rol = 'admin'
where lower(email) = lower('tu-correo@ejemplo.com');
```

Luego vuelve a **Perfil → Verificar acceso**. La aplicación vuelve a consultar
el rol sin pedir que cierres sesión.

Para una organización específica también se puede asignar la membresía:

```sql
insert into public.organizacion_usuarios (organizacion_id, usuario_id, rol)
select o.id, u.id, 'admin'
from public.organizaciones o
cross join public.usuarios u
where o.slug = 'smart-hub'
  and lower(u.email) = lower('tu-correo@ejemplo.com')
on conflict (organizacion_id, usuario_id)
do update set rol = excluded.rol;
```

No se permite que una cuenta se conceda permisos desde el navegador. La base
de datos continúa aplicando RLS y sólo el propietario del proyecto puede hacer
esta asignación inicial.
