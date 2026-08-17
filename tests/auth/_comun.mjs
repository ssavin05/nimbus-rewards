/* Utilería compartida por las pruebas de autenticación (FASE 02).
 *
 * Habla con Supabase por HTTP, sin dependencias: así se prueba lo que
 * de verdad viaja por el cable, que es donde viven los fallos de
 * enumeración y de límites de ritmo.
 *
 * La llave `service_role` se lee del ENTORNO y nunca se imprime.
 *   export SUPABASE_SERVICE_ROLE_KEY=...      (o un .env, ya ignorado por git)
 * Sin ella, las pruebas que necesitan crear cuentas se marcan OMITIDA
 * en vez de fallar: una prueba que no se pudo ejecutar no es un fallo,
 * pero tampoco es un aprobado.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");

// ---------------------------------------------------------------- entorno
function cargarEnv() {
  for (const nombre of [".env.local", ".env"]) {
    const ruta = join(RAIZ, nombre);
    if (!existsSync(ruta)) continue;
    for (const linea of readFileSync(ruta, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
      if (!m) continue;
      const valor = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = valor;
    }
  }
}
cargarEnv();

export const URL_BASE =
  process.env.SUPABASE_URL || "https://xashvchjvsmwyrbxwomd.supabase.co";
export const CLAVE_PUBLICA =
  process.env.SUPABASE_ANON_KEY || "sb_publishable_5kJ0n19pWLvyhJuANLFwIw_nqwvn4RA";
export const CLAVE_SERVICIO = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const HAY_SERVICIO = Boolean(CLAVE_SERVICIO);

// Dominio de las cuentas de prueba. Supabase rechaza dominios que no
// resuelven, así que se usa uno real; el buzón da igual porque los
// enlaces se piden por la API de administración, no por correo.
const DOMINIO = process.env.DOMINIO_PRUEBAS || "gmail.com";
export const PREFIJO = "co-prueba-auth";

export const correoDePrueba = (etiqueta = "") =>
  `${PREFIJO}-${Date.now().toString(36)}${etiqueta}-${Math.random().toString(36).slice(2, 8)}@${DOMINIO}`;

// ------------------------------------------------------------------- HTTP
async function pedir(ruta, { metodo = "GET", cuerpo, token, servicio = false, headers = {} } = {}) {
  const clave = servicio ? CLAVE_SERVICIO : CLAVE_PUBLICA;
  const t0 = performance.now();
  const r = await fetch(`${URL_BASE}${ruta}`, {
    method: metodo,
    headers: {
      apikey: clave,
      Authorization: `Bearer ${token || clave}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    redirect: "manual",
  });
  const ms = performance.now() - t0;
  const texto = await r.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  return { estado: r.status, datos, texto, ms, cabeceras: r.headers };
}

export const auth = (ruta, opciones) => pedir(`/auth/v1${ruta}`, opciones);
export const rest = (ruta, opciones) => pedir(`/rest/v1${ruta}`, opciones);

/** API de administración. Sólo con service_role. */
export const admin = (ruta, opciones = {}) => {
  if (!HAY_SERVICIO) throw new OmitirPrueba("hace falta SUPABASE_SERVICE_ROLE_KEY");
  return pedir(`/auth/v1/admin${ruta}`, { ...opciones, servicio: true });
};

// --------------------------------------------------------------- atajos
/** Crea una cuenta ya confirmada sin mandar correo (evita el límite de envío). */
export async function crearUsuarioListo(password = "ClaveDePrueba123", extra = {}) {
  const email = correoDePrueba();
  const r = await admin("/users", {
    metodo: "POST",
    cuerpo: { email, password, email_confirm: true, ...extra },
  });
  if (r.estado >= 300) throw new Error(`no se pudo crear la cuenta: ${r.texto.slice(0, 160)}`);
  return { email, password, id: r.datos.id };
}

