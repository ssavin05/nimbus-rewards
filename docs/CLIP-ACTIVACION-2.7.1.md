# Activación de Clip — Smart Hub 2.7.1

Esta entrega deja el código listo para que Clip aparezca como único método de pago.
Las credenciales siguen fuera del repositorio.

## En Supabase Dashboard

1. SQL Editor: ejecuta `supabase/migracion-07-metodo-de-pago-clip.sql`.
2. Edge Functions → Secrets:
   - `CLIP_API_KEY` = API Key PRODUCTIVA de Clip.
   - `CLIP_SECRET_KEY` = Secret Key PRODUCTIVA.
   - `SITIO_URL` = `https://ssavin05.github.io/3d`
   - todavía NO pongas `CLIP_COBROS_REALES`.
3. Edge Functions → `pagos-clip`: despliega/reemplaza `index.ts` de esta entrega.
   La función debe desplegarse sin verificación JWT de plataforma porque `/webhook`
   es público; las rutas de usuario validan el JWT dentro del código.
4. Verifica `POST /functions/v1/pagos-clip/estado`.
   Debe responder que credenciales y sitio están configurados, pero
   `cobros_habilitados=false`.
5. Cuando estés listo para hacer un cobro REAL mínimo, añade el secreto:
   `CLIP_COBROS_REALES=si`.
6. Haz una reserva de importe pequeño, paga en Clip, vuelve a Smart Hub y comprueba
   que la reserva queda `confirmada`.
7. Cancela y verifica el reembolso en Clip.

No pegues API Key ni Secret Key en GitHub, `config.js`, HTML o mensajes de soporte.
