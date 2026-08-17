/* ======================================================================
   config.js — Configuración central de la aplicación.

   TODO lo que depende del entorno (URLs, llaves públicas, teléfonos,
   banderas de funcionalidad) vive aquí. Ningún otro módulo debe leer
   credenciales directamente.

   Las llaves que aparecen abajo son SIEMPRE datos públicos del cliente.
   Las credenciales secretas (Clip, IA, VAPID privada, etc.) viven
   únicamente en las Edge Functions del servidor — ver supabase/functions.
   ====================================================================== */

/* Permite sobreescribir cualquier valor sin tocar este archivo:
   basta con definir window.__APP_CONFIG__ antes de cargar main.js
   (por ejemplo desde un <script> inyectado por el hosting). */
const OVERRIDES = (typeof window !== "undefined" && window.__APP_CONFIG__) || {};

/* Ajustes que la administración cambia desde la propia app
   (/admin/apariencia). Se guardan en el equipo y ganan sobre los valores
   de fábrica, pero pierden contra window.__APP_CONFIG__, que es lo que
   pone el hosting y no debería poder saltarse desde la interfaz. */
export const CLAVE_AJUSTES = "co.ajustes";

function leerAjustes() {
  if (typeof localStorage === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(CLAVE_AJUSTES) || "{}") || {}; }
  catch { return {}; }
}
let AJUSTES = leerAjustes();

function buscar(objeto, parts) {
  let cur = objeto;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object" || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function pick(path, fallback) {
  const parts = path.split(".");
  const delHosting = buscar(OVERRIDES, parts);
  if (delHosting !== undefined) return delHosting;
  const delAdmin = buscar(AJUSTES, parts);
  if (delAdmin !== undefined) return delAdmin;
  return fallback;
}

/** Lee los ajustes guardados (para el panel de administración). */
export function getAjustes() { return structuredClone(AJUSTES); }

/**
 * Guarda los ajustes de la administración. Requiere recargar para que
 * todos los módulos los vean: se avisa desde la vista, no se recarga a
 * traición mientras alguien está tocando interruptores.
 */
export function setAjustes(nuevos) {
  AJUSTES = nuevos || {};
  try { localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(AJUSTES)); } catch { /* ignora */ }
  return AJUSTES;
}

export const APP = {
  name: pick("app.name", "Smart Hub"),
  shortName: pick("app.shortName", "Smart Hub"),
  version: pick("app.version", "2.8.1"),
  /* Marca de pre-lanzamiento. Al ejecutar limpieza-lanzamiento-aplicar.sql hay
     que cambiar esta fecha: cada equipo que abra la app comparará la
     suya y, si no coincide, purgará la disponibilidad guardada. Sin
     esto, quien ya usó la app sigue viendo horarios ocupados aunque la
     base esté vacía. No afecta a la sesión. */
  epocaLanzamiento: pick("app.epocaLanzamiento", "2026-08-13"),
  /* Ruta base cuando la app se sirve desde un subdirectorio
     (ej. GitHub Pages: "/3d/"). Se detecta sola, pero se puede forzar. */
  basePath: pick("app.basePath", detectBasePath()),
  defaultLocale: pick("app.defaultLocale", "es"),
  currency: pick("app.currency", "MXN"),
  locale: pick("app.locale", "es-MX"),
  timezone: pick("app.timezone", "America/Tijuana"),
};

function detectBasePath() {
  if (typeof document === "undefined") return "/";
  const base = document.querySelector("base");
  if (base?.getAttribute("href")) return base.getAttribute("href");
  // /carpeta/index.html -> /carpeta/
  const path = location.pathname;
  return path.endsWith("/") ? path : path.slice(0, path.lastIndexOf("/") + 1);
}

/* ---------------------------------------------------------------------
   Supabase — base de datos real, API REST (PostgREST), realtime,
   almacenamiento en la nube y autenticación con JWT.
   --------------------------------------------------------------------- */
export const SUPABASE = {
  url: pick("supabase.url", "https://xashvchjvsmwyrbxwomd.supabase.co"),
  anonKey: pick("supabase.anonKey", "sb_publishable_5kJ0n19pWLvyhJuANLFwIw_nqwvn4RA"),
  /* Buckets de Storage usados por la app */
  buckets: {
    avatares: pick("supabase.buckets.avatares", "avatares"),
    espacios: pick("supabase.buckets.espacios", "espacios"),
    facturas: pick("supabase.buckets.facturas", "facturas"),
    modelos: pick("supabase.buckets.modelos", "modelos-3d"),
  },
};

