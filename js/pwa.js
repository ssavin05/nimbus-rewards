/* ======================================================================
   pwa.js — Instalación, actualizaciones y notificaciones push.

   • Registra el service worker y avisa cuando hay versión nueva.
   • Guarda el evento `beforeinstallprompt` para ofrecer "Instalar app".
   • Gestiona la suscripción Web Push (VAPID) contra Supabase.
   ====================================================================== */
import { APP, PUSH } from "./core/config.js";
import { emit, EV } from "./core/bus.js";
import { getDB } from "./data/db.js";
import store from "./core/store.js";
import { esIOS, rutaInterna } from "./core/utils.js";

let registro = null;
let promptInstalacion = null;

/* ---------------------------------------------------------------------
   Service worker
   --------------------------------------------------------------------- */
export async function iniciarPWA() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptInstalacion = e;
  });

  window.addEventListener("appinstalled", () => {
    promptInstalacion = null;
    console.info("[pwa] aplicación instalada");
  });

  if (!("serviceWorker" in navigator)) return null;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    console.info("[pwa] el service worker requiere HTTPS");
    return null;
  }

  try {
    registro = await navigator.serviceWorker.register(APP.basePath + "sw.js", { scope: APP.basePath });

    // Comprueba la versión al abrir, no media hora después.
    registro.update().catch(() => {});

    /* Si una versión NUEVA toma el control, recargamos una sola vez para
       que el documento deje de ejecutar JS viejo que estaba en memoria.

       OJO con la primera visita. `controllerchange` no significa sólo
       «hay versión nueva»: también salta la PRIMERA vez que un service
       worker reclama una página que no tenía ninguno (el sw.js hace
       skipWaiting + clients.claim). En ese caso no hay código viejo que
       tirar, y recargar sólo consigue que la app arranque, se descarte y
       vuelva a arrancar: un parpadeo y una descarga doble en cada visita
       nueva, y si alguien estaba escribiendo o pagando, se pierde lo que
       llevara hecho.

       Por eso se mira si YA había un controlador al registrar: sólo
       entonces esto es una actualización de verdad. */
    const habiaControlador = Boolean(navigator.serviceWorker.controller);
    let recargandoPorSW = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!habiaControlador) return;   // primera visita: nada que recargar
      if (recargandoPorSW) return;
      recargandoPorSW = true;
      location.reload();
    });

    // Nueva versión esperando
    if (registro.waiting) emit(EV.APP_ACTUALIZABLE, registro.waiting);

    registro.addEventListener("updatefound", () => {
      const nuevo = registro.installing;
      if (!nuevo) return;
      nuevo.addEventListener("statechange", () => {
        if (nuevo.state === "installed" && navigator.serviceWorker.controller) {
          emit(EV.APP_ACTUALIZABLE, nuevo);
        }
      });
    });

    // El service worker nos habla (por ejemplo al terminar un sync).
    navigator.serviceWorker.addEventListener("message", (e) => {
      const { tipo, payload } = e.data || {};
      if (tipo === "sync-completo") emit(EV.SYNC_COMPLETA, payload || { enviadas: 0 });
      // El destino nace en un push: se limita a una ruta interna.
      if (tipo === "navegar" && payload?.url) location.hash = rutaInterna(String(payload.url).replace(/^#/, ""));
    });

    // Busca actualizaciones cada media hora y al volver a la pestaña.
    setInterval(() => registro.update().catch(() => {}), 30 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registro.update().catch(() => {});
    });

    // Si ya había permiso, resuscribe silenciosamente.
    if (Notification?.permission === "granted") pedirPermisoPush({ silencioso: true }).catch(() => {});

    return registro;
  } catch (e) {
    console.warn("[pwa] no se pudo registrar el service worker", e);
    return null;
  }
}

/** Aplica la actualización pendiente y recarga. */
export function aplicarActualizacion() {
  if (!registro?.waiting) { location.reload(); return; }
  registro.waiting.postMessage({ tipo: "saltar-espera" });
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
}

