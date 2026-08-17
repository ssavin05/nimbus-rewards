# Smart Hub 2.7.2 — corrección Clip/CORS

- El cliente ya no añade la cabecera global `x-app`, que provocaba que el navegador bloqueara por CORS las llamadas a Edge Functions.
- `pagos-clip/estado` se consulta con GET directo, sin preflight ni sesión, porque sólo devuelve booleanos seguros.
- Las llamadas que crean/verifican/reembolsan pagos siguen autenticadas por Supabase.
- Defensa adicional: futuras Edge Functions permiten `x-app` en CORS.
- V1 bloquea por código cualquier reserva que no sea OF-A, OF-B, OF-C u OF-D, incluso si una fila vieja de producción conserva `reservable=true`.
- Versión/cache subidas a 2.7.2.
