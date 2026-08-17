/* ======================================================================
   haptics.js — Vibración háptica. Se activa desde Configuración y sólo
   funciona donde el navegador expone la Vibration API (Android/Chrome).
   En iOS la API no existe: las llamadas no hacen nada y no fallan.
   ====================================================================== */
import { STORAGE_KEYS } from "./config.js";

const PATRONES = {
  toque: 8,
  seleccion: 12,
  exito: [14, 40, 24],
  advertencia: [22, 50, 22],
  error: [34, 60, 34, 60, 34],
  impacto: 26,
};

let habilitada = leer();

function leer() {
  try { return localStorage.getItem(STORAGE_KEYS.haptics) !== "off"; }
  catch { return true; }
}

export function getHaptics() { return habilitada; }

export function setHaptics(on) {
  habilitada = Boolean(on);
  try { localStorage.setItem(STORAGE_KEYS.haptics, habilitada ? "on" : "off"); } catch { /* ignora */ }
  if (habilitada) vibrar("toque");
}

export const soportaHaptics = () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

/** vibrar("exito") | vibrar(30) | vibrar([10,20,10]) */
export function vibrar(patron = "toque") {
  if (!habilitada || !soportaHaptics()) return false;
  const p = typeof patron === "string" ? PATRONES[patron] : patron;
  if (p == null) return false;
  try { return navigator.vibrate(p); }
  catch { return false; }
}

export default { vibrar, getHaptics, setHaptics, soportaHaptics };
