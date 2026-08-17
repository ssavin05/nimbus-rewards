/* ======================================================================
   pagos.js — Historial de pagos y facturas.
   ====================================================================== */
import { html, raw, esc, formatMoneda, fechaHora, urlSegura } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { vacio, toastError } from "../core/ui.js";
import api from "../data/api.js";
import { verComprobante } from "../payments/comprobante.js";
import { FEATURES } from "../core/config.js";

export const titulo = () => t("pago.historial");

const CLASE = { aprobado: "ok", pendiente: "warm", procesando: "warm", rechazado: "taken", reembolsado: "neutro", parcial: "warm" };
const METODO = {
  clip: "Clip", stripe: "Tarjeta", mercadopago: "Mercado Pago", paypal: "PayPal", googlepay: "Google Pay",
  applepay: "Apple Pay", transferencia: "Transferencia", efectivo: "Efectivo", cortesia: "Cortesía",
};

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        ${FEATURES.facturacion ? raw(`<div class="segmentado mb-4">
          <button type="button" data-tab="pagos" aria-pressed="true">Pagos</button>
          <button type="button" data-tab="facturas" aria-pressed="false">Facturas</button>
        </div>`) : ""}
        <div id="pg-cont">${raw('<div class="esqueleto esq-linea" style="height:60px;margin-bottom:10px"></div>'.repeat(3))}</div>
      </div>
    </div>`;

  const [pagos, facturas] = await Promise.all([
    api.getPagos().catch(() => []),
    FEATURES.facturacion ? api.getFacturas().catch(() => []) : Promise.resolve([]),
  ]);

  pintarPagos(contenedor, pagos);

  contenedor.addEventListener("click", async (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      contenedor.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b === tab)));
      if (tab.dataset.tab === "pagos") pintarPagos(contenedor, pagos);
      else pintarFacturas(contenedor, facturas);
      return;
    }
    const rec = e.target.closest("[data-recibo]");
    if (rec) {
      const pago = pagos.find((p) => String(p.id) === rec.dataset.recibo);
      if (!pago) return;
      const reserva = await api.getReserva(pago.reserva_id);
      if (reserva) verComprobante(reserva, pago);
      else toastError("No encontramos la reserva asociada.");
    }
  });
}

function pintarPagos(contenedor, pagos) {
  const cont = contenedor.querySelector("#pg-cont");
  if (!pagos.length) {
    cont.innerHTML = vacio({ ico: "🧾", titulo: "Sin pagos todavía", desc: "Aquí aparecerán tus pagos con su comprobante." });
    return;
  }
  cont.innerHTML = `<div class="lista tarjeta">${pagos.map((p) => html`
    <div class="lista-item">
      <span class="li-ico">${raw(icono("tarjeta", { size: 17 }))}</span>
      <span class="li-txt">
        <span class="li-titulo">${p.reservas?.espacios?.nombre || "Reserva"}</span>
        <span class="li-sub">${METODO[p.metodo] || p.metodo}${p.ultimos4 ? ` ····${p.ultimos4}` : ""} · ${fechaHora(p.creado_en)}</span>
        <span class="mono texto-xs texto-suave">${p.folio || ""}</span>
      </span>
      <span class="li-fin col" style="align-items:flex-end;gap:4px">
        <strong class="mono">${formatMoneda(p.monto)}</strong>
        <span class="chip chip-${raw(CLASE[p.estado] || "neutro")}">${p.estado}</span>
        <button type="button" class="btn btn-fantasma btn-sm" data-recibo="${p.id}">Recibo</button>
      </span>
    </div>`).join("")}</div>`;
}

function pintarFacturas(contenedor, facturas) {
  const cont = contenedor.querySelector("#pg-cont");
  if (!facturas.length) {
    cont.innerHTML = vacio({
      ico: "📄", titulo: "Sin facturas",
      desc: "Puedes solicitar factura desde el detalle de cualquier reserva pagada.",
    });
    return;
  }
  cont.innerHTML = `<div class="lista tarjeta">${facturas.map((f) => html`
    <div class="lista-item">
      <span class="li-ico">${raw(icono("recibo", { size: 17 }))}</span>
      <span class="li-txt">
        <span class="li-titulo">${f.razon_social}</span>
        <span class="li-sub">${f.rfc} · ${fechaHora(f.creado_en)}</span>
        <span class="mono texto-xs texto-suave">${f.folio || ""}${f.uuid_fiscal ? ` · ${f.uuid_fiscal.slice(0, 8)}…` : ""}</span>
      </span>
      <span class="li-fin col" style="align-items:flex-end;gap:4px">
        <strong class="mono">${formatMoneda(f.total)}</strong>
        <span class="chip chip-${raw(f.estado === "timbrada" ? "ok" : f.estado === "error" ? "taken" : "warm")}">${f.estado}</span>
        ${urlSegura(f.pdf_url) ? raw(`<a class="btn btn-fantasma btn-sm" href="${esc(urlSegura(f.pdf_url))}" target="_blank" rel="noopener noreferrer">PDF</a>`) : ""}
      </span>
    </div>`).join("")}</div>`;
}
