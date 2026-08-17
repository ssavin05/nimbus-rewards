/* ======================================================================
   pagos-paypal — Crea y captura órdenes de PayPal.

   Secretos necesarios:
     PAYPAL_CLIENT_ID
     PAYPAL_SECRET
     PAYPAL_ENTORNO     "sandbox" (por defecto) o "live"
   ====================================================================== */
import { preflight, respuesta, error, requiereUsuario, reservaDelUsuario, confirmarPago } from "../_compartido/utiles.ts";

const ENTORNO = Deno.env.get("PAYPAL_ENTORNO") ?? "sandbox";
const BASE = ENTORNO === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

async function token() {
  const credenciales = btoa(`${Deno.env.get("PAYPAL_CLIENT_ID")}:${Deno.env.get("PAYPAL_SECRET")}`);
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credenciales}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const datos = await res.json();
  if (!res.ok) throw new Error(datos?.error_description || "no se pudo autenticar con PayPal");
  return datos.access_token;
}

async function pp(ruta: string, opciones: RequestInit = {}) {
  const t = await token();
  const res = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(opciones.headers ?? {}) },
  });
  const datos = await res.json();
  if (!res.ok) throw new Error(datos?.message || `PayPal devolvió ${res.status}`);
  return datos;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const { usuario } = await requiereUsuario(req);
    const { accion, reserva_id, order_id } = await req.json();

    if (accion === "crear-orden") {
      const reserva = await reservaDelUsuario(reserva_id, usuario.id);
      const orden = await pp("/v2/checkout/orders", {
        method: "POST",
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{
            reference_id: reserva.id,
            custom_id: usuario.id,
            description: `${reserva.espacios?.nombre ?? "Reserva"} · ${reserva.folio}`,
            amount: {
              currency_code: reserva.moneda || "MXN",
              value: Number(reserva.total).toFixed(2),
            },
          }],
          application_context: { brand_name: "Smart Hub", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING" },
        }),
      });
      return respuesta({ orderId: orden.id });
    }

    if (accion === "capturar") {
      const reserva = await reservaDelUsuario(reserva_id, usuario.id);
      const captura = await pp(`/v2/checkout/orders/${order_id}/capture`, { method: "POST" });
      const detalle = captura.purchase_units?.[0]?.payments?.captures?.[0];

      await confirmarPago({
        reservaId: reserva.id, usuarioId: usuario.id, metodo: "paypal",
        estado: captura.status === "COMPLETED" ? "aprobado" : "procesando",
        monto: Number(detalle?.amount?.value ?? reserva.total),
        moneda: detalle?.amount?.currency_code ?? reserva.moneda,
        proveedorId: order_id,
        respuesta: { status: captura.status, capture_id: detalle?.id },
      });

      return respuesta({ status: captura.status, id: detalle?.id });
    }

    return error("acción desconocida", 400);
  } catch (e) {
    const status = e.message === "no_autorizado" ? 401 : 400;
    return error(e.message, status);
  }
});
