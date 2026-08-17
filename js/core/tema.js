/* ======================================================================
   tema.js — Modo oscuro / claro / automático + preferencia de
   animaciones. Se aplica en <html data-tema="…" data-animaciones="…">.
   ====================================================================== */
import { STORAGE_KEYS } from "./config.js";
import { emit, EV } from "./bus.js";

export const TEMAS = ["auto", "claro", "oscuro"];

function leer(clave, porDefecto) {
  try { return localStorage.getItem(clave) ?? porDefecto; }
  catch { return porDefecto; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* ignora */ }
}

let temaActual = TEMAS.includes(leer(STORAGE_KEYS.tema, "auto")) ? leer(STORAGE_KEYS.tema, "auto") : "auto";

export function getTema() { return temaActual; }

/** Tema efectivo tras resolver "auto" contra la preferencia del sistema. */
export function temaEfectivo() {
  if (temaActual !== "auto") return temaActual;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}

export function setTema(tema) {
  if (!TEMAS.includes(tema)) return;
  temaActual = tema;
  guardar(STORAGE_KEYS.tema, tema);
  aplicar();
  emit(EV.TEMA_CAMBIO, { tema, efectivo: temaEfectivo() });
}

function aplicar() {
  if (typeof document === "undefined") return;
  const raiz = document.documentElement;
  if (temaActual === "auto") raiz.removeAttribute("data-tema");
  else raiz.setAttribute("data-tema", temaActual);

  // Color de la barra del sistema en móvil
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", temaEfectivo() === "oscuro" ? "#0a0f18" : "#f5f7fa");
}

/* ---------- animaciones ---------- */
let animaciones = leer(STORAGE_KEYS.animaciones, "on") !== "off";

export function getAnimaciones() { return animaciones; }

export function setAnimaciones(on) {
  animaciones = Boolean(on);
  guardar(STORAGE_KEYS.animaciones, animaciones ? "on" : "off");
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-animaciones", animaciones ? "on" : "off");
  }
}

export function initTema() {
  aplicar();
  setAnimaciones(animaciones);
  if (typeof matchMedia === "function") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
      if (temaActual === "auto") { aplicar(); emit(EV.TEMA_CAMBIO, { tema: "auto", efectivo: temaEfectivo() }); }
    });
  }
}

export default { getTema, setTema, temaEfectivo, initTema, getAnimaciones, setAnimaciones, TEMAS };
