/* ======================================================================
   clip.js — Cobro con Clip México, la pasarela principal.

   Flujo (todo el cobro ocurre en el servidor):

     1. La app pide a la Edge Function `pagos-clip` que cree un checkout.
        La función lee el importe DE LA BASE, no del navegador.
     2. Clip devuelve una URL y la persona se va a pagar allí.
     3. Al volver, la app llama a `/verificar`, que le pregunta a Clip
        —con nuestras credenciales— si el cobro ocurrió de verdad.
     4. Sólo entonces la reserva pasa de «pendiente» a «confirmada».

   ⚠️ Aquí NO hay ninguna credencial de Clip, y no puede haberla. La
   llave y el secreto viven en los secretos de Supabase. Este archivo
   sólo sabe llamar a una función del servidor y esperar su respuesta.

   Por qué la vuelta se verifica en vez de creerse:
   Clip no firma su webhook —no hay cabecera, ni HMAC, ni secreto
   compartido—, así que su aviso no demuestra nada por sí mismo. El
   servidor lo trata como un simple «mira este identificador» y va a
   preguntar. Lo mismo hace esta pantalla al volver de pagar, por si el
   aviso tarda o se pierde.

   ⚠️ Clip no tiene sandbox para este flujo. Checkout Redireccionado sólo
   existe contra producción —el modo de prueba de Clip cubre Checkout
   Transparente, reembolsos y el SDK, y nada más—, así que cada cobro que
   sale de aquí es dinero de verdad. Por eso el servidor lleva un freno
   aparte (CLIP_COBROS_REALES) y encender `enabled` aquí no basta.

   Configuración necesaria:
     • config.js  →  PAYMENTS.clip.enabled = true
     • Secretos de Supabase: CLIP_API_KEY, CLIP_SECRET_KEY, SITIO_URL
     • CLIP_COBROS_REALES=si, después de la prueba real (OWNER_ACTIONS §2)
   ====================================================================== */
import { PAYMENTS, SUPABASE } from "../core/config.js";
import { invocarFuncion } from "../data/db.js";
import { esc, formatMoneda } from "../core/utils.js";

export const id = "clip";

/* Clip vive entero en el servidor: si la Edge Function no está
   desplegada o le faltan secretos, el método no aparece. Lo comprueba el
   propio servidor —aquí sólo se mira la bandera— porque preguntar a la
   función en cada carga del checkout costaría una llamada de red antes
   de pintar nada. */
export async function disponible() {
  return Boolean(PAYMENTS.clip?.enabled);
}

/**
 * Comprueba que el servidor esté listo ANTES de crear el apartado.
 * Así un fallo de configuración de Clip no bloquea un horario durante
 * 15 minutos sólo porque alguien abrió la pantalla de pago.
 */
export async function preparar() {
  if (!PAYMENTS.clip?.enabled) throw new Error("El pago con Clip está desactivado.");
  try {
    // /estado sólo devuelve booleanos de preparación y no necesita sesión.
    // Se consulta con GET directo para evitar el preflight/autorización de
    // `functions.invoke`; el cobro real sí sigue usando la llamada autenticada.
    const urlEstado = `${SUPABASE.url.replace(/\/+$/, "")}/functions/v1/pagos-clip/estado`;
    const r = await fetch(urlEstado, { method: "GET", cache: "no-store" });
    if (!r.ok) throw new Error(`pagos-clip/estado respondió ${r.status}`);
    const estado = await r.json();
    if (estado?.listo) return estado;

    const faltan = [];
    if (!estado?.credenciales_configuradas) faltan.push("credenciales");
    if (estado?.credenciales_de_prueba) faltan.push("credenciales productivas");
    if (!estado?.sitio_configurado) faltan.push("URL pública");
    if (!estado?.cobros_habilitados) faltan.push("habilitación de cobros");

    console.error("[clip] servidor no listo:", estado);
    throw new Error(
      "El pago con Clip todavía no está habilitado" +
      (faltan.length ? ` (${faltan.join(", ")})` : "") + "."
    );
  } catch (e) {
    const m = String(e?.message || e);
    if (/todavía no está habilitado|está desactivado/i.test(m)) throw e;
    console.error("[clip] no se pudo consultar el estado de pagos-clip:", e);
    throw new Error("El pago con Clip no está disponible en este momento.");
  }
}

