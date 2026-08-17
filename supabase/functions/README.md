# Edge Functions — Smart Hub

Las funciones corren en Supabase/Deno. **Los secretos nunca van en el
navegador.**

## V1: qué desplegar

La única pasarela pública es `pagos-clip`.

```bash
supabase functions deploy pagos-clip --no-verify-jwt
supabase functions deploy eliminar-cuenta
```

Despliega además sólo los módulos que realmente hayas configurado:

```bash
supabase functions deploy asistente
supabase functions deploy enviar-recordatorios --no-verify-jwt
# facturacion: sólo después de tener un PAC/emisor real
```

`pagos-clip` usa rutas públicas para webhook/retorno y hace sus propias
comprobaciones. El webhook no se toma como autoridad: la función vuelve a
consultar a Clip antes de confirmar un pago.

## Secretos mínimos de Clip

```text
CLIP_API_KEY
CLIP_SECRET_KEY
SITIO_URL
CLIP_COBROS_REALES=si   # sólo cuando ya vayas a aceptar cargos reales
```

Checkout Redireccionado de Clip no tiene sandbox. No uses
`CLIP_COBROS_REALES=si` hasta completar la prueba controlada descrita en
`OWNER_ACTIONS.md`.

## Funciones históricas

`pagos-stripe`, `pagos-mercadopago` y `pagos-paypal` permanecen en el
repositorio únicamente para trazabilidad/compatibilidad con instalaciones
anteriores. **No forman parte del despliegue V1 y no deben publicarse como
métodos nuevos de checkout.**

`pagos-stripe` puede ser necesario únicamente si una instalación existente
tiene cobros Stripe antiguos que todavía deban reembolsarse. No lo despliegues
“por si acaso”.

## Otras integraciones

- `asistente`: requiere su llave de proveedor/modelo; si falta, el cliente cae
  al asistente local.
- `enviar-recordatorios`: requiere VAPID y un disparador/cron real.
- `facturacion`: no desplegar en V1 hasta tener emisor y PAC reales.
- `eliminar-cuenta`: soporta el flujo de borrado de cuenta.

Para el estado completo de producción, ver `OWNER_ACTIONS.md` y
`docs/CONFIGURACION.md`.
