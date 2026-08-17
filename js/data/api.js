/* ======================================================================
   api.js — Única puerta de entrada a los datos.

   Estrategia por consulta:
     1. Devuelve al instante lo que haya en caché (IndexedDB).
     2. Pide al servidor en segundo plano y actualiza.
     3. Sin conexión: conserva lectura en caché. Las operaciones críticas
        (reservar, modificar, cancelar y pagar) fallan de forma explícita;
        sólo acciones de bajo riesgo como favoritos pueden quedar en cola.

   Ninguna vista habla con Supabase directamente: todas pasan por aquí.
   ====================================================================== */
import { getDB, mensajeError, invocarFuncion } from "./db.js";
import cache from "./cache.js";
import store from "../core/store.js";
import { getAjustes, BOOKING, PAYMENTS, isBackendConfigured } from "../core/config.js";
import { emit, EV } from "../core/bus.js";
import { isoFecha, rangoBloque, duracionHoras, uuid, hashInt } from "../core/utils.js";
import * as mock from "./mock.js";
import { aplicarMediosLocales } from "./medios-locales.js";

const TTL = {
  catalogo: 30 * 60 * 1000,   // espacios, sedes, amenidades
  disponibilidad: 60 * 1000,  // se refresca seguido, y realtime lo invalida
  reservas: 5 * 60 * 1000,
  resenas: 10 * 60 * 1000,
};

let modoDemo = false;
const BACKEND_ESPERADO = isBackendConfigured();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODIGOS_RESERVABLES_V1 = new Set(["OF-A", "OF-B", "OF-C", "OF-D"]);
const NOMBRES_RESERVABLES_V1 = new Map([
  ["OFICINA A", "OF-A"], ["EJECUTIVA PLUS", "OF-A"],
  ["OFICINA B", "OF-B"], ["EJECUTIVA COMPACT", "OF-B"],
  ["OFICINA C", "OF-C"], ["PREMIUM PATIO VIEW", "OF-C"],
  ["OFICINA D", "OF-D"], ["EJECUTIVA LOUNGE", "OF-D"],
]);
function textoCanonico(v) {
  return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}
export function codigoReservableV1(espacio) {
  const codigo = textoCanonico(espacio?.codigo);
  if (CODIGOS_RESERVABLES_V1.has(codigo)) return codigo;
  return NOMBRES_RESERVABLES_V1.get(textoCanonico(espacio?.nombre))
    || NOMBRES_RESERVABLES_V1.get(textoCanonico(espacio?.nombre_mapa))
    || null;
}
export function esReservableV1(espacio) {
  // En V1 el catálogo comercial es A/B/C/D. No usamos únicamente el
  // booleano `reservable`, porque bases antiguas dejaron Patio/Jardín y
  // otros espacios con ese flag en true y entonces la UI los ofrecía
  // para luego rechazarlos al entrar a la reservación.
  return Boolean(codigoReservableV1(espacio))
    && espacio?.activo !== false
    && !["mantenimiento", "inactiva", "inactivo"].includes(String(espacio?.estado || "").toLowerCase());
}
function idEspacioAceptable(id) {
  return !BACKEND_ESPERADO || UUID_RE.test(String(id || ""));
}
function espacioReservableV1(espacio) {
  return esReservableV1(espacio);
}
/** true cuando el catálogo está usando el respaldo local. */
export const enModoDemo = () => modoDemo;

function activarDemo(motivo) {
  // Si este despliegue TIENE Supabase configurado, una caída transitoria
  // no puede convertir el proceso entero en demo hasta recargar. Eso
  // mezclaba IDs `demo-*` con columnas UUID y, peor, podía hacer que la
  // app siguiera local aun después de recuperar la red. En producción
  // el respaldo local es sólo de lectura; las escrituras siguen cerradas.
  if (BACKEND_ESPERADO) {
    console.warn("[api] backend temporalmente no disponible:", motivo);
    return;
  }
  if (!modoDemo) {
    modoDemo = true;
    mock.cargarEstadoLocal?.();
    console.info("[api] modo local activo:", motivo);
  }
}

/* ---------------------------------------------------------------------
   Primera pantalla: nunca se espera a la red

   El problema medido: sin caché, la portada tardaba 15 s en aparecer. No
   era el tiempo de carga de la biblioteca (eso ya tiene tope), sino que
   la CONSULTA en sí no tenía ninguno: si el servidor no contesta pero
   tampoco rechaza —red mala, wifi de hotel, DNS lento— la promesa se
   queda colgada y la vista, en blanco.

   Ahora la primera consulta compite contra un cronómetro. Si pierde, se
   pinta al instante con el plano y la caché local y la respuesta del
   servidor, cuando llegue, refresca la pantalla sin cortar nada.
   --------------------------------------------------------------------- */
const ESPERA_PRIMERA_PINTADA = 600;    // ms antes de tirar de datos locales
const ESPERA_CONSULTA = 4000;          // ms antes de dar la consulta por muerta

