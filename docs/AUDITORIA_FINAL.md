# Auditoría de pre-entrega — Centro de Oficinas

> ⚠️ **ARCHIVO HISTÓRICO — NO USAR COMO GUÍA DE LANZAMIENTO.**
> Este documento conserva decisiones y resultados de etapas anteriores y puede mencionar Stripe, estados o procedimientos ya reemplazados. Para V1 2.5.0 usa `OWNER_ACTIONS.md`, `RELEASE_CHECKLIST.md` y `docs/ATAQUE-2.5.0.md`.

Estado del proyecto medido contra los archivos reales, no contra el
README. Cada punto trae **cómo se comprobó**: si no hay forma de
comprobarlo, va como pendiente aunque el código exista.

Leyenda: `[✓]` verificado · `[~]` parcial · `[ ]` pendiente · `[✗]` fallo

---

## 🔴 Bloqueadores — no entregar sin esto

### B1. El plano no tiene una versión maestra aprobada `[~]`

`js/data/planta.js` es hoy la única fuente de la geometría, y las cotas
que contiene cuadran solas:

```
Ancho  →  5.80 + 3.00 + 2.70 + 1.80 + 2.20 + 3.20 = 18.70 m
Fondo  →  2.85 + 5.35 + 4.25 + 17.50            = 29.95 m
```

Comprobado por script: **24 espacios, 0 solapes, 0 fuera de la
envolvente**. Pero sigue siendo una reconstrucción a partir de las cotas
escritas: los muros curvos, los grosores reales y la posición exacta de
cada puerta no están en esas cotas.

**Qué falta:** que el dueño del edificio firme el plano digital contra el
original. La vía rápida está resuelta — dejar el plano recortado en
`assets/plano.png` hace que el mapa dibuje el plano REAL a escala con los
bloques encima (ver `assets/LEEME-PLANO.txt`).

### B2. Datos reales `[ ]`

Precios, capacidades, horarios, teléfonos, dirección, RFC, razón social,
términos y política de privacidad son de ejemplo. Nada de esto es código:
es contenido que sólo el cliente puede dar.

### B3. Fotografías `[ ]`

Cada espacio soporta portada, galería, 360° y vídeo. Ahora mismo:
**0 fotos**. Un catálogo de oficinas sin fotos no se puede publicar.

### B4. Despliegue real `[ ]`

Nada de esto está verificado porque no hay entorno de producción:
dominio, HTTPS, proyecto Supabase productivo, secretos, webhooks de
cobro, correos, Storage, OAuth, push, copias de seguridad y
monitorización. Lista completa en `docs/CONFIGURACION.md`.

### B5. Cabeceras del servidor `[ ]`

La CSP va en `<meta>` y funciona, pero `frame-ancestors`,
`X-Frame-Options`, `HSTS` y `Permissions-Policy` **sólo se pueden mandar
desde el servidor**. Hay un rompe-marcos en JS como paliativo. Los
valores exactos están en `docs/SEGURIDAD.md` §10.

---

## 🟠 Muy recomendable antes de entregar

### R1. Prueba de aceptación de usuario `[~]`

`tools/prueba-reserva.mjs` cubre el recorrido de datos completo
(reservar → pagar → ver → recargar → cancelar): **7 de 7**. Lo que NO
cubre es el mismo recorrido **a base de clics**, incluyendo registro real
e inicio de sesión, que necesita un Supabase de pruebas.

### R2. Números de rendimiento en dispositivos reales `[~]`

Medido, con la CPU frenada para aproximar teléfonos:

| Escenario | 1ª pantalla | Mapa listo | FPS |
|---|---|---|---|
| Sin freno | 1.191 ms | 5.817 ms | 24 |
| CPU 4× (gama media) | 1.419 ms | 6.444 ms | **17** |

| Otras medidas | |
|---|---|
| Peso de una visita anónima | 244,8 KB · 29 peticiones |
| Three.js (sólo al abrir el mapa) | 1,24 MB |

> **Estos FPS NO predicen un teléfono real.** El navegador de pruebas
> corre **sin GPU** (`SwiftShader`, renderizado por software), así que
> todo el dibujo lo hace la CPU. Un móvil de verdad tiene GPU y va a dar
> bastante más. Sirven como **suelo**, no como pronóstico.
>
> Lo que sí dicen: el mapa tarda ~6 s en montarse incluso sin freno, y
> eso sí es alto. Vale la pena revisarlo.

Se capó el ratio de píxeles a 1,5 en modo plano (bloques de color liso
no necesitan 2×, y en una pantalla 3× eso multiplica por nueve el
relleno). **No se pudo medir la mejora aquí** porque en este entorno
`devicePixelRatio` ya es 1.

**Sigue faltando** un Android de gama media y un iPhone reales:
`node tools/prueba-rendimiento.mjs` deja el arnés listo.

### R3. Accesibilidad `[~]`

Verificado: navegación con Tab (12/12 paradas), foco visible,
`prefers-reduced-motion`, `prefers-contrast`, etiquetas en los campos.
**Falta**: lector de pantalla real (NVDA/VoiceOver), contraste medido con
herramienta, y que los mensajes de error se anuncien.

### R4. Estados de error `[~]`

Cubiertos y probados: sin conexión, servidor caído, consulta agotada,
horario ocupado, espacio inexistente, fecha inválida, modelo 3D que no
llega, CDN caída. **Sin probar**: sesión expirada a media reserva, pago
rechazado por el banco, WebGL no disponible, Storage lleno.

### R5. Priorizar `[ ]`

Hay 30 funciones al 90 % donde conviene tener 10 al 100 %. Núcleo
innegociable: login, registro, plano, espacios, disponibilidad, reserva,
mis reservas, administración. La IA, el chat y los recorridos 360° pueden
esperar.

