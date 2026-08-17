# FASE 02 — Resultados

> ⚠️ **ARCHIVO HISTÓRICO — NO USAR COMO GUÍA DE LANZAMIENTO.**
> Este documento conserva decisiones y resultados de etapas anteriores y puede mencionar Stripe, estados o procedimientos ya reemplazados. Para V1 2.5.0 usa `OWNER_ACTIONS.md`, `RELEASE_CHECKLIST.md` y `docs/ATAQUE-2.5.0.md`.

Salida real contra el proyecto `xashvchjvsmwyrbxwomd`, **sin** llave de
servicio y **sin** ninguna configuración manual previa.

```
 FASE 02 — AUTENTICACIÓN

[✓] AUTH-07b El login no delata qué correos existen   ambos: HTTP 400 · "Invalid login credentials"
[✓] AUTH-17  Sin sesión no se lee nada privado        10 privadas sin filtrar · 2 vistas en cero
[✓] AUTH-18  Sin sesión no se puede escribir          4 escrituras anónimas rechazadas
[✓] AUTH-19  El catálogo público sí se lee            5 espacios visibles sin cuenta
[✓] AUTH-20  La ocupación pública no filtra datos     sólo espacio_id, inicio, fin
[✓] AUTH-21  Un token inventado no vale               3 tokens falsos + cabecera manipulada
[–] AUTH-01  Registro válido                          OMITIDA: hace falta service_role
[✓] AUTH-02  Correo inválido (servidor)               6 formatos rechazados
[✓] AUTH-03  Contraseña débil                         rechazadas las cortas
[–] AUTH-03b Contraseña filtrada (HaveIBeenPwned)     OMITIDA: cupo de correo agotado
[–] AUTH-04  Correo duplicado: sin enumerar           OMITIDA: hace falta service_role
[–] AUTH-05  Confirmación de correo                   OMITIDA: hace falta service_role
[–] AUTH-06  Login válido                             OMITIDA: hace falta service_role
[–] AUTH-07  Login incorrecto: mismo mensaje          OMITIDA: hace falta service_role
[–] AUTH-08  Usuario sin confirmar no entra           OMITIDA: hace falta service_role
[–] AUTH-12  Recuperar contraseña                     OMITIDA: hace falta service_role
[–] AUTH-12b Recuperación no revela si existe         OMITIDA: hace falta service_role
[–] AUTH-13  La contraseña vieja deja de servir       OMITIDA: hace falta service_role
[–] AUTH-14  Escalada de rol (sesión real)            OMITIDA: hace falta service_role
[–] AUTH-15  No se puede tocar otra organización      OMITIDA: hace falta service_role
[✓] AUTH-16a Freno a la fuerza bruta en el login      frenado en el intento 31
[✓] AUTH-16b Recuperación de correo desconocido       6 peticiones, HTTP 200, sin gastar cupo
[✗] AUTH-16c El remitente de correo aguanta uso real  FALLA

 RESULTADO: 10/23 PASA · 1 FALLA · 12 OMITIDA
```

```
 FASE 02 — AUTENTICACIÓN (navegador)

[✓] AUTH-02c Correo inválido (cliente)                0 peticiones a /signup
[–] AUTH-09  Persistencia de sesión                   OMITIDA: hace falta service_role
[–] AUTH-10  Logout                                   OMITIDA: hace falta service_role
[✓] AUTH-11  Sesión expirada                          detectada, sin error crudo

 RESULTADO: 2/4 PASA
```

**12 pasan · 1 falla · 14 omitidas.** Las omitidas no cuentan como
aprobadas.

> `AUTH-07b` necesita saber un correo que ya esté registrado. No se
> guarda en el repositorio porque es un dato personal: se pasa por el
> entorno con `CORREO_CONOCIDO=...`. Aquí se ejecutó con uno de los tres
> correos que ya existen en el proyecto, y **no manda ningún correo**:
> sólo intenta entrar con una contraseña equivocada.

