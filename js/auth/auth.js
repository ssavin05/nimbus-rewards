/* ======================================================================
   auth.js — Autenticación con Supabase Auth (JWT + OAuth).

   Métodos soportados:
     • Correo y contraseña (registro, inicio de sesión, verificación)
     • Recuperación y cambio de contraseña
     • Google (OAuth 2.0 / OIDC)
     • Apple (Sign in with Apple)
     • Enlace mágico por correo

   El token JWT lo administra la biblioteca: se refresca solo y viaja en
   cada petición REST, donde las políticas RLS deciden qué puede leer o
   escribir cada usuario.
   ====================================================================== */
import { getDB, mensajeError, recordarSesion } from "../data/db.js";
import store from "../core/store.js";
import { emit, EV } from "../core/bus.js";
import { APP } from "../core/config.js";
import { esEmail, evaluarPassword } from "../core/utils.js";

let inicializado = false;

/** ¿Hay un token de sesión guardado por la biblioteca en este equipo? */
function haySesionGuardada() {
  try {
    for (const almacen of [localStorage, sessionStorage]) {
      for (const clave of Object.keys(almacen)) {
        if (clave.startsWith("sb-") && clave.includes("-auth-token")) return true;
      }
    }
  } catch { return true; }   // si no se puede mirar, se asume que sí
  return false;
}

