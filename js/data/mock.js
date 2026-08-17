/* ======================================================================
   mock.js — Datos de demostración.

   Se usan cuando no hay backend configurado o no se puede alcanzar, para
   que la aplicación siga siendo navegable (mapa 3D, precios, reservas
   simuladas). Reproducen el plano arquitectónico real del edificio.

   La disponibilidad es determinística (hash de sala + día): siempre se
   ve igual en cada recarga, a diferencia de Math.random().
   ====================================================================== */
import { BOOKING } from "../core/config.js";
import { isoFecha, uuid, rangoBloque } from "../core/utils.js";
import cache from "./cache.js";
import { espaciosDelPlano, ENVOLVENTE, CORREDORES } from "./planta.js";

const ORG_ID = "demo-org";

export const organizacion = () => ({
  id: ORG_ID, nombre: "Smart Hub", slug: "smart-hub",
  moneda: "MXN", zona_horaria: "America/Tijuana", tasa_impuesto: 0.16, activa: true, demo: true,
});

export const sedes = () => ([{
  id: "demo-sede", organizacion_id: ORG_ID, nombre: "Sede Ensenada", slug: "ensenada-centro",
  // Sin calle inventada: sólo la ciudad, que sí es donde opera Smart Hub.
  direccion: "", ciudad: "Ensenada", estado: "Baja California",
  lat: null, lng: null, activa: true, orden: 1,
}]);

export const edificios = () => ([{
  id: "demo-edificio", organizacion_id: ORG_ID, sede_id: "demo-sede",
  nombre: "Edificio Principal", ancho_m: ENVOLVENTE.ancho, fondo_m: ENVOLVENTE.fondo, activo: true, orden: 1,
  pisos: [{ id: "demo-piso", edificio_id: "demo-edificio", nombre: "Planta Baja", numero: 1, altura_m: 2.6, activo: true }],
}]);

export const amenidades = () => ([
  { clave: "wifi", etiqueta: "WiFi de alta velocidad", icono: "📶", orden: 1 },
  { clave: "ac", etiqueta: "Aire acondicionado", icono: "❄️", orden: 2 },
  { clave: "proyector", etiqueta: "Proyector / Pantalla", icono: "📽️", orden: 3 },
  { clave: "pizarron", etiqueta: "Pizarrón", icono: "🖊️", orden: 4 },
  { clave: "accesible", etiqueta: "Acceso para discapacidad", icono: "♿", orden: 5 },
  { clave: "estacionamiento", etiqueta: "Estacionamiento incluido", icono: "🚗", orden: 6 },
  { clave: "cafe", etiqueta: "Servicio de café", icono: "☕", orden: 7 },
  { clave: "impresora", etiqueta: "Impresora / Escáner", icono: "🖨️", orden: 8 },
  { clave: "videollamada", etiqueta: "Equipo de videollamada", icono: "🎥", orden: 9 },
  { clave: "lockers", etiqueta: "Lockers", icono: "🔒", orden: 10 },
  { clave: "recepcion", etiqueta: "Recepción de visitas", icono: "🛎️", orden: 11 },
  { clave: "cocina", etiqueta: "Acceso a cocina", icono: "🍳", orden: 12 },
]);

/* El plano real vive en planta.js: aquí sólo se le añaden los datos de
   demostración (calificaciones, contadores) que no son geometría. */
export { CORREDORES } from "./planta.js";   // re-exportado tal cual

let _espacios = null;

export function espacios() {
  if (_espacios) return _espacios;
  _espacios = espaciosDelPlano({
    organizacionId: ORG_ID, sedeId: "demo-sede",
    edificioId: "demo-edificio", pisoId: "demo-piso", prefijo: "demo-",
  }).map((e) => ({
    ...e,
    // Sin historial inventado: un catálogo recién puesto en marcha no
    // tiene 87 reservas ni 4,3 estrellas de 19 opiniones.
    calificacion: 0,
    total_resenas: 0,
    total_reservas: 0,
  }));
  return _espacios;
}

