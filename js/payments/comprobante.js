/* ======================================================================
   comprobante.js — Comprobantes de pago y solicitud de factura (CFDI).

   El comprobante se genera en el navegador (HTML imprimible → PDF con el
   diálogo de impresión del sistema), así que funciona sin ninguna
   dependencia ni servidor.

   La factura fiscal sí requiere un PAC: se envía la solicitud y la Edge
   Function `facturacion` hace el timbrado y devuelve XML + PDF.
   ====================================================================== */
import { esc, formatMoneda, fechaHora, fechaLarga } from "../core/utils.js";
import { APP, CONTACT, PAYMENTS, FEATURES } from "../core/config.js";
import store from "../core/store.js";
import { abrirHoja, toastOk, toastError, conCarga } from "../core/ui.js";
import api from "../data/api.js";

/** HTML del comprobante, listo para imprimir o guardar como PDF. */
export function comprobanteHtml(reserva, pago = null) {
  const org = store.get().organizacion || {};
  const espacio = reserva.espacios || store.getEspacio(reserva.espacio_id) || {};
  const perfil = store.get().perfil || {};
  const inicio = new Date(reserva.inicio);
  const fin = new Date(reserva.fin);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return `
  <article class="comprobante" id="comprobante">
    <header class="cp-cab">
      <div>
        <strong class="cp-marca">${esc(org.nombre || APP.name)}</strong>
        <div class="texto-xs texto-dim">${esc(CONTACT.direccion)}</div>
        ${[CONTACT.email, CONTACT.telefonoVisible].filter(Boolean).length ? `<div class="texto-xs texto-dim">${[CONTACT.email, CONTACT.telefonoVisible].filter(Boolean).map(esc).join(" · ")}</div>` : ""}
      </div>
      <div class="cp-folio">
        <span class="texto-xs texto-dim">Folio</span>
        <strong class="mono">${esc(reserva.folio || "—")}</strong>
      </div>
    </header>

    <h2 class="cp-titulo">Comprobante de reserva</h2>

    <div class="cp-grid">
      ${dato("Cliente", perfil.nombre || "—")}
      ${dato("Correo", perfil.email || "—")}
      ${dato("Espacio", `${espacio.nombre || "—"} (${espacio.codigo || "—"})`)}
      ${dato("Fecha", fechaLarga(inicio))}
      ${dato("Horario", `${hhmm(inicio)} – ${hhmm(fin)}`)}
      ${dato("Asistentes", String(reserva.asistentes || 1))}
      ${dato("Emitido", fechaHora(reserva.creado_en || new Date()))}
      ${dato("Estado", etiquetaEstado(reserva.estado))}
    </div>

    <table class="cp-tabla">
      <thead><tr><th>Concepto</th><th class="num">Importe</th></tr></thead>
      <tbody>
        <tr><td>Renta de espacio · ${esc(espacio.nombre || "")}</td><td class="num">${esc(formatMoneda(reserva.subtotal || 0))}</td></tr>
        ${Number(reserva.descuento) > 0 ? `<tr><td>Descuento</td><td class="num">−${esc(formatMoneda(reserva.descuento))}</td></tr>` : ""}
        <tr><td>IVA (${Math.round((Number(org.tasa_impuesto ?? PAYMENTS.taxRate)) * 100)} %)</td><td class="num">${esc(formatMoneda(reserva.impuestos || 0))}</td></tr>
      </tbody>
      <tfoot><tr><th>Total</th><th class="num">${esc(formatMoneda(reserva.total || 0))}</th></tr></tfoot>
    </table>

    ${pago ? `<div class="cp-pago">
      <span class="texto-sm texto-dim">Pagado con</span>
      <strong>${esc(nombreMetodo(pago.metodo))}${pago.ultimos4 ? ` ····${esc(pago.ultimos4)}` : ""}</strong>
      <span class="texto-xs texto-dim">${esc(pago.folio || pago.proveedor_id || "")}</span>
    </div>` : ""}

    <footer class="cp-pie">
      <p class="texto-xs texto-dim">
        Este comprobante no es un documento fiscal.${FEATURES.facturacion ? " La factura (CFDI) puede solicitarse desde la app cuando el pago es elegible." : " La facturación fiscal todavía no está habilitada en este despliegue."}
      </p>
      <p class="texto-xs texto-dim">${esc(APP.name)} · ${new Date().getFullYear()}</p>
    </footer>
  </article>`;
}

