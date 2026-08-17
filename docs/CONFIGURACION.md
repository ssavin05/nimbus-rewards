# Guía de configuración

Qué funciona de inmediato, qué necesita credenciales y cómo conseguirlas.

---

## Resumen honesto de lo que necesita cada cosa

| Funcionalidad | Estado sin configurar nada | Qué hace falta para producción |
|---|---|---|
| Mapa 3D, catálogo, precios | ✅ Funciona (datos de demostración) | Nada |
| Búsqueda inteligente y recomendaciones | ✅ Funciona (motor local) | Nada |
| Modo oscuro, idiomas, háptica, PWA offline | ✅ Funciona | Nada |
| Registro, sesión, reservas reales, favoritos, reseñas | ❌ Sin backend | Proyecto de Supabase |
| Google / Apple Sign In | 🚫 Oculto por defecto | Activar proveedor + `auth.*Enabled=true` sólo tras probarlo |
| Notificaciones push | ❌ | Llaves VAPID + Edge Function |
| **Clip México** (pasarela principal) | ❌ | Cuenta Clip + Edge Function `pagos-clip` |
| Stripe / Google Pay / Apple Pay | 🚫 Fuera de V1 | Adaptadores cliente retirados |
| Mercado Pago | 🚫 Fuera de V1 | Adaptador cliente retirado |
| PayPal | 🚫 Fuera de V1 | Adaptador cliente retirado |
| Transferencia SPEI | 🚫 Fuera de V1 | Adaptador cliente retirado |
| Factura CFDI timbrada | 🚫 Oculta por defecto | Emisor + PAC real + `features.facturacion=true` |
| Asistente con modelo de lenguaje | ✅ Motor local | `ANTHROPIC_API_KEY` en el servidor |
| Estadísticas | ✅ Con datos reales | Supabase |

---

## 1. Base de datos (Supabase)

Es lo único imprescindible para tener datos reales. El plan gratuito
alcanza de sobra para un edificio.

1. Crea un proyecto en <https://supabase.com>.
2. **SQL Editor** → ejecuta en este orden:
   - `supabase/schema.sql` — tablas, funciones, triggers y vistas
   - `supabase/policies.sql` — Row Level Security y buckets de Storage
   - `supabase/seguridad.sql` — guardias del servidor y multiempresa
   - `supabase/restricciones.sql` — CHECK e índices
   - `supabase/caducidad.sql` — expiración de los apartados sin pagar
   - `supabase/seed.sql` — el plano real del edificio

   > `caducidad.sql` parece opcional y no lo es: sin ella la columna
   > `reservas.expira_en` no existe y un apartado sin pagar **no caduca
   > nunca**, bloqueando ese horario para siempre.

   > **¿Ya habías aplicado una versión anterior de `schema.sql`?**
   > Corre además `supabase/migracion-01-borrado-cuenta.sql`. Sin ella,
   > eliminar una cuenta que haya hecho alguna reserva falla por violación
   > de llave foránea: `reservas`, `pagos` y `facturas` apuntaban al
   > usuario con `ON DELETE RESTRICT`.

3. **Project Settings → API** → copia `Project URL` y la llave
   `publishable` / `anon`.
4. Pégalas en `js/core/config.js`:

```js
export const SUPABASE = {
  url: "https://TU-PROYECTO.supabase.co",
  anonKey: "sb_publishable_...",
  ...
};
```

5. Regístrate en la app y conviértete en administrador:

```sql
update public.usuarios set rol = 'admin' where email = 'tucorreo@ejemplo.com';

insert into public.organizacion_usuarios (organizacion_id, usuario_id, rol)
select '11111111-1111-1111-1111-111111111111', id, 'admin'
  from public.usuarios where email = 'tucorreo@ejemplo.com'
on conflict do nothing;
```

### Correo de confirmación y recuperación

En esta entrega `auth.emailDeliveryEnabled=false` por defecto porque el SMTP
actual todavía no está listo. Eso oculta los flujos que dependen del correo,
como recuperación de contraseña. Para pruebas internas puedes mantener
**Confirm email** desactivado en Supabase.

Antes de producción configura un SMTP real, prueba entrega/recuperación,
vuelve a activar **Confirm email** y publica:

```js
auth: { emailDeliveryEnabled: true }
```

