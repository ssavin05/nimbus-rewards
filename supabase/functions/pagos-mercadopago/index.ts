/* ======================================================================
   pagos-mercadopago — Preferencias, procesamiento y webhook.

   Secretos necesarios:
     MP_ACCESS_TOKEN     APP_USR-… (privado)
     MP_WEBHOOK_SECRET   opcional, para validar la firma

   Despliegue:
     supabase functions deploy pagos-mercadopago --no-verify-jwt
   ====================================================================== */
import { preflight, respuesta, error, requiereUsuario, reservaDelUsuario, confirmarPago, clienteServicio } from "../_compartido/utiles.ts";

const TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
const API = "https://api.mercadopago.com";

async function mp(ruta: string, opciones: RequestInit = {}) {
  const res = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(opciones.headers ?? {}),
    },
  });
  const datos = await res.json();
  if (!res.ok) throw new Error(datos?.message || `Mercado Pago devolvió ${res.status}`);
  return datos;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const url = new URL(req.url);

  /* ---------- Webhook ---------- */
  if (url.pathname.endsWith("/webhook")) {
    try {
      const cuerpo = await req.json();
      const pagoId = cuerpo?.data?.id;
      if (!pagoId) return respuesta({ ok: true });

      const pago = await mp(`/v1/payments/${pagoId}`);
      const estado = pago.status === "approved" ? "aprobado"
        : pago.status === "in_process" || pago.status === "pending" ? "procesando"
        : pago.status === "refunded" ? "reembolsado" : "rechazado";

      await confirmarPago({
        reservaId: pago.metadata?.reserva_id ?? pago.external_reference,
        usuarioId: pago.metadata?.usuario_id,
        metodo: "mercadopago",
        estado,
        monto: pago.transaction_amount,
        moneda: pago.currency_id,
        proveedorId: String(pago.id),
        ultimos4: pago.card?.last_four_digits,
        marca: pago.payment_method_id,
        respuesta: { status: pago.status, detalle: pago.status_detail },
      });
      return respuesta({ ok: true });
    } catch (e) {
      return error(e.message, 400);
    }
  }

  try {
    const { usuario } = await requiereUsuario(req);
    const cuerpo = await req.json();
    const { accion, reserva_id } = cuerpo;

    if (accion === "crear-preferencia") {
      const reserva = await reservaDelUsuario(reserva_id, usuario.id);
      const origen = req.headers.get("origin") ?? Deno.env.get("ORIGEN_PERMITIDO") ?? "";

      const preferencia = await mp("/checkout/preferences", {
        method: "POST",
        body: JSON.stringify({
          items: [{
            id: reserva.id,
            title: `${reserva.espacios?.nombre ?? "Reserva"} · ${reserva.folio}`,
            quantity: 1,
            unit_price: Number(reserva.total),
            currency_id: reserva.moneda || "MXN",
          }],
          payer: { email: usuario.email },
          external_reference: reserva.id,
          metadata: { reserva_id: reserva.id, usuario_id: usuario.id },
          back_urls: {
            success: `${origen}/#/reservas/${reserva.id}`,
            pending: `${origen}/#/reservas/${reserva.id}`,
            failure: `${origen}/#/checkout/${reserva.espacio_id}`,
          },
          auto_return: "approved",
          notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/pagos-mercadopago/webhook`,
          statement_descriptor: "CENTRO OFICINAS",
        }),
      });

      return respuesta({ preferenceId: preferencia.id, initPoint: preferencia.init_point });
    }

    if (accion === "procesar") {
      const reserva = await reservaDelUsuario(reserva_id, usuario.id);
      const formulario = cuerpo.pago ?? {};

      const pago = await mp("/v1/payments", {
        method: "POST",
        headers: { "X-Idempotency-Key": `${reserva.id}-${Date.now()}` },
        body: JSON.stringify({
          transaction_amount: Number(reserva.total),   // importe real de la base
          token: formulario.token,
          description: `${reserva.espacios?.nombre ?? "Reserva"} · ${reserva.folio}`,
          installments: formulario.installments ?? 1,
          payment_method_id: formulario.payment_method_id,
          issuer_id: formulario.issuer_id,
          payer: formulario.payer ?? { email: usuario.email },
          external_reference: reserva.id,
          metadata: { reserva_id: reserva.id, usuario_id: usuario.id },
        }),
      });

      const estado = pago.status === "approved" ? "aprobado"
        : pago.status === "in_process" || pago.status === "pending" ? "procesando" : "rechazado";

      await confirmarPago({
        reservaId: reserva.id, usuarioId: usuario.id, metodo: "mercadopago",
        estado, monto: pago.transaction_amount, moneda: pago.currency_id,
        proveedorId: String(pago.id), ultimos4: pago.card?.last_four_digits,
        respuesta: { status: pago.status, detalle: pago.status_detail },
      });

      return respuesta({ id: pago.id, status: pago.status, status_detail: pago.status_detail });
    }

    return error("acción desconocida", 400);
  } catch (e) {
    const status = e.message === "no_autorizado" ? 401 : 400;
    return error(e.message, status);
  }
});