/* ---------- disponibilidad del modo local ----------
   Ya no hay ningún «patrón determinístico»: sólo ocupan los bloques que
   esta persona reservó en ESTE equipo. Esto sirve para probar sin
   Supabase, y nada más — no sabe nada de las reservas de los demás.

   Con Supabase configurado no se llama nunca: si la consulta falla,
   `api.getDisponibilidad` devuelve `null` («no se sabe») en vez de caer
   aquí. Verlo caer aquí con backend puesto sería un error. */

const reservasDemo = new Map();   // `${espacioId}|${fecha}` -> Set(bloques)

export async function disponibilidad(espacioId, fechaIso) {
  await cargarEstadoLocal();
  const clave = `${espacioId}|${fechaIso}`;
  const tomadas = reservasDemo.get(clave) || new Set();
  const esp = espacios().find((e) => e.id === espacioId);
  const cerrado = esp && esp.estado !== "disponible";
  return BOOKING.bloques.map((bloque) => {
    // Un espacio en mantenimiento o inactivo no se reserva.
    if (cerrado) return { bloque, libre: false };
    // Lo que YA reservó esta persona en este equipo sí ocupa de verdad.
    if (tomadas.has(bloque)) return { bloque, libre: false };
    // Un bloque que ya terminó no se puede reservar.
    const yaPaso = rangoBloque(fechaIso, bloque).fin.getTime() <= Date.now();
    // Y nada más. Antes había un `(hashInt(...) % 100) < 42` que pintaba
    // como ocupado el 42 % de los bloques para que la demostración se
    // viera con vida. En una instalación nueva eso hace que el negocio
    // parezca usado y que la gente no encuentre hueco: fuera.
    return { bloque, libre: !yaPaso };
  });
}

export async function disponibilidadMapa(fechaIso = isoFecha()) {
  await cargarEstadoLocal();
  const mapa = {};
  for (const e of espacios()) {
    if (!e.reservable) continue;
    const d = await disponibilidad(e.id, fechaIso);
    mapa[e.id] = { libres: d.filter((b) => b.libre).length, total: d.length };
  }
  return mapa;
}

/* ======================================================================
   ESCRITURAS — se guardan de verdad
   ======================================================================
   Antes esto vivía en dos variables en memoria: al recargar la página
   desaparecían las reservas, el historial y todo lo demás. Eso es lo que
   hacía que la app se sintiera "una demostración".

   Ahora el estado de DEMOSTRACIÓN se persiste en IndexedDB para que no
   desaparezca al recargar. No se sincroniza con Supabase: una reserva
   simulada nunca se convierte silenciosamente en una reserva real. La
   cola de data/sync.js sólo admite favoritos.
   ====================================================================== */
const CLAVE_ESTADO = "local:estado";

let misReservasDemo = [];
let promesaCarga = null;
let guardadoPendiente = null;

/**
 * Lee de disco una sola vez.
 *
 * Se devuelve la MISMA promesa a todo el mundo. Con una bandera
 * `cargado = true` puesta antes del `await`, quien llamara mientras se
 * leía se encontraba la lista todavía vacía y creía que no había nada
 * guardado: las reservas desaparecían al recargar la página.
 */
export function cargarEstadoLocal() {
  if (promesaCarga) return promesaCarga;
  promesaCarga = (async () => {
  try {
    const guardado = await cache.leer(CLAVE_ESTADO);
    if (!guardado) return;
    misReservasDemo = Array.isArray(guardado.reservas) ? guardado.reservas : [];
    for (const [clave, bloques] of Object.entries(guardado.ocupacion || {})) {
      reservasDemo.set(clave, new Set(bloques));
    }
    resenasPropias = Array.isArray(guardado.resenas) ? guardado.resenas : [];
    pagosLocales = Array.isArray(guardado.pagos) ? guardado.pagos : [];
  } catch { /* sin IndexedDB se sigue en memoria */ }
  })();
  return promesaCarga;
}

