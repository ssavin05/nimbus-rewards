/* ======================================================================
   store.js — Estado global observable, mínimo y sin dependencias.

   Guarda lo que varias vistas necesitan compartir: sesión, perfil,
   sede activa, catálogo de espacios en memoria, favoritos, contadores
   de notificaciones y estado de conexión.
   ====================================================================== */
import { emit, EV } from "./bus.js";

const estado = {
  /* sesión */
  sesion: null,          // objeto session de Supabase
  usuario: null,         // user de Supabase
  perfil: null,          // fila de la tabla `usuarios`
  rol: "invitado",       // invitado | usuario | staff | admin | superadmin
  membresias: [],        // organizaciones a las que pertenece

  /* contexto multiempresa / multisede */
  organizacion: null,
  sede: null,
  sedes: [],
  edificio: null,
  edificios: [],
  piso: null,
  pisos: [],

  /* catálogo */
  espacios: [],
  espaciosPorId: new Map(),
  amenidades: [],
  promociones: [],

  /* usuario */
  reservas: [],
  favoritos: new Set(),
  notificaciones: [],
  noLeidas: 0,

  /* app */
  conectado: typeof navigator === "undefined" ? true : navigator.onLine,
  pendientesSync: 0,
  cargando: false,
  ultimaBusqueda: "",
};

const suscriptores = new Set();

/** Instantánea de sólo lectura del estado. */
export function get() { return estado; }

export function getEspacio(id) { return estado.espaciosPorId.get(String(id)) || null; }

/** Actualiza el estado y notifica. `parche` es un objeto plano. */
export function set(parche, motivo = "") {
  let cambio = false;
  for (const [k, v] of Object.entries(parche)) {
    if (estado[k] !== v) { estado[k] = v; cambio = true; }
  }
  if (Object.prototype.hasOwnProperty.call(parche, "espacios")) reindexar();
  if (cambio) notificar(motivo, parche);
  return estado;
}

function reindexar() {
  estado.espaciosPorId = new Map((estado.espacios || []).map((e) => [String(e.id), e]));
}

function notificar(motivo, parche) {
  for (const fn of [...suscriptores]) {
    try { fn(estado, motivo, parche); }
    catch (e) { console.error("[store] suscriptor falló", e); }
  }
}

/** Se suscribe a cualquier cambio. Devuelve función para cancelar. */
export function subscribe(fn) {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

/* ---------- acciones de conveniencia ---------- */

export function setSesion(sesion, perfil = null) {
  const usuario = sesion?.user || null;
  const rol = derivarRol(perfil, usuario);
  set({ sesion, usuario, perfil, rol }, "sesion");
  emit(EV.AUTH_CAMBIO, { sesion, usuario, perfil, rol });
}

export function limpiarSesion() {
  set({
    sesion: null, usuario: null, perfil: null, rol: "invitado",
    reservas: [], favoritos: new Set(), notificaciones: [], noLeidas: 0, membresias: [],
  }, "logout");
  emit(EV.SESION_CERRADA);
}

function derivarRol(perfil, usuario) {
  if (!usuario) return "invitado";
  const meta = usuario.user_metadata || {};
  return perfil?.rol || meta.rol || "usuario";
}

export const esAdmin = () => ["admin", "superadmin"].includes(estado.rol);
export const esStaff = () => ["staff", "admin", "superadmin"].includes(estado.rol);
export const haySesion = () => Boolean(estado.sesion);

export function toggleFavoritoLocal(espacioId) {
  const id = String(espacioId);
  const next = new Set(estado.favoritos);
  next.has(id) ? next.delete(id) : next.add(id);
  set({ favoritos: next }, "favoritos");
  emit(EV.FAVORITOS_CAMBIO, next);
  return next.has(id);
}

export function esFavorito(espacioId) { return estado.favoritos.has(String(espacioId)); }

export function setConectado(v) {
  if (estado.conectado === v) return;
  set({ conectado: v }, "red");
  emit(EV.CONEXION, v);
}

export function setNotificaciones(lista) {
  // Último cortafuegos contra los avisos repetidos: la lista se
  // deduplica por id venga de donde venga (fetch inicial, websocket,
  // sincronización al recuperar la red o varias pestañas abiertas).
  const vistos = new Set();
  const unicas = [];
  for (const n of lista || []) {
    const id = String(n?.id ?? "");
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    unicas.push(n);
  }
  const noLeidas = unicas.filter((n) => !n.leida).length;
  set({ notificaciones: unicas, noLeidas }, "notificaciones");
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setConectado(true));
  window.addEventListener("offline", () => setConectado(false));
}

/* El objeto por defecto expone TODO lo público: varias vistas hacen
   `import store from "…/store.js"` y usan `store.loQueSea`. */
export default {
  get, set, subscribe, getEspacio,
  setSesion, limpiarSesion, esAdmin, esStaff, haySesion,
  toggleFavoritoLocal, esFavorito, setConectado, setNotificaciones,
};