function conTiempo(promesa, ms, etiqueta) {
  let reloj;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error(`tiempo agotado: ${etiqueta}`)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

/**
 * Devuelve lo primero que esté listo: la red si es rápida, el respaldo
 * que le pase quien llama si no. La promesa de red sigue viva y
 * actualiza al terminar.
 *
 * Ojo con qué se le pasa como respaldo. Para el catálogo es el plano
 * local, que es fiel. Para la disponibilidad es la caché o `null`:
 * nunca el catálogo local, porque no sabe nada de las reservas de los
 * demás y sus horarios serían una invención.
 */
async function loQueLlegueAntes(promesaRed, datosLocales, ms = ESPERA_PRIMERA_PINTADA) {
  let dormir;
  const espera = new Promise((r) => { dormir = setTimeout(() => r(Symbol.for("tarde")), ms); });
  try {
    const ganador = await Promise.race([promesaRed.catch(() => Symbol.for("tarde")), espera]);
    if (ganador !== Symbol.for("tarde")) return ganador;
    return typeof datosLocales === "function" ? datosLocales() : datosLocales;
  } finally { clearTimeout(dormir); }
}

/* =====================================================================
   CATÁLOGO
   ===================================================================== */

/* La portada pide la organización y, acto seguido, los espacios —que
   la vuelven a pedir—. Sin memoizar, cada llamada abría su propia
   espera de 1,2 s y se sumaban. Se comparte la misma promesa. */
let orgEnCurso = null;

/** Organización activa (la primera disponible, o la guardada). */
export async function getOrganizacion() {
  const yaEnEstado = store.get().organizacion;
  if (yaEnEstado) return yaEnEstado;
  if (orgEnCurso) return orgEnCurso;
  orgEnCurso = resolverOrganizacion().finally(() => { orgEnCurso = null; });
  return orgEnCurso;
}

async function resolverOrganizacion() {
  const enCache = await cache.leer("organizacion");
  // Versiones antiguas pudieron guardar `demo-org` aun teniendo Supabase
  // configurado. No volvemos a inyectar ese ID en consultas UUID.
  if (enCache && (!BACKEND_ESPERADO || UUID_RE.test(String(enCache.id || "")))) {
    hidratarOrg(enCache);
    refrescarOrganizacion().catch(() => {});
    return enCache;
  }
  if (enCache && BACKEND_ESPERADO) await cache.borrar("organizacion");

  // Con backend configurado se espera la consulta real (máximo 4 s).
  // Si falla, devuelve null: getEspacios puede enseñar el plano local,
  // pero ninguna consulta ni escritura recibe un ID de demostración.
  if (BACKEND_ESPERADO) return refrescarOrganizacion();

  return loQueLlegueAntes(refrescarOrganizacion(), () => {
    const o = mock.organizacion();
    hidratarOrg(o);
    return o;
  });
}

async function refrescarOrganizacion() {
  const db = await getDB();
  if (!db) {
    activarDemo("sin cliente");
    if (BACKEND_ESPERADO) return null;
    const o = mock.organizacion(); hidratarOrg(o); return o;
  }
  let data = null, error = null;
  try {
    ({ data, error } = await conTiempo(
      db.from("organizaciones").select("*").eq("activa", true).order("creado_en").limit(1).maybeSingle(),
      ESPERA_CONSULTA, "organizaciones"));
  } catch (e) { error = e; }
  if (error || !data) {
    activarDemo(error?.message || "sin organizaciones");
    if (BACKEND_ESPERADO) return null;
    const o = mock.organizacion(); hidratarOrg(o); return o;
  }
  modoDemo = false;
  await cache.guardar("organizacion", data, TTL.catalogo);
  hidratarOrg(data);
  return data;
}

function hidratarOrg(org) { store.set({ organizacion: org }, "organizacion"); }

export async function getSedes() {
  const org = await getOrganizacion();
  if (BACKEND_ESPERADO && !UUID_RE.test(String(org?.id || ""))) {
    const locales = mock.sedes();
    store.set({ sedes: locales }, "sedes");
    return locales;
  }
  const clave = `sedes:${org?.id}`;
  const enCache = await cache.leer(clave);
  if (enCache) { store.set({ sedes: enCache }, "sedes"); refrescarSedes(org, clave); return enCache; }
  // Misma carrera que el resto del catálogo. Sin ella esta llamada
  // esperaba a la red hasta rendirse: medido en 3,5 s con el backend
  // inalcanzable, y la portada la pide al arrancar.
  return loQueLlegueAntes(
    refrescarSedes(org, clave),
    () => { const s = mock.sedes(); store.set({ sedes: s }, "sedes"); return s; }
  );
}

async function refrescarSedes(org, clave) {
  const db = await getDB();
  if (!db || modoDemo) { const s = mock.sedes(); store.set({ sedes: s }, "sedes"); return s; }
  // Con tope: una consulta sin cronómetro puede quedarse colgada para
  // siempre si el servidor no contesta pero tampoco rechaza.
  let data = null, error = null;
  try {
    ({ data, error } = await conTiempo(
      db.from("sedes").select("*").eq("organizacion_id", org.id).eq("activa", true).order("orden"),
      ESPERA_CONSULTA, "sedes"));
  } catch (e) { error = e; }
  if (error) return store.get().sedes || mock.sedes();
  // Aquí había `datos = sinOcultos(datos);`, con dos fallos a la vez:
  //
  //   · `datos` no existe —la variable es `data`—, y en un módulo ES,
  //     que siempre es modo estricto, asignar a algo no declarado lanza
  //     ReferenceError. O sea que esta función reventaba entera en
  //     cuanto la consulta de sedes devolvía filas. No saltaba en las
  //     pruebas porque sin Supabase alcanzable se sale antes, por la
  //     rama del modo local.
  //
  //   · Y aunque hubiera dicho `data`, estaba mal: el mapa `ocultos`
  //     de la administración lleva identificadores de ESPACIOS
  //     (apariencia.js lo escribe como `ocultos.${espacio.id}`), no de
  //     sedes. Filtrar sedes con él no significa nada.
  //
  // El filtro de ocultos se aplica donde corresponde, en los espacios.
  await cache.guardar(clave, data, TTL.catalogo);
  store.set({ sedes: data }, "sedes");
  return data;
}

export async function getEdificios(sedeId = null) {
  const org = await getOrganizacion();
  if (BACKEND_ESPERADO && !UUID_RE.test(String(org?.id || ""))) {
    const locales = mock.edificios();
    store.set({ edificios: locales, pisos: locales.flatMap((e) => e.pisos || []) }, "edificios");
    return locales;
  }
  const clave = `edificios:${org?.id}:${sedeId || "all"}`;

  const enCache = await cache.leer(clave);
  if (enCache?.length) {
    store.set({ edificios: enCache, pisos: enCache.flatMap((e) => e.pisos || []) }, "edificios");
    refrescarEdificios(org, sedeId, clave).catch(() => {});
    return enCache;
  }

  /* Esta función era la única del catálogo sin cronómetro ni respaldo:
     ni leía caché, ni ponía tope a la consulta, ni competía contra el
     reloj. Justo el caso que describe el comentario de arriba —«si el
     servidor no contesta pero tampoco rechaza, la promesa se queda
     colgada y la vista, en blanco»—, y el mapa 3D depende de ella para
     saber las medidas del edificio: sin respuesta, no se dibuja nada.
     Medido con el backend inalcanzable: 3,5 s de pantalla vacía, frente
     a los 0,6 s de getEspacios(). Ahora se comporta igual que las
     demás. */
  return loQueLlegueAntes(
    refrescarEdificios(org, sedeId, clave),
    () => {
      const e = mock.edificios();
      store.set({ edificios: e, pisos: e.flatMap((x) => x.pisos || []) }, "edificios");
      return e;
    }
  );
}

async function refrescarEdificios(org, sedeId, clave) {
  const db = await getDB();
  if (!db || modoDemo) {
    const e = mock.edificios();
    store.set({ edificios: e, pisos: e.flatMap((x) => x.pisos || []) }, "edificios");
    return e;
  }
  let q = db.from("edificios").select("*, pisos(*)")
    .eq("organizacion_id", org.id).eq("activo", true).order("orden");
  if (sedeId) q = q.eq("sede_id", sedeId);

  let data = null, error = null;
  try {
    ({ data, error } = await conTiempo(q, ESPERA_CONSULTA, "edificios"));
  } catch (e) { error = e; }
  if (error || !data?.length) return store.get().edificios || mock.edificios();

  store.set({ edificios: data, pisos: data.flatMap((e) => e.pisos || []) }, "edificios");
  await cache.guardar(clave, data, TTL.catalogo);
  return data;
}

/** Catálogo de espacios (oficinas, salas y espacios informativos). */
export async function getEspacios({ sedeId = null, pisoId = null, forzar = false } = {}) {
  const org = await getOrganizacion();
  if (BACKEND_ESPERADO && !UUID_RE.test(String(org?.id || ""))) {
    const locales = sinOcultos(mock.espacios());
    store.set({ espacios: locales }, "espacios");
    return locales;
  }
  const clave = `espacios:${org?.id}:${sedeId || "all"}:${pisoId || "all"}`;

  if (!forzar) {
    const enCache = await cache.leer(clave);
    if (enCache?.length) {
      const hidratados = enCache.map(aplicarMediosLocales);
      store.set({ espacios: hidratados }, "espacios");
      refrescarEspacios(org, sedeId, pisoId, clave).catch(() => {});
      return hidratados;
    }
  }
  // En producción NO devolvemos durante 600 ms espacios mock con IDs
  // como "of-a": la base usa UUIDs y un clic rápido podía acabar en
  // 22P02 (invalid input syntax for type uuid). Sin caché esperamos la
  // consulta real hasta su límite de 4 s. Si de verdad falla, el
  // catálogo local puede mostrarse, pero disponibilidad/escrituras
  // quedan cerradas por las guardas de BACKEND_ESPERADO.
  if (BACKEND_ESPERADO) return refrescarEspacios(org, sedeId, pisoId, clave);
  return loQueLlegueAntes(
    refrescarEspacios(org, sedeId, pisoId, clave),
    () => {
      const e = sinOcultos(mock.espacios());
      store.set({ espacios: e }, "espacios");
      return e;
    }
  );
}

/** Quita los espacios que la administración escondió (/admin/apariencia). */
function sinOcultos(lista) {
  const ocultos = getAjustes().ocultos || {};
  const hay = Object.values(ocultos).some(Boolean);
  if (!hay) return lista;
  return lista.filter((e) => !ocultos[String(e.id)]);
}

async function refrescarEspacios(org, sedeId, pisoId, clave) {
  const db = await getDB();
  if (!db || modoDemo) {
    const e = sinOcultos(mock.espacios());
    store.set({ espacios: e }, "espacios");
    return e;
  }
  let q = db.from("espacios")
    .select("*, espacio_fotos(id, url, titulo, es_portada, es_360, orden)")
    .eq("organizacion_id", org.id)
    .eq("activo", true)
    .order("codigo");
  if (sedeId) q = q.eq("sede_id", sedeId);
  if (pisoId) q = q.eq("piso_id", pisoId);

  let data = null, error = null;
  try { ({ data, error } = await conTiempo(q, ESPERA_CONSULTA, "espacios")); }
  catch (e) { error = e; }
  if (error) {
    console.warn("[api] getEspacios", error);
    const local = await cache.leer(clave);
    if (local?.length) {
      const hidratados = sinOcultos(local.map(aplicarMediosLocales));
      store.set({ espacios: hidratados }, "espacios");
      return hidratados;
    }
    activarDemo(error.message);
    const e = mock.espacios();
    store.set({ espacios: e }, "espacios");
    return e;
  }

  const espacios = sinOcultos((data || []).map(normalizarEspacio));
  await cache.guardar(clave, espacios, TTL.catalogo);
  await cache.guardarColeccion(cache.ALMACENES.espacios, espacios);
  store.set({ espacios }, "espacios");
  emit(EV.ESPACIOS_CAMBIO, espacios);
  return espacios;
}

function normalizarEspacio(e) {
  const fotos = (e.espacio_fotos || []).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  return aplicarMediosLocales({
    ...e,
    id: String(e.id),
    fotos,
    portada: fotos.find((f) => f.es_portada)?.url || fotos[0]?.url || null,
    panoramas: fotos.filter((f) => f.es_360).map((f) => f.url),
    precioHora: Number(e.precio_hora) || 0,
    precioDia: e.precio_dia != null ? Number(e.precio_dia) : null,
    amenidades: e.amenidades || [],
    servicios: e.servicios || [],
  });
}

export async function getEspacio(id) {
  // Si la administración lo escondió, tampoco se llega por la URL
  // directa. Antes sólo desaparecía del catálogo y del mapa, así que
  // bastaba con conocer el enlace para verlo y reservarlo igual.
  if ((getAjustes().ocultos || {})[String(id)]) return null;

  const local = store.getEspacio(id);
  if (local) return aplicarMediosLocales(local);

  const delPlano = () => mock.espacios().find((e) => String(e.id) === String(id)) || null;

  const db = await getDB();
  if (!db || modoDemo) return delPlano();

  // Con la biblioteca cargada pero el servidor inalcanzable, esta
  // consulta se quedaba colgada y la ficha del espacio salía en blanco
  // para siempre. Ahora tiene tope y respaldo local.
  const consulta = (async () => {
    const { data, error } = await conTiempo(
      db.from("espacios")
        .select("*, espacio_fotos(*), pisos(nombre, numero), edificios(nombre), sedes(nombre, direccion, lat, lng)")
        .eq("id", id).maybeSingle(),
      ESPERA_CONSULTA, "espacio");
    if (error) throw error;
    return data ? normalizarEspacio(data) : delPlano();
  })().catch((e) => {
    activarDemo(e?.message || "espacio sin respuesta");
    return delPlano();
  });

  // Si el servidor no contesta rápido se pinta la ficha del plano; la
  // respuesta real, si llega, actualiza el catálogo por su cuenta.
  return loQueLlegueAntes(consulta, delPlano);
}

export async function getAmenidades() {
  const enCache = await cache.leer("amenidades");
  if (enCache) return enCache;
  const db = await getDB();
  if (!db || modoDemo) return mock.amenidades();

  // Está en el camino crítico de la ficha del espacio: si tarda, se
  // devuelve el catálogo local y el del servidor entra después. Antes
  // esta sola consulta dejaba la ficha en esqueletos 12 segundos.
  const consulta = (async () => {
    const { data, error } = await db.from("amenidades").select("*").order("orden");
    if (error || !data?.length) return mock.amenidades();
    await cache.guardar("amenidades", data, 24 * 60 * 60 * 1000);
    return data;
  })().catch(() => mock.amenidades());

  return loQueLlegueAntes(consulta, () => mock.amenidades());
}

/* =====================================================================
   DISPONIBILIDAD EN TIEMPO REAL
   ===================================================================== */

/* ---------------------------------------------------------------------
   LA DISPONIBILIDAD NO SE GUARDA EN CACHÉ. NUNCA.

   Con Supabase configurado, estas dos funciones no leen ni escriben
   IndexedDB. Sólo hay dos respuestas posibles: lo que diga el servidor
   ahora mismo, o `null`.

   Por qué se quitó la caché entera en vez de sólo dejar de leerla al
   fallar: mientras el dato exista en disco, alguien acabará leyéndolo.
   Un TTL de minutos parece inofensivo, pero un horario se ocupa en
   segundos. Enseñar «libre» algo que se acaba de reservar lleva a que
   dos personas paguen el mismo despacho, y eso no se arregla con un
   mensaje de error: hay que devolver el dinero a una de las dos.

   Lo que se pierde es velocidad al repintar. Es un precio pequeño.

   El modo local (sin Supabase) sigue con `mock`, que no consulta a
   nadie y sólo sabe de las reservas hechas en este equipo.
   --------------------------------------------------------------------- */

/** Techo para las consultas de disponibilidad. Pasado esto, «no se sabe». */
const ESPERA_DISPONIBILIDAD = 6000;

/**
 * Disponibilidad de un espacio en un día.
 *
 * Devuelve una de tres cosas, y hay que distinguirlas:
 *
 *   [{ bloque, libre }]  lo que dice el servidor AHORA.
 *   []                   el espacio no abre ese día.
 *   null                 NO SE SABE: la consulta falló o tardó de más.
 *
 * `null` no es «todo ocupado» ni «todo libre». Quien llama tiene que
 * enseñar «no pudimos consultar la disponibilidad» y ofrecer reintentar;
 * `rejillaHorarios` ya lo hace. Rellenar ese hueco —con datos
 * inventados o con una copia vieja— es como se acaba vendiendo dos
 * veces el mismo despacho.
 *
 * `forzar` se acepta por compatibilidad, pero ya no hace nada: sin
 * caché, toda consulta es forzada.
 */
export async function getDisponibilidad(espacioId, fechaIso, { forzar = false } = {}) {
  void forzar;
  if (!idEspacioAceptable(espacioId)) {
    console.warn("[api] disponibilidad bloqueada: el catálogo local todavía no tiene el UUID real del espacio");
    return null;
  }
  const db = await getDB();
  if (!db) return BACKEND_ESPERADO ? null : await mock.disponibilidad(espacioId, fechaIso);

  try {
    const { data, error } = await conTiempo(
      db.rpc("disponibilidad_dia", {
        p_espacio: espacioId,
        p_fecha: fechaIso,
        p_bloques: BOOKING.bloques,
      }),
      ESPERA_DISPONIBILIDAD, "disponibilidad_dia");
    if (error) throw error;
    return (data || []).map((f) => ({ bloque: f.bloque, libre: f.libre }));
  } catch (e) {
    console.warn("[api] disponibilidad_dia:", e?.message || e);
    return null;
  }
}

/**
 * Semáforo de todo el mapa: { espacioId: { libres, total } }, o `null`.
 *
 * Mismo criterio, y por el mismo motivo: este objeto pinta los colores
 * del mapa y el «quedan 3 de 6» de las tarjetas. Si viniera de una copia
 * vieja, la aplicación estaría anunciando disponibilidad actual con
 * datos de hace rato.
 */
export async function getDisponibilidadMapa(fechaIso = isoFecha()) {
  const db = await getDB();
  if (!db) return BACKEND_ESPERADO ? null : await mock.disponibilidadMapa(fechaIso);

  const org = await getOrganizacion();
  if (!org?.id) return null;

  try {
    const { data, error } = await conTiempo(
      db.rpc("disponibilidad_mapa", { p_organizacion: org.id, p_fecha: fechaIso }),
      ESPERA_DISPONIBILIDAD, "disponibilidad_mapa");
    if (error) throw error;
    const mapa = {};
    for (const f of data || []) mapa[String(f.espacio_id)] = { libres: f.libres, total: f.total };
    return mapa;
  } catch (e) {
    console.warn("[api] disponibilidad_mapa:", e?.message || e);
    return null;
  }
}

/**
 * Ya no hay caché de disponibilidad que invalidar: se quitó entera.
 *
 * Se conserva por dos motivos. Uno, la llaman varias vistas y el canal
 * de tiempo real, y quitarla obligaría a tocarlas todas. Dos, y más
 * importante: las versiones anteriores SÍ dejaron entradas `disp:*` y
 * `mapa:*` en el IndexedDB de cada equipo. Esto las va barriendo.
 *
 * La purga de época (`lanzamiento.js`) hace la limpieza grande de una
 * vez; esto es el rastrillo de después.
 */
export function invalidarDisponibilidad(espacioId = null, fechaIso = null) {
  if (espacioId && fechaIso) return cache.borrar(`disp:${espacioId}:${fechaIso}`);
  const hoy = new Date();
  const tareas = [];
  for (let i = 0; i < BOOKING.diasVisibles; i++) {
    const f = isoFecha(new Date(hoy.getTime() + i * 86400000));
    if (espacioId) tareas.push(cache.borrar(`disp:${espacioId}:${f}`));
    tareas.push(cache.borrar(`mapa:${store.get().organizacion?.id}:${f}`));
  }
  return Promise.all(tareas);
}

/* =====================================================================
   RESERVAS
   ===================================================================== */

export async function getMisReservas({ forzar = false } = {}) {
  const { usuario } = store.get();
  if (!usuario) return [];
  const clave = `reservas:${usuario.id}`;
  if (!forzar) {
    const enCache = await cache.leer(clave);
    if (enCache) { store.set({ reservas: enCache }, "reservas"); refrescarReservas(usuario, clave).catch(() => {}); return enCache; }
  }
  return refrescarReservas(usuario, clave);
}

async function refrescarReservas(usuario, clave) {
  const db = await getDB();
  if (!db) {
    if (BACKEND_ESPERADO) {
      const guardadas = (await cache.leer(clave)) || store.get().reservas || [];
      store.set({ reservas: guardadas }, "reservas");
      return guardadas;
    }
    const demo = await mock.misReservas();
    store.set({ reservas: demo }, "reservas");
    return demo;
  }
  const { data, error } = await db.from("reservas")
    .select("*, espacios(id, nombre, codigo, icono, tipo, precio_hora), pagos(id, estado, metodo, monto, folio)")
    .eq("usuario_id", usuario.id)
    .order("inicio", { ascending: false })
    .limit(200);
  if (error) {
    // Antes se devolvía `store.get().reservas`, que recién arrancada la
    // app está vacío: con el servidor lento o caído, "Mis reservas"
    // aparecía sin nada aunque hubiera reservas guardadas en el equipo.
    console.warn("[api] getMisReservas", error);
    const guardadas = (await cache.leer(clave))
      || store.get().reservas
      || (BACKEND_ESPERADO ? [] : await mock.misReservas());
    if (guardadas?.length) store.set({ reservas: guardadas }, "reservas");
    return guardadas || [];
  }
  await cache.guardar(clave, data, TTL.reservas);
  await cache.guardarColeccion(cache.ALMACENES.reservas, data);
  store.set({ reservas: data }, "reservas");
  return data;
}

/**
 * Recupera una reserva propia que quedó pendiente de pago y le renueva
 * el apartado. Es lo que permite recargar la pantalla de pago sin crear
 * una segunda reserva que choque con la primera.
 */
export async function reanudarReserva(id) {
  const db = await getDB();
  if (!db) return null;
  const { data, error } = await db.rpc("reanudar_reserva", { p_reserva: id });
  if (error) throw new Error(mensajeError(error));
  return Array.isArray(data) ? data[0] : data;
}

export async function getReserva(id, { forzar = false } = {}) {
  // `forzar` salta la copia local. Hace falta mientras se espera al
  // webhook: la copia en memoria dice «pendiente» y justo lo que
  // queremos saber es si el servidor ya la pasó a «confirmada».
  if (!forzar) {
    const local = store.get().reservas.find((r) => String(r.id) === String(id));
    if (local) return local;
  }
  const db = await getDB();
  if (!db) return null;
  const { data } = await db.from("reservas")
    .select("*, espacios(*), pagos(*), facturas(*)")
    .eq("id", id).maybeSingle();
  return data ?? null;
}

/**
 * Crea una reserva. Usa la función `crear_reserva` de la base de datos,
 * que valida disponibilidad y calcula precios de forma atómica —
 * imposible reservar dos veces el mismo horario aunque dos personas
 * toquen "confirmar" en el mismo instante.
 */
export async function crearReserva({ espacioId, fecha, bloque, asistentes = 1, notas = "", cupon = null, origen = "web" }) {
  if (!idEspacioAceptable(espacioId)) {
    throw new Error("Todavía estamos sincronizando ese espacio con el servidor. Recarga e inténtalo de nuevo.");
  }
  const espacio = await getEspacio(espacioId);
  if (!espacioReservableV1(espacio)) {
    throw new Error("Este espacio no está habilitado para reservaciones. Sólo se rentan las oficinas A, B, C y D.");
  }
  const { inicio, fin } = rangoBloque(fecha, bloque);
  const db = await getDB();

  if (!db) {
    if (BACKEND_ESPERADO) throw new Error("No pudimos conectar con el servidor. No se creó ninguna reserva.");
    const r = await mock.crearReserva({ espacioId, fecha, bloque, asistentes, notas });
    store.set({ reservas: await mock.misReservas() }, "reservas");
    emit(EV.RESERVA_CREADA, r);
    return r;
  }

  if (!store.get().conectado) {
    // Antes esto guardaba la reserva en una cola y decía «Reserva
    // guardada». Para una agenda de horarios exclusivos con cobro es
    // peligroso: sin conexión no hay forma de saber si ese hueco sigue
    // libre, y al recuperar la red la reserva puede chocar con otra que
    // llegó primero. La persona se fue creyendo que tenía la sala.
    //
    // El catálogo se sigue viendo sin conexión; reservar, no.
    throw new Error("Necesitas conexión para comprobar la disponibilidad y reservar.");
  }

  const { data, error } = await db.rpc("crear_reserva", {
    p_espacio: espacioId,
    p_inicio: inicio.toISOString(),
    p_fin: fin.toISOString(),
    p_asistentes: asistentes,
    p_notas: notas || null,
    p_promocion: cupon || null,
    p_origen: origen,
  });
  if (error) throw new Error(mensajeError(error));

  const reserva = Array.isArray(data) ? data[0] : data;
  await invalidarDisponibilidad(espacioId, fecha);
  await cache.borrar(`reservas:${store.get().usuario?.id}`);
  store.set({ reservas: [reserva, ...store.get().reservas] }, "reservas");
  emit(EV.RESERVA_CREADA, reserva);
  return reserva;
}

export async function cancelarReserva(id, motivo = "") {
  const db = await getDB();
  if (!db) {
    if (BACKEND_ESPERADO) throw new Error("No pudimos conectar con el servidor. La reserva NO se canceló.");
    const r = await mock.cancelarReserva(id);
    store.set({ reservas: [...(await mock.misReservas())] }, "reservas");
    emit(EV.RESERVA_CANCELADA, r);
    return r;
  }

  if (!store.get().conectado) {
    // Mismo motivo que al reservar: sin red la app decía «cancelada» y
    // el servidor no se enteraba, así que la reserva seguía viva y el
    // reembolso nunca salía. Cancelar mueve dinero; necesita conexión.
    throw new Error("Necesitas conexión para cancelar la reserva y procesar el reembolso.");
  }

  const { data, error } = await db.rpc("cancelar_reserva", { p_reserva: id, p_motivo: motivo || null });
  if (error) throw new Error(mensajeError(error));
  const reserva = Array.isArray(data) ? data[0] : data;

  // PostgreSQL calcula `monto_reembolso`, pero calcularlo no mueve el
  // dinero. La devolución tiene que ir por LA MISMA pasarela que cobró.
  // Antes todo se mandaba a `pagos-stripe`, incluso los cobros de Clip:
  // una reserva podía quedar cancelada con el dinero todavía cobrado.
  if (Number(reserva?.monto_reembolso || 0) > 0) {
    try {
      const { data: pago } = await db.from("pagos")
        .select("id, metodo, estado, monto, reembolsado")
        .eq("reserva_id", id)
        .in("estado", ["aprobado", "parcial", "reembolsado"])
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();

      let r = null;
      if (pago?.metodo === "clip") {
        r = await invocarFuncion("pagos-clip/reembolso", {
          reserva_id: id,
          motivo: motivo || "Cancelación de reserva",
        });
      } else if (pago?.metodo === "stripe") {
        // Compatibilidad con pagos históricos de Stripe. V1 ya no lo
        // ofrece como método nuevo, pero una reserva antigua todavía
        // tiene derecho a que su devolución salga por donde se cobró.
        r = await invocarFuncion("pagos-stripe", {
          accion: "reembolsar", reserva_id: id,
        });
      } else if (pago) {
        // Transferencia/efectivo/otras pasarelas antiguas requieren una
        // devolución manual o una integración específica. No fingimos
        // que el dinero volvió sólo porque la reserva se canceló.
        emit(EV.REEMBOLSO_PENDIENTE, {
          reserva_id: id, monto: reserva.monto_reembolso, metodo: pago.metodo,
        });
      }

      if (r && !["sin_reembolso", "ya_reembolsado"].includes(r.estado)) {
        emit(EV.PAGO_REEMBOLSADO, { reserva_id: id, ...r });
      }
    } catch (e) {
      console.warn("[api] la cancelación se guardó, pero el reembolso no salió", e);
      emit(EV.REEMBOLSO_PENDIENTE, { reserva_id: id, monto: reserva.monto_reembolso });
    }
  }

  marcarLocal(id, reserva || { estado: "cancelada" });
  await invalidarDisponibilidad(reserva?.espacio_id);
  emit(EV.RESERVA_CANCELADA, reserva);
  return reserva;
}

export async function modificarReserva(id, { fecha, bloque }) {
  const { inicio, fin } = rangoBloque(fecha, bloque);
  const db = await getDB();
  if (!db) {
    if (BACKEND_ESPERADO) throw new Error("No pudimos conectar con el servidor. La reserva NO se modificó.");
    return await mock.modificarReserva(id, { fecha, bloque });
  }

  const { data, error } = await db.rpc("modificar_reserva", {
    p_reserva: id, p_inicio: inicio.toISOString(), p_fin: fin.toISOString(),
  });
  if (error) throw new Error(mensajeError(error));
  const reserva = Array.isArray(data) ? data[0] : data;
  marcarLocal(id, reserva);
  await invalidarDisponibilidad(reserva?.espacio_id);
  emit(EV.RESERVA_MODIFICADA, reserva);
  return reserva;
}

function marcarLocal(id, parche) {
  const reservas = store.get().reservas.map((r) => (String(r.id) === String(id) ? { ...r, ...parche } : r));
  store.set({ reservas }, "reservas");
}

/** Cotiza una reserva sin crearla (para el resumen del checkout). */
export async function cotizar({ espacioId, bloque, cupon = null }) {
  const espacio = await getEspacio(espacioId);
  if (!espacio) throw new Error("Espacio no encontrado");
  if (!espacioReservableV1(espacio)) {
    throw new Error("Este espacio no está habilitado para reservaciones. Sólo se rentan las oficinas A, B, C y D.");
  }
  const horas = duracionHoras(bloque);
  const subtotal = Math.round(Number(espacio.precio_hora || espacio.precioHora || 0) * horas * 100) / 100;

  let descuento = 0, promocion = null;
  if (cupon) {
    promocion = await validarPromocion(cupon, espacioId, subtotal);
    if (promocion) descuento = promocion.descuento;
  }
  const tasa = Number(store.get().organizacion?.tasa_impuesto ?? PAYMENTS.taxRate);
  const impuestos = Math.round((subtotal - descuento) * tasa * 100) / 100;
  return {
    horas, subtotal, descuento, impuestos, tasa,
    total: Math.round((subtotal - descuento + impuestos) * 100) / 100,
    promocion,
  };
}

/* =====================================================================
   PROMOCIONES
   ===================================================================== */

export async function getPromociones() {
  const org = await getOrganizacion();
  const db = await getDB();
  if (!db || modoDemo) return mock.promociones();
  const { data, error } = await db.from("promociones")
    .select("*")
    .eq("organizacion_id", org.id).eq("activa", true)
    .lte("inicia", new Date().toISOString())
    .order("creado_en", { ascending: false });
  if (error) return [];
  const vigentes = (data || []).filter((p) => !p.termina || new Date(p.termina) > new Date());
  store.set({ promociones: vigentes }, "promociones");
  return vigentes;
}

export async function validarPromocion(codigo, espacioId, subtotal) {
  const promos = await getPromociones();
  const p = promos.find((x) => x.codigo.toUpperCase() === String(codigo).trim().toUpperCase());
  if (!p) return null;
  if (p.termina && new Date(p.termina) < new Date()) return null;
  if (p.usos_maximos != null && p.usos_actuales >= p.usos_maximos) return null;
  if (p.espacios?.length && !p.espacios.includes(espacioId)) return null;
  if (subtotal < Number(p.minimo_compra || 0)) return null;

  const espacio = await getEspacio(espacioId);
  const precioHora = Number(espacio?.precio_hora || espacio?.precioHora || 0);
  let descuento = 0;
  if (p.tipo === "porcentaje") descuento = Math.round(subtotal * Number(p.valor) / 100 * 100) / 100;
  else if (p.tipo === "monto") descuento = Math.min(Number(p.valor), subtotal);
  else if (p.tipo === "horas_gratis") descuento = Math.min(Number(p.valor) * precioHora, subtotal);
  return { ...p, descuento };
}

/* =====================================================================
   FAVORITOS
   ===================================================================== */

export async function getFavoritos() {
  const { usuario } = store.get();
  if (!usuario) return new Set();
  const db = await getDB();
  if (!db) {
    const ids = new Set(await cache.leer(`fav:${usuario.id}`, []));
    store.set({ favoritos: ids }, "favoritos");
    return ids;
  }
  const { data, error } = await db.from("favoritos").select("espacio_id").eq("usuario_id", usuario.id);
  if (error) return store.get().favoritos;
  const ids = new Set((data || []).map((f) => String(f.espacio_id)));
  await cache.guardar(`fav:${usuario.id}`, [...ids], TTL.catalogo);
  store.set({ favoritos: ids }, "favoritos");
  return ids;
}

export async function alternarFavorito(espacioId) {
  if (!idEspacioAceptable(espacioId)) throw new Error("Ese espacio todavía se está sincronizando con el servidor.");
  const { usuario } = store.get();
  if (!usuario) throw new Error("Inicia sesión para guardar favoritos");
  const activo = store.toggleFavoritoLocal(espacioId);   // respuesta inmediata en la UI
  await cache.guardar(`fav:${usuario.id}`, [...store.get().favoritos], TTL.catalogo);

  const db = await getDB();
  if (!db) return activo;
  if (!store.get().conectado) {
    await cache.encolar({ tipo: activo ? "fav_add" : "fav_del", payload: { espacioId } });
    return activo;
  }
  try {
    if (activo) await db.from("favoritos").upsert({ usuario_id: usuario.id, espacio_id: espacioId });
    else await db.from("favoritos").delete().eq("usuario_id", usuario.id).eq("espacio_id", espacioId);
  } catch (e) {
    store.toggleFavoritoLocal(espacioId);   // revierte si el servidor falló
    throw new Error(mensajeError(e));
  }
  return activo;
}

/* =====================================================================
   RESEÑAS
   ===================================================================== */

export async function getResenas(espacioId, { limite = 30 } = {}) {
  if (!idEspacioAceptable(espacioId)) return [];
  const clave = `resenas:${espacioId}`;
  const enCache = await cache.leer(clave);
  const db = await getDB();
  if (!db) return BACKEND_ESPERADO ? (enCache || []) : (enCache || (await mock.resenas(espacioId)));
  const { data, error } = await db.from("resenas")
    .select("*, usuarios(nombre, avatar_url)")
    .eq("espacio_id", espacioId).eq("visible", true)
    .order("creado_en", { ascending: false }).limit(limite);
  if (error) return enCache || [];
  await cache.guardar(clave, data, TTL.resenas);
  return data;
}

export async function publicarResena({ espacioId, reservaId = null, calificacion, comentario = "" }) {
  if (!idEspacioAceptable(espacioId)) throw new Error("Ese espacio todavía se está sincronizando con el servidor.");
  const { usuario } = store.get();
  if (!usuario) throw new Error("Inicia sesión para calificar");
  const db = await getDB();
  if (!db) {
    if (BACKEND_ESPERADO) throw new Error("No pudimos guardar la reseña. Inténtalo cuando vuelva la conexión.");
    return mock.publicarResena({ espacioId, calificacion, comentario });
  }

  const { data, error } = await db.from("resenas").upsert({
    espacio_id: espacioId, usuario_id: usuario.id, reserva_id: reservaId,
    calificacion, comentario: comentario || null,
  }, { onConflict: "usuario_id,reserva_id" }).select().single();
  if (error) throw new Error(mensajeError(error));
  await cache.borrar(`resenas:${espacioId}`);
  emit(EV.RESENA_PUBLICADA, data);
  return data;
}

/* =====================================================================
   LISTA DE ESPERA
   ===================================================================== */

export async function apuntarseListaEspera(espacioId, fechaIso, bloque = null) {
  if (!idEspacioAceptable(espacioId)) throw new Error("Ese espacio todavía se está sincronizando con el servidor.");
  const { usuario } = store.get();
  if (!usuario) throw new Error("Inicia sesión para unirte a la lista de espera");
  const db = await getDB();
  if (!db) {
    if (BACKEND_ESPERADO) throw new Error("No pudimos guardar la lista de espera. Inténtalo de nuevo.");
    return mock.listaEspera(espacioId, fechaIso, bloque);
  }
  const { data, error } = await db.from("lista_espera").upsert({
    espacio_id: espacioId, usuario_id: usuario.id, fecha: fechaIso, bloque, activo: true, notificado: false,
  }, { onConflict: "espacio_id,usuario_id,fecha,bloque" }).select().single();
  if (error) throw new Error(mensajeError(error));
  return data;
}

export async function getMiListaEspera() {
  const { usuario } = store.get();
  if (!usuario) return [];
  const db = await getDB();
  if (!db) return [];
  const { data } = await db.from("lista_espera")
    .select("*, espacios(nombre, codigo, icono)")
    .eq("usuario_id", usuario.id).eq("activo", true)
    .gte("fecha", isoFecha()).order("fecha");
  return data || [];
}

export async function salirListaEspera(id) {
  const db = await getDB();
  if (!db) return;
  await db.from("lista_espera").update({ activo: false }).eq("id", id);
}

/* =====================================================================
   NOTIFICACIONES
   ===================================================================== */

export async function getNotificaciones({ limite = 50 } = {}) {
  const { usuario } = store.get();
  if (!usuario) return [];
  const db = await getDB();
  if (!db) return [];
  const { data, error } = await db.from("notificaciones")
    .select("*").eq("usuario_id", usuario.id)
    .or(`programada_para.is.null,programada_para.lte.${new Date().toISOString()}`)
    .order("creado_en", { ascending: false }).limit(limite);
  if (error) return [];
  store.setNotificaciones(data);
  return data;
}

export async function marcarNotificacionLeida(id) {
  const db = await getDB();
  if (!db) return;
  await db.from("notificaciones").update({ leida: true }).eq("id", id);
  const lista = store.get().notificaciones.map((n) => (n.id === id ? { ...n, leida: true } : n));
  store.setNotificaciones(lista);
}

export async function marcarTodasLeidas() {
  const { usuario } = store.get();
  const db = await getDB();
  if (!db || !usuario) return;
  await db.from("notificaciones").update({ leida: true }).eq("usuario_id", usuario.id).eq("leida", false);
  store.setNotificaciones(store.get().notificaciones.map((n) => ({ ...n, leida: true })));
}

/* =====================================================================
   PERFIL
   ===================================================================== */

export async function getPerfil(usuarioId = null) {
  const id = usuarioId || store.get().usuario?.id;
  if (!id) return null;
  const db = await getDB();
  if (!db) return store.get().perfil;
  const { data, error } = await db.from("usuarios").select("*").eq("id", id).maybeSingle();
  if (error) return store.get().perfil;
  if (data && !usuarioId) store.set({ perfil: data, rol: data.rol || "usuario" }, "perfil");
  return data;
}

export async function actualizarPerfil(parche) {
  const { usuario } = store.get();
  if (!usuario) throw new Error("Sin sesión");
  const db = await getDB();
  if (!db) {
    if (BACKEND_ESPERADO) throw new Error("No pudimos guardar los cambios del perfil.");
    const perfil = { ...store.get().perfil, ...parche };
    store.set({ perfil }, "perfil");
    return perfil;
  }
  const { data, error } = await db.from("usuarios").update(parche).eq("id", usuario.id).select().single();
  if (error) throw new Error(mensajeError(error));
  store.set({ perfil: data }, "perfil");
  emit(EV.PERFIL_ACTUALIZADO, data);
  return data;
}

/** Estadísticas del usuario para la pantalla de perfil. */
export async function getEstadisticasUsuario() {
  const reservas = await getMisReservas();
  const validas = reservas.filter((r) => r.estado !== "cancelada");
  const horas = validas.reduce((acc, r) => acc + (new Date(r.fin) - new Date(r.inicio)) / 3600000, 0);
  const gasto = validas.reduce((acc, r) => acc + Number(r.total || 0), 0);
  return { total: validas.length, horas: Math.round(horas), gasto };
}

/* =====================================================================
   PAGOS Y FACTURAS
   ===================================================================== */

export async function getPagos() {
  const { usuario } = store.get();
  if (!usuario) return [];
  const db = await getDB();
  // Sin servidor, el historial sale del almacenamiento del dispositivo.
  if (!db) return BACKEND_ESPERADO ? [] : await mock.pagos();
  const { data } = await db.from("pagos")
    .select("*, reservas(folio, inicio, espacios(nombre))")
    .eq("usuario_id", usuario.id).order("creado_en", { ascending: false }).limit(100);
  return data || [];
}

export async function solicitarFactura() {
  // V1 no permite crear facturas desde el navegador. La política RLS y
  // guardas de servidor también cierran esta ruta: los importes fiscales
  // nunca deben venir de un objeto editable por el cliente.
  throw new Error("La facturación todavía no está habilitada.");
}

export async function getFacturas() {
  const { usuario } = store.get();
  if (!usuario) return [];
  const db = await getDB();
  if (!db) return [];
  const { data } = await db.from("facturas").select("*").eq("usuario_id", usuario.id).order("creado_en", { ascending: false });
  return data || [];
}

/* =====================================================================
   CHAT
   ===================================================================== */

export async function getConversacion() {
  const { usuario, organizacion } = store.get();
  if (!usuario) return null;
  const db = await getDB();
  if (!db) return null;
  const { data, error } = await db.from("conversaciones").select("*")
    .eq("usuario_id", usuario.id).order("ultimo_mensaje_en", { ascending: false }).limit(1).maybeSingle();
  if (data) return data;
  // Si la búsqueda falló (o se agotó el tiempo) NO se crea una nueva:
  // la conversación podría existir ya y acabaríamos con dos hilos
  // paralelos, cada uno con la mitad de los mensajes.
  if (error) return null;
  const { data: nueva } = await db.from("conversaciones")
    .insert({ usuario_id: usuario.id, organizacion_id: organizacion?.id }).select().single();
  return nueva;
}

export async function getMensajes(conversacionId, { limite = 100 } = {}) {
  const db = await getDB();
  if (!db || !conversacionId) return [];
  const { data } = await db.from("mensajes").select("*")
    .eq("conversacion_id", conversacionId).order("creado_en").limit(limite);
  return data || [];
}

export async function enviarMensaje(conversacionId, cuerpo, { esIA = false, esStaff = false } = {}) {
  const { usuario } = store.get();
  const db = await getDB();
  if (!db) {
    if (BACKEND_ESPERADO) throw new Error("No pudimos enviar el mensaje. Inténtalo de nuevo.");
    return { id: uuid(), cuerpo, creado_en: new Date().toISOString(), es_ia: esIA, es_staff: esStaff };
  }
  const { data, error } = await db.from("mensajes").insert({
    conversacion_id: conversacionId, autor_id: usuario?.id || null,
    cuerpo, es_ia: esIA, es_staff: esStaff,
  }).select().single();
  if (error) throw new Error(mensajeError(error));
  await db.from("conversaciones").update({ ultimo_mensaje_en: new Date().toISOString() }).eq("id", conversacionId);
  return data;
}

/* =====================================================================
   ADMINISTRACIÓN
   ===================================================================== */

export async function adminGuardarEspacio(espacio) {
  const db = await getDB();
  if (!db) throw new Error("Backend no configurado");
  const { organizacion } = store.get();
  const payload = { organizacion_id: organizacion?.id, ...espacio };
  delete payload.espacio_fotos; delete payload.fotos; delete payload.portada; delete payload.panoramas;
  delete payload.precioHora; delete payload.precioDia;

  const q = payload.id
    ? db.from("espacios").update(payload).eq("id", payload.id)
    : db.from("espacios").insert(payload);
  const { data, error } = await q.select().single();
  if (error) throw new Error(mensajeError(error));
  await getEspacios({ forzar: true });
  return data;
}

export async function adminBorrarEspacio(id) {
  const db = await getDB();
  if (!db) throw new Error("Backend no configurado");
  // Baja lógica: conserva el historial de reservas asociado.
  const { error } = await db.from("espacios").update({ activo: false, estado: "inactiva" }).eq("id", id);
  if (error) throw new Error(mensajeError(error));
  await getEspacios({ forzar: true });
}

export async function adminCambiarEstado(id, estado) {
  const db = await getDB();
  if (!db) throw new Error("Backend no configurado");
  const { error } = await db.from("espacios").update({ estado }).eq("id", id);
  if (error) throw new Error(mensajeError(error));
  await getEspacios({ forzar: true });
}

export async function adminReservas({ desde = null, hasta = null, estado = null, limite = 200 } = {}) {
  const db = await getDB();
  const { organizacion } = store.get();
  if (!db) return [];
  let q = db.from("reservas")
    .select("*, espacios(nombre, codigo), usuarios(nombre, email, telefono)")
    .eq("organizacion_id", organizacion?.id)
    .order("inicio", { ascending: false }).limit(limite);
  if (desde) q = q.gte("inicio", desde);
  if (hasta) q = q.lte("inicio", hasta);
  if (estado) q = q.eq("estado", estado);
  const { data, error } = await q;
  if (error) { console.warn("[api] adminReservas", error); return []; }
  return data || [];
}

export async function adminGuardarPromocion(promo) {
  const db = await getDB();
  const { organizacion } = store.get();
  if (!db) throw new Error("Backend no configurado");
  const payload = { organizacion_id: organizacion?.id, ...promo };
  const q = payload.id ? db.from("promociones").update(payload).eq("id", payload.id) : db.from("promociones").insert(payload);
  const { data, error } = await q.select().single();
  if (error) throw new Error(mensajeError(error));
  return data;
}

export async function adminBorrarPromocion(id) {
  const db = await getDB();
  if (!db) return;
  await db.from("promociones").update({ activa: false }).eq("id", id);
}

export async function adminGuardarEdificio(edificio) {
  const db = await getDB();
  const { organizacion } = store.get();
  if (!db) throw new Error("Backend no configurado");
  const payload = { organizacion_id: organizacion?.id, ...edificio };
  delete payload.pisos;
  const q = payload.id ? db.from("edificios").update(payload).eq("id", payload.id) : db.from("edificios").insert(payload);
  const { data, error } = await q.select().single();
  if (error) throw new Error(mensajeError(error));
  return data;
}

export async function adminGuardarPiso(piso) {
  const db = await getDB();
  if (!db) throw new Error("Backend no configurado");
  const q = piso.id ? db.from("pisos").update(piso).eq("id", piso.id) : db.from("pisos").insert(piso);
  const { data, error } = await q.select().single();
  if (error) throw new Error(mensajeError(error));
  return data;
}

export async function adminGuardarSede(sede) {
  const db = await getDB();
  const { organizacion } = store.get();
  if (!db) throw new Error("Backend no configurado");
  const payload = { organizacion_id: organizacion?.id, ...sede };
  const q = payload.id ? db.from("sedes").update(payload).eq("id", payload.id) : db.from("sedes").insert(payload);
  const { data, error } = await q.select().single();
  if (error) throw new Error(mensajeError(error));
  await cache.borrar(`sedes:${organizacion?.id}`);
  return data;
}

export async function adminHorarios(espacioId = null, edificioId = null) {
  const db = await getDB();
  if (!db) return [];
  let q = db.from("horarios_operacion").select("*").order("dia_semana");
  if (espacioId) q = q.eq("espacio_id", espacioId);
  else if (edificioId) q = q.eq("edificio_id", edificioId).is("espacio_id", null);
  const { data } = await q;
  return data || [];
}

export async function adminGuardarHorarios(filas) {
  const db = await getDB();
  const { organizacion } = store.get();
  if (!db) throw new Error("Backend no configurado");
  const payload = filas.map((f) => ({ organizacion_id: organizacion?.id, ...f }));
  const { error } = await db.from("horarios_operacion").upsert(payload);
  if (error) throw new Error(mensajeError(error));
}

export async function adminCrearBloqueo({ espacioId, edificioId, motivo, inicio, fin }) {
  const db = await getDB();
  const { organizacion, usuario } = store.get();
  if (!db) throw new Error("Backend no configurado");
  const { data, error } = await db.from("bloqueos").insert({
    organizacion_id: organizacion?.id, espacio_id: espacioId || null, edificio_id: edificioId || null,
    motivo, inicio, fin, creado_por: usuario?.id,
  }).select().single();
  if (error) throw new Error(mensajeError(error));
  await invalidarDisponibilidad(espacioId);
  return data;
}

export async function adminUsuarios({ limite = 200 } = {}) {
  const db = await getDB();
  if (!db) return [];
  const { data } = await db.from("usuarios").select("*").order("creado_en", { ascending: false }).limit(limite);
  return data || [];
}

export async function adminCambiarRol(usuarioId, rol) {
  const db = await getDB();
  if (!db) throw new Error("Backend no configurado");
  const { error } = await db.from("usuarios").update({ rol }).eq("id", usuarioId);
  if (error) throw new Error(mensajeError(error));
}

/* ---------- analítica ---------- */

export async function adminMetricas({ dias = 30 } = {}) {
  const db = await getDB();
  const { organizacion } = store.get();
  if (!db) return { diarias: [], populares: [], pico: [], totales: {} };

  const desde = isoFecha(new Date(Date.now() - dias * 86400000));
  const [diarias, populares, pico] = await Promise.all([
    db.from("v_metricas_diarias").select("*").eq("organizacion_id", organizacion?.id).gte("dia", desde).order("dia"),
    db.from("v_espacios_populares").select("*").eq("organizacion_id", organizacion?.id).order("reservas", { ascending: false }).limit(10),
    db.from("v_horarios_pico").select("*").eq("organizacion_id", organizacion?.id).order("reservas", { ascending: false }),
  ]);

  const filas = diarias.data || [];
  const totales = {
    reservas: filas.reduce((a, f) => a + Number(f.reservas || 0), 0),
    canceladas: filas.reduce((a, f) => a + Number(f.canceladas || 0), 0),
    ingresos: filas.reduce((a, f) => a + Number(f.ingresos || 0), 0),
    horas: filas.reduce((a, f) => a + Number(f.horas || 0), 0),
  };
  totales.tasaCancelacion = totales.reservas ? totales.canceladas / totales.reservas : 0;
  totales.ticketPromedio = totales.reservas ? totales.ingresos / totales.reservas : 0;

  return { diarias: filas, populares: populares.data || [], pico: pico.data || [], totales };
}

export default {
  getOrganizacion, getSedes, getEdificios, getEspacios, getEspacio, getAmenidades,
  getDisponibilidad, getDisponibilidadMapa, invalidarDisponibilidad,
  getMisReservas, getReserva, reanudarReserva, crearReserva, cancelarReserva, modificarReserva, cotizar,
  getPromociones, validarPromocion,
  getFavoritos, alternarFavorito,
  getResenas, publicarResena,
  apuntarseListaEspera, getMiListaEspera, salirListaEspera,
  getNotificaciones, marcarNotificacionLeida, marcarTodasLeidas,
  getPerfil, actualizarPerfil, getEstadisticasUsuario,
  getPagos, solicitarFactura, getFacturas,
  getConversacion, getMensajes, enviarMensaje,
  enModoDemo, esReservableV1, codigoReservableV1,

  /* administración */
  adminGuardarEspacio, adminBorrarEspacio, adminCambiarEstado,
  adminReservas, adminGuardarPromocion, adminBorrarPromocion,
  adminGuardarEdificio, adminGuardarPiso, adminGuardarSede,
  adminHorarios, adminGuardarHorarios, adminCrearBloqueo,
  adminUsuarios, adminCambiarRol, adminMetricas,
};