const CLAVE_PENDIENTE = "co.clip.pendiente";

/** Guarda el checkout en curso para poder verificarlo al volver. */
function recordar(datos) {
  try { sessionStorage.setItem(CLAVE_PENDIENTE, JSON.stringify(datos)); } catch { /* ignora */ }
}

export function pendienteGuardado() {
  try { return JSON.parse(sessionStorage.getItem(CLAVE_PENDIENTE) || "null"); }
  catch { return null; }
}

export function olvidarPendiente() {
  try { sessionStorage.removeItem(CLAVE_PENDIENTE); } catch { /* ignora */ }
}

/**
 * Pregunta al servidor si un checkout terminó en cobro.
 * Devuelve { pagado, estado, caducada } — nunca decide nada por su
 * cuenta: la respuesta viene de consultar a Clip desde el servidor.
 */
export async function verificar(paymentRequestId) {
  return invocarFuncion("pagos-clip/verificar", { payment_request_id: paymentRequestId });
}

export async function cobrar({ reserva, monto, moneda = "MXN", contenedor }) {
  contenedor.innerHTML = `
    <div class="clip-pago">
      <p class="texto-sm">
        Al continuar te llevamos a la página segura de <strong>Clip</strong> para
        pagar ${esc(formatMoneda(monto, moneda))}. Tus datos de tarjeta se capturan
        allí: no pasan por nosotros.
      </p>
      <p class="texto-sm texto-dim">
        Cuando termines volverás aquí solo. La reserva queda apartada mientras tanto
        y sólo se confirma cuando el cobro esté verificado.
      </p>
    </div>`;

  return {
    async confirmar() {
      let r;
      try {
        r = await invocarFuncion("pagos-clip", {
          reserva_id: reserva.id,
          descripcion: `Reserva ${reserva.folio || reserva.id}`,
        });
      } catch (e) {
        /* El freno del servidor y las credenciales de prueba son fallos
           de configuración del dueño, no de quien intenta pagar. Se le
           dice que ese método no está listo —no un error de pasarela que
           le haría reintentar— y el motivo real queda en la consola para
           quien administra. */
        const m = String(e?.message || e);
        if (m.includes("clip_cobros_no_habilitados") || m.includes("clip_credenciales_de_prueba")) {
          console.error("[clip] la función rechazó el cobro:", m);
          throw new Error("El pago con Clip todavía no está habilitado. Elige otro método.");
        }
        throw e;
      }
      if (!r?.url) throw new Error("Clip no devolvió el enlace de pago");

      recordar({
        payment_request_id: r.payment_request_id,
        reservaId: reserva.id,
        creado: Date.now(),
      });

      // Nos vamos a Clip. Esta promesa no llega a resolverse: el
      // documento se descarta al navegar. La confirmación de verdad la
      // hace `verificar()` cuando la persona vuelve.
      window.location.assign(r.url);

      // Por si el navegador bloquea la navegación, se devuelve un estado
      // honesto en vez de dejar la pantalla colgada para siempre.
      await new Promise((listo) => setTimeout(listo, 4000));
      return {
        estado: "pendiente",
        metodo: "clip",
        proveedorId: r.payment_request_id,
        respuesta: { redirigido: false, url: r.url },
      };
    },
    desmontar() { /* nada que desmontar: no montamos iframes ni scripts */ },
    textoBoton: `Pagar ${formatMoneda(monto, moneda)} con Clip`,
  };
}

export default { id, disponible, preparar, cobrar, verificar, pendienteGuardado, olvidarPendiente };
