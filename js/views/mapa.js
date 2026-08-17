/* ======================================================================
   mapa.js — Vista del mapa 3D interactivo.

   Carga Three.js sólo aquí (lazy loading), construye la escena con los
   datos reales del edificio, pinta el semáforo de disponibilidad en
   vivo y ofrece buscador, mini mapa, ruta y panel de reserva rápida.
   ====================================================================== */
import { html, raw, esc, isoFecha, fechaLarga, formatMoneda, debounce } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { toastError, toastOk, abrirHoja } from "../core/ui.js";
import { ir } from "../core/router.js";
import { vibrar } from "../core/haptics.js";
import api from "../data/api.js";
import store from "../core/store.js";
import { on as onBus, EV } from "../core/bus.js";
import { buscarSimple } from "../ai/busqueda.js";
import { selectorDias, rejillaHorarios, insigniaEstado } from "./componentes.js";
import * as mockDatos from "../data/mock.js";
import { ENVOLVENTE, espaciosDelPlano } from "../data/planta.js";

export const titulo = () => t("mapa.titulo");
export const nav = true;

let escena = null;
let minimapa = null;
let desuscribir = [];
const st = { fecha: isoFecha(), espacioSel: null, disponibilidad: {}, bloques: [], bloqueSel: null, amenidades: [] };

// Canon comercial de V1. Aunque una base vieja todavía conserve
// `reservable=true` en áreas históricas, el mapa nunca las pinta como
// disponibles ni ofrece un botón de reserva. La migración 06/09 debe
// dejar la base igual; esto evita que una base atrasada vuelva verde el
// edificio entero mientras se termina el despliegue.
const CODIGOS_RESERVABLES_MAPA = new Set(["OF-A", "OF-B", "OF-C", "OF-D"]);

/*
 * El mapa se dibuja SIEMPRE con la geometría canónica del plano local.
 * La base decide disponibilidad, precio, IDs y estado comercial; no decide
 * dónde aparece un cuarto en pantalla. Esto evita que una migración vieja o
 * una fila con coordenadas antiguas deforme el edificio (fue exactamente lo
 * que produjo la maqueta verde/descuadrada de 2.6.x).
 */
function normalizarReservablesMapa(lista = []) {
  const porCodigo = new Map((lista || []).map((e) => [String(e.codigo || "").toUpperCase(), e]));
  const canon = espaciosDelPlano();

  return canon.map((geo) => {
    const codigo = String(geo.codigo || "").toUpperCase();
    const real = porCodigo.get(codigo);
    const base = real ? { ...geo, ...real } : {
      ...geo,
      id: `mapa-${codigo.toLowerCase()}`,
      estado: "inactiva",
      activo: true,
      _soloMapa: true,
    };

    return {
      ...base,
      // Geometría, etiqueta y puerta: autoritativas del plano.
      pos_x: geo.pos_x,
      pos_y: geo.pos_y,
      ancho: geo.ancho,
      fondo: geo.fondo,
      abierto: geo.abierto,
      puerta: geo.puerta,
      nombre_mapa: geo.nombre_mapa,
      // Comercial: sólo A/B/C/D y sólo si la fila real lo permite.
      reservable: Boolean(real) && CODIGOS_RESERVABLES_MAPA.has(codigo) && api.esReservableV1(real),
    };
  });
}