/** ¿Venimos de un enlace de correo o de un retorno OAuth? */
function urlTraeTokenDeCorreo() {
  if (typeof location === "undefined") return false;
  return /(^|[?&#])(code|access_token|refresh_token|error_description)=/.test(
    location.search + location.hash,
  );
}

/** URL absoluta de retorno tras un flujo OAuth o un enlace de correo. */
function urlRetorno(hash = "#/") {
  const base = location.origin + location.pathname;
  return base + hash;
}

/**
 * URL de retorno para los enlaces que llegan por correo (recuperación,
 * confirmación, enlace mágico).
 *
 * Va SIN "#": según la configuración del proyecto, Supabase devuelve el
 * token en la query (`?code=…`, flujo PKCE) o en el hash
 * (`#access_token=…&type=recovery`). Si nuestra URL ya llevara hash, el
 * segundo se pegaría al primero (`#/nueva-password#access_token=…`) y la
 * ruta dejaría de existir. Con la base limpia, `revisarEnlaceDeCorreo()`
 * decide a dónde ir.
 */
function urlRetornoCorreo() {
  return location.origin + location.pathname;
}

/**
 * Lee los parámetros que Supabase deja en la URL al volver de un correo
 * y devuelve a qué ruta hay que ir. Limpia la URL para que el token no
 * quede en el historial ni se comparta por accidente.
 *
 * @returns {{destino:string|null, error:string|null}}
 */
export function revisarEnlaceDeCorreo() {
  if (typeof location === "undefined") return { destino: null, error: null };

  const query = new URLSearchParams(location.search);
  const hashCrudo = location.hash.startsWith("#/") ? "" : location.hash.replace(/^#/, "");
  const hash = new URLSearchParams(hashCrudo);
  const leer = (k) => query.get(k) || hash.get(k);

  const tipo = leer("type");
  const errorDesc = leer("error_description") || leer("error");
  const hayToken = Boolean(leer("code") || leer("access_token") || errorDesc);
  if (!hayToken && !tipo) return { destino: null, error: null };

  // Deja la barra de direcciones limpia; la sesión ya la procesó la
  // biblioteca a partir de la URL original.
  const destino = tipo === "recovery" ? "/nueva-password" : "/";
  try {
    history.replaceState(null, "", location.pathname + "#" + destino);
  } catch { /* navegadores muy restrictivos */ }

  return {
    destino,
    error: errorDesc ? decodeURIComponent(String(errorDesc).replace(/\+/g, " ")) : null,
  };
}

/* ---------------------------------------------------------------------
   Arranque
   --------------------------------------------------------------------- */

/** Lee la sesión guardada y engancha los cambios de estado. */
export async function iniciarAuth() {
  if (inicializado) return store.get().sesion;
  inicializado = true;

  // Sin sesión guardada no hay nada que rehidratar, y cargar la
  // biblioteca de Supabase (108 KB) sólo para descubrirlo es tirar
  // ancho de banda de quien entra a mirar el catálogo. Se pospone hasta
  // que alguien inicie sesión, reserve o vuelva de un enlace de correo.
  if (!haySesionGuardada() && !urlTraeTokenDeCorreo()) return null;

  const db = await getDB();
  if (!db) return null;

  const { data } = await db.auth.getSession();
  if (data?.session) await hidratarSesion(data.session);

  db.auth.onAuthStateChange(async (evento, sesion) => {
    if (evento === "PASSWORD_RECOVERY") {
      // La sesión temporal del enlace ya está activa: sólo falta que la
      // persona escriba la contraseña nueva.
      if (sesion) await hidratarSesion(sesion);
      emit(EV.RECUPERAR_PASSWORD, sesion);
      if (!location.hash.includes("/nueva-password")) location.hash = "#/nueva-password";
      return;
    }
    if (evento === "SIGNED_OUT") {
      store.limpiarSesion();
      const { detenerRealtime } = await import("../data/realtime.js");
      detenerRealtime();
      return;
    }
    if (sesion) {
      await hidratarSesion(sesion);
      if (evento === "SIGNED_IN") emit(EV.SESION_INICIADA, sesion);
    }
  });

  return store.get().sesion;
}

/** Carga el perfil de `usuarios` y lo guarda en el estado global. */
async function hidratarSesion(sesion) {
  const db = await getDB();
  store.setSesion(sesion, store.get().perfil);
  if (!db) return;

  const { data: perfil } = await db.from("usuarios").select("*").eq("id", sesion.user.id).maybeSingle();
  let perfilEfectivo = perfil;
  if (perfil) {
    store.setSesion(sesion, perfil);
  } else {
    // El trigger de la base debería crearlo; esto cubre cuentas antiguas.
    const meta = sesion.user.user_metadata || {};
    const { data: nuevo } = await db.from("usuarios").upsert({
      id: sesion.user.id,
      email: sesion.user.email,
      nombre: meta.nombre || meta.full_name || meta.name || sesion.user.email?.split("@")[0],
      avatar_url: meta.avatar_url || meta.picture || null,
    }).select().maybeSingle();
    perfilEfectivo = nuevo;
    store.setSesion(sesion, nuevo);
  }

  // Membresías por organización (multiempresa). Se consulta la tabla sola:
  // antes se pedía además un join con `organizaciones`; si esa relación
  // quedaba bloqueada por una política RLS antigua, Supabase devolvía toda
  // la consulta vacía y la interfaz degradaba a un admin real a "usuario".
  const { data: membresias } = await db.from("organizacion_usuarios")
    .select("*")
    .eq("usuario_id", sesion.user.id);
  const listaMembresias = membresias || [];
  const candidatos = [
    perfilEfectivo?.rol,
    sesion.user?.app_metadata?.rol,
    ...listaMembresias.map((m) => m.rol),
  ].filter(Boolean);
  const orden = { invitado: 0, usuario: 1, staff: 2, admin: 3, superadmin: 4 };
  const rolEfectivo = candidatos.sort((a, b) => (orden[b] || 0) - (orden[a] || 0))[0] || "usuario";

  store.setSesion(sesion, { ...(perfilEfectivo || {}), rol: rolEfectivo });
  store.set({ membresias: listaMembresias, rol: rolEfectivo }, "acceso");
}

/** Vuelve a consultar el rol sin obligar a cerrar sesión. */
export async function refrescarAcceso() {
  const db = await getDB();
  if (!db) return { rol: store.get().rol, actualizado: false };
  const { data } = await db.auth.getSession();
  if (!data?.session) return { rol: "invitado", actualizado: false };
  await hidratarSesion(data.session);
  return { rol: store.get().rol, actualizado: true, membresias: store.get().membresias };
}

/* ---------------------------------------------------------------------
   Correo y contraseña
   --------------------------------------------------------------------- */

export async function registrar({ email, password, nombre, telefono = "", recordar = true }) {
  if (!esEmail(email)) throw new Error("Correo no válido");
  const pw = evaluarPassword(password);
  if (!pw.ok) throw new Error(pw.mensaje);

  const db = await getDB();
  if (!db) throw new Error("El servidor no está configurado todavía.");
  recordarSesion(recordar);

  const metadata = {
    nombre: (nombre || "").trim(),
    app: APP.name,
  };
  const telefonoLimpio = String(telefono || "").trim();
  if (telefonoLimpio) metadata.telefono = telefonoLimpio;

  const { data, error } = await db.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      // Un teléfono opcional vacío NO se manda como "". La base acepta
      // NULL o un teléfono válido; enviar una cadena vacía hacía fallar
      // todo el signup con 500 por `usuario_telefono_razonable`.
      data: metadata,
      emailRedirectTo: urlRetornoCorreo(),
    },
  });
  if (error) {
    // No se delata si el correo ya estaba registrado: eso permitiría
    // averiguar quién tiene cuenta probando direcciones una a una. Se
    // responde igual que en un alta normal, y quien de verdad sea el
    // dueño recibe un aviso en su buzón.
    if (/already registered|already exists|user_already_exists/i.test(String(error.message))) {
      return { usuario: null, necesitaConfirmar: true, neutro: true };
    }
    throw new Error(mensajeError(error));
  }

  // Si el proyecto exige confirmar el correo, aún no hay sesión.
  const necesitaConfirmar = !data.session;
  if (data.session) await hidratarSesion(data.session);
  return { usuario: data.user, necesitaConfirmar };
}