const dato = (k, v) => `<div class="cp-dato"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`;

function etiquetaEstado(e) {
  return { pendiente: "Pendiente de pago", confirmada: "Confirmada", en_curso: "En curso",
    completada: "Completada", cancelada: "Cancelada", no_asistio: "No asistió" }[e] || e;
}

function nombreMetodo(m) {
  return { clip: "Clip", stripe: "Tarjeta", mercadopago: "Mercado Pago", paypal: "PayPal",
    googlepay: "Google Pay", applepay: "Apple Pay", transferencia: "Transferencia SPEI",
    efectivo: "Efectivo", cortesia: "Cortesía" }[m] || m;
}

/** Abre el comprobante en una hoja con opciones de imprimir y compartir. */
export function verComprobante(reserva, pago = null) {
  const { el, cerrar } = abrirHoja({
    titulo: "Comprobante",
    contenido: comprobanteHtml(reserva, pago),
    pie: `
      <button type="button" class="btn btn-contorno" data-imprimir>Descargar PDF</button>
      ${FEATURES.facturacion ? '<button type="button" class="btn btn-primario" data-factura>Solicitar factura</button>' : ""}`,
  });

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-imprimir]")) imprimir(el.querySelector("#comprobante"));
    if (e.target.closest("[data-factura]")) { cerrar(); solicitarFactura(reserva); }
  });
}

