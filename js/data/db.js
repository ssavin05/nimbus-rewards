/* ======================================================================
   db.js — Cliente único de Supabase.

   • Autenticación (JWT) con almacenamiento configurable según la casilla
     "mantener sesión iniciada".
   • Acceso REST (PostgREST) a la base de datos.
   • Realtime (websockets) para disponibilidad en vivo.
   • Storage para fotos de espacios, avatares y comprobantes.

   La biblioteca se carga desde CDN. Si el <script> UMD de index.html ya
   la dejó en `window.supabase`, se reutiliza; si no, se importa como
   módulo ESM. Así la app funciona con o sin ese <script>.
   ====================================================================== */
import { SUPABASE, STORAGE_KEYS, isBackendConfigured } from "../core/config.js";

let cliente = null;
let cargando = null;
let fallo = false;

/* Almacenamiento personalizado: localStorage si el usuario pidió que se
   recuerde la sesión; sessionStorage si no (se borra al cerrar la pestaña). */
const almacenamiento = {
  getItem: (clave) => {
    try {
      const recordar = localStorage.getItem(STORAGE_KEYS.recordarme) !== "false";
      return recordar ? localStorage.getItem(clave) : sessionStorage.getItem(clave);
    } catch { return null; }
  },
  setItem: (clave, valor) => {
    try {
      const recordar = localStorage.getItem(STORAGE_KEYS.recordarme) !== "false";
      (recordar ? localStorage : sessionStorage).setItem(clave, valor);
    } catch { /* modo privado */ }
  },
  removeItem: (clave) => {
    try { localStorage.removeItem(clave); sessionStorage.removeItem(clave); } catch { /* ignora */ }
  },
};

/* Si la biblioteca no llega en este tiempo, la app arranca con los datos
   del propio dispositivo en vez de dejar a nadie mirando un esqueleto
   gris. Seis segundos era demasiado: en una red mala se notaba como
   "la app tarda un montón en cargar". Con 2,5 s la pantalla ya está
   puesta, y si el servidor aparece después se sincroniza sin cortar. */
const TIEMPO_MAXIMO_CARGA = 2500;

function conTiempoLimite(promesa, ms, mensaje) {
  return Promise.race([
    promesa,
    new Promise((_, rechazar) => setTimeout(() => rechazar(new Error(mensaje)), ms)),
  ]);
}

/* La biblioteca son 108 KB. Ya no va en un <script> del HTML: se pide
   la primera vez que hace falta de verdad. Quien sólo entra a mirar el
   catálogo o el mapa no la descarga nunca. */
const RUTA_LIB = "vendor/supabase/supabase.umd.js";
let promesaLib = null;

function cargarScript(src) {
  return new Promise((resolver, rechazar) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolver(window.supabase);
    s.onerror = () => rechazar(new Error(`No se pudo cargar ${src}`));
    document.head.append(s);
  });
}

async function cargarLib() {
  // 1. ¿Ya está? (otra llamada la trajo, o el hosting la inyectó)
  if (typeof window !== "undefined" && window.supabase?.createClient) return window.supabase;
  if (promesaLib) return promesaLib;

  // 2. La copia local del proyecto. No depende de ninguna CDN.
  promesaLib = (async () => {
    const base = (typeof document !== "undefined" && document.baseURI) || "./";
    try {
      const lib = await conTiempoLimite(
        cargarScript(new URL(RUTA_LIB, base).href),
        TIEMPO_MAXIMO_CARGA,
        "La biblioteca de Supabase tardó demasiado en cargar",
      );
      if (lib?.createClient) return lib;
      throw new Error("copia local incompleta");
    } catch (e) {
      // 3. Último recurso: la versión ESM desde la red.
      return conTiempoLimite(
        import("https://esm.sh/@supabase/supabase-js@2.45.4"),
        TIEMPO_MAXIMO_CARGA,
        "La biblioteca de Supabase tardó demasiado en cargar",
      );
    }
  })();
  promesaLib.catch(() => { promesaLib = null; });
  return promesaLib;
}

