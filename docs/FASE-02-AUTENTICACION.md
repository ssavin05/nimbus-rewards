# FASE 02 — Autenticación: especificación verificable

> ⚠️ **ARCHIVO HISTÓRICO — NO USAR COMO GUÍA DE LANZAMIENTO.**
> Este documento conserva decisiones y resultados de etapas anteriores y puede mencionar Stripe, estados o procedimientos ya reemplazados. Para V1 2.5.0 usa `OWNER_ACTIONS.md`, `RELEASE_CHECKLIST.md` y `docs/ATAQUE-2.5.0.md`.

Este documento **no es una lista de deseos**. Es el contrato de la fase:
define qué tiene que pasar, cómo se comprueba y quién puede comprobarlo.

La regla es una sola:

> Una casilla sólo se marca `[✓]` si existe una comprobación que se
> puede **volver a ejecutar** y que falla si alguien rompe eso mañana.
>
> «El código parece correcto» no marca nada.

Estado al escribir esto: **0 de 16 verificadas.** No es pesimismo, es el
punto de partida honesto — hasta ahora nadie ha ejecutado estos flujos
de principio a fin contra el Supabase real.

---

## 0. Los dos recorridos que hay que demostrar

```
REGISTRO → EMAIL → CONFIRMACIÓN → LOGIN → SESIÓN → PERFIL
                                                      ↓
        LOGIN OTRA VEZ ← LOGOUT ← RESERVA ←───────────┘
```

```
OLVIDÉ CONTRASEÑA → EMAIL → NUEVA CONTRASEÑA → LOGIN
                                                  ↓
                              la contraseña vieja ya NO entra
```

---

## 1. Cómo se verifica cada cosa

No todo se puede automatizar, y conviene decirlo antes de empezar:

| Nivel | Qué es | Quién lo ejecuta |
|---|---|---|
| **A · Automático** | Navegador sin interfaz (Playwright) contra el Supabase real | `node tools/prueba-auth.mjs` |
| **B · Automático con buzón** | Igual, pero además hay que **abrir el correo** y pulsar el enlace | Requiere decisión (§2) |
| **C · SQL** | Ataque directo a la base con una sesión real | `psql -f supabase/pruebas-auth.sql` |
| **D · Manual** | Alguien lo hace con las manos y deja captura | Tú, una vez |

El objetivo es que **A y C cubran 13 de las 16**, y que sólo la
confirmación por correo y el cambio de contraseña necesiten buzón.

### El problema del buzón, y las tres salidas

Los casos 5, 12 y 13 dependen de recibir un correo y pulsar un enlace.
Hay tres formas de resolverlo, y hay que elegir una **antes** de
programar nada:

| Opción | Cómo funciona | Coste | Repetible |
|---|---|---|---|
| **1. Llave de servicio** | `auth.admin.generateLink()` devuelve el enlace sin enviar correo | Necesito el `service_role key` | ✅ Sí |
| **2. Buzón desechable** | Un correo `@mailinator.com` o similar, leído por HTTP | Gratis, pero depende de un tercero | ✅ Sí |
| **3. Tu propio correo** | Te registras a mano y pulsas el enlace | Cero preparación | ❌ Una vez |

**Mi recomendación: la 1.** Es la única que deja las tres casillas
verificadas *de verdad y para siempre*, y la llave de servicio nunca
sale del arnés de pruebas (jamás va al navegador ni al repositorio).

> ⚠️ Si me pasas el `service_role key`, que sea por un canal donde
> puedas revocarlo después. Se puede regenerar desde
> *Settings → API → service_role → Reset*.

Sin esa llave, los casos 5, 12 y 13 quedan en nivel **D** y los marcas
tú con una captura.

---

## 2. FASE 02.1 — Configuración de Supabase Auth

### Lo que ya pude comprobar

Consultado directamente contra `auth.users` del proyecto
`xashvchjvsmwyrbxwomd`:

| | |
|---|---|
| Cuentas existentes | 3 |
| Todas con proveedor | `email` |
| Todas confirmadas | Sí (`email_confirmed_at` con valor) |
| Todas con contraseña | Sí |
| Último acceso | 12/08/2026 |

Que las tres estén confirmadas es **buena señal pero no es prueba**: no
sé si se confirmaron pulsando un enlace o si la confirmación estaba
desactivada cuando se crearon. Eso es justo lo que mide el caso 5.

### Lo que NO puedo hacer desde aquí