/** Imprime sólo el comprobante, en una ventana aislada. */
export function imprimir(nodo) {
  const ventana = window.open("", "_blank", "width=820,height=1000");
  if (!ventana) { toastError("El navegador bloqueó la ventana de impresión."); return; }
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Comprobante</title>
    <style>
      body{font-family:Inter,system-ui,sans-serif;color:#0f172a;background:#fff;padding:32px;max-width:760px;margin:0 auto}
      .cp-cab{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0ea5e9;padding-bottom:14px;margin-bottom:20px}
      .cp-marca{font-size:19px;font-weight:700;display:block}
      .cp-folio{text-align:right}.cp-folio strong{font-size:16px;display:block}
      .cp-titulo{font-size:22px;margin:0 0 18px}
      .cp-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:22px}
      .cp-dato{display:flex;flex-direction:column;gap:2px}
      .cp-dato span{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
      .cp-tabla{width:100%;border-collapse:collapse;margin-bottom:20px}
      .cp-tabla th,.cp-tabla td{padding:9px 6px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:14px}
      .cp-tabla .num{text-align:right;font-variant-numeric:tabular-nums}
      .cp-tabla tfoot th{border-top:2px solid #0f172a;border-bottom:0;font-size:16px}
      .cp-pago{background:#f1f5f9;padding:12px 14px;border-radius:10px;margin-bottom:18px;display:flex;flex-direction:column;gap:2px}
      .texto-xs{font-size:11px}.texto-sm{font-size:13px}.texto-dim{color:#64748b}
      .cp-pie{border-top:1px solid #e2e8f0;padding-top:12px}
      @page{margin:16mm}
    </style></head><body>${nodo.outerHTML}</body></html>`);
  ventana.document.close();
  ventana.focus();
  setTimeout(() => { ventana.print(); }, 350);
}

/* ---------------------------------------------------------------------
   Factura (CFDI 4.0)
   --------------------------------------------------------------------- */
const USOS_CFDI = [
  ["G03", "G03 · Gastos en general"],
  ["G01", "G01 · Adquisición de mercancías"],
  ["D10", "D10 · Pagos por servicios educativos"],
  ["P01", "P01 · Por definir"],
  ["S01", "S01 · Sin efectos fiscales"],
];

const REGIMENES = [
  ["601", "601 · General de Ley Personas Morales"],
  ["603", "603 · Personas Morales con Fines no Lucrativos"],
  ["605", "605 · Sueldos y Salarios"],
  ["612", "612 · Personas Físicas con Actividades Empresariales"],
  ["616", "616 · Sin obligaciones fiscales"],
  ["626", "626 · Régimen Simplificado de Confianza"],
];

export function solicitarFactura(reserva) {
  if (!FEATURES.facturacion) {
    toastError("La facturación todavía no está habilitada.");
    return;
  }
  const perfil = store.get().perfil || {};
  const fiscal = perfil.datos_facturacion || {};

  const { el, cerrar } = abrirHoja({
    titulo: "Solicitar factura (CFDI)",
    contenido: `
      <div class="campo"><label for="fa-rfc">RFC</label>
        <input id="fa-rfc" type="text" value="${esc(fiscal.rfc || perfil.rfc || "")}" placeholder="XAXX010101000"
               maxlength="13" style="text-transform:uppercase" required></div>
      <div class="campo"><label for="fa-razon">Razón social</label>
        <input id="fa-razon" type="text" value="${esc(fiscal.razon_social || perfil.empresa || "")}" placeholder="Mi Empresa S.A. de C.V." required></div>
      <div class="campo"><label for="fa-cp">Código postal fiscal</label>
        <input id="fa-cp" type="text" value="${esc(fiscal.codigo_postal || "")}" placeholder="22800" maxlength="5" inputmode="numeric" required></div>
      <div class="campo"><label for="fa-regimen">Régimen fiscal</label>
        <select id="fa-regimen">${REGIMENES.map(([v, txt]) =>
          `<option value="${v}" ${fiscal.regimen_fiscal === v ? "selected" : ""}>${esc(txt)}</option>`).join("")}</select></div>
      <div class="campo"><label for="fa-uso">Uso del CFDI</label>
        <select id="fa-uso">${USOS_CFDI.map(([v, txt]) =>
          `<option value="${v}" ${fiscal.uso_cfdi === v ? "selected" : ""}>${esc(txt)}</option>`).join("")}</select></div>
      <div class="campo"><label for="fa-email">Correo para recibirla</label>
        <input id="fa-email" type="email" value="${esc(fiscal.email || perfil.email || "")}" required></div>
      <label class="switch"><input type="checkbox" id="fa-guardar" checked>
        <span class="switch-pista"></span><span class="texto-sm">Guardar estos datos para próximas facturas</span></label>`,
    pie: `
      <button type="button" class="btn btn-contorno" data-cancelar>Cancelar</button>
      <button type="button" class="btn btn-primario" data-enviar>Solicitar</button>`,
  });

  el.querySelector("[data-cancelar]").addEventListener("click", () => cerrar());
  el.querySelector("[data-enviar]").addEventListener("click", async (ev) => {
    const rfc = el.querySelector("#fa-rfc").value.trim().toUpperCase();
    const razon = el.querySelector("#fa-razon").value.trim();
    const cp = el.querySelector("#fa-cp").value.trim();
    const email = el.querySelector("#fa-email").value.trim();

    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) return toastError("El RFC no tiene un formato válido.");
    if (!razon) return toastError("Falta la razón social.");
    if (!/^\d{5}$/.test(cp)) return toastError("El código postal debe tener 5 dígitos.");

    const datos = {
      pago_id: reserva.pagos?.[0]?.id || null,
      rfc, razon_social: razon, codigo_postal: cp, email,
      regimen_fiscal: el.querySelector("#fa-regimen").value,
      uso_cfdi: el.querySelector("#fa-uso").value,
      subtotal: reserva.subtotal, impuestos: reserva.impuestos, total: reserva.total,
    };

    try {
      await conCarga(ev.currentTarget, api.solicitarFactura(datos));
      if (el.querySelector("#fa-guardar").checked) {
        await api.actualizarPerfil({ rfc, datos_facturacion: datos }).catch(() => {});
      }
      cerrar();
      toastOk("Solicitud de factura enviada.");
    } catch (e) {
      toastError(e.message);
    }
  });
}

export default { comprobanteHtml, verComprobante, imprimir, solicitarFactura };
