# Manual de entrega

> ⚠️ **ARCHIVO HISTÓRICO — NO USAR COMO GUÍA DE LANZAMIENTO.**
> Este documento conserva decisiones y resultados de etapas anteriores y puede mencionar Stripe, estados o procedimientos ya reemplazados. Para V1 2.5.0 usa `OWNER_ACTIONS.md`, `RELEASE_CHECKLIST.md` y `docs/ATAQUE-2.5.0.md`.

De acuerdo en congelar el código. A partir de aquí no se toca salvo que
una prueba real encuentre un fallo.

> ## ⚠️ Lo primero, y sin ello nada de lo demás importa
>
> **La base viva NO tiene la migración de caducidad.** Comprobado hoy
> contra `xashvchjvsmwyrbxwomd` por la API REST:
>
> ```
> ✗ reservas.expira_en             FALTA   (42703 column does not exist)
> ✗ organizaciones.minutos_apartado FALTA  (42703 column does not exist)
> ✗ reanudar_reserva()             NO existe (404)
> ✗ expirar_reservas_pendientes()  NO existe (404)
> ```
>
> Es exactamente el riesgo de «el ZIP y el servidor hablan idiomas
> distintos». Si se publica así:
>
> - recargar durante el pago **falla** (`reanudar_reserva` da 404),
> - los apartados **no caducan** y bloquean horarios para siempre,
> - `confirmarPago()` lee `expira_en` y recibe error, así que el webhook
>   devuelve 500 y Stripe reintenta en bucle.

---

## 1. Aplicar el SQL — prioridad máxima

Orden exacto. Los cinco son idempotentes: correrlos dos veces no rompe
nada (comprobado).

```bash
psql "$DATABASE_URL" -f supabase/schema.sql
psql "$DATABASE_URL" -f supabase/policies.sql
psql "$DATABASE_URL" -f supabase/seguridad.sql
psql "$DATABASE_URL" -f supabase/restricciones.sql
psql "$DATABASE_URL" -f supabase/caducidad.sql     # ← lo que falta
```

O pegándolos en *SQL Editor* del panel, en ese orden.

**Como tu base ya tiene el resto aplicado, basta con `caducidad.sql`.**
Los otros cuatro no harán nada nuevo, pero correrlos no estorba.

### Comprobar que entró

```sql
select
  to_regclass('public.reservas') is not null                        as tabla,
  (select count(*) from information_schema.columns
    where table_name='reservas' and column_name='expira_en')        as expira_en,
  (select count(*) from information_schema.columns
    where table_name='organizaciones' and column_name='minutos_apartado') as minutos,
  to_regproc('public.reanudar_reserva')            is not null      as reanudar,
  to_regproc('public.expirar_reservas_pendientes') is not null      as expirar,
  (select count(*) from pg_trigger where tgname='trg_aaa_liberar_vencidos') as trigger_libera;
```

Los seis tienen que dar `true` / `1`.

O desde fuera, sin entrar al panel:

```bash
curl -s "$SUPABASE_URL/rest/v1/organizaciones?select=minutos_apartado&limit=1" \
     -H "apikey: $ANON_KEY"
# Antes:  {"code":"42703", ... does not exist}
# Después: [{"minutos_apartado":15}]
```

### Programar la limpieza

`caducidad.sql` intenta programar `pg_cron` solo y **avisa si no puede**.
Si sale el aviso, hay que llamarlo desde una Scheduled Function:

```sql
select public.expirar_reservas_pendientes();   -- cada 1–5 minutos
```

Ya no bloquea reservar —de eso se encarga el trigger— pero sin esto se
acumulan reservas `pendiente` muertas.

---

## 2. Desplegar esta versión de `pagos-stripe`

```bash
supabase login
supabase link --project-ref xashvchjvsmwyrbxwomd
supabase functions deploy pagos-stripe --no-verify-jwt
```

La versión desplegada tiene que ser la de este ZIP. Se reconoce porque
contiene:

| Señal | Búscala en el código desplegado |
|---|---|
| Idempotencia | `idempotencyKey: \`reserva:` |
| Ya cobrado | `yaPagado: true` |
| Caducidad | `if (r?.caducada)` |
| Reembolso parcial | `devuelto >= cobrado ? "reembolsado" : "parcial"` |
| Reintento de Stripe | `no se pudo procesar el evento`, `500` |
| Firma | `firma inválida`, `400` |
| Helper de reembolso | `reservaParaReembolso` |

