# Smart Hub 2.8.1 — corrección de reservaciones

- El catálogo, inicio, detalle y asistente sólo ofrecen OF-A, OF-B, OF-C y OF-D.
- Se centralizó el criterio comercial de V1 para no depender de flags `reservable` antiguos.
- Se reconocen también los nombres comerciales de A/B/C/D si una base antigua conserva códigos distintos.
- La pantalla Reservar y Checkout usan el mismo criterio, evitando el falso “Espacio no reservable”.
- El selector interno de oficinas usa la ruta correcta `#/espacios/:id/reservar`.
- El manifest declara `enctype` explícitamente para eliminar la advertencia de Chrome.
- Caché/versionado subido a 2.8.1.