/**
 * Reenvía el correo de confirmación. Responde igual exista o no la
 * cuenta, por el mismo motivo que `registrar`.
 */
export async function reenviarConfirmacion(email) {
  const db = await getDB();
  if (!db) throw new Error("El servidor no está configurado todavía.");
  const { error } = await db.auth.resend({
    type: "signup",
    email: String(email || "").trim().toLowerCase(),
    options: { emailRedirectTo: urlRetornoCorreo() },
  });
  // Sólo se propaga lo que no delata nada: si no hay cuenta, silencio.
  if (error && /rate limit|too many/i.test(String(error.message))) {
    throw new Error(mensajeError(error));
  }
  return true;
}

export async function entrar({ email, password, recordar = true }) {
  const db = await getDB();
  if (!db) throw new Error("El servidor no está configurado todavía.");
  recordarSesion(recordar);

  const { data, error } = await db.auth.signInWithPassword({
    email: String(email).trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(mensajeError(error));
  await hidratarSesion(data.session);
  emit(EV.SESION_INICIADA, data.session);
  return data.session;
}

/**
 * Cierra la sesión y, sobre todo, **no deja rastro en el equipo**.
 *
 * Cerrar sesión no es sólo borrar el token: si el siguiente que abre el
 * navegador puede seguir viendo tus reservas, tus facturas o tus
 * notificaciones porque quedaron guardadas en IndexedDB o en la caché
 * del service worker, la sesión no está cerrada de verdad. Aquí se
 * limpia todo lo que contiene datos personales y se conserva sólo lo
 * neutro (idioma, tema, si ya viste el tutorial).
 */
export async function salir() {
  const db = await getDB();
  // Sin `scope`, supabase-js revoca el refresh token en el servidor. Si
  // alguien te copió el token del almacenamiento, deja de servirle.
  try { await db?.auth.signOut(); }
  catch { /* la sesión local se limpia igual */ }

  store.limpiarSesion();

  try {
    const { detenerRealtime } = await import("../data/realtime.js");
    await detenerRealtime();
  } catch { /* si no había canales, da igual */ }

  await limpiarRastroLocal();
}

/** Claves de localStorage que SÍ se conservan: no dicen nada de nadie. */
const CLAVES_NEUTRAS = new Set([
  "co.tema", "co.idioma", "co.animaciones", "co.haptica",
  "co.tutorial-visto", "co.instalar-descartado",
]);

/**
 * Borra caché de datos, IndexedDB y preferencias ligadas a la persona.
 * Por defecto conserva la bandeja de salida (`outbox`), que en la V1
 * endurecida sólo admite acciones no críticas (favoritos). Al borrar la
 * cuenta también se elimina esa cola porque ya no pertenece a nadie.
 */
export async function limpiarRastroLocal({ incluirPendientes = false } = {}) {
  // 1. Caché de datos en IndexedDB (reservas, espacios, respuestas API).
  try {
    const cache = await import("../data/cache.js");
    await cache.limpiarTodo();
    // Al borrar la cuenta ya no hay a dónde enviar lo pendiente.
    if (incluirPendientes) {
      for (const op of await cache.listarCola()) await cache.quitarDeCola(op.id);
    }
  } catch { /* sin IndexedDB no hay nada que borrar */ }

  // 2. Cachés del service worker con datos e imágenes privadas.
  try {
    const reg = navigator.serviceWorker?.controller;
    if (reg) reg.postMessage({ tipo: "purgar-datos" });
    else if (typeof caches !== "undefined") {
      const claves = await caches.keys();
      await Promise.all(claves.filter((k) => /^co-(datos|img)-/.test(k)).map((k) => caches.delete(k)));
    }
  } catch { /* ignora */ }

  // 3. Preferencias que sí identifican (borradores, último edificio…).
  try {
    for (const clave of Object.keys(localStorage)) {
      if (clave.startsWith("co.") && !CLAVES_NEUTRAS.has(clave)) localStorage.removeItem(clave);
      // La biblioteca de Supabase guarda el token con este prefijo.
      if (clave.startsWith("sb-") && clave.includes("-auth-token")) localStorage.removeItem(clave);
    }
    sessionStorage.clear();
  } catch { /* modo privado */ }
}

/* ---------------------------------------------------------------------
   Recuperación y cambio de contraseña
   --------------------------------------------------------------------- */

export async function recuperarPassword(email) {
  if (!esEmail(email)) throw new Error("Correo no válido");
  const db = await getDB();
  if (!db) throw new Error("El servidor no está configurado todavía.");
  const { error } = await db.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: urlRetornoCorreo(),
  });
  if (error) throw new Error(mensajeError(error));
  return true;
}

