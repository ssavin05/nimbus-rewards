/* ======================================================================
   busqueda.js — Búsqueda inteligente y recomendaciones.

   Funciona sin servidor ni llaves de API: entiende lenguaje natural en
   español ("sala para 8 personas mañana por la tarde con proyector"),
   extrae intención y puntúa cada espacio. Si hay un asistente de IA
   configurado, éste reutiliza el mismo motor para filtrar.
   ====================================================================== */
import { normalizar, isoFecha, sumarDias, hashInt } from "../core/utils.js";
import store from "../core/store.js";

/* ---------------------------------------------------------------------
   Sinónimos: el usuario no escribe como está el catálogo.
   --------------------------------------------------------------------- */
const SINONIMOS = {
  oficina: ["oficina", "despacho", "privado", "privada", "cubiculo", "cubículo"],
  sala_juntas: ["sala", "juntas", "junta", "reunion", "reunión", "meeting", "conferencia", "board"],
  coworking: ["coworking", "abierto", "compartido", "escritorio", "hot desk", "flexible", "comunitario"],
  auditorio: ["auditorio", "evento", "conferencias", "capacitacion", "capacitación", "curso"],
  estacionamiento: ["estacionamiento", "cochera", "parking", "cajon", "cajón", "auto", "coche"],
};

const AMENIDAD_PALABRAS = {
  wifi: ["wifi", "internet", "red", "conexion", "conexión"],
  ac: ["aire", "clima", "acondicionado", "fresco", "frio", "frío"],
  proyector: ["proyector", "pantalla", "presentacion", "presentación", "proyeccion", "tv"],
  pizarron: ["pizarron", "pizarrón", "whiteboard", "brainstorm", "lluvia de ideas"],
  accesible: ["accesible", "discapacidad", "silla de ruedas", "rampa", "movilidad"],
  estacionamiento: ["estacionamiento", "parking", "cochera", "auto", "coche", "carro"],
  cafe: ["cafe", "café", "coffee", "bebidas", "snacks"],
  impresora: ["impresora", "imprimir", "escaner", "escáner", "copias"],
  videollamada: ["videollamada", "zoom", "teams", "camara", "cámara", "remoto", "hibrida", "híbrida"],
  lockers: ["locker", "lockers", "casillero", "guardar"],
  recepcion: ["recepcion", "recepción", "visitas", "clientes", "atencion", "atención"],
};

const PALABRAS_FECHA = [
  [/\bhoy\b/, 0], [/\bma(n|ñ)ana\b/, 1], [/\bpasado ma(n|ñ)ana\b/, 2],
  [/\blunes\b/, "lunes"], [/\bmartes\b/, "martes"], [/\bmi(e|é)rcoles\b/, "miercoles"],
  [/\bjueves\b/, "jueves"], [/\bviernes\b/, "viernes"], [/\bs(a|á)bado\b/, "sabado"], [/\bdomingo\b/, "domingo"],
];
const DIAS_SEMANA = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

const FRANJAS = {
  manana: ["08:00-09:00", "09:00-10:00", "10:00-11:00", "11:00-12:00"],
  tarde: ["12:00-13:00", "13:00-14:00", "14:00-15:00", "15:00-16:00", "16:00-17:00"],
  noche: ["17:00-18:00", "18:00-19:00"],
};

/**
 * Extrae la intención de una frase libre.
 * → { texto, tipo, capacidad, amenidades, fecha, franja, precioMax, soloLibres }
 */