/* ---------------------------------------------------------------------
   Un tope de tiempo para TODAS las consultas

   Ir poniendo un cronómetro consulta por consulta es una carrera que se
   pierde: siempre queda una sin él, y basta una para dejar la pantalla
   colgada en esqueletos grises (le pasó a `amenidades`, y bloqueaba la
   ficha entera del espacio).

   Así que el tope se pone UNA vez, en el cliente: `from()` y `rpc()`
   devuelven constructores que son "thenables", y se envuelve su `then`
   para que la espera compita contra un reloj. Cualquier consulta que se
   escriba mañana lo hereda sin acordarse de nada.
   --------------------------------------------------------------------- */
const TIEMPO_MAXIMO_CONSULTA = 3500;

/* Lo que se envía a la red es lo que devuelven select/insert/update/
   upsert/delete, NO lo que devuelve `from()`: en postgrest-js cada uno
   crea un objeto NUEVO. Por eso hay que envolver esos métodos y no el
   constructor de la tabla. */
const METODOS_CONSULTA = ["select", "insert", "update", "upsert", "delete"];

function conTopeDeTiempo(consulta, etiqueta, ms = TIEMPO_MAXIMO_CONSULTA) {
  const thenOriginal = consulta?.then?.bind(consulta);
  if (typeof thenOriginal !== "function") return consulta;

  consulta.then = (alCumplir, alFallar) => {
    let reloj;
    // Se RESUELVE con la forma { data, error } de siempre en vez de
    // rechazar: así todo el código que ya comprueba `if (error)` sigue
    // funcionando igual y nadie se queda sin manejar el fallo.
    const limite = new Promise((resolver) => {
      reloj = setTimeout(() => resolver({
        data: null,
        error: { message: `El servidor no respondió a tiempo (${etiqueta})`, code: "TIEMPO_AGOTADO" },
      }), ms);
    });
    return Promise.race([new Promise(thenOriginal), limite])
      .finally(() => clearTimeout(reloj))
      .then(alCumplir, alFallar);
  };
  return consulta;
}

/** Envuelve las consultas para que ninguna se quede colgada. */
function ponerTopes(cliente) {
  const fromOriginal = cliente.from.bind(cliente);
  cliente.from = (tabla, ...resto) => {
    const constructor = fromOriginal(tabla, ...resto);
    for (const metodo of METODOS_CONSULTA) {
      const original = constructor[metodo];
      if (typeof original !== "function") continue;
      constructor[metodo] = (...args) => conTopeDeTiempo(original.apply(constructor, args), tabla);
    }
    return constructor;
  };

  const rpcOriginal = cliente.rpc.bind(cliente);
  cliente.rpc = (nombre, ...resto) => conTopeDeTiempo(rpcOriginal(nombre, ...resto), `rpc ${nombre}`);

  return cliente;
}

/** Devuelve el cliente, creándolo la primera vez. */
export async function getDB() {
  if (cliente) return cliente;
  if (!isBackendConfigured()) return null;
  if (fallo) return null;                    // no reintentar en cada llamada
  if (!cargando) {
    cargando = (async () => {
      const lib = await cargarLib();
      cliente = lib.createClient(SUPABASE.url, SUPABASE.anonKey, {
        auth: {
          storage: almacenamiento,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
        },
        // No añadimos cabeceras personalizadas globales aquí. `x-app` provocaba
        // un preflight CORS extra en Edge Functions y el navegador bloqueaba
        // pagos-clip aunque /estado respondiera correctamente al abrirlo directo.
        realtime: { params: { eventsPerSecond: 5 } },
        db: { schema: "public" },
      });
      ponerTopes(cliente);
      return cliente;
    })();
  }
  try { return await cargando; }
  catch (e) {
    console.warn("[db] Supabase no disponible, se usará el modo demostración:", e?.message || e);
    cargando = null;
    fallo = true;
    return null;
  }
}