/**
 * Cambia la contraseña de la sesión activa.
 * @param {string} nueva
 * @param {object} opciones
 * @param {string} [opciones.actual]  Si se pasa, se verifica antes.
 * @param {boolean} [opciones.cerrarOtras=false] Cierra el resto de sesiones.
 */
export async function cambiarPassword(nueva, { actual = null, cerrarOtras = false } = {}) {
  const pw = evaluarPassword(nueva);
  if (!pw.ok) throw new Error(pw.mensaje);

  const db = await getDB();
  if (!db) throw new Error("El servidor no está configurado todavía.");

  const { data: sesionActual } = await db.auth.getSession();
  if (!sesionActual?.session) {
    throw new Error("Tu enlace expiró o no hay sesión activa. Pide uno nuevo desde “¿Olvidaste tu contraseña?”.");
  }

  // Verificación de la contraseña vigente: evita que alguien con el
  // teléfono desbloqueado ajeno cambie la clave sin conocerla.
  if (actual) {
    const email = sesionActual.session.user?.email;
    if (!email) throw new Error("Esta cuenta no usa contraseña; entra con Google o Apple.");
    const { error: eVerif } = await db.auth.signInWithPassword({ email, password: actual });
    if (eVerif) throw new Error("La contraseña actual no es correcta.");
  }

  const { error } = await db.auth.updateUser({ password: nueva });
  if (error) throw new Error(mensajeError(error));

  if (cerrarOtras) await cerrarOtrasSesiones().catch(() => {});
  return true;
}

