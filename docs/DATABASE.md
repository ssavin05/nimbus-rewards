# FASE 01 — Base de datos

Inventario de la base con las respuestas a las preguntas de la fase:
para qué existe cada tabla, quién la lee, quién la escribe, de quién es
y qué pasa cuando se borra algo.

**Proyecto**: `xashvchjvsmwyrbxwomd` · PostgreSQL 17.6 · us-east-1

Al 12/08/2026, medido contra la base real:

| | |
|---|---|
| Tablas en `public` | 25 (todas con RLS) |
| Tablas **sin** RLS | 0 |
| Restricciones `CHECK` | 69 |
| Claves foráneas | 49 |
| Índices | 93 |
| Pruebas que pasan | 39 de seguridad + 65 de restricciones |

---

## 0. Lo que había antes, y por qué se migró

La base **no tenía el esquema de la aplicación**. Tenía otro distinto e
incompatible, de un diseño anterior:

| Concepto | Esquema viejo | Lo que la app espera |
|---|---|---|
| Precio | `horarios_disponibles.precio` | `espacios.precio_hora` |
| Reserva | `horario_id` → fila pregenerada | `inicio`/`fin` timestamptz |
| Estado | `estado_id` smallint → tabla | enum `estado_reserva` |
| Aforo | `capacidad_maxima` | `capacidad` |
| Posición | `posicion_x/y`, `ancho`, `alto` | `pos_x/pos_y`, `ancho`, `fondo` |
| Dirección | `edificios.direccion` | `sedes.direccion` |

Faltaban además 12 tablas que la aplicación consulta. Con ese esquema la
app no podía funcionar: no era cuestión de ajustar consultas.

Y tenía tres agujeros de fondo:

- **Cero restricciones de exclusión**: la doble reserva no estaba
  impedida. Dos personas podían reservar el mismo espacio a la misma
  hora y las dos quedaban confirmadas.
- **12 tablas con RLS activo y ninguna política**: RLS encendido sin
  políticas niega todo, así que la app veía tablas vacías.
- **6 funciones `SECURITY DEFINER` ejecutables por `anon`** y 7 con el
  `search_path` suelto.

*(También había una tabla llamada `Milagros Pineda` con dos columnas y
cero filas. Se eliminó.)*

### Cómo se hizo

1. `create table respaldo_v1.X as table public.X` para **todas** las
   tablas. El esquema `respaldo_v1` sigue intacto en la base: no se
   borró nada, sólo se apartó.
2. Se reconstruyó `public` con `schema.sql` → `policies.sql` →
   `seguridad.sql` → `restricciones.sql`.
3. `migracion-v1-a-v2.sql` volcó los datos traduciendo cada concepto.

Resultado del volcado:

| | filas |
|---|---|
| organizaciones · sedes · edificios · pisos | 1 · 2 · 2 · 2 |
| espacios | 18 |
| usuarios · membresías | 3 · 1 |
| reservas | 10 |
| auditoría (desde `historial`) | 20 |

> **Para volver atrás**: los datos originales están en `respaldo_v1`.
> Nada de lo hecho aquí los toca.

---

## 1. Inventario de tablas

Abreviaturas de la columna «Al borrar»: **CASCADE** se lleva a los
hijos · **SET NULL** los deja huérfanos pero vivos · **RESTRICT** impide
borrar el padre.

### Organización y personas

#### `organizaciones`
La empresa dueña de todo. Es la raíz del aislamiento multiempresa.

| | |
|---|---|
| **Lee** | Cualquiera (`lectura_publica`) |
| **Escribe** | `es_admin(id)` — sólo un admin de esa misma empresa |
| **Dueño** | Ella misma |
| **Al borrar** | CASCADE hacia sedes, edificios, espacios, reservas, pagos, facturas, promociones y conversaciones. Es un borrado nuclear: en la práctica se usa `activa = false`. |

`tasa_impuesto` está acotada entre 0 y 1 — es una fracción (0.16), no un
porcentaje (16). Un 16 ahí multiplicaría cada factura por diecisiete.

#### `usuarios`
El perfil. **No guarda contraseñas**: eso vive en `auth.users` y lo
gestiona Supabase Auth (FASE 02 §2.2). `usuarios.id` es la misma id que
`auth.users.id`.

| | |
|---|---|
| **Lee** | Uno mismo · el staff de tu organización · el superadmin |
| **Escribe** | Uno mismo (`perfil_propio_update`) · un admin de tu organización |
| **Dueño** | `organizacion_id` |
| **Al borrar el usuario de Auth** | CASCADE: se borra el perfil |
| **Al borrar la organización** | SET NULL: la persona sobrevive sin empresa |

