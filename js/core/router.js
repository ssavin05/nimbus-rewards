/* ======================================================================
   router.js — Enrutador hash con carga diferida (lazy loading).

   Cada vista es un módulo que se descarga sólo cuando se visita su ruta,
   con `import()` dinámico. Eso mantiene el arranque ligero: el mapa 3D
   y el panel de administración no pesan nada hasta que se abren.

   Formato de ruta:  #/espacios/:id  ->  params.id
   ====================================================================== */
import { emit, EV } from "./bus.js";
import { cargando } from "./ui.js";
import store from "./store.js";

const rutas = [];
let vistaActual = null;      // { destruir?, ruta, params }
let contenedor = null;
let ultimaRuta = null;
const posicionesScroll = new Map();

/**
 * registrar("/espacios/:id", () => import("../views/espacio.js"), { auth: true })
 * El módulo debe exportar `render(contenedor, contexto)` y, opcionalmente,
 * `destruir()`, `titulo`, `nav` y `topbar`.
 */
export function registrar(patron, cargador, opciones = {}) {
  rutas.push({ patron, cargador, ...compilar(patron), opciones });
}

function compilar(patron) {
  const nombres = [];
  const regex = new RegExp("^" + patron
    .replace(/\/$/, "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:(\w+)/g, (_, n) => { nombres.push(n); return "([^/]+)"; })
    .replace(/\*/g, ".*") + "/?$");
  return { regex, nombres };
}

function parsear(hash) {
  const limpio = (hash || "").replace(/^#/, "") || "/";
  const [ruta, query = ""] = limpio.split("?");
  return { ruta: ruta || "/", query: new URLSearchParams(query) };
}

export function rutaActual() { return parsear(location.hash).ruta; }
export function queryActual() { return parsear(location.hash).query; }

/** Navega a una ruta. `reemplazar: true` no agrega entrada al historial. */
export function ir(ruta, { reemplazar = false, estado = null } = {}) {
  const destino = "#" + (ruta.startsWith("/") ? ruta : "/" + ruta);
  if (location.hash === destino) { resolver(estado); return; }
  if (reemplazar) history.replaceState(estado, "", destino);
  else history.pushState(estado, "", destino);
  resolver(estado);
}

export function atras() {
  if (history.length > 1) history.back();
  else ir("/");
}

function coincidir(ruta) {
  for (const r of rutas) {
    const m = ruta.match(r.regex);
    if (m) {
      const params = {};
      r.nombres.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { ...r, params };
    }
  }
  return null;
}

let resolviendo = false;
let pendiente = null;

async function resolver(estadoNav = null) {
  if (resolviendo) { pendiente = estadoNav; return; }
  resolviendo = true;

  const { ruta, query } = parsear(location.hash);

  // Guarda el scroll de la vista que se abandona
  if (ultimaRuta && contenedor) {
    const sc = contenedor.querySelector(".vista-scroll");
    if (sc) posicionesScroll.set(ultimaRuta, sc.scrollTop);
  }

  const encontrada = coincidir(ruta);
  if (!encontrada) { resolviendo = false; ir("/", { reemplazar: true }); return; }

  const { opciones, params, cargador } = encontrada;

  // Control de permisos
  let st = store.get();
  if (opciones.auth && !st.sesion) {
    resolviendo = false;
    ir(`/login?redirect=${encodeURIComponent(ruta)}`, { reemplazar: true });
    return;
  }
  if (opciones.rol && !([].concat(opciones.rol).includes(st.rol)) && ruta.startsWith("/admin") && st.sesion) {
    // El rol puede haber cambiado en Supabase después de iniciar sesión.
    // Refrescar aquí evita exigir cerrar sesión o limpiar el navegador.
    try {
      const { refrescarAcceso } = await import("../auth/auth.js");
      await refrescarAcceso();
      st = store.get();
    } catch (e) { console.warn("[router] no se pudo refrescar el acceso", e); }
  }
  if (opciones.rol && !([].concat(opciones.rol).includes(st.rol))) {
    resolviendo = false;
    const { toastError } = await import("./ui.js");
    toastError(`Supabase reporta el rol “${st.rol || "usuario"}”. Revisa tu acceso en Perfil.`);
    ir("/perfil?acceso=admin", { reemplazar: true });
    return;
  }

  // Desmonta la vista anterior
  try { await vistaActual?.destruir?.(); } catch (e) { console.warn("[router] destruir()", e); }
  vistaActual = null;

  if (contenedor) contenedor.innerHTML = `<div class="vista-scroll">${cargando()}</div>`;

  let modulo;
  try {
    modulo = await cargador();
  } catch (e) {
    console.error("[router] no se pudo cargar la vista", ruta, e);
    const { errorEstado } = await import("./ui.js");
    if (contenedor) contenedor.innerHTML = `<div class="vista-scroll">${errorEstado("No se pudo cargar esta sección.")}</div>`;
    resolviendo = false;
    return;
  }

  const contexto = { params, query, ruta, estado: estadoNav, ir, atras };

  if (contenedor) contenedor.innerHTML = "";
  try {
    await modulo.render?.(contenedor, contexto);
  } catch (e) {
    console.error("[router] render falló", ruta, e);
    const { errorEstado } = await import("./ui.js");
    if (contenedor) contenedor.innerHTML = `<div class="vista-scroll">${errorEstado()}</div>`;
  }

  vistaActual = { destruir: modulo.destruir, ruta, params, modulo };
  ultimaRuta = ruta;

  // Restaura scroll si volvemos a una vista ya visitada
  const sc = contenedor?.querySelector(".vista-scroll");
  if (sc) {
    sc.classList.add("vista-entra");
    const y = posicionesScroll.get(ruta);
    if (y) sc.scrollTop = y;
  }

  emit(EV.RUTA_CAMBIO, { ruta, params, query, modulo, opciones });

  resolviendo = false;
  if (pendiente !== null) { const p = pendiente; pendiente = null; resolver(p); }
}

/** Arranca el router sobre un contenedor. */
export function iniciarRouter(el) {
  contenedor = el;
  window.addEventListener("hashchange", () => resolver());
  window.addEventListener("popstate", () => resolver());
  if (!location.hash) history.replaceState(null, "", "#/");
  return resolver();
}

/** Vuelve a renderizar la vista actual (por ejemplo tras cambiar idioma). */
export function recargarVista() {
  posicionesScroll.delete(rutaActual());
  return resolver();
}

export function getVistaActual() { return vistaActual; }

export default { registrar, ir, atras, iniciarRouter, rutaActual, queryActual, recargarVista, getVistaActual };
