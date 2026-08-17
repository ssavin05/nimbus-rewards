/* ======================================================================
   tutorial.js — Onboarding de tres pasos que se muestra una sola vez.
   ====================================================================== */
import { html, raw, esc } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { ir } from "../core/router.js";
import { STORAGE_KEYS } from "../core/config.js";
import { vibrar } from "../core/haptics.js";
import { icono } from "../core/iconos.js";

export const titulo = () => "";
export const nav = false;
export const topbar = false;

const PASOS = [
  { arte: arte3d, tk: "tutorial.t1", dk: "tutorial.d1" },
  { arte: arteReserva, tk: "tutorial.t2", dk: "tutorial.d2" },
  { arte: arteTodo, tk: "tutorial.t3", dk: "tutorial.d3" },
];

let indice = 0;

export function render(contenedor) {
  indice = 0;
  contenedor.innerHTML = html`
    <section class="vista-scroll tutorial">
      <div class="tutorial-inner">
        <button type="button" class="btn btn-fantasma btn-sm tutorial-saltar" data-saltar>${t("tutorial.saltar")}</button>
        <div class="tutorial-arte" id="tut-arte"></div>
        <div class="tutorial-texto">
          <h1 id="tut-titulo"></h1>
          <p id="tut-desc"></p>
        </div>
        <div class="tutorial-puntos" id="tut-puntos" role="tablist"></div>
        <button type="button" class="btn btn-primario btn-lg btn-bloque" id="tut-siguiente"></button>
      </div>
    </section>`;

  pintar(contenedor);

  contenedor.addEventListener("click", (e) => {
    if (e.target.closest("[data-saltar]")) return terminar();
    if (e.target.closest("#tut-siguiente")) {
      vibrar("seleccion");
      if (indice >= PASOS.length - 1) return terminar();
      indice++;
      pintar(contenedor);
    }
    const punto = e.target.closest("[data-punto]");
    if (punto) { indice = Number(punto.dataset.punto); pintar(contenedor); }
  });

  // Deslizar horizontalmente entre pasos
  let x0 = null;
  contenedor.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  contenedor.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (dx < -50 && indice < PASOS.length - 1) { indice++; pintar(contenedor); }
    if (dx > 50 && indice > 0) { indice--; pintar(contenedor); }
    x0 = null;
  });
}

function pintar(contenedor) {
  const paso = PASOS[indice];
  const arte = contenedor.querySelector("#tut-arte");
  arte.innerHTML = paso.arte();
  arte.classList.remove("entra"); void arte.offsetWidth; arte.classList.add("entra");

  contenedor.querySelector("#tut-titulo").textContent = t(paso.tk);
  contenedor.querySelector("#tut-desc").textContent = t(paso.dk);
  contenedor.querySelector("#tut-siguiente").textContent =
    indice >= PASOS.length - 1 ? t("tutorial.empezar") : t("tutorial.siguiente");
  contenedor.querySelector("#tut-puntos").innerHTML = PASOS.map((_, i) =>
    `<button type="button" data-punto="${i}" class="tut-punto${i === indice ? " on" : ""}" role="tab" aria-selected="${i === indice}" aria-label="Paso ${i + 1}"></button>`
  ).join("");
}

function terminar() {
  try { localStorage.setItem(STORAGE_KEYS.tutorialVisto, "1"); } catch { /* ignora */ }
  ir("/", { reemplazar: true });
}

/* ---------- ilustraciones (SVG en línea, sin imágenes externas) ---------- */
function arte3d() {
  return `<svg viewBox="0 0 240 180" role="img" aria-label="Mapa 3D del edificio">
    <defs><linearGradient id="t1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="var(--marca)"/><stop offset="100%" stop-color="var(--acento)"/></linearGradient></defs>
    <g fill="none" stroke="url(#t1)" stroke-width="2" stroke-linejoin="round">
      <path d="M120 22 205 66v70l-85 44-85-44V66z" opacity=".35"/>
      <path d="M35 66l85 44 85-44M120 110v70" opacity=".3"/>
    </g>
    <g>
      <rect x="66" y="74" width="42" height="26" rx="4" fill="var(--ok)" opacity=".85"/>
      <rect x="118" y="86" width="34" height="24" rx="4" fill="var(--warm)" opacity=".85"/>
      <rect x="78" y="108" width="38" height="22" rx="4" fill="var(--marca)" opacity=".85"/>
      <rect x="126" y="116" width="30" height="20" rx="4" fill="var(--purple)" opacity=".7"/>
    </g>
    <circle cx="96" cy="66" r="7" fill="var(--marca)"/>
    <circle cx="96" cy="66" r="14" fill="none" stroke="var(--marca)" stroke-width="2" opacity=".4"/>
  </svg>`;
}

function arteReserva() {
  return `<svg viewBox="0 0 240 180" role="img" aria-label="Reserva y pago">
    <rect x="44" y="24" width="152" height="132" rx="14" fill="var(--superficie)" stroke="var(--linea)" stroke-width="2"/>
    <rect x="44" y="24" width="152" height="30" rx="14" fill="var(--marca)" opacity=".18"/>
    <g fill="var(--superficie-3)">
      ${[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) =>
        `<rect x="${58 + c * 26}" y="${66 + r * 22}" width="20" height="16" rx="4"/>`).join("")).join("")}
    </g>
    <rect x="110" y="88" width="20" height="16" rx="4" fill="var(--ok)"/>
    <rect x="136" y="88" width="20" height="16" rx="4" fill="var(--marca)"/>
    <rect x="58" y="132" width="124" height="14" rx="7" fill="var(--marca)"/>
  </svg>`;
}

function arteTodo() {
  return `<svg viewBox="0 0 240 180" role="img" aria-label="Historial, favoritos y avisos">
    <rect x="30" y="40" width="80" height="100" rx="12" fill="var(--superficie)" stroke="var(--linea)" stroke-width="2"/>
    <rect x="130" y="40" width="80" height="46" rx="12" fill="var(--superficie)" stroke="var(--linea)" stroke-width="2"/>
    <rect x="130" y="94" width="80" height="46" rx="12" fill="var(--superficie)" stroke="var(--linea)" stroke-width="2"/>
    <g fill="var(--superficie-3)">
      <rect x="42" y="54" width="56" height="9" rx="4"/><rect x="42" y="70" width="40" height="9" rx="4"/>
      <rect x="42" y="94" width="56" height="9" rx="4"/><rect x="42" y="110" width="46" height="9" rx="4"/>
    </g>
    <path d="M170 52a9 9 0 0 1 13 12l-13 13-13-13a9 9 0 0 1 13-12z" fill="var(--taken)"/>
    <path d="M170 104a10 10 0 0 1 10 10c0 6 2 8 2 8h-24s2-2 2-8a10 10 0 0 1 10-10z" fill="var(--warm)"/>
  </svg>`;
}
