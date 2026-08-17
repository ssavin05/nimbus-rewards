/* ======================================================================
   favoritos.js — Espacios guardados por el usuario.
   ====================================================================== */
import { html, raw, isoFecha } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { vacio, toastOk, toastError } from "../core/ui.js";
import api from "../data/api.js";
import store from "../core/store.js";
import { tarjetaEspacio } from "./componentes.js";
import { on as onBus, EV } from "../core/bus.js";

export const titulo = () => t("favoritos.titulo");

let desuscribir = [];

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <div class="grid-auto" id="fav-lista">
          ${raw('<div class="esqueleto esq-tarjeta"></div>'.repeat(3))}
        </div>
      </div>
    </div>`;

  const [espacios, favoritos, disponibilidad] = await Promise.all([
    api.getEspacios(),
    api.getFavoritos(),
    api.getDisponibilidadMapa(isoFecha()).then((m) => m || {}).catch(() => ({})),
  ]);

  pintar(contenedor, espacios, disponibilidad);

  contenedor.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-fav]");
    if (!btn) return;
    e.preventDefault();
    try {
      await api.alternarFavorito(btn.dataset.fav);
      toastOk(t("favoritos.quitado"));
      pintar(contenedor, espacios, disponibilidad);
    } catch (err) { toastError(err.message); }
  });

  desuscribir.push(onBus(EV.FAVORITOS_CAMBIO, () => pintar(contenedor, espacios, disponibilidad)));
}

export function destruir() {
  desuscribir.forEach((f) => { try { f(); } catch { /* ignora */ } });
  desuscribir = [];
}

function pintar(contenedor, espacios, disponibilidad) {
  const favoritos = store.get().favoritos;
  const lista = espacios.filter((e) => favoritos.has(String(e.id)) && (e.portada || e.fotos?.some((f) => f?.url && !f?.es_360)));
  const cont = contenedor.querySelector("#fav-lista");
  cont.innerHTML = lista.length
    ? lista.map((e) => tarjetaEspacio(e, { disponibilidad: disponibilidad[e.id] })).join("")
    : vacio({
        ico: "💙", titulo: t("favoritos.vacio"), desc: t("favoritos.vacioDesc"),
        accion: `<a class="btn btn-primario" href="#/espacios">${t("home.verTodo")}</a>`,
      });
}