export async function render(contenedor, ctx) {
  st.fecha = ctx?.query?.get("fecha") || isoFecha();
  st.espacioSel = null;
  st.bloqueSel = null;

  contenedor.innerHTML = html`
    <div class="mapa-vista">
      <canvas id="lienzo3d" aria-label="Mapa 3D del edificio"></canvas>

      <div class="mapa-cargando" id="mapa-cargando">
        <div class="spinner"></div>
        <p class="texto-sm">${t("mapa.cargando")}</p>
        <p class="texto-xs texto-suave" id="mapa-progreso"></p>
      </div>

      <!-- El título va oculto a la vista porque la barra superior ya lo
           enseña, pero tiene que existir: quien navega con lector de
           pantalla salta de encabezado en encabezado, y una vista sin
           <h1> no tiene dónde aterrizar. -->
      <h1 class="sr-only">${t("nav.mapa")}</h1>

      <div class="mapa-superior">
        <div class="buscador buscador-flotante">
          ${raw(icono("buscar", { size: 17, clase: "ci" }))}
          <input id="mapa-busq" type="search" placeholder="${t('mapa.buscar')}" autocomplete="off">
          <div id="mapa-res" class="buscador-res" hidden></div>
        </div>
        <div class="cinta mapa-dias" id="mapa-dias">${raw(selectorDias(st.fecha, 7))}</div>
      </div>

      <canvas id="minimapa" class="minimapa" aria-label="Mini mapa del piso"></canvas>

      <div class="mapa-controles">
        <button type="button" class="btn btn-icono mapa-btn" data-zoom="1.18" aria-label="${t('mapa.acercar')}">${raw(icono("mas", { size: 18 }))}</button>
        <button type="button" class="btn btn-icono mapa-btn" data-zoom="0.85" aria-label="${t('mapa.alejar')}">${raw(icono("menos", { size: 18 }))}</button>
        <button type="button" class="btn btn-icono mapa-btn" data-girar="0.4" aria-label="${t('mapa.girar')}">${raw(icono("refrescar", { size: 18 }))}</button>
        <button type="button" class="btn btn-icono mapa-btn" data-reset aria-label="${t("mapa.restablecer")}">${raw(icono("cubo", { size: 18 }))}</button>
      </div>

      <div class="mapa-leyenda" aria-label="${t("mapa.leyenda")}">
        <span><i class="punto punto-ok"></i>${t("mapa.muchos")}</span>
        <span><i class="punto punto-warm"></i>${t("mapa.pocos")}</span>
        <span><i class="punto punto-taken"></i>${t("mapa.ninguno")}</span>
        <span><i class="punto punto-neutro"></i>${t("mapa.sinDatos")}</span>
      </div>

      <div class="mapa-tip" id="mapa-tip" aria-hidden="true"></div>

      <button type="button" class="btn btn-contorno mapa-volver" id="mapa-volver" hidden>
        ${raw(icono("atras", { size: 16 }))} ${t("mapa.volver")}
      </button>

      <div class="mapa-panel" id="mapa-panel" aria-live="polite"></div>
    </div>`;

  const lienzo = contenedor.querySelector("#lienzo3d");
  const cargando = contenedor.querySelector("#mapa-cargando");
  const progreso = contenedor.querySelector("#mapa-progreso");

  /* ---------- datos ---------- */
  progreso.textContent = t("mapa.progresoCatalogo");
  const [espaciosRaw, edificios, amenidades] = await Promise.all([
    api.getEspacios(),
    api.getEdificios().catch(() => []),
    api.getAmenidades().catch(() => []),
  ]);
  const espacios = normalizarReservablesMapa(espaciosRaw);
  st.amenidades = amenidades;
  // Sin edificio en la base se usa la envolvente del plano, no unas
  // medidas sueltas: si no coinciden, los bloques salen descuadrados
  // respecto al dibujo.
  const edificioDatos = { ...(edificios[0] || {}), ancho_m: ENVOLVENTE.ancho, fondo_m: ENVOLVENTE.fondo };

  progreso.textContent = t("mapa.progresoDisponibilidad");
  st.disponibilidad = (await api.getDisponibilidadMapa(st.fecha).catch(() => null)) || {};

  /* ---------- escena ---------- */
  progreso.textContent = t("mapa.progresoEscena");
  try {
    const { crearEscena } = await import("../three/escena.js");
    escena = await crearEscena(lienzo, {
      edificioDatos,
      espacios,
      corredores: mockDatos.CORREDORES,
      onSeleccion: (espacio) => seleccionar(contenedor, espacio),
      onHover: (espacio, pos) => mostrarTip(contenedor, espacio, pos),
    });
    escena.aplicarDisponibilidad(st.disponibilidad);
  } catch (e) {
    console.error("[mapa]", e);
    cargando.innerHTML = html`
      <div class="vacio">
        <div class="vacio-ico">🧊</div>
        <h3>${t("mapa.sinWebgl")}</h3>
        <p class="texto-sm">${t("mapa.sinWebglDesc")}</p>
        <a class="btn btn-primario" href="#/espacios">${t("mapa.verCatalogo")}</a>
      </div>`;
    return;
  }

  /* ---------- mini mapa ---------- */
  const { crearMinimapa } = await import("../three/minimapa.js");
  minimapa = crearMinimapa(contenedor.querySelector("#minimapa"), {
    espacios, edificio: edificioDatos, centro: escena.centro,
    onSeleccion: (espacio) => seleccionar(contenedor, espacio),
  });
  minimapa.setDisponibilidad(st.disponibilidad);

  escena.onFrame(({ camara, objetivo }) => {
    const angulo = Math.atan2(objetivo.x - camara.position.x, objetivo.z - camara.position.z);
    minimapa.setCamara({ x: camara.position.x, z: camara.position.z }, -angulo + Math.PI);
  });

  cargando.classList.add("fuera");
  setTimeout(() => cargando.remove(), 400);
  vibrar("toque");

  /* ---------- eventos ---------- */
  contenedor.addEventListener("click", async (e) => {
    const zoom = e.target.closest("[data-zoom]");
    if (zoom) { escena.setZoom(nuevoZoom(Number(zoom.dataset.zoom))); vibrar("toque"); return; }

    const girar = e.target.closest("[data-girar]");
    if (girar) { escena.girar(Number(girar.dataset.girar)); vibrar("toque"); return; }

    if (e.target.closest("[data-reset]") || e.target.closest("#mapa-volver")) {
      seleccionar(contenedor, null);
      return;
    }

    const dia = e.target.closest("[data-dia]");
    if (dia) return cambiarDia(contenedor, dia);

    // Sólo el panel lateral. La escena 3D no se toca.
    if (e.target.closest("[data-reintentar-disp]")) {
      if (st.espacioSel) {
        st.bloques = await api.getDisponibilidad(st.espacioSel.id, st.fecha, { forzar: true });
        refrescarPanel(contenedor);
      }
      return;
    }

    const bloque = e.target.closest("[data-bloque]");
    if (bloque && !bloque.disabled) {
      st.bloqueSel = st.bloqueSel === bloque.dataset.bloque ? null : bloque.dataset.bloque;
      contenedor.querySelectorAll("[data-bloque]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.bloque === st.bloqueSel)));
      actualizarBotonReserva(contenedor);
      vibrar("seleccion");
      return;
    }

    if (e.target.closest("[data-ruta]")) {
      escena.mostrarRuta(st.espacioSel.id);
      toastOk(t("mapa.rutaLista"));
      return;
    }

    if (e.target.closest("[data-reservar]")) {
      const params = new URLSearchParams({ fecha: st.fecha });
      if (st.bloqueSel) params.set("bloque", st.bloqueSel);
      if (!store.get().sesion) {
        return ir(`/login?redirect=${encodeURIComponent(`/espacios/${st.espacioSel.id}/reservar?${params}`)}`);
      }
      ir(`/espacios/${st.espacioSel.id}/reservar?${params}`);
    }

    if (e.target.closest("[data-detalle]")) ir(`/espacios/${st.espacioSel.id}`);
  });

  /* ---------- buscador ---------- */
  const input = contenedor.querySelector("#mapa-busq");
  const resultados = contenedor.querySelector("#mapa-res");
  input.addEventListener("input", debounce((e) => {
    const q = e.target.value.trim();
    if (q.length < 2) { resultados.hidden = true; return; }
    const encontrados = buscarSimple(q, espacios);
    resultados.hidden = false;
    resultados.innerHTML = encontrados.length
      ? encontrados.map((s) => `<button type="button" class="lista-item" data-ir="${esc(s.id)}">
          <span class="li-ico">${esc(s.icono || "🏢")}</span>
          <span class="li-txt"><span class="li-titulo">${esc(s.nombre)}</span>
          <span class="li-sub">${esc(s.codigo)}</span></span></button>`).join("")
      : `<p class="texto-sm texto-dim" style="padding:12px">${esc(t("mapa.sinCoincidencias"))}</p>`;
  }, 180));

  resultados.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ir]");
    if (!b) return;
    const espacio = espacios.find((s) => String(s.id) === b.dataset.ir);
    resultados.hidden = true;
    input.value = "";
    input.blur();
    seleccionar(contenedor, espacio);
  });

  /* ---------- si llegamos con ?espacio= ---------- */
  const idInicial = ctx?.query?.get("espacio");
  if (idInicial) {
    const espacio = espacios.find((s) => String(s.id) === idInicial);
    if (espacio) setTimeout(() => { seleccionar(contenedor, espacio); escena.mostrarRuta(espacio.id); }, 700);
  }

  /* ---------- disponibilidad en vivo ---------- */
  desuscribir.push(onBus(EV.DISPONIBILIDAD_CAMBIO, async () => {
    st.disponibilidad = (await api.getDisponibilidadMapa(st.fecha, { forzar: true })
      .catch(() => null)) || st.disponibilidad || {};
    escena?.aplicarDisponibilidad(st.disponibilidad);
    minimapa?.setDisponibilidad(st.disponibilidad);
    if (st.espacioSel) refrescarPanel(contenedor);
  }));
}

