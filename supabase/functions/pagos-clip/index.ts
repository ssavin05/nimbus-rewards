/* ======================================================================
   pagos-clip — Cobro con Clip México (pasarela principal de Smart Hub).

   Secretos (nunca en el navegador):
     CLIP_API_KEY        llave de la aplicación creada en el panel de Clip
     CLIP_SECRET_KEY     su secreto (Clip lo enseña UNA sola vez)
     CLIP_COBROS_REALES  "si" para permitir crear cobros. Ver abajo.
     SITIO_URL           a dónde vuelve el cliente tras pagar

   Rutas:
     POST /pagos-clip            crea el checkout y devuelve la URL
     POST /pagos-clip/verificar  pregunta a Clip el estado y confirma
     POST /pagos-clip/webhook    Clip avisa; sólo dispara la verificación
     POST /pagos-clip/reembolso  devuelve total o parcialmente

   ──────────────────────────────────────────────────────────────────────
   AQUÍ NO HAY SANDBOX. NO EXISTE. TODO COBRO ES DINERO DE VERDAD.
   ──────────────────────────────────────────────────────────────────────
   Clip sí ofrece credenciales de prueba, pero su propia documentación
   acota para qué sirven: Checkout Transparente, la API de reembolsos y
   el SDK. Y cierra la lista sin ambigüedad —

       «Cualquier otra API que no se encuentre en esta lista no
        funcionará en el modo de prueba.»

   Checkout Redireccionado, que es el que usa esta función, NO está en
   esa lista. Tampoco hay un host de sandbox: la documentación publica un
   único destino, `https://api.payclip.com`, y son las credenciales las
   que distinguen.

   Consecuencia práctica, y por eso este bloque va antes que el código:
   no se puede «probar el cobro» de Checkout Redireccionado sin cobrar.
   La única validación de punta a punta posible es un cargo REAL de
   importe mínimo con credenciales REALES, comprobarlo en el panel de
   Clip y reembolsarlo. Eso lo decide el dueño, no el código.

   De ahí `CLIP_COBROS_REALES`. Mientras no valga "si", crear un checkout
   devuelve 503 y no se llama a Clip. No es una simulación —una
   simulación aquí sería mentir—: es un freno para que nadie encienda por
   accidente una pasarela que cobra de verdad. Lo que se puede probar sin
   él está en la suite de coherencia y en las pruebas SQL: que la reserva
   quede pendiente, que el webhook no confirme nada por sí solo, que el
   pago se registre una sola vez. Todo eso es estructura, y se dice
   estructura, no «pruebas de cobro».

   ──────────────────────────────────────────────────────────────────────
   LA DECISIÓN DE SEGURIDAD QUE MANDA SOBRE TODO LO DEMÁS
   ──────────────────────────────────────────────────────────────────────
   La documentación de Clip NO define ninguna firma para el webhook de
   checkout: ni cabecera, ni HMAC, ni secreto compartido. Un webhook sin
   firma es un endpoint público que cualquiera puede llamar. Si nos
   fiáramos de su contenido, bastaría con mandar

       POST /pagos-clip/webhook
       { "payment_request_id": "<el de otra persona>",
         "resource_status": "COMPLETED" }

   para confirmar una reserva sin haber pagado un peso.

   Por eso aquí el webhook NO confirma nada. Sólo dice «mira este
   identificador», y entonces el servidor le pregunta a Clip, con
   nuestras credenciales, cuál es el estado de verdad
   (GET /v2/checkout/{payment_request_id}). El cuerpo se ignora salvo por
   el identificador, y ni siquiera se cree que ese identificador sea
   nuestro hasta comprobar que existe en nuestra base.

   Con esto el peor abuso posible es obligarnos a hacer una consulta de
   más contra la API de Clip. Que alguien reserve gratis, no.
   ====================================================================== */
import {
  preflight, respuesta, error, clienteServicio, requiereUsuario,
  reservaDelUsuario, reservaParaReembolso, confirmarPago,
} from "../_compartido/utiles.ts";

/* Un único destino, el de producción. No hay otro: la documentación de
   Clip no publica ningún host de sandbox. Que esta constante no tenga
   hermana es la forma honesta de decirlo. */
const API = "https://api.payclip.com";

