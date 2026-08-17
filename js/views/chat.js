/* ======================================================================
   chat.js — Conversación con la administración, en tiempo real.
   ====================================================================== */
import { html, raw, esc, fechaHora, uuid } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { toastError, vacio } from "../core/ui.js";
import { vibrar } from "../core/haptics.js";
import api from "../data/api.js";
import store from "../core/store.js";
import { CONTACT } from "../core/config.js";
import { on as onBus, EV } from "../core/bus.js";

export const titulo = () => t("ayuda.chat");
export const nav = false;

let conversacion = null;
let mensajes = [];
let desuscribir = [];

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="chat-vista">
      <div class="chat-cab">
        <span class="avatar avatar-sm" style="background:var(--marca);color:#fff">🛎️</span>
        <div class="crece">
          <strong>Administración</strong>
          <div class="texto-xs texto-dim">${CONTACT.horarioAtencion ? esc(CONTACT.horarioAtencion) : "Chat de la app"}</div>
        </div>
        ${CONTACT.whatsapp ? raw(`<a class="btn btn-fantasma btn-icono btn-sm" href="https://wa.me/${esc(CONTACT.whatsapp)}"
           target="_blank" rel="noopener" aria-label="WhatsApp">${icono("whatsapp", { size: 18 })}</a>`) : ""}
        ${CONTACT.telefono ? raw(`<a class="btn btn-fantasma btn-icono btn-sm" href="tel:${esc(CONTACT.telefono)}"
           aria-label="Llamar">${icono("telefono", { size: 18 })}</a>`) : ""}
      </div>

      <div class="chat-hilo" id="ct-hilo">
        <div class="cargando-centro"><div class="spinner"></div></div>
      </div>

      <form class="chat-barra" id="ct-form">
        <input id="ct-input" type="text" placeholder="${t("chat.escribe")}" autocomplete="off" enterkeyhint="send">
        <button type="submit" class="btn btn-primario btn-icono" aria-label="${t("chat.enviar")}">
          ${raw(icono("adelante", { size: 18 }))}
        </button>
      </form>
    </div>`;

  try {
    conversacion = await api.getConversacion();
    mensajes = conversacion ? await api.getMensajes(conversacion.id) : [];
  } catch (e) {
    console.warn("[chat]", e);
  }
  pintar(contenedor);

  contenedor.querySelector("#ct-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = contenedor.querySelector("#ct-input");
    const texto = input.value.trim();
    if (!texto) return;
    input.value = "";

    const provisional = {
      id: uuid(), cuerpo: texto, es_staff: false, es_ia: false,
      creado_en: new Date().toISOString(), provisional: true,
    };
    mensajes.push(provisional);
    pintar(contenedor);
    vibrar("toque");

    try {
      if (!conversacion) conversacion = await api.getConversacion();
      const guardado = await api.enviarMensaje(conversacion.id, texto);
      mensajes = mensajes.map((m) => (m.id === provisional.id ? guardado : m));
    } catch (err) {
      mensajes = mensajes.map((m) => (m.id === provisional.id ? { ...m, error: true } : m));
      toastError(err.message);
    }
    pintar(contenedor);
  });

  desuscribir.push(onBus(EV.CHAT_MENSAJE, (m) => {
    if (!conversacion || m.conversacion_id !== conversacion.id) return;
    if (mensajes.some((x) => x.id === m.id)) return;
    mensajes.push(m);
    pintar(contenedor);
    if (m.es_staff) vibrar("seleccion");
  }));
}

export function destruir() {
  desuscribir.forEach((f) => { try { f(); } catch { /* ignora */ } });
  desuscribir = [];
}

function pintar(contenedor) {
  const hilo = contenedor.querySelector("#ct-hilo");
  if (!mensajes.length) {
    hilo.innerHTML = vacio({
      ico: "💬", titulo: "Empieza la conversación",
      desc: t("chat.sinMensajes"),
    });
    return;
  }
  hilo.innerHTML = mensajes.map((m) => {
    const propio = !m.es_staff && !m.es_ia;
    return `<div class="burbuja-grupo${propio ? " propio" : ""}">
      <div class="burbuja ${propio ? "usuario" : "ia"}${m.error ? " error" : ""}">${esc(m.cuerpo)}</div>
      <span class="burbuja-hora">${m.provisional ? "enviando…" : esc(fechaHora(m.creado_en))}${m.error ? " · no enviado" : ""}</span>
    </div>`;
  }).join("");
  hilo.scrollTop = hilo.scrollHeight;
}