export function destruir() {
  desuscribir.forEach((f) => { try { f(); } catch { /* ignora */ } });
  desuscribir = [];
  try { minimapa?.destruir(); } catch { /* ignora */ }
  try { escena?.destruir(); } catch { /* ignora */ }
  minimapa = null;
  escena = null;
}

/* ---------------------------------------------------------------------
   Selección y panel
   --------------------------------------------------------------------- */
let zoomActual = 1;
function nuevoZoom(factor) { zoomActual = Math.min(2.2, Math.max(0.34, zoomActual * factor)); return zoomActual; }

async function seleccionar(contenedor, espacio) {
  const panel = contenedor.querySelector("#mapa-panel");
  const volver = contenedor.querySelector("#mapa-volver");
  contenedor.querySelector("#mapa-tip")?.classList.remove("visible");

  if (!espacio) {
    st.espacioSel = null;
    st.bloqueSel = null;
    panel.classList.remove("abierto");
    volver.hidden = true;
    escena?.vistaGeneral();
    escena?.quitarRuta();
    minimapa?.setSeleccion(null);
    return;
  }

  st.espacioSel = espacio;
  st.bloqueSel = null;
  escena?.enfocar(espacio.id);
  minimapa?.setSeleccion(espacio.id);
  volver.hidden = false;

  panel.classList.add("abierto");
  panel.innerHTML = `<div class="cargando-centro" style="padding:24px"><div class="spinner"></div></div>`;

  st.bloques = espacio.reservable
    ? await api.getDisponibilidad(espacio.id, st.fecha).catch(() => [])
    : [];
  refrescarPanel(contenedor);
}

