/* ======================================================================
   ui.js — Kit de interacción: avisos (toasts), hojas inferiores,
   diálogos de confirmación, estados de carga y feedback visual.
   Todo depende sólo del DOM + tokens CSS.
   ====================================================================== */
import { esc, html, raw } from "./utils.js";
import { t } from "./i18n.js";
import { vibrar } from "./haptics.js";
import { icono } from "./iconos.js";

/* ---------------------------------------------------------------------
   Helpers de DOM
   --------------------------------------------------------------------- */
export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** ¿Es una cadena o un fragmento HTML marcado como seguro por `html`/`raw`? */
const esTexto = (v) => typeof v === "string" || (v && v.__raw === true);

export function crear(tag, props = {}, hijos = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "clase") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "texto") el.textContent = v;
    else if (k === "estilo") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && v !== false) el.setAttribute(k, v === true ? "" : v);
  }
  for (const h of [].concat(hijos)) if (h) el.append(h);
  return el;
}

/** Delegación de eventos: on(raiz, "click", "[data-id]", handler) */
export function on(raiz, evento, selector, handler) {
  const fn = (e) => {
    const objetivo = e.target.closest(selector);
    if (objetivo && raiz.contains(objetivo)) handler(e, objetivo);
  };
  raiz.addEventListener(evento, fn);
  return () => raiz.removeEventListener(evento, fn);
}

/* ---------------------------------------------------------------------
   Avisos (toasts)
   --------------------------------------------------------------------- */
function contenedorToasts() {
  let c = document.getElementById("toasts");
  if (!c) {
    c = crear("div", { id: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(c);
  }
  return c;
}

const ICONO_TOAST = { ok: "✓", error: "✕", warm: "!", info: "i" };

/**
 * toast("Guardado")                       -> neutro
 * toast("Listo", { tipo: "ok" })
 * toast("Sin conexión", { tipo:"error", accion:{ texto:"Reintentar", fn } })
 */
export function toast(mensaje, { tipo = "info", ms = 3200, accion = null } = {}) {
  const c = contenedorToasts();
  const el = crear("div", { clase: `toast toast-${tipo}` });
  el.innerHTML = html`
    <span class="toast-ico" aria-hidden="true">${ICONO_TOAST[tipo] || "•"}</span>
    <span class="toast-txt">${mensaje}</span>
  `;
  if (accion?.texto) {
    const btn = crear("button", { clase: "toast-accion", type: "button", texto: accion.texto });
    btn.addEventListener("click", () => { cerrar(); accion.fn?.(); });
    el.append(btn);
  }
  c.append(el);
  if (tipo === "ok") vibrar("exito");
  else if (tipo === "error") vibrar("error");
  else vibrar("toque");

  let temporizador = ms > 0 ? setTimeout(cerrar, ms) : null;
  function cerrar() {
    clearTimeout(temporizador);
    el.classList.add("saliendo");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }
  el.addEventListener("click", (e) => { if (!e.target.closest(".toast-accion")) cerrar(); });
  return cerrar;
}

export const toastOk = (m, o) => toast(m, { ...o, tipo: "ok" });
export const toastError = (m, o) => toast(m, { ...o, tipo: "error", ms: 4600 });

/* ---------------------------------------------------------------------
   Hoja inferior / modal
   --------------------------------------------------------------------- */
let pilaHojas = [];

/**
 * abrirHoja({ titulo, contenido, pie, centrado, alCerrar, arrastrable })
 * `contenido` puede ser HTML (string) o un HTMLElement.
 * Devuelve { el, cerrar, cuerpo }.
 */
export function abrirHoja({
  titulo = "", contenido = "", pie = "", centrado = false,
  alCerrar = null, cerrable = true, ancho = null, clase = "",
} = {}) {
  const velo = crear("div", { clase: "velo", "data-centrado": String(centrado), role: "dialog", "aria-modal": "true" });
  const hoja = crear("div", { clase: `hoja ${clase}`.trim() });
  if (ancho) hoja.style.maxWidth = ancho;

  if (!centrado) hoja.append(crear("div", { clase: "hoja-agarre", "aria-hidden": "true" }));

  if (titulo || cerrable) {
    const cab = crear("div", { clase: "hoja-cab" });
    cab.innerHTML = html`<h2>${titulo}</h2>`;
    if (cerrable) {
      const x = crear("button", {
        clase: "btn btn-fantasma btn-icono btn-sm", type: "button",
        "aria-label": t("app.cerrar"), html: icono("cerrar", { size: 18 }),
      });
      x.addEventListener("click", () => cerrar());
      cab.append(x);
    }
    hoja.append(cab);
  }

  const cuerpo = crear("div", { clase: "hoja-cuerpo" });
  if (esTexto(contenido)) cuerpo.innerHTML = String(contenido);
  else if (contenido) cuerpo.append(contenido);
  hoja.append(cuerpo);

  if (pie) {
    const p = crear("div", { clase: "hoja-pie" });
    if (esTexto(pie)) p.innerHTML = String(pie);
    else p.append(pie);
    hoja.append(p);
  }

  velo.append(hoja);
  document.body.append(velo);
  document.body.style.overflow = "hidden";

  velo.addEventListener("click", (e) => { if (e.target === velo && cerrable) cerrar(); });
  const onTecla = (e) => { if (e.key === "Escape" && cerrable) { e.stopPropagation(); cerrar(); } };
  document.addEventListener("keydown", onTecla, true);

  if (!centrado) habilitarArrastre(hoja, cerrar, cerrable);
  atraparFoco(hoja);
  vibrar("toque");

  let cerrada = false;
  function cerrar(resultado) {
    if (cerrada) return;
    cerrada = true;
    document.removeEventListener("keydown", onTecla, true);
    velo.classList.add("cerrando");
    setTimeout(() => {
      velo.remove();
      pilaHojas = pilaHojas.filter((h) => h !== velo);
      if (!pilaHojas.length) document.body.style.overflow = "";
    }, 240);
    alCerrar?.(resultado);
  }

  pilaHojas.push(velo);
  return { el: hoja, velo, cuerpo, cerrar };
}

export function cerrarTodasLasHojas() {
  [...pilaHojas].forEach((v) => v.querySelector(".hoja") && v.remove());
  pilaHojas = [];
  document.body.style.overflow = "";
}

/** Arrastre vertical para descartar la hoja (gesto móvil). */
function habilitarArrastre(hoja, cerrar, cerrable) {
  const agarre = hoja.querySelector(".hoja-agarre");
  if (!agarre || !cerrable) return;
  let y0 = 0, dy = 0, activo = false;

  const abajo = (e) => {
    activo = true; y0 = (e.touches?.[0] || e).clientY; dy = 0;
    hoja.style.transition = "none";
  };
  const mover = (e) => {
    if (!activo) return;
    dy = Math.max(0, (e.touches?.[0] || e).clientY - y0);
    hoja.style.transform = `translateY(${dy}px)`;
  };
  const arriba = () => {
    if (!activo) return;
    activo = false;
    hoja.style.transition = "";
    hoja.style.transform = "";
    if (dy > 110) cerrar();
  };

  agarre.addEventListener("touchstart", abajo, { passive: true });
  agarre.addEventListener("touchmove", mover, { passive: true });
  agarre.addEventListener("touchend", arriba);
  agarre.addEventListener("mousedown", (e) => {
    abajo(e);
    const mm = (ev) => mover(ev);
    const mu = () => { arriba(); document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); };
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
  });
}

/** Mantiene el foco dentro del diálogo mientras esté abierto. */
function atraparFoco(contenedor) {
  const foco = () => contenedor.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  setTimeout(() => {
    const items = foco();
    (items[0] || contenedor).focus?.();
  }, 60);
  contenedor.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = [...foco()];
    if (!items.length) return;
    const primero = items[0], ultimo = items[items.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  });
}

