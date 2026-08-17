/* ======================================================================
   mis-reservas.js — Historial de reservas con pestañas y lista de espera.
   ====================================================================== */
import { html, raw, esc } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { vacio, toastError } from "../core/ui.js";
import api from "../data/api.js";
import store from "../core/store.js";
import { tarjetaReserva } from "./componentes.js";
import { on as onBus, EV } from "../core/bus.js";

export const titulo = () => t("misReservas.titulo");

let pestana = "proximas";
let desuscribir = [];

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <div class="segmentado mb-4" role="tablist">
          <button type="button" data-tab="proximas" aria-pressed="true">${t("misReservas.proximas")}</button>
          <button type="button" data-tab="pasadas" aria-pressed="false">${t("misReservas.pasadas")}</button>
          <button type="button" data-tab="canceladas" aria-pressed="false">${t("misReservas.canceladas")}</button>
        </div>
        <div id="mr-espera"></div>
        <div id="mr-lista" class="col" style="gap:12px">
          ${raw('<div class="esqueleto esq-tarjeta" style="height:92px"></div>'.repeat(3))}
        </div>
      </div>
    </div>`;

  contenedor.querySelectorAll("[data-tab]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.tab === pestana));
  });

  await Promise.all([api.getMisReservas(), pintarListaEspera(contenedor)]);
  pintar(contenedor);

  contenedor.addEventListener("click", async (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      pestana = tab.dataset.tab;
      contenedor.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b === tab)));
      pintar(contenedor);
      return;
    }
    const salir = e.target.closest("[data-salir-espera]");
    if (salir) {
      try {
        await api.salirListaEspera(salir.dataset.salirEspera);
        await pintarListaEspera(contenedor);
      } catch (err) { toastError(err.message); }
    }
  });

  desuscribir.push(onBus(EV.RESERVA_CANCELADA, () => pintar(contenedor)));
  desuscribir.push(onBus(EV.RESERVA_CREADA, () => pintar(contenedor)));
}

export function destruir() {
  desuscribir.forEach((f) => { try { f(); } catch { /* ignora */ } });
  desuscribir = [];
}

function pintar(contenedor) {
  const lista = contenedor.querySelector("#mr-lista");
  const ahora = Date.now();
  const todas = store.get().reservas || [];

  let filtradas;
  if (pestana === "proximas") {
    filtradas = todas.filter((r) => r.estado !== "cancelada" && new Date(r.fin).getTime() > ahora)
      .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  } else if (pestana === "pasadas") {
    filtradas = todas.filter((r) => r.estado !== "cancelada" && new Date(r.fin).getTime() <= ahora)
      .sort((a, b) => new Date(b.inicio) - new Date(a.inicio));
  } else {
    filtradas = todas.filter((r) => r.estado === "cancelada")
      .sort((a, b) => new Date(b.inicio) - new Date(a.inicio));
  }

  if (!filtradas.length) {
    lista.innerHTML = vacio({
      ico: pestana === "canceladas" ? "🗑️" : pestana === "pasadas" ? "🕓" : "📅",
      titulo: pestana === "proximas" ? t("misReservas.vacio") : "Nada por aquí",
      desc: pestana === "proximas" ? t("misReservas.vacioDesc") : "",
      accion: pestana === "proximas" ? `<a class="btn btn-primario" href="#/espacios">${esc(t("home.reservarAhora"))}</a>` : "",
    });
    return;
  }
  lista.innerHTML = filtradas.map(tarjetaReserva).join("");
}

async function pintarListaEspera(contenedor) {
  const caja = contenedor.querySelector("#mr-espera");
  if (!caja) return;
  const filas = await api.getMiListaEspera().catch(() => []);
  if (!filas.length) { caja.innerHTML = ""; return; }

  caja.innerHTML = html`
    <section class="seccion">
      <h2 class="seccion-titulo">${raw(icono("campana", { size: 16 }))} En lista de espera</h2>
      <div class="lista tarjeta">
        ${filas.map((f) => raw(`<div class="lista-item">
          <span class="li-ico">${esc(f.espacios?.icono || "🏢")}</span>
          <span class="li-txt">
            <span class="li-titulo">${esc(f.espacios?.nombre || "Espacio")}</span>
            <span class="li-sub">${esc(f.fecha)}${f.bloque ? ` · ${esc(f.bloque)}` : " · cualquier horario"}</span>
          </span>
          <button type="button" class="btn btn-fantasma btn-sm" data-salir-espera="${esc(f.id)}">Quitar</button>
        </div>`))}
      </div>
    </section>`;
}