Busqué una herramienta para tocar la configuración de Auth y **no
existe**: el conector de Supabase que tengo permite SQL, migraciones,
diagnósticos y funciones edge, pero no los ajustes de autenticación.
Son del panel.

Así que **esto lo tienes que hacer tú**, y es el primer paso de la fase:

#### ✅ Lista para el panel de Supabase

**Authentication → Sign In / Providers → Email**

| Ajuste | Valor | Por qué |
|---|---|---|
| Email provider | Activado | Es el único método real hoy |
| Confirm email | **Activado** | Sin esto cualquiera se registra con un correo que no es suyo |
| Secure email change | Activado | Pide confirmación en las **dos** direcciones |
| Minimum password length | **8** | Hoy Supabase trae 6; los 8 es el mínimo defendible |
| Password requirements | Letras y dígitos, mínimo | Sin pasarse: reglas absurdas empujan al post-it |

**Authentication → Attack Protection**

| Ajuste | Valor |
|---|---|
| **Leaked password protection** | **Activado** ← lo que dejó pendiente FASE 01 |
| Max request rate | Dejar el de fábrica hasta medirlo (§11) |

**Authentication → URL Configuration**

| Ajuste | Valor |
|---|---|
| Site URL | La URL real de producción cuando exista |
| Redirect URLs | La de producción **y** `http://localhost:8099/**` para pruebas |

> Sobre las URL de redirección: si no está la de pruebas, el enlace del
> correo rebota y los casos 5, 12 y 13 fallan por configuración, no por
> código. Es la causa número uno de «el correo no funciona».

**Cuando lo tengas hecho, dímelo y lo confirmo** ejecutando
`get_advisors`: el aviso `auth_leaked_password_protection` tiene que
desaparecer. Ésa es la verificación del 02.1, y no la puedo dar por
buena de otro modo.

---

## 3. FASE 02.2 — Las tres capas, y quién manda en cada una

```
auth.users              identidad     ← Supabase Auth, contraseñas
     │ 1:1                              (la app NUNCA escribe aquí)
usuarios                perfil        ← nombre, teléfono, avatar, tema
     │ N:M
organizacion_usuarios   membresía     ← el ROL vive aquí
     │
organizaciones
```

Esto **ya está construido y probado** en FASE 01. Lo que la FASE 02
añade es comprobarlo *desde una sesión real*, no desde SQL:

- El disparador `trg_nuevo_usuario` crea la fila de `usuarios` al
  registrarse. Si falla, la persona queda con identidad y sin perfil.
  **Caso 1 lo comprueba.**
- El disparador `proteger_rol` impide cambiar `rol`,
  `organizacion_id` y `email` con un `PATCH`. **Caso 14 lo comprueba.**
- Ninguna pantalla decide el rol: `js/auth/permisos.js` lo **lee** de
  `store`, que lo carga del perfil. Hay que verificar que no exista
  ningún sitio que lo escriba a mano.

---

## 4. Los 16 casos

Cada uno con: qué se hace, qué debe pasar, y cómo se comprueba.

### Registro

#### `AUTH-01` · Registro válido — nivel A
**Dado** un correo que no existe.
**Cuando** se envía el formulario con nombre, correo y contraseña de 12 caracteres.
**Entonces**:
- Aparece «Revisa tu correo para confirmar la cuenta».
- Existe la fila en `auth.users` con `email_confirmed_at` **nulo**.
- Existe la fila en `public.usuarios` con el `nombre` que se escribió.
- **No** hay sesión iniciada (`getSession()` devuelve null).

> La comprobación del perfil es la que de verdad importa: si el
> disparador falla, el registro «funciona» y la cuenta queda coja.

#### `AUTH-02` · Correo inválido — nivel A
`abc`, `a@`, `a@b`, `@b.com`, `a b@c.com`, y una cadena de 300 caracteres.
**Todos** rechazados **antes** de llamar a la red, con mensaje junto al campo.
Verificación extra: contar las peticiones a `/auth/v1/signup` — debe ser **0**.

#### `AUTH-03` · Contraseña débil — nivel A
`123`, `1234567` (7), `password`, `12345678`, y la cadena vacía.
Rechazo con el motivo concreto («al menos 8 caracteres»), no un genérico.
`password` sólo cae si el 02.1 está activado: **este caso también prueba
la configuración del panel**.

#### `AUTH-04` · Correo duplicado — nivel A
Registrarse dos veces con el mismo correo.
**Nunca** un 500 ni una traza.