El trigger `proteger_rol` impide, incluso vía `PATCH` directo, que
alguien se cambie el `rol`, la `organizacion_id` o el `email`. El correo
sólo llega desde Auth (verificado), a través de `sincronizar_email`.

Para borrar la cuenta hay una función dedicada: **`eliminar_mi_cuenta()`**
(FASE 03 §3.2). No borra a lo bruto:

1. Cancela las reservas futuras — así el espacio queda libre.
2. Borra lo puramente personal: favoritos, lista de espera, avisos,
   suscripciones push, reseñas, conversaciones.
3. **Anonimiza** reservas, pagos y facturas (`cliente_nombre = 'Cuenta
   eliminada'`, correo a null). El histórico contable se conserva porque
   la ley obliga, pero deja de tener tu nombre pegado.
4. Borra el perfil y la credencial de `auth.users`.

#### `organizacion_usuarios`
Quién pertenece a qué empresa y con qué rol. Una persona puede estar en
varias.

| | |
|---|---|
| **Lee** | Uno mismo · el staff de esa organización |
| **Escribe** | `es_admin(organizacion_id)` |
| **Al borrar** | CASCADE desde la organización o desde el usuario |

### El edificio

#### `sedes` → `edificios` → `pisos` → `espacios`
La jerarquía física. Todas se leen en abierto (el catálogo es público) y
sólo las escribe un admin de la organización dueña.

| Tabla | Al borrar el padre | Nota |
|---|---|---|
| `sedes` | CASCADE desde organización | Dirección, ciudad, coordenadas |
| `edificios` | CASCADE desde sede | `ancho_m`/`fondo_m` = envolvente del plano |
| `pisos` | CASCADE desde edificio | Único por (edificio, número) |
| `espacios` | `piso_id` SET NULL, `edificio_id`/`sede_id` CASCADE | Único por (organización, código) |

**`espacios` es la tabla de precios.** `precio_hora` es la única fuente
del importe de una reserva: el navegador nunca lo manda (FASE 01 §1.4).

`capacidad` puede ser 0 **sólo si `reservable = false`** — la recepción,
los pasillos y los baños son espacios reales del plano con aforo cero.
Si se puede reservar, tiene que caber alguien.

#### `espacio_fotos`, `amenidades`, `horarios_operacion`, `bloqueos`
Complementos del catálogo. `bloqueos` marca mantenimiento y tiene que
colgar de un espacio o de un edificio: un bloqueo sin destino no bloquea
nada, y hay un `CHECK` que lo exige.

### Reservas y dinero

#### `reservas`
El centro del sistema.

| | |
|---|---|
| **Lee** | El dueño de la reserva · el staff de la organización |
| **Escribe** | El dueño (limitado) · el staff |
| **Borra** | Sólo `es_admin(organizacion_id)` |
| **Al borrar el espacio** | **RESTRICT** — un espacio con reservas no se puede borrar. Protege el histórico contable. |
| **Al borrar el usuario** | SET NULL + anonimización |

**Estados** (enum `estado_reserva`, el frontend no puede inventarse
otros): `pendiente` → `confirmada` → `en_curso` → `completada`, más
`cancelada` y `no_asistio`.

Qué puede tocar el cliente, y qué no. `guardia_reserva` restaura en
silencio todo lo que no le corresponde:

| Puede | No puede |
|---|---|
| Cancelar la suya | Confirmarla (eso es del pago) |
| Cambiar asistentes (dentro del aforo) | Tocar precio, horario, dueño o empresa |
| Editar notas (≤ 1000 caracteres) | Cambiar de estado a nada que no sea cancelada |

**La doble reserva la impide PostgreSQL, no JavaScript** (FASE 04 §4.3):

```sql
exclude using gist (espacio_id with =, periodo with &&)
  where (estado in ('pendiente','confirmada','en_curso'))
```

`periodo` es una columna generada (`tstzrange(inicio, fin, '[)')`). Si
dos peticiones llegan a la vez, una entra y la otra recibe error `23P01`.
No hay ventana de carrera porque no lo decide la aplicación.

#### `pagos`
| | |
|---|---|
| **Lee** | El dueño · el staff |
| **Inserta** | Sólo servidor/Edge Functions; staff puede registrar ajustes administrativos |
| **Actualiza** | `es_admin` — o la Edge Function con la llave de servicio |
| **Al borrar la reserva** | SET NULL: el pago sobrevive |

`guardia_pago` rechaza escrituras de pago desde el navegador. En V1 el
intento de Clip nace en la Edge Function con el importe leído desde la
reserva y sólo el servidor puede mover su estado. La migración
`migracion-10-cerrar-escrituras-pospuestas.sql` aplica el mismo cierre a
una base ya desplegada.

Del número de tarjeta se guardan `ultimos4` (cuatro dígitos, con un
`CHECK` que lo obliga) y la marca. **El PAN completo no cabe en la
base.**