Si falta cualquiera, es la versión vieja.

---

## 3. Stripe

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

En `js/core/config.js`, **sólo** la pública:

```js
stripe: { publishableKey: "pk_test_...", enabled: true }
```

Webhook en Stripe apuntando a:

```
https://xashvchjvsmwyrbxwomd.supabase.co/functions/v1/pagos-stripe/webhook
```

Eventos mínimos:

```
payment_intent.succeeded
payment_intent.payment_failed
charge.refunded
```

> `sk_test` y `whsec` **nunca** en JavaScript, en el repositorio ni en el
> ZIP. Si alguno se filtra, se rota desde el panel de Stripe.

---

## 4. Las diez pruebas

Todas de sandbox. Ninguna mueve dinero real.

| # | Prueba | Qué tiene que pasar |
|---|---|---|
| A | Pago con `4242 4242 4242 4242` | `pagos.estado=aprobado` · `reservas.estado=confirmada` |
| B | Tarjeta rechazada (`4000 0000 0000 0002`) | reserva **no** confirmada · se puede reintentar |
| C | Recargar durante el pago | 1 reserva · 1 PaymentIntent · 1 cobro |
| D | Cancelar con derecho al 100 % | Stripe devuelve el total · `estado=reembolsado` |
| E | Cancelar con derecho al 50 % | Stripe devuelve la mitad · **`estado=parcial`** |
| F | Cancelar sin derecho (0 %) | Stripe **no recibe nada** · `sin_reembolso` |
| G | Pagar después de que venza el apartado | reembolso automático · la reserva **no** revive · la de B sigue válida |
| H | Reenviar el mismo webhook | ningún efecto duplicado |
| I | Dos usuarios, mismo horario | sólo uno reserva |
| J | Sin conexión | no deja reservar **ni cancelar** |

**E** y **F** son las que acaban de corregirse: E marcaba `reembolsado`
cuando era `parcial`, y F habría devuelto el importe entero por culpa de
un `||`. Merecen mirarse en el panel de Stripe, no sólo en la app.

**G** es la carrera difícil. Para provocarla sin esperar 15 minutos:

```sql
update reservas set expira_en = now() - interval '1 minute' where id = '...';
```

y entonces completar el pago que quedó abierto.

### Consulta para revisar después de cada prueba

```sql
select r.folio, r.estado as reserva, r.expira_en,
       p.estado as pago, p.monto, p.reembolsado, p.proveedor_id
  from reservas r left join pagos p on p.reserva_id = r.id
 where r.creado_en > now() - interval '2 hours'
 order by r.creado_en desc;
```

---

## 5. Auth

1. **SMTP propio** — *Authentication → Emails → SMTP Settings*. Cierra
   `AUTH-16c` y desbloquea las omitidas.
2. **Leaked Password Protection** — *Authentication → Attack Protection*.
3. En tu máquina, no aquí:
   ```bash
   export SUPABASE_SERVICE_ROLE_KEY=...
   export CORREO_CONOCIDO=tu-correo-ya-registrado@...
   node tests/auth/index.mjs --estricto
   ```
   Objetivo: `FAIL 0 · SKIP 0`. En `--estricto` una omitida también falla.
4. La prueba manual de correo real (llega · remitente · plantilla ·
   enlace · redirección · caducidad · móvil · spam).

---

## 6. URL pública

Con el dominio ya en marcha, en *Authentication → URL Configuration*:

```
Site URL       https://tu-dominio
Redirect URLs  https://tu-dominio/**   (y localhost:8099/** para pruebas)
```

Y repetir desde esa URL, no desde localhost: registro, confirmación,
recuperación y Google OAuth.

---

## 7. Antes de publicar

`docs/CONFIGURACION.md` tiene la lista larga. Lo que no puede quedarse:

- Dirección, teléfono, WhatsApp y correo de ejemplo.
- La CLABE ficticia. **Si no hay datos bancarios reales, desactiva
  transferencia** en vez de publicar una CLABE inventada.
- Mercado Pago y PayPal: desactivados mientras no estén configurados.
  Una app con Stripe al 100 % se ve más terminada que una con cinco
  métodos a medias.