> ⚠️ **Decisión pendiente.** Hoy `db.js:252` responde *«Ya existe una
> cuenta con ese correo»*, y eso **permite enumerar usuarios**: cualquiera
> prueba correos y averigua quién está registrado. Choca con el 02.10,
> que tú mismo pediste.
>
> Con *Confirm email* activado, Supabase responde lo mismo que en un alta
> normal y manda un correo distinto al dueño real («alguien intentó
> registrarse con tu correo»). Es la conducta correcta.
>
> **Propongo**: quitar ese mensaje y mostrar siempre «Te mandamos un
> correo para continuar». Cuesta claridad y gana privacidad. Dime si lo
> ves bien; si prefieres el mensaje explícito, se queda y lo anoto como
> decisión consciente.

#### `AUTH-05` · Confirmación de correo — nivel B
Registro → enlace → cuenta activa.
- Antes de pulsar: `email_confirmed_at` nulo y **el login se rechaza**.
- Después: tiene valor y el login entra.
- El enlace **no** sirve dos veces.
- Un enlace manipulado (token cambiado) no confirma nada.

### Login

#### `AUTH-06` · Login válido — nivel A
Sesión creada, `access_token` presente, el perfil carga, y el rol del
`store` coincide con `organizacion_usuarios`. Redirige a donde iba.

#### `AUTH-07` · Login incorrecto — nivel A
Contraseña mal, correo inexistente, campos vacíos.
Los tres dan **el mismo** mensaje: «Correo o contraseña incorrectos.»
Y ninguna sesión.

#### `AUTH-08` · Usuario sin confirmar — nivel A
Rechazo con instrucción clara **y un botón para reenviar el correo**.
> Ese botón **no existe hoy**. Es trabajo de la fase.

### Sesión

#### `AUTH-09` · Persistencia — nivel A
Login → cerrar el contexto del navegador → abrirlo con el mismo
almacenamiento → **sigue dentro**, sin volver a escribir nada.

#### `AUTH-10` · Logout — nivel A
Logout → cerrar → abrir → **fuera**. Y además:
- `localStorage` sin token.
- La caché del *service worker* sin respuestas privadas
  (esto ya se corrigió una vez; el caso impide que vuelva).

#### `AUTH-11` · Sesión expirada — nivel A
Estando en una pantalla protegida, se corrompe el token en
`localStorage` y se fuerza una petición.
**Debe**: detectar, limpiar, avisar («Tu sesión expiró») y llevar al
login **conservando a dónde iba**.
**No debe**: quedarse colgada, ni enseñar un error de Supabase, ni
entrar en bucle de reintentos.

### Contraseña

#### `AUTH-12` · Recuperación — nivel B
«Olvidé mi contraseña» → correo → enlace → nueva contraseña → entra.
El formulario de petición responde **igual** exista o no el correo
(si no, es otro enumerador).

#### `AUTH-13` · La contraseña vieja muere — nivel B
Tras el 12, la anterior da «Correo o contraseña incorrectos».
Y las demás sesiones de esa cuenta se cierran.

### Seguridad

#### `AUTH-14` · Escalada de rol — nivel A + C
Con una sesión **real** de usuario normal (no simulada en SQL):
```js
await db.from('usuarios').update({ rol: 'admin' }).eq('id', miId)
```
La petición puede devolver 200 — lo que importa es que al releer, el rol
**siga siendo `usuario`**. `proteger_rol` restaura en silencio.
También por RPC y cambiando `organizacion_id`.

#### `AUTH-15` · Organización ajena — nivel A + C
Con sesión de la organización A, y el `uuid` real de un espacio de la B:
leer sus reservas, editar su espacio, escribir a sus usuarios, verse su
facturación. **Los cuatro rechazados.**

> Esto ya pasa en `pruebas-seguridad.sql`, pero ahí el usuario se simula
> con `set_config`. Aquí es un JWT de verdad emitido por GoTrue, que es
> lo que de verdad va a pasar en producción.

#### `AUTH-16` · Abuso — nivel A
- 20 logins fallidos seguidos → el servidor empieza a frenar.
- 10 recuperaciones seguidas del mismo correo → freno.
- 30 registros seguidos → freno.

Primero **medimos** qué hace Supabase de fábrica. Sólo si no frena se
añade algo, y CAPTCHA sería lo último.

---

## 5. FASE 02.10 — Mensajes

Hay un traductor en `js/data/db.js:246`, y cubre los casos frecuentes.
Tiene **un agujero**:

```js
for (const [re, texto] of mapa) if (re.test(m)) return texto;
return m;                      // ← el mensaje crudo de Supabase, en inglés
```

Cualquier error no previsto se le enseña al usuario tal cual llega:
en inglés y, a veces, contando de más. Hay que cerrarlo con un genérico
y dejar el detalle sólo en la consola.

Catálogo objetivo:

| Situación | Mensaje | Acción que se ofrece |
|---|---|---|
| Credenciales mal | Correo o contraseña incorrectos. | ¿Olvidaste tu contraseña? |
| Sin confirmar | Falta confirmar tu correo. | Reenviar correo |
| Correo ya usado | *(pendiente de tu decisión en AUTH-04)* | — |
| Contraseña débil | Necesita al menos 8 caracteres. | — |
| Contraseña filtrada | Esa contraseña apareció en una filtración. Elige otra. | — |
| Demasiados intentos | Demasiados intentos. Espera un momento. | — |
| Sesión expirada | Tu sesión expiró. Vuelve a entrar. | Ir al login |
| Sin conexión | Sin conexión con el servidor. | Reintentar |
| **Cualquier otra** | No pudimos completar la operación. Inténtalo de nuevo. | Reintentar |

Nunca: «El correo existe pero la contraseña está mal».

---

## 6. FASE 02.12 — Estados de la interfaz

Cada pantalla de autenticación necesita: **reposo · cargando · error ·
éxito**, y además *correo pendiente*, *reenviar* y *olvidé mi contraseña*.

El botón se **deshabilita** mientras hay una petición en vuelo. Hoy
`login.js:283` marca `data-cargando`, pero **no toca `disabled`**: hay
que comprobar si cuatro clics rápidos mandan cuatro peticiones. El caso
`AUTH-16` lo mide contando peticiones, no mirando el código.

---

## 7. Lo que voy a construir

Nada de esto toca el mapa 3D.

| Archivo | Qué es |
|---|---|
| `tools/prueba-auth.mjs` | Los 13 casos de nivel A. Crea sus propias cuentas y las borra al terminar. |
| `supabase/pruebas-auth.sql` | Los casos 14 y 15 en SQL, contra la base. |
| `docs/FASE-02-RESULTADOS.md` | La matriz rellenada, con la salida real pegada. |

Cambios de código que ya se ven necesarios:

1. Cerrar el `return m` de `mensajeError`.
2. Botón de **reenviar confirmación** (no existe).
3. `disabled` de verdad en los botones mientras cargan.
4. Resolver AUTH-04 según lo que decidas.
5. Lo que aparezca al ejecutar: **ésa es la parte que no puedo predecir,
   y es justamente la que vale.**

---

## 8. Matriz de aceptación

| # | Prueba | Nivel | Estado |
|---|---|---|---|
| 01 | Registro válido | A | ⬜ |
| 02 | Correo inválido | A | ⬜ |
| 03 | Contraseña débil | A | ⬜ |
| 04 | Correo duplicado | A | ⬜ |
| 05 | Confirmación por correo | B | ⬜ |
| 06 | Login válido | A | ⬜ |
| 07 | Login incorrecto | A | ⬜ |
| 08 | Usuario sin confirmar | A | ⬜ |
| 09 | Persistencia de sesión | A | ⬜ |
| 10 | Logout | A | ⬜ |
| 11 | Sesión expirada | A | ⬜ |
| 12 | Recuperar contraseña | B | ⬜ |
| 13 | Contraseña vieja inválida | B | ⬜ |
| 14 | Escalada de rol | A+C | ⬜ |
| 15 | Organización ajena | A+C | ⬜ |
| 16 | Abuso y límites | A | ⬜ |

**FASE 02 termina cuando las 16 estén en `[✓]` con salida pegada.**

---

## 9. Lo que necesito de ti para empezar

1. **Configura el panel** (§2). Es lo único que no puedo hacer yo, y
   tres casos dependen de ello. Avísame y lo verifico.
2. **Elige cómo probamos el correo** (§1): llave de servicio, buzón
   desechable, o a mano.
3. **Decide el AUTH-04**: ¿mensaje explícito de «ya existe» o respuesta
   neutra que no permita enumerar?

Con eso arranco. Los casos que no dependen de nada (02, 03, 07, 09, 10,
11, 14, 15, 16) los puedo empezar ya mismo si prefieres que vaya
avanzando en paralelo.