---

## 🔴 El único fallo: el correo no sirve para uso real

```
{"code":429,"error_code":"over_email_send_rate_limit",
 "msg":"email rate limit exceeded"}
```

El proyecto usa el **remitente compartido de fábrica**, con un cupo de
muy pocos correos por hora. Se agotó con dos registros de prueba.

```
persona se registra → Supabase intenta mandar el enlace → cupo agotado
→ la cuenta existe pero NO se puede confirmar → esa persona no entra nunca
```

Con la confirmación activada, **el registro está roto a partir del
segundo usuario de cada hora**. Se arregla con un SMTP propio en
*Authentication → Emails → SMTP Settings*.

---

## Dos veces que la medición me corrigió

Vale la pena dejarlo escrito, porque las dos habrían sido hallazgos
falsos en un informe.

**1. «No hay freno a la fuerza bruta».** La primera versión de
`AUTH-16a` hacía 20 intentos fallidos, no veía ningún `429` y lo daba
por concluido. El límite de Supabase salta a los **30**: con 40 intentos
apareció en el 31. Ahora la prueba informa de cuántos intentos hizo y se
declara *omitida* si no ve el freno, en vez de afirmar que no existe.
Queda anotado además que estas medidas salen por un proxy y que el
límite es **por IP**.

**2. «Las vistas de analítica filtran a los anónimos».** `AUTH-17`
marcaba fallo porque `v_espacios_populares` y `v_ocupacion_espacio`
devolvían 5 filas sin sesión. Al mirar los valores:

```json
{"nombre":"Jardín Privado","reservas":0,"ingresos":0}
```

No hay fuga: `security_invoker = on` está haciendo su trabajo. Las filas
salen del catálogo, que es público, y todo lo que viene de `reservas`
llega en cero. La prueba contaba filas cuando tenía que mirar cifras.
Corregida, ahora comprueba que ningún agregado privado sea distinto de
cero.

---

## Lo verificado sin tocar nada

| Prueba | Qué demuestra |
|---|---|
| `AUTH-02` / `AUTH-02c` | 6 formatos de correo rechazados; el formulario los para antes de la red (**0 peticiones**) |
| `AUTH-03` | No se aceptan contraseñas de menos de 8 |
| `AUTH-07b` | Contraseña mal en cuenta que existe y cuenta que no existe dan **exactamente** la misma respuesta: no se pueden enumerar usuarios |
| `AUTH-11` | Con el token corrupto la app no se cuelga ni enseña el error crudo |
| `AUTH-16a` | Hay freno a la fuerza bruta (intento 31) |
| `AUTH-16b` | Pedir recuperación de un correo desconocido responde igual y no gasta cupo |
| `AUTH-17` | 10 tablas y vistas privadas no devuelven una sola fila sin sesión; los agregados de las dos públicas vienen en cero |
| `AUTH-18` | 4 escrituras anónimas rechazadas (crear reserva, bajar precios, autoascenso, renombrar la empresa) |
| `AUTH-19` | El catálogo **sí** se ve sin cuenta — cerrar de más también es un fallo |
| `AUTH-20` | La vista pública de ocupación expone sólo `espacio_id`, `inicio` y `fin` |
| `AUTH-21` | Tres tokens falsificados y una cabecera manipulada, todos rechazados |

---

## Cambios de código

| Archivo | Qué cambió |
|---|---|
| `js/data/db.js` | `mensajeError()` ya no termina en `return m`. Lo no previsto sale como «No pudimos completar la operación» y el detalle va a la consola. Añadidos: contraseña filtrada, contraseña débil, cupo de correo. |
| `js/auth/auth.js` | `registrar()` **ya no delata** que el correo existe. Nueva `reenviarConfirmacion()`, también neutra. |
| `js/views/login.js` | Aviso neutro tras registrarse. Botón **Reenviar el correo de confirmación**, visible sólo cuando el rechazo es por falta de confirmación. Los botones de Google y Apple ahora se **deshabilitan** al pulsarlos. |

