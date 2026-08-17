# Smart Hub 2.6.0 — mapa 3D de reservas

## Mapa

- Los espacios se muestran como **bloques 3D cerrados** sobre una rejilla oscura.
- El bloque completo funciona como semáforo; ya no se usa un punto pequeño.
- **Verde:** todos los horarios que aún pueden reservarse ese día están libres.
- **Ámbar:** quedan algunos horarios, pero no todos.
- **Rojo:** no quedan horarios o el espacio no es reservable.
- **Gris:** la consulta de disponibilidad todavía no respondió.
- Los nombres quedan visibles en el mapa general para que funcione como plano de selección.
- Las cuatro oficinas rentables siguen siendo OF-A, OF-B, OF-C y OF-D.

## Horario

- Todos los días, incluidos domingos.
- 08:00 a 19:00, zona `America/Tijuana`.
- 11 bloques de una hora: 08–09, 09–10, …, 18–19.
- Frontend, modo local, asistente y Supabase usan la misma regla.

## Producción

Aplicar después de las migraciones 01–13:

`supabase/migracion-14-horario-8-a-19-y-mapa-semaforo.sql`

La migración actualiza los horarios existentes, crea los días generales que falten y sustituye las funciones de validación/disponibilidad con la nueva rejilla.