### URLs de redirección

**Authentication → URL Configuration**:

- *Site URL*: `https://tudominio.mx`
- *Redirect URLs*: `https://tudominio.mx/**` y `http://localhost:8080/**`

Sin esto, el OAuth y la recuperación de contraseña fallan al volver.

---

## 2. Google Sign In

1. <https://console.cloud.google.com> → **APIs y servicios → Credenciales**.
2. Crea un **ID de cliente de OAuth 2.0** de tipo *Aplicación web*.
3. En *URI de redireccionamiento autorizados* añade:
   `https://TU-PROYECTO.supabase.co/auth/v1/callback`
4. En Supabase: **Authentication → Providers → Google** → pega el
   *Client ID* y el *Client Secret* → activa.

Después de probar el proveedor, habilita el botón explícitamente:

```js
auth: { googleEnabled: true }
```

---

## 3. Apple Sign In

Requiere cuenta de desarrollador de Apple (99 USD/año).

1. <https://developer.apple.com> → **Certificates, Identifiers & Profiles**.
2. Crea un **App ID** y un **Services ID** con *Sign in with Apple* activo.
3. En el Services ID, *Return URLs*:
   `https://TU-PROYECTO.supabase.co/auth/v1/callback`
4. Crea una **Key** con *Sign in with Apple* y descarga el `.p8`.
5. En Supabase: **Authentication → Providers → Apple** → Services ID,
   Team ID, Key ID y el contenido del `.p8`.
6. Sólo después de probarlo, publica `auth.appleEnabled=true`.

---

## 4. Clip México (pasarela principal)

Es la pasarela con la que Smart Hub cobra. Todo ocurre en el servidor:
Clip **no tiene llave pública**, sus dos credenciales son secretas y sólo
viven en los secretos de Supabase.

### ⚠️ Este flujo no tiene sandbox. Léelo antes de configurar nada.

Clip sí ofrece credenciales de prueba, pero su documentación acota para
qué sirven: **Checkout Transparente, la API de reembolsos y el SDK**. Y
cierra la lista sin ambigüedad: *«Cualquier otra API que no se encuentre
en esta lista no funcionará en el modo de prueba.»*

**Checkout Redireccionado —el que usa Smart Hub— no está en esa lista.**
Tampoco hay un host de sandbox: Clip publica un único destino,
`https://api.payclip.com`, y son las credenciales las que distinguen.

De ahí se sigue algo incómodo pero que es mejor saber ahora: **no se
puede probar este cobro sin cobrar**. La única validación de punta a
punta posible es un cargo real de importe mínimo, con credenciales
reales, comprobado en el panel de Clip y reembolsado después. Está
descrito paso a paso en `OWNER_ACTIONS.md` §3d.

Lo que sí se comprueba sin gastar un peso —y se comprueba en cada
`npm test`— es la **estructura**: que la reserva quede pendiente, que el
webhook no confirme nada por sí solo, que el pago no se duplique, que
ninguna credencial llegue al navegador. Eso es estructura, no una prueba
de cobro, y en este proyecto se llaman por su nombre.

### Configuración

1. Aplica antes `supabase/migracion-07-metodo-de-pago-clip.sql` (añade
   `clip` al enum `metodo_pago`). Sin ella, registrar un cobro falla.
2. <https://dashboard.clip.mx> → **Desarrolladores → Llaves de API** →
   copia la *API Key* y la *Secret Key* **reales**. Las de prueba
   (prefijo `test_`) no sirven para este flujo: la función las detecta y
   responde `clip_credenciales_de_prueba` en vez de dejar que Clip
   conteste un 401 confuso.

```bash
supabase secrets set \
  CLIP_API_KEY=... \
  CLIP_SECRET_KEY=... \
  SITIO_URL=https://tudominio.mx

supabase functions deploy pagos-clip --no-verify-jwt
```

3. En esta entrega Clip ya es la pasarela V1 visible por defecto. Antes
   de crear una reserva, el navegador consulta `/pagos-clip/estado`; si la
   función, las credenciales, `SITIO_URL` o el freno no están listos, el
   pago falla cerrado **antes de apartar el horario**. No hay ninguna clave
   que pegar en el frontend.