/** Cierra la sesión en el resto de dispositivos, manteniendo el actual. */
export async function cerrarOtrasSesiones() {
  const db = await getDB();
  if (!db) throw new Error("El servidor no está configurado todavía.");
  const { error } = await db.auth.signOut({ scope: "others" });
  if (error) throw new Error(mensajeError(error));
  return true;
}

/** ¿La cuenta puede usar contraseña, o entró sólo con Google/Apple? */
export function tienePassword() {
  const identidades = store.get().usuario?.identities || [];
  if (!identidades.length) return true;   // sin dato, se asume que sí
  return identidades.some((i) => i.provider === "email");
}

export async function cambiarEmail(nuevo) {
  if (!esEmail(nuevo)) throw new Error("Correo no válido");
  const db = await getDB();
  const { error } = await db.auth.updateUser({ email: nuevo.trim().toLowerCase() });
  if (error) throw new Error(mensajeError(error));
  return true;
}

/* ---------------------------------------------------------------------
   OAuth: Google y Apple
   --------------------------------------------------------------------- */

async function oauth(proveedor, opciones = {}) {
  const db = await getDB();
  if (!db) throw new Error("El servidor no está configurado todavía.");
  recordarSesion(true);
  const { error } = await db.auth.signInWithOAuth({
    provider: proveedor,
    options: {
      redirectTo: urlRetorno(opciones.redirect || "#/"),
      queryParams: proveedor === "google"
        ? { access_type: "offline", prompt: "select_account" }
        : undefined,
      scopes: proveedor === "apple" ? "email name" : undefined,
    },
  });
  if (error) {
    if (/provider is not enabled/i.test(error.message)) {
      throw new Error(`Falta activar ${proveedor === "google" ? "Google" : "Apple"} en Supabase → Authentication → Providers.`);
    }
    throw new Error(mensajeError(error));
  }
  // El navegador se redirige; no hay valor de retorno útil.
}

export const entrarConGoogle = (opciones) => oauth("google", opciones);
export const entrarConApple = (opciones) => oauth("apple", opciones);

/** Enlace mágico: inicia sesión sin contraseña. */
export async function enviarEnlaceMagico(email) {
  if (!esEmail(email)) throw new Error("Correo no válido");
  const db = await getDB();
  const { error } = await db.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: urlRetornoCorreo() },
  });
  if (error) throw new Error(mensajeError(error));
  return true;
}

/* ---------------------------------------------------------------------
   Utilidades
   --------------------------------------------------------------------- */

export function nombreUsuario() {
  const { perfil, usuario } = store.get();
  const meta = usuario?.user_metadata || {};
  return perfil?.nombre || meta.nombre || meta.full_name || meta.name
    || (usuario?.email ? usuario.email.split("@")[0] : "Invitado");
}

export function avatarUsuario() {
  const { perfil, usuario } = store.get();
  return perfil?.avatar_url || usuario?.user_metadata?.avatar_url || usuario?.user_metadata?.picture || "";
}

/**
 * Borrado de cuenta. Lo ejecuta una Edge Function con permisos de
 * administración: el navegador no puede borrarse a sí mismo.
 * Devuelve el detalle de lo eliminado.
 */