/* Rutas de Checkout Redireccionado, tal y como las publica Clip:
     POST https://api.payclip.com/v2/checkout
     GET  https://api.payclip.com/v2/checkout/{payment_request_id}
   Las dos van bajo /v2. Escribir la de consulta sin el prefijo la
   convierte en un 404 permanente: el cobro ocurre, la verificación
   falla, y ninguna reserva llega a confirmarse nunca. */
const CHECKOUT = "/v2/checkout";

/* Los reembolsos NO llevan /v2, y no es un descuido: Clip los publica en
   `POST https://api.payclip.com/refunds`. La mezcla de prefijos parece un
   error y no lo es —si alguien «arregla» esto poniéndole /v2, los
   reembolsos dejan de funcionar—.
   Nota aparte: la API de reembolsos SÍ está entre las que aceptan
   credenciales de prueba. La de checkout no. Por eso el freno de cobros
   sólo cubre la creación del checkout. */
const REEMBOLSOS = "/refunds";

const CLAVE = Deno.env.get("CLIP_API_KEY") ?? "";
const SECRETO = Deno.env.get("CLIP_SECRET_KEY") ?? "";
const SITIO = (Deno.env.get("SITIO_URL") ?? "").replace(/\/+$/, "");

/** Clip autentica con Basic base64(API_KEY:SECRET). */
const autorizacion = () => "Basic " + btoa(`${CLAVE}:${SECRETO}`);

const configurado = () => Boolean(CLAVE && SECRETO);
const sitioConfigurado = () => /^https:\/\/[^\s]+/i.test(SITIO);

/* Las credenciales de prueba de Clip llevan el prefijo `test_`. Con
   ellas, Checkout Redireccionado no funciona —no está entre las APIs que
   el modo de prueba soporta—, así que más vale decirlo con una frase
   clara que dejar que Clip conteste un 401 y parezca un fallo nuestro.
   Se mira el prefijo; el valor no se registra ni se devuelve jamás. */
const credencialDePruebas = () => CLAVE.startsWith("test_") || SECRETO.startsWith("test_");

/* El freno. Crear un checkout mueve dinero real, siempre, sin excepción
   ni modo seguro. Se enciende a mano y a conciencia. */
const cobrosPermitidos = () => (Deno.env.get("CLIP_COBROS_REALES") ?? "").toLowerCase() === "si";