/** Vuelve a intentar la conexión (por ejemplo al recuperar la red). */
export function reintentarConexion() {
  fallo = false;
  cargando = null;
  return getDB();
}

/** Cliente ya inicializado, o null. Para código síncrono. */
export function dbSync() { return cliente; }

export function recordarSesion(recordar) {
  try { localStorage.setItem(STORAGE_KEYS.recordarme, recordar ? "true" : "false"); }
  catch { /* ignora */ }
}

/** URL pública de un archivo en Storage. */
export async function urlPublica(bucket, ruta) {
  const db = await getDB();
  if (!db || !ruta) return "";
  if (/^https?:\/\//.test(ruta)) return ruta;
  const { data } = db.storage.from(bucket).getPublicUrl(ruta);
  return data?.publicUrl || "";
}

/** Sube un archivo y devuelve { ruta, url }. */
export async function subirArchivo(bucket, ruta, archivo, { upsert = true } = {}) {
  const db = await getDB();
  if (!db) throw new Error("Backend no configurado");
  const { error } = await db.storage.from(bucket).upload(ruta, archivo, {
    upsert, cacheControl: "3600", contentType: archivo.type || undefined,
  });
  if (error) throw error;
  return { ruta, url: await urlPublica(bucket, ruta) };
}

export async function borrarArchivo(bucket, rutas) {
  const db = await getDB();
  if (!db) return;
  await db.storage.from(bucket).remove([].concat(rutas));
}

/** Llama a una Edge Function con el JWT del usuario. */
export async function invocarFuncion(nombre, payload = {}) {
  const db = await getDB();
  if (!db) throw new Error("Backend no configurado");
  const { data, error } = await db.functions.invoke(nombre, { body: payload });
  if (error) throw error;
  return data;
}

/** Traduce errores de PostgREST/GoTrue a mensajes en español. */
export function mensajeError(error) {
  if (!error) return "";
  const m = String(error.message || error.error_description || error);
  const mapa = [
    [/Invalid login credentials/i, "Correo o contraseña incorrectos."],
    [/Email not confirmed/i, "Falta confirmar tu correo. Revisa tu bandeja de entrada."],
    [/User already registered/i, "Ya existe una cuenta con ese correo."],
    [/Password should be at least/i, "La contraseña debe tener al menos 6 caracteres."],
    [/rate limit|too many requests/i, "Demasiados intentos. Espera un momento e inténtalo de nuevo."],
    [/duplicate key value|already exists/i, "Ese registro ya existe."],
    [/violates foreign key/i, "No se puede completar: hay información relacionada."],
    [/violates row-level security|permission denied/i, "No tienes permisos para hacer esto."],
    [/JWT expired|invalid claim/i, "Tu sesión expiró. Vuelve a iniciar sesión."],
    [/Failed to fetch|NetworkError|ERR_INTERNET/i, "Sin conexión con el servidor."],
    [/reserva_solapada|conflicto_horario|exclusion/i, "Ese horario acaba de ocuparse. Elige otro."],
    [/pwned|leaked password|compromised/i,
      "Esa contraseña apareció en una filtración conocida. Elige otra."],
    [/over_email_send_rate_limit/i,
      "No pudimos enviar el correo en este momento. Inténtalo en unos minutos."],
    [/weak.?password/i, "La contraseña es demasiado fácil de adivinar. Elige otra."],
  ];
  for (const [re, texto] of mapa) if (re.test(m)) return texto;

  // Nada de `return m`. Lo que llega de Supabase viene en inglés y a
  // veces cuenta de más (nombres de tabla, restricciones, si un correo
  // existe). El detalle se queda en la consola para depurar; la persona
  // ve una frase en su idioma que no filtra nada.
  if (typeof console !== "undefined") console.warn("[error sin traducir]", m);
  return "No pudimos completar la operación. Inténtalo de nuevo.";
}

export default { getDB, dbSync, urlPublica, subirArchivo, borrarArchivo, invocarFuncion, mensajeError, recordarSesion };