/* ---------------------------------------------------------------------
   Confirmación / aviso
   --------------------------------------------------------------------- */
export function confirmar({
  titulo = "", mensaje = "", aceptar = t("app.aceptar"), cancelar = t("app.cancelar"),
  peligro = false, detalle = "",
} = {}) {
  return new Promise((resolve) => {
    let respondido = false;
    const { cerrar, el } = abrirHoja({
      titulo, centrado: true, ancho: "420px",
      contenido: html`
        <p>${mensaje}</p>
        ${detalle ? raw(`<p class="texto-sm texto-dim">${esc(detalle)}</p>`) : ""}
      `,
      pie: html`
        <button type="button" class="btn btn-contorno" data-r="0">${cancelar}</button>
        <button type="button" class="btn ${peligro ? "btn-peligro" : "btn-primario"}" data-r="1">${aceptar}</button>
      `,
      alCerrar: () => { if (!respondido) resolve(false); },
    });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-r]");
      if (!b) return;
      respondido = true;
      resolve(b.dataset.r === "1");
      cerrar();
    });
  });
}

export function avisar({ titulo = "", mensaje = "", boton = t("app.aceptar") } = {}) {
  return new Promise((resolve) => {
    const { cerrar, el } = abrirHoja({
      titulo, centrado: true, ancho: "420px",
      contenido: html`<p>${mensaje}</p>`,
      pie: html`<button type="button" class="btn btn-primario" data-ok>${boton}</button>`,
      alCerrar: () => resolve(),
    });
    el.querySelector("[data-ok]")?.addEventListener("click", () => cerrar());
  });
}