`uq_pagos_proveedor` es un índice único sobre `proveedor_id`: un webhook
repetido no puede crear dos pagos (FASE 12, Test 06).

#### `facturas`
Sólo se factura un pago **aprobado**, el importe sale del pago y el RFC
tiene que cumplir el formato mexicano. Un pago no puede tener dos
facturas vivas.

### Lo demás

| Tabla | Para qué | Quién la lee |
|---|---|---|
| `favoritos` | Espacios guardados | Sólo su dueño |
| `resenas` | Opiniones | Público si `visible`; el staff ve todas |
| `lista_espera` | Avisar cuando se libera un hueco | Su dueño · el staff del espacio |
| `promociones` / `promocion_usos` | Cupones y sus canjes | Catálogo público / usos privados |
| `notificaciones` | Avisos en la app | Sólo su destinatario |
| `push_suscripciones` | Endpoints Web Push | Sólo su dueño |
| `conversaciones` / `mensajes` | Chat con administración | Los dos lados de la conversación |
| `auditoria` | Registro de cambios (FASE 06 §6.4) | Admin de la organización |
| `ritmo` | Contador anti-abuso | Nadie: RLS sin políticas a propósito |

Sólo se puede opinar sobre una reserva propia y ya empezada. La
`respuesta` de una reseña es voz de la administración: `guardia_resena`
la descarta si la manda el cliente.

---

## 2. Las relaciones

```
auth.users  (Supabase Auth: correo y contraseña)
     │ 1:1
usuarios ──────────────┐
     │                 │
     │ N:M             │ N:1
organizacion_usuarios  │
     │                 │
     └──── organizaciones
                │
                ├── sedes ── edificios ── pisos
                │                           │
                └────────────────────── espacios
                                            │
                                        reservas ── pagos ── facturas
                                            │
                                        resenas
```

La regla que pedía FASE 01 §1.2 —*no quiero `reserva → espacio` sin
saber a qué organización pertenece*— está resuelta por partida doble:
`reservas.organizacion_id` es `not null`, y `guardia_reserva_insert` lo
**copia del espacio**, ignorando lo que mande el cliente. No se puede
crear una reserva apuntando a otra empresa.

---

## 3. Las restricciones (§1.3)

Las 69 están en `supabase/restricciones.sql`. Las que más importan:

| Restricción | Qué impide |
|---|---|
| `espacio_precios_no_negativos` | Precios negativos |
| `espacio_capacidad_coherente` | Aforo 0 en algo reservable |
| `reservas_check` | `fin <= inicio` |
| `reserva_duracion_razonable` | Reservas de 1 minuto o de 300 años |
| `reserva_descuento_acotado` | Descuento mayor que el subtotal |
| `pago_ultimos4_son_cuatro` | Meter el número de tarjeta completo |
| `pago_aprobado_con_fecha` | «Aprobado» sin fecha de cobro |
| `reserva_cancelacion_coherente` | «Cancelada» sin fecha de cancelación |
| `espera_bloque_valido` | Bloques como `HOLA-MUNDO` |
| `promo_porcentaje_acotado` | Descuentos del 300 % |
| enums | Estados inventados |

### La que resuelve §1.4

```sql
alter table reservas add constraint reserva_total_cuadra
  check (abs(total - (subtotal - descuento + impuestos)) <= 0.01);
```

El escenario del enunciado:

```
Cliente:   "Quiero reservar el espacio X"
Servidor:  precio_hora = 500, son 3 h  →  subtotal 1500 + IVA 240 = 1740
Cliente:   PATCH { "total": 1 }
Servidor:  ERROR 23514 — reserva_total_cuadra
```

Hay tres capas, y son distintas a propósito:

1. `crear_reserva()` **calcula** el precio desde el catálogo.
2. `guardia_reserva` **restaura** el importe si llega un `PATCH`.
3. `reserva_total_cuadra` **verifica** que la fila es aritméticamente
   posible.

Las dos primeras son código y pueden tener errores. La tercera no es
código: es una condición que la fila cumple o no existe. Ni la llave de
servicio puede saltársela — y así está probado en
`pruebas-restricciones.sql`, que ataca desde `service_role` justamente
para que no haya trigger que ayude.

El margen de 0,01 absorbe el redondeo del IVA. Nada más.

---

## 4. Orden de aplicación

```bash
psql "$DATABASE_URL" -f supabase/schema.sql         # tablas, enums, funciones
psql "$DATABASE_URL" -f supabase/policies.sql       # RLS y Storage
psql "$DATABASE_URL" -f supabase/seguridad.sql      # guardias y multiempresa
psql "$DATABASE_URL" -f supabase/restricciones.sql  # CHECK e índices
psql "$DATABASE_URL" -f supabase/caducidad.sql      # expiración de apartados
psql "$DATABASE_URL" -f supabase/seed.sql           # el plano del edificio
```