---

## 🟡 Mejora profesional

- **M1.** Deduplicar la lógica de precios: hoy vive en `crear_reserva()`
  (SQL) y en `mock.js` (cliente). Las reglas ya son idénticas y hay
  pruebas que lo comprueban, pero son dos copias.
- **M2.** Sin pruebas unitarias del cliente: todo se prueba de punta a
  punta con un navegador. Funciona, pero es lento para iterar.
- **M3.** Sin CI. Las cuatro suites hay que correrlas a mano.
- **M4.** Los ajustes de administración viven en `localStorage`, así que
  son por equipo. Deberían guardarse en la organización.
- **M5.** Sin SEO: no hay `sitemap.xml`, ni datos estructurados, ni
  renderizado en servidor. Para una app de reservas importa poco; para
  captar clientes, mucho.

---

## 🟢 Opcional / futuro

Multiedificio y multisede (el esquema ya lo soporta), facturación
timbrada con PAC, informes exportables, integración con calendario,
control de acceso físico, aplicación nativa.

---

## Lo que SÍ está verificado

Esto no es opinión: son comprobaciones que se pueden repetir.

| Área | Evidencia | Estado |
|---|---|---|
| Las 26 vistas cargan sin errores de JS | `tools/prueba-flujos.mjs` | `[✓]` |
| Recorrido completo de reserva | `tools/prueba-reserva.mjs` → 7/7 | `[✓]` |
| Concurrencia: 2 reservas simultáneas → 1 | `tools/prueba-datos.mjs` | `[✓]` |
| Entradas hostiles rechazadas | `tools/prueba-datos.mjs` | `[✓]` |
| Clics, mapa 3D, teclado, botón Atrás | `tools/prueba-interaccion.mjs` | `[✓]` |
| XSS, ajustes manipulados, datos de tarjeta | `tools/ataque-cliente.mjs` | `[✓]` |
| 21 ataques a la base + 7 de uso normal | `supabase/pruebas-seguridad.sql` → 39 | `[✓]` |
| Responsive sin desborde | 5 tamaños de 320 a 1920 px | `[✓]` |
| Hashes de la CSP al día | `node tools/csp.mjs --check` | `[✓]` |
| Una sola fuente para las medidas | `ENVOLVENTE` en `planta.js` | `[✓]` |

### Cómo repetirlo todo

```bash
# 1. Servir la app
python3 -m http.server 8099

# 2. Cliente
node tools/prueba-flujos.mjs
node tools/prueba-reserva.mjs
node tools/prueba-datos.mjs
node tools/prueba-interaccion.mjs
node tools/ataque-cliente.mjs
node tools/csp.mjs --check

# 3. Servidor (contra una COPIA, nunca producción)
psql "$DATABASE_URL" -f supabase/pruebas-seguridad.sql
```

---

## Matriz de pruebas

| Área | Prueba | Esperado | Estado |
|---|---|---|---|
| Registro | correo inválido | rechazo con aviso | `[✓]` |
| Registro | contraseña corta | rechazo con aviso | `[✓]` |
| Login | credenciales válidas | acceso | `[ ]` requiere servidor |
| Login | contraseña incorrecta | error claro | `[ ]` requiere servidor |
| Mapa | tocar una oficina | abre su información | `[✓]` |
| Mapa | zoom y arrastre | cámara estable | `[✓]` |
| Mapa | sin modelo 3D | carga igual | `[✓]` |
| Buscador | texto sin coincidencias | «Nada coincide» | `[✓]` |
| Reserva | horario libre | permite | `[✓]` |
| Reserva | horario ocupado | bloquea | `[✓]` |
| Reserva | dos a la vez | sólo una | `[✓]` |
| Reserva | fecha pasada | rechaza | `[✓]` |
| Reserva | aforo excedido | rechaza | `[✓]` |
| Reserva | sobrevive a recargar | persiste | `[✓]` |
| Pago | tarjeta válida | cobro pendiente | `[✓]` |
| Pago | tarjeta inválida (Luhn) | rechaza | `[✓]` |
| Pago | el PAN no se guarda | sólo últimos 4 | `[✓]` |
| Pago | pasarela real | confirmación | `[ ]` requiere Stripe |
| Admin | ocultar espacio | fuera del catálogo y de la URL | `[✓]` |
| Admin | guardar espacio | persiste | `[ ]` requiere servidor |
| Seguridad | XSS `javascript:` | bloqueado | `[✓]` |
| Seguridad | PATCH `total = 0` | sin efecto | `[✓]` |
| Seguridad | pago autoaprobado | queda pendiente | `[✓]` |
| Seguridad | autoascenso a admin | sin efecto | `[✓]` |
| Seguridad | cruzar de empresa | bloqueado | `[✓]` |
| Móvil | 320 × 568 | sin desborde | `[✓]` |
| Móvil | 390 × 844 | sin desborde | `[✓]` |
| Tableta | 768 × 1024 | sin desborde | `[✓]` |
| Escritorio | 1920 × 1080 | sin desborde | `[✓]` |
| Horizontal | 844 × 390 | sin desborde | `[~]` |

---

## Conclusión

El proyecto **no está terminado**, y los cinco bloqueadores no son de
código: son el plano firmado, los datos reales, las fotos, el despliegue
y las cabeceras del servidor. Todo eso depende del cliente o del hosting,
no de escribir más funciones.

Lo que sí depende del código está en un estado razonable y, sobre todo,
**demostrable**: 29 fallos encontrados atacando la aplicación, corregidos
y con una prueba que los vuelve a intentar.

La recomendación es dejar de añadir funciones hasta cerrar B1–B5.