/** Pide un texto al usuario. Resuelve con la cadena o null. */
export function pedirTexto({ titulo = "", etiqueta = "", valor = "", placeholder = "", multilinea = false, boton = t("app.guardar") } = {}) {
  return new Promise((resolve) => {
    let respondido = false;
    const campo = multilinea
      ? html`<textarea id="pt-in" placeholder="${placeholder}">${valor}</textarea>`
      : html`<input id="pt-in" type="text" value="${valor}" placeholder="${placeholder}">`;
    const { cerrar, el } = abrirHoja({
      titulo, centrado: true, ancho: "460px",
      contenido: html`<div class="campo"><label for="pt-in">${etiqueta}</label>${raw(campo)}</div>`,
      pie: html`
        <button type="button" class="btn btn-contorno" data-c>${t("app.cancelar")}</button>
        <button type="button" class="btn btn-primario" data-ok>${boton}</button>`,
      alCerrar: () => { if (!respondido) resolve(null); },
    });
    const input = el.querySelector("#pt-in");
    setTimeout(() => input?.focus(), 80);
    el.querySelector("[data-ok]").addEventListener("click", () => {
      respondido = true; resolve(input.value.trim()); cerrar();
    });
    el.querySelector("[data-c]").addEventListener("click", () => cerrar());
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !multilinea) el.querySelector("[data-ok]").click();
    });
  });
}

/* ---------------------------------------------------------------------
   Estados de carga
   --------------------------------------------------------------------- */
export function botonCargando(btn, cargando = true) {
  if (!btn) return;
  btn.dataset.cargando = String(cargando);
  btn.disabled = cargando;
}

/** Envuelve una promesa mostrando el botón en estado de carga. */
export async function conCarga(btn, promesa) {
  botonCargando(btn, true);
  try { return await promesa; }
  finally { botonCargando(btn, false); }
}

export const esqueletoLista = (n = 4) =>
  Array.from({ length: n }, () => '<div class="esqueleto esq-tarjeta" style="margin-bottom:12px"></div>').join("");

export const cargando = (texto = t("app.cargando")) => html`
  <div class="cargando-centro">
    <div class="col" style="align-items:center;gap:12px">
      <div class="spinner"></div>
      <span class="texto-sm texto-dim">${texto}</span>
    </div>
  </div>`;

export const vacio = ({ ico = "📭", titulo = "", desc = "", accion = "" } = {}) => html`
  <div class="vacio">
    <div class="vacio-ico">${ico}</div>
    <h3>${titulo}</h3>
    ${desc ? raw(`<p>${esc(desc)}</p>`) : ""}
    ${raw(accion)}
  </div>`;

export const errorEstado = (mensaje = t("app.errorDesc"), onReintentar = "") => html`
  <div class="vacio">
    <div class="vacio-ico">⚠️</div>
    <h3>${t("app.error")}</h3>
    <p>${mensaje}</p>
    ${onReintentar ? raw(`<button type="button" class="btn btn-contorno" ${onReintentar}>${esc(t("app.reintentar"))}</button>`) : ""}
  </div>`;

/* ---------------------------------------------------------------------
   Feedback visual varios
   --------------------------------------------------------------------- */
export function pulsar(el) {
  if (!el) return;
  el.classList.remove("pulso-ok");
  void el.offsetWidth;
  el.classList.add("pulso-ok");
}

export function temblar(el) {
  if (!el) return;
  el.classList.remove("temblar");
  void el.offsetWidth;
  el.classList.add("temblar");
  vibrar("error");
}

export async function copiar(texto, mensaje = t("app.copiado")) {
  try {
    await navigator.clipboard.writeText(texto);
    toastOk(mensaje);
    return true;
  } catch {
    // Respaldo para navegadores sin permiso de portapapeles
    const ta = crear("textarea", { estilo: { position: "fixed", opacity: "0" } });
    ta.value = texto;
    document.body.append(ta);
    ta.select();
    try { document.execCommand("copy"); toastOk(mensaje); return true; }
    catch { toastError("No se pudo copiar"); return false; }
    finally { ta.remove(); }
  }
}

/** Web Share API con respaldo a copiar el enlace. */
export async function compartir({ titulo = "", texto = "", url = location.href } = {}) {
  if (navigator.share) {
    try { await navigator.share({ title: titulo, text: texto, url }); return true; }
    catch (e) { if (e?.name === "AbortError") return false; }
  }
  return copiar(url, "Enlace copiado");
}

export default {
  $, $$, crear, on, toast, toastOk, toastError, abrirHoja, confirmar, avisar, pedirTexto,
  botonCargando, conCarga, cargando, vacio, errorEstado, pulsar, temblar, copiar, compartir,
  cerrarTodasLasHojas, esqueletoLista,
};