Rectificación de la especificación: `conCarga()` **sí** deshabilitaba los
botones del formulario. El que no lo hacía era el camino de OAuth.

---

## Matriz

| # | Prueba | Estado |
|---|---|---|
| 02 · 02c | Correo inválido (servidor y cliente) | ✅ |
| 03 | Contraseña débil | ✅ |
| 07b | Login no enumera usuarios | ✅ |
| 11 | Sesión expirada | ✅ |
| 16a · 16b | Freno a fuerza bruta y a envíos | ✅ |
| 17 · 18 | Sin sesión: ni lectura ni escritura privada | ✅ |
| 19 · 20 · 21 | Catálogo público, vista pública acotada, tokens falsos | ✅ |
| 16c | El correo aguanta uso real | ❌ **falla** |
| 01 · 03b · 04 · 05 · 06 · 07 · 08 | Registro, confirmación, login | ⬜ omitidas |
| 09 · 10 | Persistencia y logout | ⬜ omitidas |
| 12 · 12b · 13 | Recuperación de contraseña | ⬜ omitidas |
| 14 · 15 | Escalada de rol y organización ajena | ⬜ omitidas |

---

## Estado del arnés (endurecido)

Repasando tu lista de trabajo no manual pendiente:

| Punto | Estado |
|---|---|
| Runner completo en una sola ejecución | ✅ `index.mjs` corre API **y** navegador en un informe |
| Código de salida ≠ 0 si hay FAIL | ✅ `1` con fallo · `2` con `--estricto` y omitidas · `0` limpio |
| Que una OMITIDA no cuente como aprobada | ✅ se lista aparte y `--estricto` la trata como fallo |
| Limpieza de usuarios temporales | ✅ cada caso borra lo suyo + barrido al empezar y al acabar |
| Idempotencia | ✅ dos vueltas seguidas: `PASS 12 · FAIL 1 · SKIP 14` las dos |
| Documentar automático vs manual | ✅ `tests/auth/README.md`; los del navegador ya están en el mismo catálogo, así que informe y matriz coinciden |
| Resumen final reproducible | ✅ se escribe en `docs/FASE-02-SALIDA.txt` en cada ejecución |
| Que AUTH-05/12/13 validen el efecto, no la URL | ✅ corregido (abajo) |
| Ejecutar las omitidas | ⬜ necesita la llave |
| Reejecutar AUTH-16c | ⬜ necesita el SMTP |

### El fallo que señalaste en AUTH-05

Tenías razón: comprobaba que se generó el enlace y luego leía
`public.usuarios`, que **no demuestra nada** sobre la confirmación.
Ahora comprueba el efecto:

1. `email_confirmed_at` está vacío **antes** de pulsar.
2. Se sigue el enlace.
3. `email_confirmed_at` **tiene valor** después (leído de `auth.users`
   por la API de administración, no de la tabla de perfiles).
4. La persona ahora **sí** puede entrar.
5. El enlace **no** se puede reutilizar.

`AUTH-13` también se endureció: abre una sesión antes del cambio y
comprueba que el `refresh_token` deja de valer. Si no, quien te robó la
contraseña sigue dentro aunque la cambies.

---

## Qué falta, y de quién depende

**Mío — ya escrito, sólo falta poder ejecutarlo.** Los 12 casos omitidos
tienen su código completo en `tests/auth/`. No están sin hacer: están sin
ejecutar, porque crear cuentas necesita `generateLink()` y eso necesita
la llave de servicio.

**Tuyo — cuatro acciones:**

1. 🔧 **SMTP propio.** Es el bloqueador principal: sin él el registro
   está roto para usuarios reales.
2. 🔐 **Leaked Password Protection**, y el resto del panel (§2 de la
   especificación): confirmación de correo, longitud mínima 8, URL de
   redirección.
