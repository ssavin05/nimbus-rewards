/* ======================================================================
   cache.js — Caché local en IndexedDB.

   Sirve para dos cosas:
     1. Que la app abra al instante mostrando lo último conocido
        (estrategia "stale-while-revalidate" a nivel de datos).
     2. Que siga siendo utilizable sin conexión.

   Si IndexedDB no está disponible (modo privado antiguo), cae a un
   Map en memoria: la app no se rompe, sólo pierde persistencia.
   ====================================================================== */

const NOMBRE_DB = "centro-oficinas";
const VERSION = 3;
export const ALMACENES = {
  datos: "datos",         // pares clave/valor con TTL
  espacios: "espacios",
  reservas: "reservas",
  outbox: "outbox",       // operaciones pendientes de enviar
  archivos: "archivos",   // blobs (fotos tomadas offline)
};

let dbPromesa = null;
const memoria = new Map();
let usandoMemoria = false;

function abrir() {
  if (dbPromesa) return dbPromesa;
  dbPromesa = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { usandoMemoria = true; resolve(null); return; }
    let req;
    try { req = indexedDB.open(NOMBRE_DB, VERSION); }
    catch { usandoMemoria = true; resolve(null); return; }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ALMACENES.datos)) db.createObjectStore(ALMACENES.datos, { keyPath: "clave" });
      if (!db.objectStoreNames.contains(ALMACENES.espacios)) db.createObjectStore(ALMACENES.espacios, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ALMACENES.reservas)) db.createObjectStore(ALMACENES.reservas, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ALMACENES.outbox)) {
        db.createObjectStore(ALMACENES.outbox, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(ALMACENES.archivos)) db.createObjectStore(ALMACENES.archivos, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { usandoMemoria = true; resolve(null); };
    req.onblocked = () => reject(new Error("IndexedDB bloqueada"));
  });
  return dbPromesa;
}

function tx(db, almacen, modo = "readonly") {
  return db.transaction(almacen, modo).objectStore(almacen);
}

/* ---------------------------------------------------------------------
   Puerta de purga
   ---------------------------------------------------------------------
   Cuando la base se limpia para el lanzamiento hay que tirar lo que este
   equipo tenga guardado. Ordenar las llamadas en `main.js` no basta:
   basta con que alguien añada mañana una lectura antes de tiempo para
   que vuelva la carrera, y esa clase de fallo no se ve en las pruebas
   porque depende de qué gane la carrera ese día.

   Así que la puerta está aquí abajo. Mientras haya una purga en marcha,
   TODA lectura espera. No es posible leer un dato caduco durante el
   primer arranque de una época nueva, venga la lectura de donde venga.

   Los borrados no esperan —son justamente lo que hace la purga— y las
   escrituras tampoco: guardar algo recién traído del servidor durante
   la purga es correcto, es dato nuevo.
   --------------------------------------------------------------------- */
let puertaPurga = null;

/** Cierra la puerta mientras corre `tarea`. La llama `lanzamiento.js`. */
export async function conPurga(tarea) {
  let abrirPuerta;
  puertaPurga = new Promise((r) => { abrirPuerta = r; });
  try {
    return await tarea();
  } finally {
    puertaPurga = null;
    abrirPuerta();
  }
}

/** ¿Hay una purga en marcha? Sólo para las pruebas y el diagnóstico. */
export const purgaEnCurso = () => puertaPurga !== null;

const esperarPurga = () => (puertaPurga ? puertaPurga : Promise.resolve());