export const isBackendConfigured = () =>
  Boolean(SUPABASE.url && SUPABASE.anonKey && !SUPABASE.url.includes("TU-PROYECTO"));

/* ---------------------------------------------------------------------
   Autenticación opcional.

   V1 no anuncia proveedores ni flujos por correo que el propietario no
   haya terminado de configurar. Esto evita botones que inevitablemente
   terminan en un error de Supabase/Brevo. Se habilitan explícitamente
   desde window.__APP_CONFIG__ cuando ya estén probados.
   --------------------------------------------------------------------- */
export const AUTH = {
  emailDeliveryEnabled: pick("auth.emailDeliveryEnabled", false),
  googleEnabled: pick("auth.googleEnabled", false),
  appleEnabled: pick("auth.appleEnabled", false),
};

/* ---------------------------------------------------------------------
   Pagos — sólo identificadores públicos. El cobro real siempre pasa por
   una Edge Function (`/functions/v1/pagos-*`).
   --------------------------------------------------------------------- */
export const PAYMENTS = {
  /* V1: una sola pasarela pública. El registro de pagos también aplica
     una allow-list, así que ni un override del hosting puede resucitar
     adaptadores retirados. */
  order: pick("payments.order", ["clip"]),

  /* Clip México — no hay credenciales en el navegador. Todo el cobro
     vive en la Edge Function `pagos-clip`. En V1 es la única pasarela y
     queda visible por defecto; antes de crear el apartado, el adaptador
     consulta al servidor y falla cerrado si faltan secretos, SITIO_URL o
     CLIP_COBROS_REALES=si. */
  clip: { enabled: pick("payments.clip.enabled", true) },

  /* IVA aplicado al subtotal (México: 16 %) */
  taxRate: pick("payments.taxRate", 0.16),
};

/* ---------------------------------------------------------------------
   Notificaciones push (Web Push / VAPID). La llave privada vive en el
   servidor; aquí sólo la pública.
   --------------------------------------------------------------------- */
export const PUSH = {
  vapidPublicKey: pick("push.vapidPublicKey", ""),
  enabled: pick("push.enabled", true),
  /* Minutos antes de la reserva en que se envía cada recordatorio */
  reminderOffsets: pick("push.reminderOffsets", [24 * 60, 60]),
};

/* ---------------------------------------------------------------------
   Comunicación con administración
   --------------------------------------------------------------------- */
/* Los datos de contacto vienen VACÍOS a propósito. Los que había eran
   inventados (Av. Reforma 1234, +52 646 000 0000,
   reservas@centrodeoficinas.mx) y publicar un teléfono o un correo que
   no es tuyo manda clientes a un desconocido. Cada canal que siga vacío
   simplemente no se pinta: la app funciona sin ellos. Rellénalos con
   los reales — ver OWNER_ACTIONS.md.

   El horario de atención también queda vacío hasta que el negocio lo
   confirme. Los bloques reservables no equivalen a horario de atención. */
export const CONTACT = {
  telefono: pick("contact.telefono", ""),
  telefonoVisible: pick("contact.telefonoVisible", ""),
  whatsapp: pick("contact.whatsapp", ""),
  email: pick("contact.email", "savinsaul750@gmail.com"),
  direccion: pick("contact.direccion", ""),
  horarioAtencion: pick("contact.horarioAtencion", ""),
};

/** ¿Hay algún canal de contacto configurado? Las vistas lo usan para no
 *  pintar una sección de «contáctanos» sin un solo dato dentro. */
export const hayContacto = () =>
  Boolean(CONTACT.telefono || CONTACT.whatsapp || CONTACT.email || CONTACT.direccion);

/* ---------------------------------------------------------------------
   Asistente de IA
   --------------------------------------------------------------------- */
export const AI = {
  /* Edge Function que hace de proxy hacia el modelo. Si está vacía o
     no responde, el asistente cae al motor heurístico local. */
  endpoint: pick("ai.endpoint", "/functions/v1/asistente"),
  enabled: pick("ai.enabled", true),
  model: pick("ai.model", "claude-sonnet-5"),
};

/* ---------------------------------------------------------------------
   Reglas de negocio de reservas
   --------------------------------------------------------------------- */
