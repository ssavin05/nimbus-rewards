/* ======================================================================
   asistente.js (vista) — Chat con el asistente virtual.
   ====================================================================== */
import { html, raw, esc, uuid, urlSegura } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { ir } from "../core/router.js";
import { rutaInterna } from "../core/utils.js";
import { vibrar } from "../core/haptics.js";
import { responder, SUGERENCIAS } from "../ai/asistente.js";
import { tarjetaEspacio } from "./componentes.js";
import { toastError } from "../core/ui.js";

export const titulo = () => t("ayuda.asistente");
export const nav = false;

let historial = [];

export function render(contenedor, ctx) {
  const consultaInicial = ctx?.query?.get("q") || "";
  historial = [{ id: uuid(), rol: "ia", texto: t("chat.ia.saludo") }];

  contenedor.innerHTML = html`
    <div class="chat-vista">
      <div class="chat-hilo" id="ch-hilo"></div>

      <div class="chat-sugerencias" id="ch-sug">
        ${SUGERENCIAS.map((s) => raw(`<button type="button" class="chip" data-sug="${esc(s)}">${esc(s)}</button>`))}
      </div>

      <form class="chat-barra" id="ch-form">
        <input id="ch-input" type="text" placeholder="${t("chat.escribe")}" autocomplete="off" enterkeyhint="send">
        <button type="submit" class="btn btn-primario btn-icono" aria-label="${t("chat.enviar")}">
          ${raw(icono("adelante", { size: 18 }))}
        </button>
      </form>
    </div>`;

  pintar(contenedor);

  contenedor.querySelector("#ch-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = contenedor.querySelector("#ch-input");
    const texto = input.value.trim();
    if (!texto) return;
    input.value = "";
    enviar(contenedor, texto);
  });

  contenedor.addEventListener("click", (e) => {
    const sug = e.target.closest("[data-sug]");
    if (sug) return enviar(contenedor, sug.dataset.sug);

    const accion = e.target.closest("[data-accion-ruta]");
    if (accion) return ir(rutaInterna(accion.dataset.accionRuta));

    const enviarAccion = e.target.closest("[data-accion-enviar]");
    if (enviarAccion) return enviar(contenedor, enviarAccion.dataset.accionEnviar);
  });

  if (consultaInicial) setTimeout(() => enviar(contenedor, consultaInicial), 300);
}

export function destruir() { historial = []; }

async function enviar(contenedor, texto) {
  vibrar("toque");
  historial.push({ id: uuid(), rol: "usuario", texto });
  historial.push({ id: "escribiendo", rol: "ia", escribiendo: true });
  contenedor.querySelector("#ch-sug").hidden = true;
  pintar(contenedor);

  try {
    const respuesta = await responder(texto, historial.filter((m) => !m.escribiendo));
    historial = historial.filter((m) => m.id !== "escribiendo");
    historial.push({
      id: uuid(), rol: "ia", texto: respuesta.texto,
      espacios: respuesta.espacios, acciones: respuesta.acciones, fuente: respuesta.fuente,
    });
  } catch (e) {
    historial = historial.filter((m) => m.id !== "escribiendo");
    historial.push({ id: uuid(), rol: "ia", texto: "Ups, algo falló al procesar tu mensaje. ¿Lo intentamos de nuevo?" });
    toastError(e.message);
  }
  pintar(contenedor);
}

function pintar(contenedor) {
  const hilo = contenedor.querySelector("#ch-hilo");
  hilo.innerHTML = historial.map((m) => {
    if (m.escribiendo) {
      return `<div class="burbuja ia escribiendo"><span></span><span></span><span></span></div>`;
    }
    if (m.rol === "usuario") {
      return `<div class="burbuja usuario">${esc(m.texto)}</div>`;
    }
    const espacios = (m.espacios || []).length
      ? `<div class="chat-espacios">${m.espacios.map((e) => tarjetaEspacio(e, { compacta: true, mostrarFavorito: false })).join("")}</div>`
      : "";
    const acciones = (m.acciones || []).length
      ? `<div class="chat-acciones">${m.acciones.map((a) => {
          // Las acciones llegan del servidor de IA: no se confía en ellas.
          const u = urlSegura(a.url);
          if (u) return `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(a.texto)}</a>`;
          if (a.ruta) return `<button type="button" class="chip" data-accion-ruta="${esc(rutaInterna(a.ruta))}">${esc(a.texto)}</button>`;
          return `<button type="button" class="chip" data-accion-enviar="${esc(a.enviar || a.texto)}">${esc(a.texto)}</button>`;
        }).join("")}</div>`
      : "";
    return `<div class="burbuja-grupo">
      <div class="burbuja ia">${formatear(m.texto)}</div>
      ${espacios}${acciones}
    </div>`;
  }).join("");
  hilo.scrollTop = hilo.scrollHeight;
}

/** Markdown mínimo: negritas y saltos de línea, todo escapado antes. */
function formatear(texto) {
  return esc(texto)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}