function refrescarPanel(contenedor) {
  const panel = contenedor.querySelector("#mapa-panel");
  const e = st.espacioSel;
  if (!e) return;

  const precio = Number(e.precio_hora ?? e.precioHora ?? 0);
  const disp = st.disponibilidad[String(e.id)];
  const reservable = e.reservable && e.estado === "disponible";

  panel.innerHTML = html`
    <div class="mp-agarre" aria-hidden="true"></div>
    <div class="mp-cab">
      <span class="mp-ico" aria-hidden="true">${e.icono || "🏢"}</span>
      <div class="crece">
        <strong>${e.nombre}</strong>
        <div class="texto-sm texto-dim">${e.codigo}${e.capacidad ? ` · ${t("espacio.personas", { n: e.capacidad })}` : ""}</div>
      </div>
      ${precio ? raw(`<div class="mp-precio"><strong>${esc(formatMoneda(precio))}</strong><small>/h</small></div>`) : ""}
    </div>

    <div class="fila envolver" style="gap:6px;margin:10px 0">
      ${insigniaEstado(e, disp)}
      ${e.amenidades?.slice(0, 3).map((a) => {
        const def = st.amenidades.find((x) => x.clave === a);
        return raw(`<span class="chip">${esc(def?.icono || "")} ${esc(def?.etiqueta || a)}</span>`);
      })}
    </div>

    ${e.descripcion ? raw(`<p class="texto-sm texto-dim">${esc(e.descripcion.slice(0, 130))}${e.descripcion.length > 130 ? "…" : ""}</p>`) : ""}

    ${reservable ? raw(`
      <p class="texto-xs texto-dim mt-4">${esc(fechaLarga(st.fecha))}</p>
      <div class="mt-2">${rejillaHorarios(st.bloques, { fecha: st.fecha, seleccion: st.bloqueSel })}</div>`) : ""}

    <div class="mp-acciones">
      <button type="button" class="btn btn-contorno btn-sm" data-ruta>${raw(icono("ubicacion", { size: 15 }))} ${t("mapa.comoLlegar")}</button>
      <button type="button" class="btn btn-contorno btn-sm" data-detalle>${raw(icono("info", { size: 15 }))} ${t("espacio.detalles")}</button>
      ${reservable ? raw(`<button type="button" class="btn btn-primario btn-sm crece" data-reservar ${st.bloqueSel ? "" : "disabled"}>
        ${esc(t("espacio.reservar"))}</button>`) : ""}
    </div>`;
}