/** Crea una cuenta SIN confirmar, tampoco manda correo. */
export async function crearUsuarioSinConfirmar(password = "ClaveDePrueba123") {
  const email = correoDePrueba();
  const r = await admin("/users", {
    metodo: "POST",
    cuerpo: { email, password, email_confirm: false },
  });
  if (r.estado >= 300) throw new Error(`no se pudo crear la cuenta: ${r.texto.slice(0, 160)}`);
  return { email, password, id: r.datos.id };
}

/** Pide a Supabase el enlace que normalmente iría por correo. */
export async function generarEnlace(type, email, extra = {}) {
  const r = await admin("/generate_link", {
    metodo: "POST",
    cuerpo: { type, email, ...extra },
  });
  if (r.estado >= 300) throw new Error(`generate_link(${type}) falló: ${r.texto.slice(0, 160)}`);
  return r.datos;   // { action_link, hashed_token, ... }
}

export async function entrar(email, password) {
  return auth("/token?grant_type=password", { metodo: "POST", cuerpo: { email, password } });
}

export async function borrarUsuario(id) {
  if (!id || !HAY_SERVICIO) return;
  try { await admin(`/users/${id}`, { metodo: "DELETE" }); } catch { /* da igual */ }
}

// ------------------------------------------------------- registro de casos
export class OmitirPrueba extends Error {}
export class FalloPrueba extends Error {}

const CASOS = [];
let grupoActual = "General";

/** Etiqueta a qué área pertenecen los casos que se declaren a continuación. */
export function grupo(nombre) { grupoActual = nombre; }

export function caso(id, nombre, nivel, fn, categoria = grupoActual) {
  CASOS.push({ id, nombre, nivel, fn, categoria });
}
export const casos = () => CASOS;

/**
 * Borra las cuentas de prueba que hayan sobrevivido a una tanda
 * interrumpida. Sin esto, correr la suite dos veces va dejando basura y
 * la segunda vuelta ya no parte de un estado limpio.
 */
export async function barrerCuentasDePrueba() {
  if (!HAY_SERVICIO) return { barridas: 0, restantes: 0 };
  let barridas = 0;
  // La API de administración pagina; con dos vueltas sobra de largo.
  for (let pagina = 1; pagina <= 2; pagina++) {
    const r = await admin(`/users?page=${pagina}&per_page=200`);
    const lista = r.datos?.users || [];
    if (!lista.length) break;
    for (const u of lista) {
      if (typeof u.email === "string" && u.email.startsWith(PREFIJO)) {
        await borrarUsuario(u.id);
        barridas++;
      }
    }
  }
  const comprobar = await admin("/users?page=1&per_page=200");
  const restantes = (comprobar.datos?.users || [])
    .filter((u) => typeof u.email === "string" && u.email.startsWith(PREFIJO)).length;
  return { barridas, restantes };
}

export function exigir(condicion, mensaje) {
  if (!condicion) throw new FalloPrueba(mensaje);
}
export function exigirIgual(real, esperado, que) {
  if (real !== esperado) {
    throw new FalloPrueba(`${que}: se esperaba ${JSON.stringify(esperado)} y llegó ${JSON.stringify(real)}`);
  }
}

/** Ejecuta y devuelve el resultado, sin dejar que una excepción tumbe la tanda. */
export async function ejecutar(c) {
  const limpieza = [];
  const t0 = performance.now();
  try {
    const detalle = await c.fn({ limpiar: (f) => limpieza.push(f) });
    return { ...c, veredicto: "PASA", detalle: detalle || "", ms: performance.now() - t0 };
  } catch (e) {
    const veredicto = e instanceof OmitirPrueba ? "OMITIDA"
                    : e instanceof FalloPrueba ? "FALLA" : "ERROR";
    return { ...c, veredicto, detalle: e.message, ms: performance.now() - t0 };
  } finally {
    for (const f of limpieza.reverse()) { try { await f(); } catch { /* nada */ } }
  }
}