4. El freno. Mientras `CLIP_COBROS_REALES` no valga `si`, crear un
   checkout devuelve `503` y **no se llama a Clip**. Enciéndelo sólo
   después de la prueba real de §3d de `OWNER_ACTIONS.md`:

```bash
supabase secrets set CLIP_COBROS_REALES=si
```

**Webhook** (Clip → Desarrolladores → Webhooks):

- URL: `https://TU-PROYECTO.supabase.co/functions/v1/pagos-clip/webhook`

Clip **no firma sus webhooks**. Por eso la Edge Function no cree lo que le
llega: del webhook sólo toma el identificador del cobro y vuelve a
preguntarle a Clip por él con nuestras credenciales
(`GET https://api.payclip.com/v2/checkout/{payment_request_id}`). Un
webhook falsificado no confirma ninguna reserva; el detalle está en
`SECURITY.md` §7.

La reserva queda **pendiente** hasta que esa verificación devuelve
`COMPLETED`. Si el pago llega después de que la reserva expiró, la función
reembolsa sola y avisa al usuario.

---

## 5. Integraciones históricas (NO son V1)

Stripe, Mercado Pago, PayPal, Google Pay, Apple Pay y transferencia están
fuera del runtime público de V1. Sus adaptadores **del navegador fueron
eliminados**. Pueden quedar Edge Functions o enums por compatibilidad con
pagos históricos, pero esta guía no incluye pasos para desplegar o reactivar
esas pasarelas: volver a habilitarlas requiere una fase nueva y pruebas E2E.

Si una instalación existente tiene un cobro viejo que deba reembolsarse,
trátalo como mantenimiento de esa pasarela concreta y no como parte del
checkout nuevo.

---

## 8. Notificaciones push

```bash
npx web-push generate-vapid-keys
```

- La **pública** va en `config.js` → `PUSH.vapidPublicKey`.
- La **privada** nunca sale del servidor:

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=B... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:reservas@tudominio.mx

supabase functions deploy enviar-recordatorios --no-verify-jwt
```

Programa el envío cada 5 minutos (SQL Editor):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'recordatorios', '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://TU-PROYECTO.supabase.co/functions/v1/enviar-recordatorios',
       headers := '{"Content-Type":"application/json"}'::jsonb
     ) $$
);
```

> En iOS, las notificaciones push sólo funcionan si el usuario **instala**
> la app en la pantalla de inicio (iOS 16.4 o superior). Es una limitación
> de Apple, no del código.

---

## 9. Asistente con modelo de lenguaje

