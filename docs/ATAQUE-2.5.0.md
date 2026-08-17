# ATAQUE 2.5.0 — barrido agresivo de Smart Hub V1

Fecha del barrido: 2026-08-14.

Objetivo: dejar V1 pequeña, coherente y difícil de romper. No se conservaron
funciones públicas por nostalgia: lo que prometía algo que V1 no puede cumplir
se eliminó, se ocultó o quedó fail-closed.

## Qué se destruyó o cerró

- Se eliminaron **18 archivos legacy** de prototipos HTML/JS/CSS que duplicaban
  login, perfil, mapa y panel administrativo.
- Se eliminaron los **6 adaptadores cliente** de pagos que no pertenecen a V1:
  Stripe, Mercado Pago, PayPal, tarjeta genérica, wallets y transferencia.
- El registro runtime de pagos quedó con una **lista permitida cerrada: Clip**.
  Una configuración vieja en `window.__APP_CONFIG__` no puede resucitar otra
  pasarela.
- Se eliminó la escritura directa de pagos y facturas desde el navegador.
  RLS/trigger y la migración 10 cierran también el backend.
- Se quitó el fallback peligroso de producción → demo. Una caída de Supabase ya
  no convierte una sesión real en datos ficticios ni manda IDs demo al backend.
- La cola offline ya no reserva, modifica, cancela ni paga. Sólo sincroniza
  favoritos; las operaciones con dinero/agenda exigen red real.
- Se retiró la promoción demo `BIENVENIDO` del seed y se añadió migración 13
  para apagarla en producción sólo si conserva la huella exacta del ejemplo.
- Se retiraron ubicación, teléfono, horarios de atención, historia, servicios y
  otras afirmaciones ficticias que el negocio no había confirmado.
- Se ocultaron recuperación por correo y OAuth mientras esas integraciones no
  estén realmente habilitadas.
- Se quitó el control administrativo de facturación que no podía funcionar en
  V1 y se cerró la Edge Function detrás de un interruptor de servidor.
- Se corrigió el crash latente de `js/data/mock.js`: el export por defecto aún
  apuntaba a `registrarPago` después de haber eliminado esa función.

## Fallos de dinero/agenda corregidos

### 1. Teléfono opcional rompía el alta

El formulario enviaba `telefono: ""` y la restricción
`usuario_telefono_razonable` rechazaba el insert del perfil. El frontend ahora
omite el dato vacío y el trigger lo normaliza con `NULLIF(..., '')`.
`migracion-08-telefono-opcional.sql` lleva el arreglo a producción.

### 2. Clip ya no confía en el navegador

- El checkout público es únicamente Clip.
- Un webhook no confirma por sí solo: la Edge Function consulta nuevamente a
  Clip.
- El retorno del navegador también se verifica en servidor.
- El cliente no decide el monto de un reembolso; se usa
  `reservas.monto_reembolso` calculado por la base.
- El reembolso descuenta devoluciones ya registradas para no duplicar dinero.
- `CLIP_COBROS_REALES=si` es obligatorio antes de hacer una llamada de cobro.

### 3. Se podía saltar el horario desde la API

La UI enseñaba seis bloques de dos horas, pero el backend aceptaba rangos
arbitrarios y las funciones de disponibilidad construían horas con la zona de
la sesión PostgreSQL. Eso permitía discrepancias por zona horaria e incluso
reservas fuera del horario mediante una llamada directa.

`migracion-12-franjas-y-zona-horaria.sql` y el esquema 2.5.0 ahora:

- interpretan el calendario en `America/Tijuana`/zona de la organización;
- exigen uno de los seis bloques V1: 09–11, 11–13, 13–15, 15–17, 17–19, 19–21;
- respetan `horarios_operacion`, cierres y horario específico del espacio;
- fallan cerrado si no existe horario válido;
- limitan la anticipación a 90 días también en servidor;
- aplican las mismas reglas tanto a disponibilidad como a creación directa.

## Catálogo que queda

El plano conserva **24 espacios activos**, pero el catálogo rentable de V1 está
cerrado a cuatro:

| Código | Nombre | Capacidad | Hora | Día |
|---|---|---:|---:|---:|
| OF-A | Ejecutiva Plus | 5 | $260 | $1,700 |
| OF-B | Ejecutiva Compact | 4 | $180 | $1,150 |
| OF-C | Premium Patio View | 4 | $240 | $1,550 |
| OF-D | Ejecutiva Lounge | 3 | $220 | $1,450 |

Los demás espacios no se venden. `seed.sql`, `planta.js` y migraciones 06/09
se alinearon al mismo canon.

## Compatibilidad histórica que NO se reactivó

Quedan fuentes de Edge Functions antiguas de Stripe/Mercado Pago/PayPal sólo
como compatibilidad/trazabilidad de instalaciones que pudieran tener pagos
viejos. **No están registradas en el checkout público de V1.** La documentación
ordena desplegar `pagos-clip` explícitamente y no publicar las antiguas “por si
acaso”. Los nombres de pasarelas viejas también pueden aparecer al mostrar un
pago histórico existente; eso no habilita un método nuevo.

## Verificación automática hecha en esta entrega

Pasaron:

- sintaxis de todos los `.js`/`.mjs` del runtime, tests y herramientas;
- hashes CSP de `index.html` y `offline.html`;
- `tests/coherencia.mjs`: **26/26**;
- import dinámico real de `js/data/mock.js`;
- integridad de **12 JPG**;
- **441 imports relativos de runtime** apuntan a archivos existentes;
- referencias locales de HTML y **49 archivos del shell del Service Worker**
  existen;
- `git diff --check` sin errores de whitespace.

## Pruebas que este entorno NO pudo ejecutar

No se declara un E2E falso. `pg` y `playwright` no están instalados en el
contenedor; la instalación de dependencias no quedó disponible. Tampoco hay
`psql` ni Deno. Por eso las suites que requieren navegador real/PostgreSQL deben
correrse en el equipo/CI con dependencias instaladas antes del lanzamiento.

## Bloqueos externos reales antes de abrir al público

1. **Supabase:** backup y aplicar/verificar migraciones 01–13; confirmar 24
   activos y exactamente A/B/C/D rentables.
2. **Clip:** credenciales reales + deploy de `pagos-clip` + webhook + un cobro
   mínimo real y un reembolso real. Sólo entonces habilitar Clip públicamente.
3. **Correo:** Supabase tiene `Confirm email` apagado temporalmente porque la
   cuenta SMTP de Brevo no está activada. Antes de público: SMTP/dominio real,
   reactivar `Confirm email` y `auth.emailDeliveryEnabled=true`.
4. **Legal/negocio:** completar razón social, RFC, domicilio, representante,
   correo legal, jurisdicción y cualquier campo `PENDIENTE`. Confirmar además
   dirección, teléfono si se publicará, amenidades/descripciones y precios.
5. **Tiendas:** esta entrega sigue siendo web/PWA; no contiene `android/`,
   `ios/` ni proyecto Capacitor/Xcode/Gradle. Hace falta empaquetado nativo para
   Play Store/App Store.

## Veredicto

La V1 quedó bastante más pequeña y con menos superficies falsas: se eliminaron
**12,697 líneas frente al baseline de esta copia** (con código de endurecimiento
nuevo añadido aparte), y se cerraron métodos de pago no usados, escrituras cliente peligrosas, fallback demo,
promoción de ejemplo y bypass de horario/zona horaria.

El código ya no es el principal bloqueo. Los bloqueos que quedan son de
**producción real**: migraciones, Clip real, correo real, datos legales reales y
empaquetado de tiendas.