export const BOOKING = {
  /* Reglas de dinero/venta: NO son overrides de interfaz. Tienen que
     coincidir con PostgreSQL; cambiarlas sólo en el navegador permitiría
     enseñar una política que el servidor no aplica. */
  // Horario comercial unificado: TODOS los días, de 08:00 a 19:00.
  // Cada bloque dura 1 hora; el último termina exactamente a las 19:00.
  bloques: Object.freeze([
    "08:00-09:00", "09:00-10:00", "10:00-11:00", "11:00-12:00",
    "12:00-13:00", "13:00-14:00", "14:00-15:00", "15:00-16:00",
    "16:00-17:00", "17:00-18:00", "18:00-19:00",
  ]),
  /* Sólo controla cuántos días dibuja el selector rápido. */
  diasVisibles: pick("booking.diasVisibles", 14),
  /* Reglas autoritativas V1, espejadas en seguridad.sql/migración 14. */
  diasMaximos: 90,
  horasCancelacionGratis: 24,
  penalizacionTardia: 0.5,
  maxReservasActivas: 10,
};

/* ---------------------------------------------------------------------
   Rendimiento del mapa 3D. `auto` decide según el dispositivo.
   --------------------------------------------------------------------- */
export const GRAPHICS = {
  quality: pick("graphics.quality", "auto"),   // auto | bajo | medio | alto
  maxPixelRatio: pick("graphics.maxPixelRatio", 2),
  /* URLs opcionales de recursos pesados. Vacío = se generan por código
     (no requiere ningún archivo externo). */
  hdriUrl: pick("graphics.hdriUrl", ""),
  dracoDecoderPath: pick("graphics.dracoDecoderPath", "https://www.gstatic.com/draco/versioned/decoders/1.5.6/"),
  threeVersion: pick("graphics.threeVersion", "0.160.0"),
  /* Estilo del mapa:
       "plano"     → bloques de color planos, como un plano arquitectónico
                     coloreado. Se lee de un vistazo y va rápido en móvil.
       "realista"  → maqueta con muebles, gente, autos, vegetación e HDRI.
     El plano es el estilo por defecto: la app es para reservar oficinas,
     no para pasear por el edificio. */
  estilo: pick("graphics.estilo", "plano"),
  /* Imagen del plano arquitectónico. Si existe, se dibuja a escala bajo
     los bloques de color y el mapa pasa a ser EL plano, no una
     reconstrucción. Basta con dejar el archivo en assets/plano.png
     recortado por los muros exteriores. */
  planoUrl: pick("graphics.planoUrl", ""),
  usarPlano: pick("graphics.usarPlano", false),
  /* Modelo 3D del edificio (GLB/GLTF). Deja el archivo en
     assets/edificio.glb y aparece solo, en cualquiera de los dos
     estilos de mapa. Vacío = sólo los bloques de color. */
  modeloUrl: pick("graphics.modeloUrl", ""),
};

/* ---------------------------------------------------------------------
   Banderas de funcionalidad — permiten apagar módulos completos.
   --------------------------------------------------------------------- */
export const FEATURES = {
  mapa3d: pick("features.mapa3d", true),
  favoritos: pick("features.favoritos", true),
  resenas: pick("features.resenas", true),
  listaEspera: pick("features.listaEspera", true),
  /* Los descuentos y códigos promocionales ensucian la interfaz y
     distraen de lo único que importa: elegir oficina y hora. Apagado.
     El motor sigue en el servidor por si algún día se vuelven a
     encender desde window.__APP_CONFIG__. */
  promociones: pick("features.promociones", false),
  chat: pick("features.chat", true),
  asistenteIA: pick("features.asistenteIA", true),
  pagos: pick("features.pagos", true),
  // V1: bloqueada a propósito. No se puede reactivar con un override del
  // navegador hasta que exista un flujo servidor que cree la solicitud
  // con importes autoritativos y un PAC real probado.
  facturacion: false,
  analitica: pick("features.analitica", true),
  multiSede: pick("features.multiSede", true),
  offline: pick("features.offline", true),
  tutorial: pick("features.tutorial", true),
  /* Adornos que no ayudan a reservar: testimonios, contadores de
     "23 personas viendo esto", insignias de moda. */
  adornos: pick("features.adornos", false),
};

export const STORAGE_KEYS = {
  tema: "co.tema",
  idioma: "co.idioma",
  tutorialVisto: "co.tutorial.visto",
  recordarme: "recordarme",
  sedeActiva: "co.sede",
  haptics: "co.haptics",
  animaciones: "co.animaciones",
  calidad3d: "co.calidad3d",
  estilo3d: "co.estilo3d",
  ultimaSync: "co.sync",
};

export default {
  APP, SUPABASE, AUTH, PAYMENTS, PUSH, CONTACT, AI, BOOKING, GRAPHICS, FEATURES, STORAGE_KEYS,
  CLAVE_AJUSTES, getAjustes, isBackendConfigured, setAjustes,
};
