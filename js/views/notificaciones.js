/* ======================================================================
   notificaciones.js — Bandeja de avisos: recordatorios, cambios de
   reserva, lista de espera y promociones.
   ====================================================================== */
import { html, raw, esc, tiempoRelativo } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { vacio, toastOk } from "../core/ui.js";
import { ir } from "../core/router.js";
import api from "../data/api.js";
import store from "../core/store.js";
import { on as onBus, EV } from "../core/bus.js";

export const titulo = () => t("config.notificaciones");

let desuscribir = [];

const ICONO_TIPO = {
  reserva: "calendario", recordatorio: "reloj", pago: "tarjeta",
  promo: "promo", espera: "campana", info: "info",
};

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <div class="fila-sep mb-4">
          <span class="texto-sm texto-dim" id="nt-conteo"></span>
          <button type="button" class="btn btn-fantasma btn-sm" data-todas>Marcar todas como leídas</button>
        </div>
        <div id="nt-lista" class="lista tarjeta">
          ${raw('<div class="esqueleto esq-linea" style="height:56px;margin:8px"></div>'.repeat(4))}
        </div>
      </div>
    </div>`;

  await api.getNotificaciones();
  pintar(contenedor);

  contenedor.addEventListener("click", async (e) => {
    if (e.target.closest("[data-todas]")) {
      await api.marcarTodasLeidas();
      toastOk("Listo");
      pintar(contenedor);
      return;
    }
    const item = e.target.closest("[data-notif]");
    if (item) {
      const id = item.dataset.notif;
      const n = store.get().notificaciones.find((x) => String(x.id) === id);
      if (n && !n.leida) await api.marcarNotificacionLeida(id);
      if (n?.enlace) ir(n.enlace);
      else pintar(contenedor);
    }
  });

  desuscribir.push(onBus(EV.NOTIFICACION, () => pintar(contenedor)));
}

export function destruir() {
  desuscribir.forEach((f) => { try { f(); } catch { /* ignora */ } });
  desuscribir = [];
}

function pintar(contenedor) {
  const lista = store.get().notificaciones || [];
  const cont = contenedor.querySelector("#nt-lista");
  const conteo = contenedor.querySelector("#nt-conteo");
  const noLeidas = lista.filter((n) => !n.leida).length;
  conteo.textContent = noLeidas ? `${noLeidas} sin leer` : "Todo al día";

  if (!lista.length) {
    cont.className = "";
    cont.innerHTML = vacio({
      ico: "🔔", titulo: "Sin notificaciones",
      desc: "Aquí verás recordatorios de tus reservas y avisos de la administración.",
    });
    return;
  }
  cont.className = "lista tarjeta";
  cont.innerHTML = lista.map((n) => html`
    <button type="button" class="lista-item${raw(n.leida ? "" : " no-leida")}" data-notif="${n.id}">
      <span class="li-ico">${raw(icono(ICONO_TIPO[n.tipo] || "info", { size: 17 }))}</span>
      <span class="li-txt">
        <span class="li-titulo">${n.titulo}</span>
        <span class="li-sub">${n.cuerpo || ""}</span>
        <span class="texto-xs texto-suave">${tiempoRelativo(n.creado_en)}</span>
      </span>
      <span class="li-fin">${n.leida ? "" : raw('<i class="punto punto-ok"></i>')}</span>
    </button>`).join("");
}