`restricciones.sql` va **después** de `seguridad.sql` porque comprueba
columnas que ésta añade (`usuarios.organizacion_id`).

`caducidad.sql` no es opcional aunque lo parezca: sin ella,
`reservas.expira_en` no existe y los apartados sin pagar **no caducan
nunca**. Se quedan bloqueando el horario para siempre.

Los cinco son idempotentes: correrlos dos veces no rompe nada.

### Probar sin Supabase

`auth` y `storage` los crea la plataforma. Para levantar la base en un
PostgreSQL normal hay un sustituto mínimo:

```bash
createdb app
psql -d app -f supabase/local/auth-simulado.sql   # ⚠️ sólo pruebas
psql -d app -f supabase/schema.sql
# ...el resto igual
psql -d app -f supabase/pruebas-seguridad.sql     # 39 comprobaciones
psql -d app -f supabase/pruebas-restricciones.sql # 65 comprobaciones
```

Las dos suites hacen `rollback` al final: no dejan nada escrito.

---

## 5. Fallos encontrados en esta fase

Todos salieron de reconstruir la base desde cero y atacarla, no de leer
el código.

| # | Fallo | Cómo apareció |
|---|---|---|
| 1 | **Las vistas de analítica filtraban entre empresas.** `v_metricas_diarias` y otras tres eran `SECURITY DEFINER`: cualquiera con sesión podía leer la facturación de **todas** las organizaciones. | Advisor de Supabase |
| 2 | **`public` sin permisos de tabla.** `schema.sql` daba por hechos los `GRANT` que trae Supabase de fábrica. Al reconstruir el esquema desaparecieron y la app respondía `permission denied for table reservas`. | Reconstrucción en limpio |
| 3 | **Reactivar una reserva cancelada dejaba basura.** Pasaba a `confirmada` conservando `cancelada_en`, el motivo y un reembolso que nunca se pagó. | `reserva_cancelacion_coherente` |
| 4 | **`reservas.promocion_id` no era clave foránea.** Un uuid suelto que podía apuntar a una promoción inexistente. | Inventario de claves |
| 5 | **11 funciones con `search_path` suelto** y 19 funciones de trigger publicadas como RPC en `/rest/v1/rpc/`. | Advisor |
| 6 | **32 claves foráneas sin índice**: cada borrado del padre recorría la tabla hija entera. | Inventario de índices |
| 7 | **El nombre real se perdía al migrar.** El trigger de Auth creaba el perfil con el trozo del correo (`ana`) y el `coalesce` de la migración prefería ese marcador a `Ana López`. | Prueba de migración con datos sucios |
| 8 | **El slug generado terminaba en guion.** `Centro De Oficinas!` → `centro-de-oficinas-`, que el `CHECK` rechaza. | Prueba de migración |
| 9 | **La suite de seguridad creaba una fila imposible** (`total = 1000`, `subtotal = 0`). Era la prueba la que estaba mal. | `reserva_total_cuadra` |

Los fallos 7, 8 y 9 los cazaron las propias pruebas antes de tocar la
base real. Los 1 a 6 estaban en producción.

---

## 6. Lo que queda pendiente

Tres avisos siguen abiertos, y los tres son **a propósito** o son
configuración del panel, no código:

| Aviso | Decisión |
|---|---|
| `v_ocupacion_publica` SECURITY DEFINER | **Resuelto.** La vista usa `security_invoker = true`; el acceso público pasa por `ocupacion_publica_segura()`, que sólo devuelve `espacio_id`, `inicio` y `fin`. |
| Funciones `SECURITY DEFINER` ejecutables | **Revisadas.** Las funciones que necesitan privilegios elevados fijan `search_path`; `ocupacion_publica_segura()` sólo devuelve `espacio_id`, `inicio` y `fin`. Las demás conservan únicamente los permisos necesarios para RLS/RPC. |
| `btree_gist` en `public` | Se queda. La restricción de exclusión que impide la doble reserva depende de ella; moverla de esquema es más riesgo que beneficio. |

Y una que **sí hay que activar a mano**, porque no se puede por SQL:

> ⚠️ **Protección contra contraseñas filtradas.** Está desactivada.
> Se enciende en *Authentication → Policies → Password protection*.
> Comprueba contra HaveIBeenPwned que la contraseña no esté en una fuga
> conocida. Entra en FASE 02.

### Datos que sólo puede dar el cliente

Los 18 espacios migrados traen los nombres y precios reales, pero
siguen sin: fotografías, dirección postal completa, RFC y razón social,
teléfonos de contacto, y los textos legales (términos y privacidad).
Nada de eso es código.