function actualizarBotonReserva(contenedor) {
  const btn = contenedor.querySelector("[data-reservar]");
  if (btn) btn.disabled = !st.bloqueSel;
}

async function cambiarDia(contenedor, dia) {
  st.fecha = dia.dataset.dia;
  st.bloqueSel = null;
  contenedor.querySelectorAll("[data-dia]").forEach((d) => d.setAttribute("aria-pressed", String(d === dia)));
  vibrar("toque");

  st.disponibilidad = (await api.getDisponibilidadMapa(st.fecha).catch(() => null)) || {};
  escena?.aplicarDisponibilidad(st.disponibilidad);
  minimapa?.setDisponibilidad(st.disponibilidad);

  if (st.espacioSel) {
    st.bloques = await api.getDisponibilidad(st.espacioSel.id, st.fecha).catch(() => []);
    refrescarPanel(contenedor);
  }
}

/* ---------------------------------------------------------------------
   Tooltip al pasar el ratón
   --------------------------------------------------------------------- */
function mostrarTip(contenedor, espacio, pos) {
  const tip = contenedor.querySelector("#mapa-tip");
  if (!tip) return;
  if (!espacio) { tip.classList.remove("visible"); return; }

  const disp = st.disponibilidad[String(espacio.id)];
  const precio = Number(espacio.precio_hora || 0);
  tip.innerHTML = `<strong>${esc(espacio.nombre)}</strong>`
    + (precio ? `<span>${esc(formatMoneda(precio))}/h</span>` : "<span>No reservable</span>")
    + (disp ? `<span class="texto-xs">${disp.libres}/${disp.total} horarios libres</span>` : "");
  tip.style.left = `${pos.x + 14}px`;
  tip.style.top = `${pos.y + 14}px`;
  tip.classList.add("visible");
}
