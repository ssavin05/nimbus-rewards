/* ======================================================================
   medios-locales.js — Fotos incluidas dentro del propio proyecto.

   IMPORTANTE:
   - Las URLs se construyen desde import.meta.url, no desde C:\\ ni desde
     la ruta actual del navegador.
   - Esto funciona igual en GitHub Pages, localhost y cualquier hosting
     estático aunque la app viva dentro de un subdirectorio.
   ====================================================================== */

/* Fotos que viven dentro del repositorio. La lista es explícita a
   propósito: el navegador no puede listar un directorio, así que un
   archivo que no esté aquí no existe para la app.

   Para añadir las de un espacio: deja los archivos en
   assets/fotos/<carpeta>/ y apunta el código aquí. Nada más. */
const ARCHIVOS_POR_CODIGO = Object.freeze({
  "OF-A": ["oficina-a/01.jpg", "oficina-a/02.jpg"],
  "OF-B": ["oficina-b/01.jpg", "oficina-b/02.jpg"],
  "OF-C": ["oficina-c/01.jpg"],
  "OF-D": ["oficina-d/01.jpg", "oficina-d/02.jpg"],
  // OF-01 ya no se renta —salió del catálogo— y tampoco hay ninguna foto
  // suya en el material del proyecto. Se deja apuntada por si vuelve a
  // ponerse en renta: en cuanto haya archivos en assets/fotos/oficina-01/
  // se descomenta esta línea y aparecen solas.
  // "OF-01": ["oficina-01/01.jpg", "oficina-01/02.jpg"],
  "PT-01": ["patio/01.jpg", "patio/02.jpg"],
  "RC-01": ["recepcion/01.jpg", "recepcion/02.jpg", "recepcion/03.jpg"],
});

const CODIGO_POR_NOMBRE = Object.freeze({
  "OFICINA A": "OF-A",
  "EJECUTIVA PLUS": "OF-A",
  "OFICINA B": "OF-B",
  "EJECUTIVA COMPACT": "OF-B",
  "OFICINA C": "OF-C",
  "PREMIUM PATIO VIEW": "OF-C",
  "OFICINA D": "OF-D",
  "EJECUTIVA LOUNGE": "OF-D",
  "PATIO": "PT-01",
  "RECEPCION": "RC-01",
});

function normalizarTexto(v = "") {
  return String(v).trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function codigoLocal(espacio = {}) {
  const codigo = normalizarTexto(espacio.codigo);
  if (ARCHIVOS_POR_CODIGO[codigo]) return codigo;
  return CODIGO_POR_NOMBRE[normalizarTexto(espacio.nombre)] || codigo;
}

function urlDeFoto(archivo) {
  // medios-locales.js vive en /js/data/. Desde ahí subimos dos niveles.
  return new URL(`../../assets/fotos/${archivo}`, import.meta.url).href;
}

function rutaUtil(url) {
  const s = String(url ?? "").trim();
  if (!s) return false;
  if (/^[a-zA-Z]:[\\/]/.test(s) || /^file:/i.test(s)) return false;
  return true;
}

export function fotosLocales(codigo, nombre = "Espacio") {
  const clave = ARCHIVOS_POR_CODIGO[normalizarTexto(codigo)]
    ? normalizarTexto(codigo)
    : CODIGO_POR_NOMBRE[normalizarTexto(nombre)];
  const archivos = ARCHIVOS_POR_CODIGO[clave] || [];

  return archivos.map((archivo, i) => ({
    id: `local-${String(clave || "espacio").toLowerCase()}-${i + 1}`,
    url: urlDeFoto(archivo),
    titulo: `${nombre} — Foto ${i + 1}`,
    es_portada: i === 0,
    es_360: false,
    orden: i,
    origen: "proyecto",
  }));
}

export function aplicarMediosLocales(espacio) {
  if (!espacio) return espacio;

  const clave = codigoLocal(espacio);
  const locales = fotosLocales(clave, espacio.nombre);
  const remotas = Array.isArray(espacio.fotos)
    ? espacio.fotos.filter((f) => rutaUtil(f?.url))
    : [];

  // Para los espacios que tienen fotos incluidas en el proyecto, esas
  // fotos van PRIMERO. Así una URL vieja/rota de Supabase no puede dejar
  // la tarjeta en blanco. Las remotas se conservan después, si existen.
  const urlsLocales = new Set(locales.map((f) => f.url));
  const remotasSinDuplicar = remotas.filter((f) => !urlsLocales.has(f.url));
  const fotos = locales.length ? [...locales, ...remotasSinDuplicar] : remotas;

  // Si hay una portada incluida en el proyecto, úsala siempre: sabemos
  // que viaja dentro del mismo deploy que la app.
  let portada = locales[0]?.url || (rutaUtil(espacio.portada) ? espacio.portada : null);
  if (!portada || !fotos.some((f) => f.url === portada)) {
    portada = fotos.find((f) => f.es_portada)?.url || fotos[0]?.url || null;
  }

  return {
    ...espacio,
    fotos,
    portada,
    panoramas: fotos.filter((f) => f.es_360).map((f) => f.url),
  };
}

export const RUTAS_POR_CODIGO = Object.freeze(
  Object.fromEntries(Object.entries(ARCHIVOS_POR_CODIGO).map(([codigo, archivos]) => [
    codigo,
    archivos.map(urlDeFoto),
  ]))
);