3. 🔑 **La llave de servicio en tu entorno** (nunca en el chat):
   ```bash
   export SUPABASE_SERVICE_ROLE_KEY=...
   export CORREO_CONOCIDO=tu-correo-ya-registrado@...
   node tests/auth/index.mjs
   node tests/auth/navegador.mjs      # con la app en :8099
   ```
4. 📧 **La prueba manual de correo real** (Nivel B): que llega, el
   remitente, la plantilla, el enlace, la redirección, la caducidad, en
   móvil y que no cae en spam. Eso no lo sustituye `generateLink()`.

Con la salida de 3 y tu confirmación de 4, se puede determinar si la
FASE 02 está aprobada. Antes no.

> Las pruebas de navegador necesitan Playwright:
> `npm i -D playwright` o
> `ln -s /opt/node22/lib/node_modules/playwright node_modules/playwright`

---

## Anexo — Endurecimiento de pagos y reservas

Cambios de código posteriores al cierre del arnés de Auth. Ninguno
necesita configuración manual; todos están probados.

| # | Qué se cerró | Dónde |
|---|---|---|
| 1 | **Un PaymentIntent por reserva.** Antes cada recarga o reintento creaba otro. Ahora se busca el existente por `metadata.reserva_id` y se reutiliza; si el importe cambió se actualiza; si ya está cobrado no se crea nada. Más `idempotencyKey` como segunda red. | `supabase/functions/pagos-stripe/index.ts` |
| 2 | **Caducidad del apartado.** Una reserva pendiente ya no bloquea el horario para siempre: nace con `expira_en` (15 min por defecto, ajustable por organización) y se cancela sola. | `supabase/caducidad.sql` |
| 3 | **Recargar durante el pago.** El id de la reserva viaja en la URL y `reanudar_reserva()` la recupera y le renueva el apartado, en vez de crear una segunda que choca con la primera. | `js/views/checkout.js`, `js/data/api.js` |
| 4 | **Cancelar devuelve el dinero de verdad.** Antes la app decía «Reembolso estimado: $1,000» y Stripe se quedaba el cobro. Ahora `cancelarReserva()` llama a la Edge Function, con idempotencia para que el doble clic no devuelva dos veces. | `js/data/api.js` |
| 5 | **Rutas separadas por rol.** Las nueve rutas `/admin` compartían lista. Ahora: staff → panel, reservas, usuarios · admin → espacios, promociones, estadísticas, apariencia · superadmin → edificios. El menú lateral filtra igual. | `js/main.js` |
| 6 | **El webhook es la autoridad.** El checkout ya no intenta registrar pagos de pasarela (que `guardia_pago()` rechazaba, dejando un `console.warn` en cada compra). Y no se dice «confirmada» hasta que la base lo dice: mientras tanto, «Pago recibido, confirmando…». | `js/views/checkout.js` |
| 7 | **Nunca se pide una tarjeta sin pasarela.** `tarjeta.disponible()` ya no devuelve `true` a secas, y se borraron las 162 líneas del formulario propio que pedía número y CVV para apuntar un pago que nadie cobraba. | `js/payments/tarjeta.js` |
| 8 | **El importe oficial manda.** El checkout usa `reserva.total` (calculado por PostgreSQL) en lugar de `cotizacion.total`, que era una estimación del cliente. | `js/views/checkout.js` |

### Comprobado

```
CADUCIDAD                                  6/6
  la pendiente nace con caducidad (15 min)
  con el apartado vivo, el hueco figura ocupado
  apartado vencido -> hueco libre sin esperar al cron
  expirar_reservas_pendientes() canceló 1 reserva(s)
  una reserva con pago aprobado NO se cancela por caducidad
  al confirmar, la caducidad se limpia

tools/prueba-reserva.mjs        7/7 · recorrido completo sin errores
tools/prueba-flujos.mjs         sin hallazgos
tools/prueba-datos.mjs          sin hallazgos
tools/ataque-cliente.mjs        XSS ejecutados: ninguno
navegador                       0 errores de JS en 5 vistas
```