Opcional: sin llave, el asistente usa su motor local, que ya resuelve
búsquedas, precios, horarios, cancelaciones y facturación.

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ASISTENTE_MODELO=claude-sonnet-5
supabase functions deploy asistente
```

La función expone tres herramientas al modelo (`buscar_espacios`,
`consultar_disponibilidad`, `mis_reservas`) para que responda con datos
reales de tu base y no invente precios.

---

## 10. Eliminación de cuentas

El borrado lo ejecuta una Edge Function, porque el navegador no puede
eliminarse a sí mismo de `auth.users`:

```bash
supabase functions deploy eliminar-cuenta
```

Qué hace exactamente:

| Se borra por completo | Se conserva anonimizado |
|---|---|
| Perfil y avatar en Storage | Reservas ya cobradas |
| Favoritos y reseñas | Pagos |
| Notificaciones y suscripciones push | Facturas emitidas (RFC y razón social son el dato fiscal) |
| Lista de espera | |
| Conversaciones y mensajes | |
| Membresías de organización | |
| Usos de promociones | |
| La cuenta de acceso (`auth.users`) | |

Las reservas futuras se cancelan y liberan el horario. En los registros
conservados, `usuario_id` queda en `NULL` y el nombre se sustituye por
"Cuenta eliminada"; el correo se borra. El nombre y el correo se copian al
registro en el momento de la operación (trigger `copiar_datos_cliente`),
así el histórico contable sigue siendo legible sin identificar a nadie.

Si la función no está desplegada, la app lo dice con claridad en vez de
fingir que borró algo.

## 11. Facturación CFDI

**No está disponible en V1 y no se habilita con un simple flag.** La
interfaz la mantiene cerrada y la base no permite que un usuario inserte
filas de `facturas` directamente. Esto es intencional: subtotal, impuestos,
total, pago y dueño deben salir del servidor, nunca del formulario del
navegador.

El directorio `supabase/functions/facturacion/` queda como base para una
versión posterior, pero está protegido por autenticación y por un freno de
entorno. Antes de desplegarlo hay que implementar la creación autoritativa
de la solicitud desde una reserva/pago aprobado, configurar un PAC real y
probar emisión, descarga y cancelación de punta a punta.

No publiques `features.facturacion=true`: en 2.5.0 el valor está bloqueado a
`false` aunque exista un override del hosting.

---

## 12. Fotos, videos y modelos 3D

### Fotos de espacios
Panel de administración → Espacios → Editar → **Subir fotos**. Se guardan
en el bucket `espacios` de Supabase Storage y se sirven por CDN.

Recomendado: 1600 × 1000 px en WebP, menos de 300 KB.

### Vista 360°
Sube una imagen equirectangular (proporción 2:1, por ejemplo 4096 × 2048)
a cualquier hosting y pega la URL en el campo *Imagen 360°*.

### Video
URL directa a un `.mp4` (H.264). Se carga sólo cuando el usuario abre esa
diapositiva de la galería.

### Recorrido virtual
Pega el enlace público de Matterport, Kuula o similar.

### Modelo 3D del edificio
Un `.glb` comprimido con Draco en el campo del edificio. El mapa lo carga
sobre la geometría generada.

```bash
npx gltf-transform optimize entrada.glb salida.glb --compress draco --texture-compress webp
```

### Iluminación HDRI
Un archivo `.hdr` (por ejemplo de polyhaven.com, 2K basta) en el campo
*HDRI* del edificio. Sin él, la escena usa un entorno generado por código
que ya se ve bien.

---

## 13. Publicación

### GitHub Pages
Settings → Pages → *Deploy from a branch* → rama y carpeta raíz.
La ruta base se detecta sola.

### Netlify / Vercel
Arrastra la carpeta. Sin comando de build ni directorio de salida.

### Cabeceras recomendadas (`_headers` en Netlify)

```
/*
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()

/sw.js
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

---

## 14. Aplicaciones nativas

La PWA se instala desde el navegador sin tiendas. Si necesitas estar en
Play Store o App Store:

### Android — Trusted Web Activity

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://tudominio.mx/manifest.webmanifest
bubblewrap build
```

Genera un `.aab` firmado listo para Play Console. Requiere subir
`assetlinks.json` a `/.well-known/` para que no muestre la barra del
navegador.

### iOS — Capacitor

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init "Smart Hub" mx.smarthub.app --web-dir=.
npx cap add ios
npx cap open ios
```

Apple exige que la app aporte algo más que el sitio web: las
notificaciones push nativas, el widget de próxima reserva o el acceso por
Face ID suelen ser suficientes para pasar la revisión.

---

## Solución de problemas

**"No se pudo cargar el mapa 3D"**
El dispositivo no soporta WebGL 2 o la CDN de Three.js está bloqueada.
Prueba en otro navegador; la app sigue usable en modo lista.

**El inicio de sesión con Google no vuelve a la app**
Falta la URL en *Authentication → URL Configuration → Redirect URLs*.

**"No se pudo eliminar la cuenta"**
Falta desplegar `eliminar-cuenta`, o no aplicaste
`migracion-01-borrado-cuenta.sql` y las llaves foráneas bloquean el
borrado. La app distingue ambos casos en el mensaje de error.

**El enlace de recuperar contraseña no abre la pantalla correcta**
Revisa que en *Authentication → URL Configuration → Redirect URLs* esté tu
dominio con `/**`. La app acepta el token tanto en la query (`?code=`)
como en el hash (`#access_token=`), y si caducó ofrece pedir otro.

**Las notificaciones no llegan**
Revisa por orden: llave VAPID en `config.js`, secretos en el servidor,
función `enviar-recordatorios` desplegada, cron activo, y que el usuario
haya dado permiso. En iOS, la app debe estar instalada.

**"Ese horario acaba de ocuparse"**
No es un error: la restricción de exclusión de PostgreSQL impidió un doble
booking real. La app ofrece horarios alternativos.

**Los cambios del panel no se ven**
El catálogo se cachea 30 minutos. Configuración → Limpiar caché, o espera:
el canal de tiempo real lo refresca solo cuando se guarda desde el panel.