- Cualquier función que lleve a una pantalla de «falta configurar».

---

## 8. Dejar la base en cero antes de abrir

Dos archivos, y se corren en este orden desde el **SQL Editor** del panel
de Supabase. No hacen falta psql ni la CLI: no llevan meta-comandos.

### 8.1 Mirar — `supabase/limpieza-lanzamiento-inspeccion.sql`

**Sólo lectura.** No borra, no actualiza, no toca secuencias, no abre
transacción. Se puede correr en producción las veces que sea.

Nueve bloques de resultados. Tres deciden si se puede limpiar:

| Bloque | Si sale con filas… |
|---|---|
| 2 y 3 · pagos con dinero | míralos en Stripe por su `pi_…` |
| 4 · bloqueos vigentes y futuros | no los borres si son reales |
| 7 · reservas confirmadas por venir | son clientes: avísales antes |

Si los tres salen vacíos, limpiar es seguro.

### 8.2 Aplicar — `supabase/limpieza-lanzamiento-aplicar.sql`

Este sí borra. Lleva dos frenos, los dos **dentro** de la transacción:

1. **Pagos con dinero.** Si hay alguno en `aprobado`, `procesando`,
   `parcial` o `reembolsado`, aborta con `RAISE EXCEPTION`. Para
   saltárselo —sólo después de comprobar en Stripe que todos son de
   prueba— se quita el comentario de una línea en la cabecera:
   ```sql
   set limpieza.pagos_revisados = 'si';
   ```
2. **El catálogo.** Si al terminar espacios, organizaciones, usuarios o
   `auth.users` quedaran vacíos, aborta y deshace todo.

> **Por qué los frenos van dentro de la transacción.** Al principio puse
> el de los pagos fuera, antes del `begin`, pensando que abortar sin
> abrir nada era más limpio. La prueba dijo lo contrario: un cliente que
> no pare al primer error se salta el `RAISE EXCEPTION` y sigue con los
> `DELETE`. El freno borró los cinco pagos que debía proteger. Dentro,
> la transacción queda abortada y el `COMMIT` se vuelve `ROLLBACK`.

**Los bloqueos vigentes y futuros no se borran nunca.** Sólo los ya
terminados (`fin < now()`). Al final del archivo hay una consulta
preparada para revisarlos y borrarlos uno a uno.

> **Los folios se reajustan después del `COMMIT`, fuera de la
> transacción.** `setval` no obedece a `ROLLBACK`. Con el reinicio
> dentro, una pasada abortada dejaba el contador en 1 con las reservas
> todavía ahí, y la siguiente chocaba:
> `duplicate key value violates unique constraint "reservas_folio_key"`.
> Ahora el valor se deduce de los folios que quedan, así que sale bien
> en los dos casos y se puede repetir.

### 8.3 Y en la aplicación

Cambiar `app.epocaLanzamiento` en `js/core/config.js` por la fecha de ese
día y volver a publicar. Es lo que hace que los equipos que ya abrieron
la app tiren su caché de disponibilidad en lugar de seguir enseñando
horarios ocupados que ya no existen. No cierra la sesión de nadie.

---

## Estado del código

Congelado. Verificado en este entorno:

```
cadena SQL desde cero (6 archivos)      aplica limpia
segunda pasada completa                 idempotente
pruebas-seguridad.sql                   39/39
pruebas-restricciones.sql               70 CHECK · 49 FK · 94 índices
pruebas-caducidad.sql                    8/8
limpieza en seco (no cambia nada)       verificado
limpieza con commit, en una copia       verificado
prelanzamiento.mjs (casos A–H)           8/8
prueba-reserva.mjs                       7/7
prueba-datos.mjs                        sin hallazgos
prueba-flujos.mjs                       sin hallazgos
ataque-cliente.mjs                       0 XSS
csp.mjs --check                         hashes al día
navegador                                0 errores de JS
auth (sin llave)                        PASS 12 · FAIL 1 · SKIP 14
```

El único `FAIL` es `AUTH-16c`, el remitente de correo, que se cierra con
el SMTP del punto 5.

Lo que **no** está verificado, y no puede estarlo desde aquí: nada que
toque Stripe de verdad. El código está escrito y revisado; que cobre y
devuelva bien sólo lo demuestra el sandbox.