/**
 * Escribe a disco.
 *
 * SIN retraso. Antes agrupaba las escrituras en una ventana de 200 ms
 * "para no castigar el hilo principal", y eso costaba reservas: quien
 * reservaba y cerraba la pestaña —o navegaba— antes de que saltara el
 * temporizador, perdía la reserva. Son unos pocos kilobytes una vez por
 * acción; no hay nada que agrupar.
 */
function instantanea() {
  const ocupacion = {};
  for (const [clave, set] of reservasDemo) ocupacion[clave] = [...set];
  return { reservas: misReservasDemo, ocupacion, resenas: resenasPropias, pagos: pagosLocales };
}

function guardarEstadoLocal() {
  guardadoPendiente = cache.guardar(CLAVE_ESTADO, instantanea()).catch(() => {});
  return guardadoPendiente;
}

/* Red de seguridad: si el navegador se lleva la página por delante
   (cerrar pestaña, cambiar de app en el móvil), se fuerza una última
   escritura. `pagehide` es el único evento fiable en iOS. */
if (typeof window !== "undefined") {
  const alSalir = () => { try { cache.guardar(CLAVE_ESTADO, instantanea()); } catch { /* ignora */ } };
  window.addEventListener("pagehide", alSalir);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") alSalir();
  });
}

let resenasPropias = [];
let pagosLocales = [];

/**
 * Mismas reglas que `validar_ventana_reserva()` en la base de datos.
 *
 * Sin esto había DOS comportamientos distintos: el servidor rechazaba
 * una reserva en el pasado o con 99 999 asistentes, y la ruta local la
 * aceptaba tan tranquila. Un fallo que sólo aparece sin conexión es
 * peor que uno que aparece siempre, porque nadie lo ve venir.
 */
function validarReserva({ espacio, inicio, fin, asistentes }) {
  if (!espacio) throw new Error("Ese espacio no existe.");
  if (!espacio.reservable || espacio.estado !== "disponible") {
    throw new Error("Este espacio no está disponible para reservar.");
  }
  if (!(inicio instanceof Date) || isNaN(inicio) || !(fin instanceof Date) || isNaN(fin)) {
    throw new Error("La fecha o el horario no son válidos.");
  }
  if (fin <= inicio) throw new Error("La hora de fin tiene que ser posterior a la de inicio.");
  if (inicio.getTime() < Date.now() - 15 * 60000) throw new Error("No se puede reservar en el pasado.");
  if (inicio.getTime() > Date.now() + 365 * 864e5) {
    throw new Error("Sólo se puede reservar con un año de anticipación.");
  }

  const horas = (fin - inicio) / 3600000;
  if (horas > 24) throw new Error("Una reserva no puede durar más de 24 horas seguidas.");
  if (horas < 0.5) throw new Error("La reserva mínima es de media hora.");

  const cupo = Number(espacio.capacidad) || 1;
  const n = Number(asistentes);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    throw new Error("El número de asistentes no es válido.");
  }
  if (n > cupo) throw new Error(`El espacio admite hasta ${cupo} personas.`);

  const pendientes = misReservasDemo.filter(
    (r) => r.estado === "pendiente" && new Date(r.fin) > new Date()).length;
  if (pendientes >= 10) {
    throw new Error("Tienes demasiadas reservas pendientes. Págalas o cancélalas antes de crear otra.");
  }
  return horas;
}