export async function eliminarCuenta() {
  const db = await getDB();

  // Sin servidor (modo local) la cuenta vive sólo en este equipo: se
  // borra lo local y listo. Antes esto lanzaba un error y dejaba a la
  // persona sin manera de darse de baja.
  if (!db) {
    await limpiarRastroLocal({ incluirPendientes: true });
    store.limpiarSesion();
    return { ok: true, local: true };
  }

  let resultado = null;
  let via = null;

  // 1. La vía buena: una función SQL que siempre está, porque viaja con
  //    el esquema. Borra el perfil y la credencial de acceso.
  try {
    const { data, error } = await db.rpc("eliminar_mi_cuenta");
    if (error) throw error;
    resultado = data; via = "rpc";
  } catch (e) {
    // 2. Si la base todavía no tiene seguridad.sql aplicado, se intenta
    //    la Edge Function (instalaciones antiguas).
    try {
      const { invocarFuncion } = await import("../data/db.js");
      resultado = await invocarFuncion("eliminar-cuenta", {});
      via = "funcion";
    } catch (e2) {
      // 3. Último recurso: borrar desde el cliente lo que las políticas
      //    RLS permiten. Queda la credencial de acceso, así que se dice
      //    claramente en vez de fingir que se borró todo.
      const parcial = await borradoDesdeElCliente(db);
      if (!parcial) {
        throw new Error(
          "No se pudo eliminar la cuenta. Falta aplicar supabase/seguridad.sql en la base de datos. " +
          "Escríbenos y la borramos nosotros."
        );
      }
      resultado = { ...parcial, parcial: true };
      via = "cliente";
    }
  }

  await salir();
  await limpiarRastroLocal({ incluirPendientes: true });
  return { ...resultado, via };
}

/**
 * Borrado de emergencia con los permisos de la propia sesión.
 * Devuelve null si ni siquiera esto funciona.
 */
async function borradoDesdeElCliente(db) {
  const { usuario } = store.get();
  if (!usuario) return null;
  const uid = usuario.id;
  const detalle = {};

  try {
    await db.from("reservas")
      .update({ estado: "cancelada" })
      .eq("usuario_id", uid).in("estado", ["pendiente", "confirmada"])
      .gt("inicio", new Date().toISOString());

    for (const tabla of ["favoritos", "lista_espera", "notificaciones",
                         "push_suscripciones", "resenas"]) {
      const { count } = await db.from(tabla).delete({ count: "exact" }).eq("usuario_id", uid);
      detalle[tabla] = count ?? 0;
    }
    await db.from("usuarios").update({
      nombre: "Cuenta eliminada", telefono: null, avatar_url: null,
      empresa: null, rfc: null, datos_facturacion: {},
    }).eq("id", uid);
    return detalle;
  } catch {
    return null;
  }
}

/** Exporta los datos personales del usuario (derecho de portabilidad). */
export async function descargarMisDatos() {
  const db = await getDB();
  const { usuario } = store.get();
  if (!db || !usuario) throw new Error("Sin sesión");
  const [perfil, reservas, pagos, resenas, favoritos] = await Promise.all([
    db.from("usuarios").select("*").eq("id", usuario.id).maybeSingle(),
    db.from("reservas").select("*").eq("usuario_id", usuario.id),
    db.from("pagos").select("*").eq("usuario_id", usuario.id),
    db.from("resenas").select("*").eq("usuario_id", usuario.id),
    db.from("favoritos").select("*").eq("usuario_id", usuario.id),
  ]);
  return {
    exportado_en: new Date().toISOString(),
    perfil: perfil.data, reservas: reservas.data, pagos: pagos.data,
    resenas: resenas.data, favoritos: favoritos.data,
  };
}

export default {
  iniciarAuth, registrar, entrar, salir, recuperarPassword, cambiarPassword, cambiarEmail,
  reenviarConfirmacion,
  entrarConGoogle, entrarConApple, enviarEnlaceMagico, nombreUsuario, avatarUsuario,
  eliminarCuenta, descargarMisDatos, limpiarRastroLocal,
  cerrarOtrasSesiones, revisarEnlaceDeCorreo, tienePassword,
};