export function interpretar(consulta) {
  const q = normalizar(consulta);
  const intencion = {
    texto: q, tipo: null, capacidad: null, amenidades: [],
    fecha: null, franja: null, precioMax: null, soloLibres: false,
  };

  for (const [tipo, palabras] of Object.entries(SINONIMOS)) {
    if (palabras.some((p) => q.includes(p))) { intencion.tipo = tipo; break; }
  }

  for (const [clave, palabras] of Object.entries(AMENIDAD_PALABRAS)) {
    if (palabras.some((p) => q.includes(p))) intencion.amenidades.push(clave);
  }

  // "para 8 personas", "8 personas", "de 10"
  const cap = q.match(/(?:para\s+|de\s+)?(\d{1,3})\s*(?:personas?|gentes?|pax|lugares?|asistentes?)/)
    || q.match(/\b(?:para|somos)\s+(\d{1,3})\b/);
  if (cap) intencion.capacidad = Number(cap[1]);

  // "menos de 300", "hasta $250", "máximo 200"
  const precio = q.match(/(?:menos de|hasta|maximo|máximo|max|por debajo de)\s*\$?\s*(\d{2,6})/);
  if (precio) intencion.precioMax = Number(precio[1]);

  for (const [re, valor] of PALABRAS_FECHA) {
    if (re.test(q)) {
      if (typeof valor === "number") intencion.fecha = isoFecha(sumarDias(new Date(), valor));
      else {
        const objetivo = DIAS_SEMANA[valor];
        const hoy = new Date();
        let delta = (objetivo - hoy.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        intencion.fecha = isoFecha(sumarDias(hoy, delta));
      }
      break;
    }
  }

  if (/\bma(n|ñ)ana por la ma(n|ñ)ana\b|\bpor la ma(n|ñ)ana\b|\btemprano\b|\bam\b/.test(q)) intencion.franja = "manana";
  else if (/\bpor la tarde\b|\btarde\b|\bpm\b/.test(q)) intencion.franja = "tarde";
  else if (/\bnoche\b|\btardeada\b/.test(q)) intencion.franja = "noche";

  if (/\blibre\b|\bdisponible\b|\bahora\b|\bya\b/.test(q)) intencion.soloLibres = true;

  return intencion;
}

/** Distancia de edición acotada, para tolerar erratas cortas. */
function similar(a, b) {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;
  if (b.includes(a) || a.includes(b)) return 0.85;
  let coincidencias = 0;
  const usados = new Array(b.length).fill(false);
  for (const c of a) {
    const i = b.split("").findIndex((d, j) => !usados[j] && d === c);
    if (i >= 0) { usados[i] = true; coincidencias++; }
  }
  return coincidencias / Math.max(a.length, b.length);
}

/**
 * Busca espacios. Devuelve [{ espacio, puntaje, razon }] ordenado.
 * `disponibilidad` es el mapa { espacioId: {libres,total} } del día actual.
 */
export async function buscar(consulta, espacios = null, disponibilidad = {}) {
  const lista = (espacios || store.get().espacios || []).filter((e) => e.activo !== false);
  const intencion = interpretar(consulta);
  const terminos = intencion.texto.split(/\s+/).filter((w) => w.length > 2);

  /* ¿La consulta pide algo concreto? Si sólo trae palabras sueltas y
     ninguna casa con nada, el resultado correcto es "no hay nada", no
     el catálogo entero ordenado por popularidad. */
  const hayIntencion = Boolean(intencion.tipo) || Boolean(intencion.capacidad)
    || intencion.amenidades.length > 0 || Boolean(intencion.precioMax);
  const exigeCoincidencia = terminos.length > 0 && !hayIntencion;

  const resultados = [];
  for (const espacio of lista) {
    let puntaje = 0;
    let coincide = false;      // ¿algo de la consulta casó de verdad?
    const razones = [];

    const nombre = normalizar(espacio.nombre);
    const codigo = normalizar(espacio.codigo || "");
    const desc = normalizar(espacio.descripcion || "");

    // Coincidencia textual
    for (const term of terminos) {
      if (nombre.includes(term)) { puntaje += 12; coincide = true; }
      else if (codigo.includes(term)) { puntaje += 10; coincide = true; }
      else if (desc.includes(term)) { puntaje += 3; coincide = true; }
      else if ((espacio.amenidades || []).some((a) => normalizar(a).includes(term))) {
        puntaje += 8; coincide = true;
      } else {
        const s = similar(term, nombre);
        if (s > 0.72) { puntaje += 6; coincide = true; }   // tolera erratas
      }
    }

    // Tipo
    if (intencion.tipo) {
      if (espacio.tipo === intencion.tipo) { puntaje += 18; razones.push("tipo de espacio"); }
      else puntaje -= 4;
    }

    // Capacidad: premia el ajuste justo, castiga quedarse corto
    if (intencion.capacidad) {
      const cap = Number(espacio.capacidad) || 0;
      if (cap >= intencion.capacidad) {
        puntaje += 14 - Math.min(10, cap - intencion.capacidad);
        razones.push(`hasta ${cap} personas`);
      } else {
        puntaje -= 25;
      }
    }

    // Amenidades
    if (intencion.amenidades.length) {
      const tiene = intencion.amenidades.filter((a) => (espacio.amenidades || []).includes(a));
      puntaje += tiene.length * 9 - (intencion.amenidades.length - tiene.length) * 6;
      if (tiene.length) razones.push(tiene.join(", "));
    }

    // Precio
    const precio = Number(espacio.precio_hora ?? espacio.precioHora ?? 0);
    if (intencion.precioMax) {
      if (precio && precio <= intencion.precioMax) { puntaje += 10; razones.push(`$${precio}/h`); }
      else if (precio) puntaje -= 14;
    }

    // Disponibilidad
    const disp = disponibilidad[espacio.id];
    if (disp) {
      if (disp.libres > 0) { puntaje += Math.min(8, disp.libres); razones.push(`${disp.libres} horarios libres`); }
      else if (intencion.soloLibres) puntaje -= 30;
    }
    if (!espacio.reservable) puntaje -= 12;
    if (espacio.estado && espacio.estado !== "disponible") puntaje -= 20;

    // Calidad y popularidad como desempate
    puntaje += Number(espacio.calificacion || 0) * 1.5;
    puntaje += Math.min(4, Number(espacio.total_reservas || 0) / 25);

    // La calificación, la popularidad y los horarios libres son DESEMPATES,
    // no motivos para aparecer. Antes bastaban para colar el catálogo
    // entero ante cualquier palabra inventada: buscar "ZZZZZ" devolvía
    // ocho oficinas.
    if (exigeCoincidencia && !coincide) continue;
    if (puntaje > 4) resultados.push({ espacio, puntaje, razon: razones.slice(0, 2).join(" · ") });
  }

  resultados.sort((a, b) => b.puntaje - a.puntaje);
  return resultados;
}

/** Búsqueda estricta por texto, para el buscador del mapa 3D. */
export function buscarSimple(consulta, espacios = null) {
  const q = normalizar(consulta);
  if (!q) return [];
  return (espacios || store.get().espacios || []).filter((e) =>
    normalizar(e.nombre).includes(q) || normalizar(e.codigo || "").includes(q)
    || normalizar(e.descripcion || "").includes(q)
    || (e.amenidades || []).some((a) => normalizar(a).includes(q))
  ).slice(0, 12);
}

/**
 * Recomendación personalizada: mezcla historial del usuario, favoritos,
 * disponibilidad de hoy, calificación y precio.
 */
export function recomendar(espacios = null, disponibilidad = {}, limite = 12) {
  const lista = (espacios || store.get().espacios || []).filter((e) => {
    const codigo = String(e.codigo || "").toUpperCase();
    return ["OF-A", "OF-B", "OF-C", "OF-D"].includes(codigo) && e.activo !== false;
  });
  const { reservas, favoritos } = store.get();

  // Preferencias inferidas del historial.
  const tiposUsados = new Map();
  const amenidadesUsadas = new Map();
  for (const r of reservas || []) {
    const e = r.espacios || store.getEspacio(r.espacio_id);
    if (!e) continue;
    tiposUsados.set(e.tipo, (tiposUsados.get(e.tipo) || 0) + 1);
    for (const a of e.amenidades || []) amenidadesUsadas.set(a, (amenidadesUsadas.get(a) || 0) + 1);
  }

  const puntuadas = lista.map((e) => {
    let p = 0;
    const disp = disponibilidad[e.id];
    if (disp) p += Math.min(14, disp.libres * 2.4);
    if (e.estado !== "disponible") p -= 30;
    p += Number(e.calificacion || 0) * 4;
    p += Math.min(6, Number(e.total_reservas || 0) / 20);
    if (favoritos?.has(String(e.id))) p += 16;
    p += (tiposUsados.get(e.tipo) || 0) * 5;
    for (const a of e.amenidades || []) p += (amenidadesUsadas.get(a) || 0) * 1.5;
    // Un poco de variedad estable por día para que no salga siempre lo mismo.
    p += (hashInt(`${e.id}|${isoFecha()}`) % 100) / 40;
    return { e, p };
  });

  puntuadas.sort((a, b) => b.p - a.p);
  return puntuadas.slice(0, limite).map((x) => x.e);
}

/** Sugerencia de horario alternativo cuando el elegido está ocupado. */
export function sugerirAlternativas(disponibilidadDia, bloqueDeseado) {
  const libres = (disponibilidadDia || []).filter((b) => b.libre).map((b) => b.bloque);
  if (!libres.length) return [];
  const idx = (disponibilidadDia || []).findIndex((b) => b.bloque === bloqueDeseado);
  return libres
    .map((b) => ({ bloque: b, distancia: Math.abs((disponibilidadDia.findIndex((x) => x.bloque === b)) - idx) }))
    .sort((a, b) => a.distancia - b.distancia)
    .slice(0, 3)
    .map((x) => x.bloque);
}

export default { buscar, buscarSimple, interpretar, recomendar, sugerirAlternativas, FRANJAS };
