# Smart Hub 2.8.0 — Admin y diseño Executive

## Qué cambió

- Portada combinada: se mantiene la navegación original y se añade un hero
  negro/dorado con fotografía, llamada a reservar y acceso al mapa 3D.
- El catálogo visible y el flujo de reserva se limitan a las oficinas A, B,
  C y D que tienen fotografías.
- Reserva con indicador de pasos, selector de oficina, calendario mensual,
  horarios, duración, detalles, resumen y continuación al checkout de Clip.
- Modo administrativo con navegación propia, Dashboard, Calendario,
  Reservaciones, Clientes, Pagos, Espacios, Tarifas, Configuración y Reportes.
- Dashboard con datos reales: ingresos, reservas, horas, ocupación, actividad
  por oficina, próximas reservas y clientes recurrentes.
- Calendario administrativo en vistas de día, semana y mes.
- Clientes en tabla con empresa, teléfono, correo, número de reservas e historial.
- Pagos distingue Clip Online y Clip Terminal sin simular cobros nuevos.

## Corrección de acceso administrativo

El rol se obtiene del perfil, de la metadata segura y de la membresía de la
organización. La consulta de membresía ya no depende de un join que podía ser
bloqueado por RLS. Al abrir una ruta administrativa se vuelve a consultar el
rol antes de negar el acceso.

Consulta `docs/ACCESO-ADMIN.md` para asignar la primera cuenta administradora
desde el SQL Editor de Supabase.

## Elementos conservados

Supabase, autenticación, RLS, reservas, cancelaciones, Clip, PWA, mapa 3D y la
lógica de precios existente permanecen activos. No se creó una base nueva ni
se reemplazó el motor de reservaciones.