async function clip(ruta: string, opciones: RequestInit = {}) {
  const r = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: {
      "Authorization": autorizacion(),
      "Content-Type": "application/json",
      "accept": "application/json",
      ...(opciones.headers ?? {}),
    },
  });
  const texto = await r.text();
  let cuerpo: Record<string, unknown> = {};
  try { cuerpo = texto ? JSON.parse(texto) : {}; } catch { cuerpo = { crudo: texto }; }
  if (!r.ok) {
    throw new Error(`Clip respondió ${r.status}: ${texto.slice(0, 300)}`);
  }
  return cuerpo;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const url = new URL(req.url);

  /* ================================================================
     ESTADO — diagnóstico seguro para el checkout.
     No expone ninguna credencial; sólo booleanos de preparación.
     ================================================================ */
  if (url.pathname.endsWith("/estado")) {
    const credencialesConfiguradas = configurado();
    const credencialesDePrueba = credencialesConfiguradas && credencialDePruebas();
    const sitioOk = sitioConfigurado();
    const cobrosOk = cobrosPermitidos();
    return respuesta({
      ok: true,
      credenciales_configuradas: credencialesConfiguradas,
      credenciales_de_prueba: credencialesDePrueba,
      sitio_configurado: sitioOk,
      cobros_habilitados: cobrosOk,
      listo: credencialesConfiguradas && !credencialesDePrueba && sitioOk && cobrosOk,
    });
  }

  if (!configurado()) {
    return error("clip_no_configurado", 501, {
      detalle: "Faltan CLIP_API_KEY y CLIP_SECRET_KEY en los secretos de Supabase",
    });
  }
  if (!sitioConfigurado()) {
    return error("clip_sitio_no_configurado", 501, {
      detalle: "Falta SITIO_URL con una URL pública https:// válida",
    });
  }

  /* ================================================================
     WEBHOOK — Clip avisa de que algo pasó.
     No se cree nada de lo que dice: se usa sólo el identificador.
     ================================================================ */
  if (url.pathname.endsWith("/webhook")) {
    let aviso: Record<string, unknown> = {};
    try { aviso = await req.json(); } catch { /* cuerpo ilegible: da igual */ }

    const id = String(aviso.payment_request_id ?? aviso.id ?? "");
    if (!id) {
      // 200 a propósito: si devolvemos error, Clip reintenta un aviso
      // que nunca vamos a poder usar.
      return respuesta({ recibido: true, ignorado: "sin payment_request_id" });
    }

    try {
      const r = await verificarYConfirmar(id);
      return respuesta({ recibido: true, ...r });
    } catch (e) {
      // 500 para que Clip reintente: el cobro puede ser real y no
      // haberse podido apuntar. Es el mismo criterio que en Stripe.
      console.error("[clip/webhook] fallo al verificar", id, e);
      return error(`no se pudo verificar: ${e.message}`, 500);
    }
  }

  /* ================================================================
     VERIFICAR — la app pregunta «¿ya pagó?» al volver de Clip.
     Misma comprobación que el webhook, iniciada por el cliente.
     ================================================================ */
  if (url.pathname.endsWith("/verificar")) {
    try {
      const { usuario } = await requiereUsuario(req);
      const { payment_request_id } = await req.json();
      if (!payment_request_id) return error("falta payment_request_id");

      // Que el pago sea de ESTA persona. Sin esto, cualquiera con sesión
      // podría sondear identificadores ajenos.
      const admin = clienteServicio();
      const { data: pago } = await admin.from("pagos")
        .select("usuario_id").eq("proveedor_id", payment_request_id).maybeSingle();
      if (pago && pago.usuario_id !== usuario.id) return error("no es tuyo", 403);

      const r = await verificarYConfirmar(String(payment_request_id), usuario.id);
      return respuesta(r);
    } catch (e) {
      return error(e.message, 400);
    }
  }

  /* ================================================================
     REEMBOLSO
     ================================================================ */
  if (url.pathname.endsWith("/reembolso")) {
    try {
      const { usuario } = await requiereUsuario(req);
      const { reserva_id, motivo } = await req.json();

      // La cantidad a devolver NUNCA viene del navegador. Antes este
      // endpoint aceptaba `monto` del cliente y, además, destructuraba
      // mal el resultado de reservaParaReembolso(); la ruta de Clip no
      // podía reembolsar correctamente y un cliente podía intentar
      // pedir más dinero del que la política de cancelación autorizaba.
      const reserva = await reservaParaReembolso(reserva_id, usuario.id);
      if (reserva.estado !== "cancelada") return error("la reserva todavía no está cancelada", 409);

      const admin = clienteServicio();
      const { data: pago, error: errLectura } = await admin.from("pagos")
        .select("id, metodo, monto, reembolsado, estado, respuesta, proveedor_id")
        .eq("reserva_id", reserva.id)
        .eq("metodo", "clip")
        .in("estado", ["aprobado", "parcial", "reembolsado"])
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (errLectura) throw errLectura;
      if (!pago) return error("no hay pago de Clip que reembolsar", 404);

      const autorizado = Math.max(0, Number(reserva.monto_reembolso ?? 0));
      const yaDevuelto = Math.max(0, Number(pago.reembolsado ?? 0));
      const importe = Math.max(0, autorizado - yaDevuelto);
      if (importe <= 0) {
        return respuesta({ ya: true, estado: pago.estado, reembolsado: yaDevuelto });
      }

      const respuestaPago = (pago.respuesta ?? {}) as Record<string, unknown>;
      const paymentId = String(respuestaPago.transaction_id ?? respuestaPago.payment_id ?? "");
      const receiptNo = String(respuestaPago.receipt_no ?? "");
      const referencia = paymentId
        ? { type: "payment", id: paymentId }
        : receiptNo
          ? { type: "receipt", id: receiptNo }
          : null;
      if (!referencia) {
        return error("el pago no tiene payment_id/transaction_id ni receipt_no de Clip", 409);
      }

      const devuelto = await clip(REEMBOLSOS, {
        method: "POST",
        headers: {
          // Clip soporta idempotency-key para POST /refunds. La clave es
          // estable para este pago + importe, así dos clics simultáneos no
          // disparan dos devoluciones durante la ventana del proveedor.
          "idempotency-key": `smarthub-${pago.id}-${Number(importe.toFixed(2))}`,
        },
        body: JSON.stringify({
          amount: Number(importe.toFixed(2)),
          reason: String(motivo ?? "Cancelación de reserva").slice(0, 250),
          reference: referencia,
        }),
      });

      const total = Number(pago.monto);
      const acumulado = Math.min(total, yaDevuelto + importe);
      const { error: errPago } = await admin.from("pagos")
        .update({
          estado: acumulado >= total ? "reembolsado" : "parcial",
          reembolsado: acumulado,
        })
        .eq("id", pago.id);
      if (errPago) throw errPago;

      return respuesta({ ok: true, reembolsado: acumulado, clip: devuelto, reserva: reserva.id });
    } catch (e) {
      return error(e.message, 400);
    }
  }

  /* ================================================================
     CREAR CHECKOUT — la única ruta que mueve dinero.

     Los dos frenos van ANTES de tocar la reserva: si el cobro no puede
     salir bien, no tiene sentido haber hecho nada.
     ================================================================ */
  if (credencialDePruebas()) {
    return error("clip_credenciales_de_prueba", 501, {
      detalle: "Checkout Redireccionado no funciona con credenciales de prueba de Clip: "
             + "el modo de prueba sólo cubre Checkout Transparente, la API de reembolsos "
             + "y el SDK. Para cobrar hacen falta las credenciales reales.",
    });
  }
  if (!cobrosPermitidos()) {
    return error("clip_cobros_no_habilitados", 503, {
      detalle: "Clip cobra dinero real y no tiene sandbox para esta API. "
             + "Para habilitarlo: haz una prueba de punta a punta con un cargo real de "
             + "importe mínimo, compruébalo en el panel de Clip, reembólsalo, y entonces "
             + "pon CLIP_COBROS_REALES=si en los secretos de Supabase (OWNER_ACTIONS §2).",
    });
  }

  try {
    const { usuario } = await requiereUsuario(req);
    const { reserva_id, descripcion } = await req.json();
    const reserva = await reservaDelUsuario(reserva_id, usuario.id);

    // El importe SIEMPRE sale de la base, nunca del navegador.
    const monto = Number(reserva.total);
    if (!(monto > 0)) return error("la reserva no tiene importe que cobrar", 409);

    /* El enlace de Clip caduca a la vez que el apartado. Si viviera más,
       alguien podría pagar un hueco que ya se liberó y que otra persona
       tiene reservado: cobro bueno, reserva imposible. Si vive menos,
       el enlace muere con el apartado todavía en pie. */
    const caduca = reserva.expira_en
      ? new Date(reserva.expira_en)
      : new Date(Date.now() + 15 * 60 * 1000);

    const volver = `${SITIO}/#/reservas/${reserva.id}`;
    const creado = await clip(CHECKOUT, {
      method: "POST",
      body: JSON.stringify({
        amount: Number(monto.toFixed(2)),
        currency: reserva.moneda ?? "MXN",
        purchase_description: String(descripcion ?? `Reserva ${reserva.folio ?? reserva.id}`).slice(0, 250),
        redirection_url: { success: volver, error: volver, default: volver },
        expires_at: caduca.toISOString().replace(/\.\d{3}Z$/, "Z"),
        webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/pagos-clip/webhook`,
        metadata: {
          external_reference: String(reserva.id),
          customer_info: { email: usuario.email ?? undefined },
        },
      }),
    });

    const idPago = String(creado.payment_request_id ?? "");
    if (!idPago) throw new Error("Clip no devolvió payment_request_id");

    /* Se apunta el intento como PENDIENTE. La reserva NO se confirma
       aquí: sólo la confirma la verificación contra Clip. */
    await confirmarPago({
      reservaId: reserva.id,
      usuarioId: usuario.id,
      metodo: "clip",
      estado: "pendiente",
      monto,
      moneda: reserva.moneda ?? "MXN",
      proveedorId: idPago,
      /* Antes esto guardaba `entorno: "pruebas"` en cada cobro. Era
         falso —Checkout Redireccionado sólo existe en producción— y
         además envenenaba la contabilidad del dueño: cargos reales
         etiquetados como pruebas. Lo que se apunta ahora es verdad. */
      respuesta: { payment_request_url: creado.payment_request_url, api: CHECKOUT, cobro_real: true },
    });

    return respuesta({
      payment_request_id: idPago,
      url: creado.payment_request_url,
      expira_en: creado.expired_at ?? caduca.toISOString(),
    });
  } catch (e) {
    return error(e.message, 400);
  }
});

/* ======================================================================
   El corazón: preguntarle a Clip, no creerle al webhook.
   ====================================================================== */
async function verificarYConfirmar(paymentRequestId: string, usuarioEsperado?: string) {
  const admin = clienteServicio();

  // 1. ¿Es un pago nuestro? Si no lo conocemos, no hay nada que hacer y
  //    tampoco damos pistas de si existe.
  const { data: pago, error: errLectura } = await admin.from("pagos")
    .select("id, reserva_id, usuario_id, monto, moneda, estado")
    .eq("proveedor_id", paymentRequestId).maybeSingle();
  if (errLectura) throw errLectura;
  if (!pago) return { conocido: false, estado: "desconocido" };
  if (usuarioEsperado && pago.usuario_id !== usuarioEsperado) {
    return { conocido: false, estado: "desconocido" };
  }

  // 2. La verdad la tiene Clip, y se la pedimos con NUESTRAS credenciales.
  //    GET https://api.payclip.com/v2/checkout/{payment_request_id}
  const estadoClip = await clip(`${CHECKOUT}/${encodeURIComponent(paymentRequestId)}`);
  const bruto = String(estadoClip.status ?? estadoClip.resource_status ?? "").toUpperCase();

  const pagado = bruto.includes("COMPLETED");
  const muerto = bruto.includes("CANCELLED") || bruto.includes("CANCELED") || bruto.includes("EXPIRED");

  if (pagado) {
    const montoClip = Number(estadoClip.amount);
    const monedaClip = String(estadoClip.currency ?? pago.moneda ?? "MXN").toUpperCase();
    const montoEsperado = Number(pago.monto);
    const monedaEsperada = String(pago.moneda ?? "MXN").toUpperCase();
    if (!Number.isFinite(montoClip) || Math.abs(montoClip - montoEsperado) > 0.009) {
      throw new Error("clip_importe_no_coincide");
    }
    if (monedaClip !== monedaEsperada) {
      throw new Error("clip_moneda_no_coincide");
    }
  }

  if (!pagado) {
    if (muerto) {
      await admin.from("pagos").update({ estado: "rechazado" }).eq("id", pago.id);
    }
    return { conocido: true, pagado: false, estado: bruto || "PENDING" };
  }

  // 3. Cobrado de verdad. Ahora sí se confirma —y confirmarPago decide si
  //    el apartado venció mientras tanto.
  const transaccion = estadoClip.transaction_id ?? estadoClip.payment_id ?? null;
  const recibo = estadoClip.receipt_no ?? null;
  const r = await confirmarPago({
    reservaId: pago.reserva_id,
    usuarioId: pago.usuario_id,
    metodo: "clip",
    estado: "aprobado",
    monto: Number(pago.monto),
    moneda: pago.moneda ?? "MXN",
    proveedorId: paymentRequestId,
    respuesta: {
      transaction_id: transaccion,
      payment_id: transaccion,
      receipt_no: recibo,
      status: bruto,
      api: CHECKOUT,
      cobro_real: true,
    },
  });

  /* El apartado caducó mientras la persona pagaba y el horario puede ser
     ya de otra. La reserva NO revive —eso sería una doble reserva—, así
     que se devuelve el dinero en el acto. Mismo criterio que en Stripe. */
  if (r?.caducada) {
    const referenciaCaducada = transaccion
      ? { type: "payment", id: String(transaccion) }
      : recibo
        ? { type: "receipt", id: String(recibo) }
        : null;
    if (referenciaCaducada) {
      await clip(REEMBOLSOS, {
        method: "POST",
        headers: { "idempotency-key": `smarthub-caducada-${pago.id}` },
        body: JSON.stringify({
          amount: Number(pago.monto),
          reason: "El apartado venció antes de completarse el pago",
          reference: referenciaCaducada,
        }),
      }).catch((e) => console.error("[clip] no se pudo reembolsar el apartado vencido", e));
    } else {
      console.error("[clip] pago completado sin identificador reembolsable", paymentRequestId);
    }
    const { error: errCaducado } = await admin.from("pagos")
      .update({ estado: "reembolsado", reembolsado: Number(pago.monto) })
      .eq("id", pago.id);
    if (errCaducado) throw errCaducado;

    await admin.from("notificaciones").insert({
      usuario_id: pago.usuario_id,
      tipo: "pago",
      titulo: "Te devolvimos el importe",
      cuerpo: "El horario que tenías apartado venció antes de completarse el pago, "
            + "así que devolvimos el cargo íntegro. Puedes reservar de nuevo cuando quieras.",
    });
    return { conocido: true, pagado: true, caducada: true, estado: "reembolsado" };
  }

  return { conocido: true, pagado: true, caducada: false, estado: "aprobado" };
}