export async function crearReserva({ espacioId, fecha, bloque, asistentes = 1, notas = "" }) {
  await cargarEstadoLocal();

  const esp = espacios().find((e) => e.id === espacioId);
  const { inicio, fin } = rangoBloque(fecha, bloque);
  const horas = validarReserva({ espacio: esp, inicio, fin, asistentes });

  const clave = `${espacioId}|${fecha}`;
  if (!reservasDemo.has(clave)) reservasDemo.set(clave, new Set());
  if (reservasDemo.get(clave).has(bloque)) throw new Error("Ese horario acaba de ocuparse. Elige otro.");
  reservasDemo.get(clave).add(bloque);

  const subtotal = (esp?.precio_hora || 0) * horas;
  const impuestos = Math.round(subtotal * 0.16 * 100) / 100;

  const reserva = {
    id: uuid(), folio: `RES-DEMO-${String(misReservasDemo.length + 1).padStart(4, "0")}`,
    espacio_id: espacioId, espacios: esp, inicio: inicio.toISOString(), fin: fin.toISOString(),
    estado: "confirmada", asistentes: Number(asistentes), notas: String(notas || "").slice(0, 1000),
    subtotal, descuento: 0, impuestos, total: subtotal + impuestos, moneda: "MXN",
    creado_en: new Date().toISOString(), demo: true,
  };
  misReservasDemo.unshift(reserva);
  // Cada reserva deja también su movimiento en el historial de pagos.
  pagosLocales.unshift({
    id: uuid(), folio: `PAG-${String(pagosLocales.length + 1).padStart(4, "0")}`,
    reserva_id: reserva.id, reservas: { folio: reserva.folio, inicio: reserva.inicio, espacios: esp },
    metodo: "pendiente", estado: "pendiente", monto: reserva.total, moneda: "MXN",
    creado_en: new Date().toISOString(),
  });
  guardarEstadoLocal();
  return reserva;
}

export async function cancelarReserva(id) {
  await cargarEstadoLocal();
  const r = misReservasDemo.find((x) => x.id === id);
  if (r) {
    r.estado = "cancelada";
    r.cancelada_en = new Date().toISOString();
    const fecha = isoFecha(new Date(r.inicio));
    const bloque = `${new Date(r.inicio).toTimeString().slice(0, 5)}-${new Date(r.fin).toTimeString().slice(0, 5)}`;
    reservasDemo.get(`${r.espacio_id}|${fecha}`)?.delete(bloque);
    guardarEstadoLocal();
  }
  return r;
}

export async function modificarReserva(id, { fecha, bloque }) {
  await cargarEstadoLocal();
  const r = misReservasDemo.find((x) => x.id === id);
  if (!r) throw new Error("Reserva no encontrada");
  const { inicio, fin } = rangoBloque(fecha, bloque);
  r.inicio = inicio.toISOString();
  r.fin = fin.toISOString();
  guardarEstadoLocal();
  return r;
}

export const misReservas = async () => { await cargarEstadoLocal(); return misReservasDemo; };

// Sin promociones comerciales inventadas en demo. Un código de ejemplo
// jamás debe poder parecer una oferta real.
export const promociones = () => [];

/* Aquí vivían NOMBRES y COMENTARIOS: el relleno con el que se
   fabricaban opiniones. Eliminados con las reseñas falsas. */

export async function resenas(espacioId) {
  await cargarEstadoLocal();
  // Sólo las que haya escrito esta persona en este equipo. Antes se
  // generaban entre 3 y 6 opiniones inventadas por espacio, con nombres
  // y comentarios de relleno: eso es una reseña falsa en una app que
  // vende, y no puede salir a producción.
  return resenasPropias.filter((r) => r.espacio_id === espacioId);
}

export function publicarResena({ espacioId, calificacion, comentario }) {
  const nueva = {
    id: uuid(), espacio_id: espacioId, calificacion, comentario,
    creado_en: new Date().toISOString(), autor_nombre: "Tú", visible: true, propia: true,
  };
  resenasPropias = resenasPropias.filter((r) => r.espacio_id !== espacioId);
  resenasPropias.unshift(nueva);
  guardarEstadoLocal();
  return nueva;
}

/** Historial de pagos guardado en el dispositivo. */
export const pagos = async () => { await cargarEstadoLocal(); return pagosLocales; };

export function listaEspera(espacioId, fecha, bloque) {
  return { id: uuid(), espacio_id: espacioId, fecha, bloque, activo: true, demo: true };
}

export default {
  organizacion, sedes, edificios, espacios, amenidades, CORREDORES,
  disponibilidad, disponibilidadMapa, crearReserva, cancelarReserva, modificarReserva,
  misReservas, promociones, resenas, publicarResena, listaEspera,
  pagos, cargarEstadoLocal,
};