function esperar(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------------------------------------------------------------------
   API clave/valor con expiración
   --------------------------------------------------------------------- */

/** Guarda un valor. `ttl` en milisegundos (0 = no expira). */
export async function guardar(clave, valor, ttl = 0) {
  const registro = { clave, valor, expira: ttl ? Date.now() + ttl : 0, ts: Date.now() };
  const db = await abrir();
  if (!db) { memoria.set(clave, registro); return valor; }
  try { await esperar(tx(db, ALMACENES.datos, "readwrite").put(registro)); }
  catch { memoria.set(clave, registro); }
  return valor;
}

/** Lee un valor; devuelve `porDefecto` si no existe o expiró. */
export async function leer(clave, porDefecto = null) {
  await esperarPurga();
  const db = await abrir();
  let registro;
  if (!db) registro = memoria.get(clave);
  else {
    try { registro = await esperar(tx(db, ALMACENES.datos).get(clave)); }
    catch { registro = memoria.get(clave); }
  }
  if (!registro) return porDefecto;
  if (registro.expira && registro.expira < Date.now()) { borrar(clave); return porDefecto; }
  return registro.valor;
}

/** Lee incluso si expiró, indicando su antigüedad. */
export async function leerConEdad(clave) {
  await esperarPurga();
  const db = await abrir();
  let registro;
  if (!db) registro = memoria.get(clave);
  else { try { registro = await esperar(tx(db, ALMACENES.datos).get(clave)); } catch { registro = memoria.get(clave); } }
  if (!registro) return { valor: null, edad: Infinity, vencido: true };
  return {
    valor: registro.valor,
    edad: Date.now() - registro.ts,
    vencido: Boolean(registro.expira && registro.expira < Date.now()),
  };
}

export async function borrar(clave) {
  memoria.delete(clave);
  const db = await abrir();
  if (!db) return;
  try { await esperar(tx(db, ALMACENES.datos, "readwrite").delete(clave)); } catch { /* ignora */ }
}

/**
 * Borra todas las claves que empiecen por un prefijo. Hace falta para
 * la purga de pre-lanzamiento: hay que tirar `disp:*` y `mapa:*` sin
 * llevarse por delante la cola de envíos ni el resto de la caché.
 */
export async function borrarPorPrefijo(prefijo) {
  let n = 0;
  for (const k of [...memoria.keys()]) {
    if (String(k).startsWith(prefijo)) { memoria.delete(k); n++; }
  }
  const db = await abrir();
  if (!db) return n;
  try {
    const almacen = tx(db, ALMACENES.datos, "readwrite");
    const claves = await esperar(almacen.getAllKeys());
    for (const k of claves || []) {
      if (String(k).startsWith(prefijo)) {
        await esperar(tx(db, ALMACENES.datos, "readwrite").delete(k));
        n++;
      }
    }
  } catch { /* ignora */ }
  return n;
}

/** Vacía un almacén concreto (nunca la cola de envíos). */
export async function vaciarAlmacen(nombre) {
  if (nombre === ALMACENES.outbox) return false;
  const db = await abrir();
  if (!db) return false;
  try { await esperar(tx(db, nombre, "readwrite").clear()); return true; }
  catch { return false; }
}

export async function limpiarTodo() {
  memoria.clear();
  const db = await abrir();
  if (!db) return;
  for (const nombre of Object.values(ALMACENES)) {
    if (nombre === ALMACENES.outbox) continue; // nunca se descartan cambios pendientes
    try { await esperar(tx(db, nombre, "readwrite").clear()); } catch { /* ignora */ }
  }
}

/* ---------------------------------------------------------------------
   Colecciones (espacios / reservas)
   --------------------------------------------------------------------- */
export async function guardarColeccion(almacen, filas) {
  const db = await abrir();
  if (!db) { memoria.set(`col:${almacen}`, { valor: filas, ts: Date.now() }); return filas; }
  try {
    const t = db.transaction(almacen, "readwrite").objectStore(almacen);
    await esperar(t.clear());
    for (const fila of filas || []) t.put(fila);
  } catch { memoria.set(`col:${almacen}`, { valor: filas, ts: Date.now() }); }
  return filas;
}

export async function leerColeccion(almacen) {
  await esperarPurga();          // el almacén `espacios` lo vacía la purga
  const db = await abrir();
  if (!db) return memoria.get(`col:${almacen}`)?.valor || [];
  try { return (await esperar(tx(db, almacen).getAll())) || []; }
  catch { return memoria.get(`col:${almacen}`)?.valor || []; }
}

export async function guardarFila(almacen, fila) {
  const db = await abrir();
  if (!db) return fila;
  try { await esperar(tx(db, almacen, "readwrite").put(fila)); } catch { /* ignora */ }
  return fila;
}

export async function borrarFila(almacen, id) {
  const db = await abrir();
  if (!db) return;
  try { await esperar(tx(db, almacen, "readwrite").delete(id)); } catch { /* ignora */ }
}

/* ---------------------------------------------------------------------
   Bandeja de salida (operaciones hechas sin conexión)
   --------------------------------------------------------------------- */
export async function encolar(operacion) {
  const registro = { ...operacion, ts: Date.now(), intentos: 0 };
  const db = await abrir();
  if (!db) {
    const cola = memoria.get("outbox")?.valor || [];
    cola.push({ ...registro, id: cola.length + 1 });
    memoria.set("outbox", { valor: cola });
    return registro;
  }
  try { registro.id = await esperar(tx(db, ALMACENES.outbox, "readwrite").add(registro)); }
  catch { /* ignora */ }
  return registro;
}

export async function listarCola() {
  const db = await abrir();
  if (!db) return memoria.get("outbox")?.valor || [];
  try { return (await esperar(tx(db, ALMACENES.outbox).getAll())) || []; }
  catch { return []; }
}

export async function quitarDeCola(id) {
  const db = await abrir();
  if (!db) {
    const cola = (memoria.get("outbox")?.valor || []).filter((o) => o.id !== id);
    memoria.set("outbox", { valor: cola });
    return;
  }
  try { await esperar(tx(db, ALMACENES.outbox, "readwrite").delete(id)); } catch { /* ignora */ }
}

export async function actualizarEnCola(registro) {
  const db = await abrir();
  if (!db) return;
  try { await esperar(tx(db, ALMACENES.outbox, "readwrite").put(registro)); } catch { /* ignora */ }
}

/** Tamaño aproximado usado, para la pantalla de Configuración. */
export async function usoEstimado() {
  if (navigator.storage?.estimate) {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usado: usage, cuota: quota };
    } catch { /* ignora */ }
  }
  return { usado: 0, cuota: 0 };
}

export const enMemoria = () => usandoMemoria;

export default {
  guardar, leer, leerConEdad, borrar, limpiarTodo, borrarPorPrefijo, vaciarAlmacen,
  guardarColeccion, leerColeccion, guardarFila, borrarFila,
  encolar, listarCola, quitarDeCola, actualizarEnCola, usoEstimado, ALMACENES,
  enMemoria, conPurga, purgaEnCurso,
};
