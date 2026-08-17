/* ======================================================================
   pagos-stripe — Crea el PaymentIntent y recibe el webhook de Stripe.

   Secretos necesarios:
     STRIPE_SECRET_KEY      sk_live_… / sk_test_…
     STRIPE_WEBHOOK_SECRET  whsec_…   (para /webhook)

   Despliegue:
     supabase functions deploy pagos-stripe --no-verify-jwt
     supabase secrets set STRIPE_SECRET_KEY=sk_test_...
   ====================================================================== */
import Stripe from "https://esm.sh/stripe@16.9.0?target=deno";
import { preflight, respuesta, error, requiereUsuario, reservaDelUsuario, reservaParaReembolso, confirmarPago, centavos, clienteServicio } from "../_compartido/utiles.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const url = new URL(req.url);

  /* ---------- Webhook: Stripe confirma el cobro ---------- */
  if (url.pathname.endsWith("/webhook")) {
    const firma = req.headers.get("stripe-signature");
    const cuerpo = await req.text();

    // La firma se valida aparte del procesado: son dos fallos distintos
    // y Stripe los trata distinto. Una firma mala es 400 y no se
    // reintenta (nunca va a mejorar). Un fallo al escribir en la base
    // tiene que ser 500 para que Stripe SÍ reintente.
    let evento: Stripe.Event;
    try {
      evento = await stripe.webhooks.constructEventAsync(
        cuerpo, firma!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined,
        Stripe.createSubtleCryptoProvider(),
      );
    } catch (e) {
      return error(`firma inválida: ${e.message}`, 400);
    }

    try {
      if (evento.type === "payment_intent.succeeded") {
        const pi = evento.data.object as Stripe.PaymentIntent;
        const tarjeta = pi.charges?.data?.[0]?.payment_method_details?.card;
        const r = await confirmarPago({
          reservaId: pi.metadata.reserva_id,
          usuarioId: pi.metadata.usuario_id,
          metodo: pi.metadata.wallet || "stripe",
          estado: "aprobado",
          monto: pi.amount_received / 100,
          moneda: pi.currency.toUpperCase(),
          proveedorId: pi.id,
          ultimos4: tarjeta?.last4,
          marca: tarjeta?.brand,
          respuesta: { status: pi.status },
        });

        // El apartado venció mientras pagaba y el horario puede estar
        // ya de otra persona. La reserva NO revive —eso sería una doble
        // reserva—, así que se devuelve el dinero en el acto.
        if (r?.caducada) {
          await stripe.refunds.create({
            payment_intent: pi.id,
            reason: "requested_by_customer",
            metadata: { motivo: "apartado_vencido", reserva_id: pi.metadata.reserva_id },
          }, { idempotencyKey: `caducado:${pi.id}` });

          const admin = clienteServicio();
          const { error: errCaducado } = await admin.from("pagos")
            .update({ estado: "reembolsado", reembolsado: pi.amount_received / 100 })
            .eq("proveedor_id", pi.id);
          // Si Stripe ya devolvió el dinero y esto no queda apuntado, la
          // base miente sobre un movimiento real. Que reviente y Stripe
          // reintente.
          if (errCaducado) throw errCaducado;

          if (pi.metadata.usuario_id) {
            await admin.from("notificaciones").insert({
              usuario_id: pi.metadata.usuario_id,
              tipo: "pago",
              titulo: "Te devolvimos el importe",
              cuerpo: "El horario que tenías apartado venció antes de completarse el pago, " +
                      "así que devolvimos el cargo íntegro. Puedes reservar de nuevo cuando quieras.",
            });
          }
        }
      }

      if (evento.type === "payment_intent.payment_failed") {
        const pi = evento.data.object as Stripe.PaymentIntent;
        const admin = clienteServicio();
        const { error: errFallo } = await admin.from("pagos")
          .update({ estado: "rechazado" }).eq("proveedor_id", pi.id);
        if (errFallo) throw errFallo;
      }

      if (evento.type === "charge.refunded") {
        const cargo = evento.data.object as Stripe.Charge;
        const admin = clienteServicio();

        // Devolver la mitad no es «reembolsado»: es «parcial». El enum
        // ya tiene ese estado y hay que usarlo, o la contabilidad dice
        // que se devolvió todo cuando se devolvió la mitad.
        const devuelto = cargo.amount_refunded / 100;
        const cobrado = cargo.amount / 100;
        const estado = devuelto >= cobrado ? "reembolsado" : "parcial";

        const { error: errRefund } = await admin.from("pagos")
          .update({ estado, reembolsado: devuelto })
          .eq("proveedor_id", cargo.payment_intent);
        if (errRefund) throw errRefund;
      }

      return respuesta({ recibido: true });
    } catch (e) {
      // 500 a propósito: Stripe reintenta y el evento no se pierde.
      console.error("[webhook] fallo al procesar", evento.type, e);
      return error(`no se pudo procesar el evento: ${e.message}`, 500);
    }
  }

  /* ---------- Crear intento de pago ---------- */
  try {
    const { usuario } = await requiereUsuario(req);
    const { accion, reserva_id, moneda = "mxn", descripcion = "", wallet } = await req.json();

    if (accion === "crear-intento") {
      const reserva = await reservaDelUsuario(reserva_id, usuario.id);
      const importe = centavos(reserva.total);

      // Una reserva, un PaymentIntent. Sin esto, cada recarga, cada
      // reintento por mala conexión y cada doble clic creaba otro
      // intento distinto para el mismo cobro.
      //
      // Se busca el que ya exista por metadata antes de crear nada. Si
      // sigue siendo utilizable se devuelve el mismo `client_secret`;
      // sólo si el importe cambió (se reprogramó la reserva) se
      // actualiza.
      const previos = await stripe.paymentIntents.search({
        query: `metadata['reserva_id']:'${reserva.id}'`,
        limit: 5,
      }).catch(() => ({ data: [] as any[] }));

      const reutilizable = (previos.data || []).find((p: any) =>
        ["requires_payment_method", "requires_confirmation", "requires_action", "processing"]
          .includes(p.status));

      if (reutilizable) {
        const intento = reutilizable.amount === importe
          ? reutilizable
          : await stripe.paymentIntents.update(reutilizable.id, { amount: importe });
        return respuesta({
          clientSecret: intento.client_secret,
          paymentIntentId: intento.id,
          reutilizado: true,
        });
      }

      // Si ya hay uno cobrado, no se crea otro: eso sería cobrar dos veces.
      const yaPagado = (previos.data || []).find((p: any) => p.status === "succeeded");
      if (yaPagado) {
        return respuesta({ yaPagado: true, paymentIntentId: yaPagado.id });
      }

      const intento = await stripe.paymentIntents.create({
        amount: importe,                        // importe real de la base, no el del cliente
        currency: String(reserva.moneda || moneda).toLowerCase(),
        // Sólo tarjeta, y a propósito.
        //
        // Con `automatic_payment_methods: { enabled: true }` quien decide
        // qué se ofrece es el panel de Stripe, no esta aplicación: el
        // Payment Element puede sacar carteras (Google Pay, Apple Pay,
        // Link) aunque en `config.js` estén desactivadas. Eso enseñaría
        // formas de pago que no se han probado ni configurado.
        //
        // Al fijarlo aquí, la lista deja de depender del panel.
        payment_method_types: ["card"],
        description: descripcion || `${reserva.espacios?.nombre ?? "Reserva"} · ${reserva.folio}`,
        receipt_email: usuario.email ?? undefined,
        metadata: {
          reserva_id: reserva.id, usuario_id: usuario.id,
          folio: reserva.folio ?? "", wallet: wallet ?? "",
        },
      }, {
        // Segunda red de seguridad: aunque dos peticiones lleguen a la
        // vez y las dos pasen la búsqueda de arriba, Stripe devuelve el
        // mismo intento en lugar de crear dos.
        idempotencyKey: `reserva:${reserva.id}:${importe}`,
      });

      return respuesta({ clientSecret: intento.client_secret, paymentIntentId: intento.id });
    }

    if (accion === "reembolsar") {
      const reserva = await reservaParaReembolso(reserva_id, usuario.id);
      const admin = clienteServicio();
      const { data: pago } = await admin.from("pagos")
        .select("id, proveedor_id, monto, reembolsado, estado")
        .eq("reserva_id", reserva.id).eq("estado", "aprobado").maybeSingle();
      if (!pago?.proveedor_id) return error("no hay pago que reembolsar", 404);

      // Sin `|| Number(pago.monto)`: con esa forma, un reembolso de 0
      // (cancelación fuera de plazo, sin derecho a devolución) caía al
      // segundo operando y devolvía el importe ENTERO. Cero significa
      // cero.
      const aDevolver = Number(reserva.monto_reembolso ?? 0);
      if (aDevolver <= 0) return respuesta({ reembolso: null, estado: "sin_reembolso" });

      // Si ya se devolvió una parte, sólo se manda el resto.
      const restante = Math.max(0, aDevolver - Number(pago.reembolsado || 0));
      if (restante <= 0) return respuesta({ reembolso: null, estado: "ya_reembolsado" });

      const reembolso = await stripe.refunds.create({
        payment_intent: pago.proveedor_id,
        amount: centavos(restante),
        metadata: { reserva_id: reserva.id, pago_id: pago.id },
      }, {
        // Doble clic en «cancelar» no puede devolver el dinero dos veces.
        idempotencyKey: `reembolso:${pago.id}:${centavos(restante)}`,
      });
      return respuesta({ reembolso: reembolso.id, estado: reembolso.status, monto: restante });
    }

    return error("acción desconocida", 400);
  } catch (e) {
    const status = e.message === "no_autorizado" ? 401 : 400;
    return error(e.message, status);
  }
});