/* ---------------------------------------------------------------------
   Instalación
   --------------------------------------------------------------------- */
export const puedeInstalar = () => Boolean(promptInstalacion) || (esIOS() && !estaInstalada());

export function estaInstalada() {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

export async function instalarApp() {
  if (!promptInstalacion) {
    if (esIOS()) {
      const { avisar } = await import("./core/ui.js");
      await avisar({
        titulo: "Instalar en iPhone o iPad",
        mensaje: "Toca el botón Compartir de Safari y elige “Agregar a pantalla de inicio”.",
      });
    }
    return false;
  }
  promptInstalacion.prompt();
  const { outcome } = await promptInstalacion.userChoice;
  promptInstalacion = null;
  return outcome === "accepted";
}

/* ---------------------------------------------------------------------
   Notificaciones push
   --------------------------------------------------------------------- */
export async function estadoPush() {
  const soportado = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const configurado = Boolean(PUSH.vapidPublicKey);
  if (!soportado) return { soportado: false, configurado, permiso: "unsupported", activo: false };

  const permiso = Notification.permission;
  let activo = false;
  try {
    const reg = registro || await navigator.serviceWorker.ready;
    activo = Boolean(await reg.pushManager.getSubscription());
  } catch { /* ignora */ }
  return { soportado: true, configurado, permiso, activo };
}

/**
 * Pide permiso y registra la suscripción en la base de datos.
 * `silencioso: true` no pide permiso si aún no se ha concedido.
 */
export async function pedirPermisoPush({ silencioso = false } = {}) {
  const estado = await estadoPush();
  if (!estado.soportado || !PUSH.enabled) return estado;
  if (!PUSH.vapidPublicKey) return { ...estado, configurado: false };

  if (Notification.permission === "default") {
    if (silencioso) return estado;
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") return { ...estado, permiso, activo: false };
  }
  if (Notification.permission !== "granted") return { ...estado, activo: false };

  try {
    const reg = registro || await navigator.serviceWorker.ready;
    let suscripcion = await reg.pushManager.getSubscription();
    if (!suscripcion) {
      suscripcion = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8(PUSH.vapidPublicKey),
      });
    }
    await guardarSuscripcion(suscripcion);
    return { soportado: true, configurado: true, permiso: "granted", activo: true };
  } catch (e) {
    console.warn("[pwa] no se pudo suscribir a push", e);
    return { ...estado, activo: false, error: e.message };
  }
}

export async function desactivarPush() {
  try {
    const reg = registro || await navigator.serviceWorker.ready;
    const s = await reg.pushManager.getSubscription();
    if (!s) return true;
    const endpoint = s.endpoint;
    await s.unsubscribe();
    const db = await getDB();
    if (db) await db.from("push_suscripciones").delete().eq("endpoint", endpoint);
    return true;
  } catch (e) {
    console.warn("[pwa] no se pudo desactivar push", e);
    return false;
  }
}

async function guardarSuscripcion(suscripcion) {
  const db = await getDB();
  const { usuario } = store.get();
  if (!db || !usuario) return;
  const json = suscripcion.toJSON();
  await db.from("push_suscripciones").upsert({
    usuario_id: usuario.id,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    agente: navigator.userAgent.slice(0, 200),
  }, { onConflict: "endpoint" });
}

function base64ToUint8(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Notificación local inmediata (no requiere servidor). Se usa como
 * respaldo para recordatorios mientras la app está abierta.
 */
export async function notificarLocal(titulo, opciones = {}) {
  if (Notification?.permission !== "granted") return false;
  try {
    const reg = registro || await navigator.serviceWorker.ready;
    await reg.showNotification(titulo, {
      badge: APP.basePath + "assets/icons/icono-96.png",
      icon: APP.basePath + "assets/icons/icono-192.png",
      vibrate: [80, 40, 80],
      ...opciones,
    });
    return true;
  } catch { return false; }
}

export default { iniciarPWA, aplicarActualizacion, puedeInstalar, instalarApp, estaInstalada, estadoPush, pedirPermisoPush, desactivarPush, notificarLocal };