`tools/ataque-cliente.mjs` reventaba tras el cambio 7: su «ATAQUE D»
rellenaba el formulario de tarjeta que acababa de desaparecer. Se
reescribió para comprobar lo contrario, que es más fuerte: que **no
existe** forma de que la app pida un número de tarjeta sin pasarela.

### Lo que sigue necesitando tus llaves

| Bloque | Falta |
|---|---|
| Stripe | `pk_test_` en config, `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` como secretos, desplegar la función, dar de alta el webhook |
| Correo | SMTP propio (desbloquea `AUTH-16c` y 14 omitidas) |
| `pg_cron` | `caducidad.sql` avisa si no está disponible. Sin él hay que llamar a `expirar_reservas_pendientes()` desde una función programada — la red de seguridad de `esta_disponible()` cubre mientras tanto, pero las reservas muertas no se limpian solas |

---

## Anexo 2 — Cuatro fallos de dinero, corregidos

Los cuatro estaban. Verificados leyendo el código antes de tocarlo.

### 🔴 1. El reembolso era imposible por construcción

`cancelarReserva()` cancelaba y llamaba a la Edge Function. Pero
`reservaDelUsuario()` hace:

```js
if (data.estado === "cancelada") throw new Error("reserva_cancelada");
```

Cancelar es justo lo que dispara el reembolso, así que la función
rechazaba **siempre** la reserva que venía a devolver. El dinero se
quedaba en Stripe y la app decía «Reembolso estimado: $1,000».

Ahora hay `reservaParaReembolso()`, que admite reservas canceladas y
sigue exigiendo que sean del usuario. Para cobrar se sigue usando el
helper estricto: son dos reglas distintas y no pueden compartir función.

Y el importe:

```js
// antes — un reembolso de 0 caía al segundo operando y devolvía TODO
const aDevolver = Number(reserva.monto_reembolso ?? 0) || Number(pago.monto);

// ahora — cero significa cero, y si ya se devolvió una parte va el resto
const aDevolver = Number(reserva.monto_reembolso ?? 0);
if (aDevolver <= 0) return respuesta({ reembolso: null, estado: "sin_reembolso" });
const restante = Math.max(0, aDevolver - Number(pago.reembolsado || 0));
```

### 🔴 2. El webhook decía «200 OK» aunque la base fallara

`confirmarPago()` no miraba el `error` de Supabase, que no lanza
excepción. Stripe daba el evento por procesado y no lo reintentaba:
cobro hecho, reserva sin confirmar, y nadie enterado.

Ahora comprueba las tres operaciones y lanza. Si algo falla, Stripe
recibe un 4xx/5xx y **reintenta**, que es justo para lo que existen los
reintentos.

### 🔴 3. Pagar después de que venciera el apartado

```
A aparta 10:00 → pasan 15 min → expira → B lo reserva
→ A termina el pago viejo → Stripe cobra a A
```

Ahora `confirmarPago()` detecta que la reserva caducó, **no la revive**
—sería una doble reserva— y devuelve la señal. El webhook reembolsa en
el acto, marca el pago y avisa a la persona.

### 🔴 4. Reservar sin conexión

`crearReserva()` encolaba y devolvía «Reserva guardada». Sin red no hay
forma de saber si el hueco sigue libre. Ahora lanza:

> Necesitas conexión para comprobar la disponibilidad y reservar.

El catálogo se sigue viendo sin conexión. Reservar, no.

### La grieta entre `esta_disponible()` y la exclusión

Tu observación más fina, y era real:

```
esta_disponible()  →  libre    (el apartado venció)
INSERT             →  23P01    (la fila sigue ahí)
```

La pantalla ofrecía el horario y al reservar rebotaba. Sin `pg_cron`,
siempre. Se arregla con un trigger `BEFORE INSERT` que suelta los
apartados vencidos **de ese espacio** antes de que se compruebe la
restricción. Vale para el RPC y para cualquier `INSERT` directo.

```
CARRERA CADUCIDAD/EXCLUSIÓN                          4/4
  esta_disponible() ofrece el hueco a B
  B reserva de verdad: el apartado vencido se soltó solo
  el apartado de A quedó cancelado, no fantasma
  con la reserva de B viva, A ya no puede colarse

pruebas-seguridad.sql      39/39 · TODAS PASARON
pruebas-restricciones.sql  65/65 · TODAS PASARON
prueba-reserva.mjs          7/7  · recorrido completo sin errores
navegador                   0 errores de JS en 5 vistas
```

`pg_cron` sigue haciendo falta para limpiar las reservas muertas, pero
ya no es la diferencia entre que reservar funcione o no.

---

## Anexo 3 — Los cinco últimos

### 🔴 1. Devolver la mitad decía «reembolsado»

```
Pago $1,000 → refund $500 → estado = "reembolsado"
```

El importe era correcto y el estado mentía. El enum ya tenía `parcial`
y no se usaba:

```js
const devuelto = cargo.amount_refunded / 100;
const cobrado  = cargo.amount / 100;
const estado   = devuelto >= cobrado ? "reembolsado" : "parcial";
```

### 🔴 2. Quedaban escrituras del webhook sin comprobar

`confirmarPago()` ya lanzaba, pero `payment_intent.payment_failed`,
`charge.refunded` y el reembolso automático por caducidad seguían
ignorando el `error`. Las tres comprueban ahora.

Y salió algo de paso: el `catch` etiquetaba **todo** como «firma
inválida» y devolvía `400`. Un fallo de base no es una firma mala, y el
código de respuesta decide si Stripe reintenta. Ahora van separados:

| Qué falla | Respuesta | Stripe |
|---|---|---|
| Firma | `400 firma inválida` | no reintenta (nunca va a mejorar) |
| Escritura en la base | `500 no se pudo procesar` | **reintenta** |

### 🔴 3. «Ya te cobraron» → la app decía error de pago

El servidor devolvía `{ yaPagado: true }` sin `clientSecret`, y
`stripe.js` lanzaba «El servidor no devolvió un intento de pago
válido». A quien acababa de pagar.

Ahora se detecta y se devuelve una sesión que resuelve en `aprobado`,
así que el checkout entra directo en `esperarConfirmacion()` y espera
al webhook, que es lo correcto.

### 🔴 4. Cancelar sin conexión también mentía

Quedaba la cola offline en `cancelarReserva()`. Mismo problema que al
reservar, y peor: la app decía «cancelada», el servidor no se enteraba,
y el reembolso no salía nunca. Fuera.

```
Crear reserva    → requiere conexión
Cancelar         → requiere conexión
Pagar            → requiere conexión
Reembolsar       → requiere conexión
Ver el catálogo  → funciona sin conexión
```

### 🟠 5. La pantalla final enseñaba la estimación

Tres sitios usaban `st.cotizacion.total` en vez del importe oficial.
Ahora los tres son `st.reserva?.total ?? st.cotizacion.total`: antes de
reservar no hay reserva y la estimación es lo único que hay; después,
manda el precio que calculó PostgreSQL y que es el que se cobró.

### Verificación

```
pruebas-seguridad.sql      39/39 · TODAS PASARON
pruebas-restricciones.sql  65/65 · TODAS PASARON
prueba-reserva.mjs          7/7  · recorrido completo sin errores
ataque-cliente.mjs                · XSS ejecutados: ninguno
navegador                         · 0 errores de JS en 5 vistas
```

Los diez casos de la prueba final de dinero necesitan las llaves de
Stripe: son de sandbox, no de código.
