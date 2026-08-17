/* ======================================================================
   main.js — Arranque de la aplicación.

   Orden:
     1. Tema e idioma (antes de pintar nada).
     2. Sesión guardada.
     3. Catálogo desde caché → pantalla usable de inmediato.
     4. Router + navegación + realtime + PWA en segundo plano.
   ====================================================================== */
import { APP, FEATURES, STORAGE_KEYS } from "./core/config.js";
import { revisarEpocaDeLanzamiento } from "./core/lanzamiento.js";
import { initTema, getTema, setTema, temaEfectivo } from "./core/tema.js";
import { t, getIdioma, setIdioma } from "./core/i18n.js";
import { on as onBus, EV } from "./core/bus.js";
import store from "./core/store.js";
import { registrar, iniciarRouter, ir, rutaActual, recargarVista } from "./core/router.js";
import { $, crear, toast } from "./core/ui.js";
import { icono } from "./core/iconos.js";
import { iniciarAuth, nombreUsuario, avatarUsuario, revisarEnlaceDeCorreo } from "./auth/auth.js";
import { esAdmin, esStaff } from "./auth/permisos.js";
import api from "./data/api.js";
import { iniciarSync } from "./data/sync.js";
import { iniciarRealtime } from "./data/realtime.js";
import { montarDrawer, abrirDrawer } from "./views/drawer.js";
import { iniciarPWA } from "./pwa.js";
import { esc, iniciales } from "./core/utils.js";

/* =====================================================================
   Rutas — cada vista se descarga sólo al visitarla (lazy loading)
   ===================================================================== */
function registrarRutas() {
  registrar("/", () => import("./views/inicio.js"));
  registrar("/tutorial", () => import("./views/tutorial.js"));
  registrar("/nosotros", () => import("./views/nosotros.js"));
  // Públicas a propósito: el enlace está en la casilla del registro, y
  // pedir cuenta para leer lo que estás aceptando sería absurdo.
  registrar("/legal", () => import("./views/legal.js"));
  registrar("/legal/:doc", () => import("./views/legal.js"));
  registrar("/login", () => import("./views/login.js"));
  registrar("/registro", () => import("./views/login.js"));
  registrar("/recuperar", () => import("./views/login.js"));
  registrar("/nueva-password", () => import("./views/nueva-password.js"));

  registrar("/mapa", () => import("./views/mapa.js"));
  registrar("/espacios", () => import("./views/espacios.js"));
  registrar("/espacios/:id", () => import("./views/espacio.js"));
  registrar("/espacios/:id/reservar", () => import("./views/reservar.js"), { auth: true });
  registrar("/checkout/:id", () => import("./views/checkout.js"), { auth: true });

  registrar("/reservas", () => import("./views/mis-reservas.js"), { auth: true });
  registrar("/reservas/:id", () => import("./views/reserva-detalle.js"), { auth: true });
  registrar("/favoritos", () => import("./views/favoritos.js"), { auth: true });
  registrar("/notificaciones", () => import("./views/notificaciones.js"), { auth: true });

  registrar("/perfil", () => import("./views/perfil.js"), { auth: true });
  registrar("/configuracion", () => import("./views/configuracion.js"));
  registrar("/pagos", () => import("./views/pagos.js"), { auth: true });

  registrar("/ayuda", () => import("./views/ayuda.js"));
  registrar("/chat", () => import("./views/chat.js"), { auth: true });
  registrar("/asistente", () => import("./views/asistente.js"));

  // Antes las nueve rutas compartían la misma lista, así que un `staff`
  // entraba a Precios o a Edificios y sólo se enteraba de que no podía
  // cuando RLS le rechazaba el guardado. La seguridad de verdad la sigue
  // poniendo la base; esto es para no llevar a nadie a una pantalla que
  // no le corresponde.
  const rolStaff = ["staff", "admin", "superadmin"];   // operación diaria
  const rolAdmin = ["admin", "superadmin"];            // configuración comercial
  const rolSuper = ["superadmin"];                     // toda la plataforma

  // — Operación: lo que hace el mostrador todos los días
  registrar("/admin", () => import("./views/admin/panel.js"), { auth: true, rol: rolStaff });
  registrar("/admin/calendario", () => import("./views/admin/calendario.js"), { auth: true, rol: rolStaff });
  registrar("/admin/reservas", () => import("./views/admin/reservas.js"), { auth: true, rol: rolStaff });
  registrar("/admin/usuarios", () => import("./views/admin/usuarios.js"), { auth: true, rol: rolStaff });
  registrar("/admin/pagos", () => import("./views/admin/pagos.js"), { auth: true, rol: rolStaff });

  // — Configuración comercial: precios, catálogo, promociones
  registrar("/admin/espacios", () => import("./views/admin/espacios.js"), { auth: true, rol: rolAdmin });
  registrar("/admin/espacios/:id", () => import("./views/admin/espacio-editar.js"), { auth: true, rol: rolAdmin });
  registrar("/admin/promociones", () => import("./views/admin/promociones.js"), { auth: true, rol: rolAdmin });
  registrar("/admin/estadisticas", () => import("./views/admin/estadisticas.js"), { auth: true, rol: rolAdmin });
  registrar("/admin/apariencia", () => import("./views/admin/apariencia.js"), { auth: true, rol: rolAdmin });

  // — Arquitectura del edificio: no es configuración comercial.
  registrar("/admin/edificios", () => import("./views/admin/edificios.js"), { auth: true, rol: rolSuper });
}

/* =====================================================================
   Navegación inferior y lateral
   ===================================================================== */
const NAV = [
  { ruta: "/", ico: "inicio", clave: "nav.inicio" },
  { ruta: "/mapa", ico: "cubo", clave: "nav.mapa", si: () => FEATURES.mapa3d },
  { ruta: "/reservas", ico: "calendario", clave: "nav.reservas" },
  { ruta: "/favoritos", ico: "corazon", clave: "nav.favoritos", si: () => FEATURES.favoritos },
  { ruta: "/perfil", ico: "usuario", clave: "nav.perfil" },
];

function pintarNav() {
  const nav = $("#nav");
  if (!nav) return;
  const activa = rutaActual();
  const items = NAV.filter((n) => !n.si || n.si());

  nav.innerHTML = items.map((n) => {
    const seleccionada = n.ruta === "/" ? activa === "/" : activa.startsWith(n.ruta);
    const contador = n.ruta === "/reservas" ? proximasCount() : 0;
    return `<a class="nav-item" href="#${n.ruta}"${seleccionada ? ' aria-current="page"' : ""}>
        ${icono(n.ico, { size: 22 })}
        <span>${esc(t(n.clave))}</span>
        ${contador ? `<span class="nav-punto">${contador}</span>` : ""}
      </a>`;
  }).join("");
  nav.hidden = false;
}

function proximasCount() {
  const ahora = Date.now();
  return store.get().reservas.filter(
    (r) => r.estado !== "cancelada" && new Date(r.inicio).getTime() > ahora
  ).length;
}

function pintarLateral() {
  const lat = $("#lateral-fijo");
  if (!lat) return;
  const activa = rutaActual();
  if (activa.startsWith("/admin") && esStaff()) {
    const adminNav = [
      { ruta: "/admin", ico: "panel", txt: "Dashboard", exacta: true },
      { ruta: "/admin/calendario", ico: "calendario", txt: "Calendario" },
      { ruta: "/admin/reservas", ico: "panel", txt: "Reservaciones" },
      { ruta: "/admin/usuarios", ico: "personas", txt: "Clientes" },
      { ruta: "/admin/pagos", ico: "tarjeta", txt: "Pagos" },
      { ruta: "/admin/espacios", ico: "edificio", txt: "Espacios", admin: true },
      { ruta: "/admin/promociones", ico: "wallet", txt: "Tarifas", admin: true },
      { ruta: "/admin/apariencia", ico: "ajustes", txt: "Configuración", admin: true },
      { ruta: "/admin/estadisticas", ico: "grafica", txt: "Reportes", admin: true },
    ].filter((n) => !n.admin || esAdmin());
    lat.innerHTML = `<div class="admin-marca"><span class="admin-marca-icono">SH</span><strong>SMART <em>HUB</em></strong><small>ADMINISTRACIÓN</small></div><nav class="admin-nav">${adminNav.map((n) => {
      const sel = n.exacta ? activa === n.ruta : activa.startsWith(n.ruta);
      return `<a class="menu-item" href="#${n.ruta}"${sel ? ' aria-current="page"' : ""}>${icono(n.ico)}<span>${esc(n.txt)}</span></a>`;
    }).join("")}</nav><div class="admin-lateral-pie"><a class="menu-item" href="#/">${icono("atras")}<span>Volver a la app</span></a><a class="menu-item" href="#/perfil">${icono("personas")}<span>Mi perfil</span></a></div>`;
    return;
  }
  const enlaces = [
    ...NAV.filter((n) => !n.si || n.si()),
    { ruta: "/nosotros", ico: "info", clave: "nav.nosotros" },
    { ruta: "/notificaciones", ico: "campana", clave: "config.notificaciones" },
    { ruta: "/pagos", ico: "tarjeta", clave: "pago.historial" },
    { ruta: "/ayuda", ico: "ayuda", clave: "ayuda.titulo" },
    { ruta: "/configuracion", ico: "ajustes", clave: "config.titulo" },
  ];
  let html = enlaces.map((n) => {
    const sel = n.ruta === "/" ? activa === "/" : activa.startsWith(n.ruta);
    return `<a class="menu-item" href="#${n.ruta}"${sel ? ' aria-current="page"' : ""}>${icono(n.ico)}<span>${esc(t(n.clave))}</span></a>`;
  }).join("");

  if (esStaff()) {
    html += `<div class="menu-sep"></div><div class="menu-titulo">${esc(t("nav.admin"))}</div>`;
    // El menú tiene que coincidir con lo que el router deja pasar: si a
    // un `staff` se le enseña «Espacios» y al pulsarlo rebota, el fallo
    // es de la interfaz, no suyo.
    html += [
      { ruta: "/admin", ico: "panel", txt: "Dashboard", admin: false },
      { ruta: "/admin/calendario", ico: "calendario", txt: "Calendario", admin: false },
      { ruta: "/admin/reservas", ico: "calendario", txt: "Reservaciones", admin: false },
      { ruta: "/admin/usuarios", ico: "personas", txt: "Clientes", admin: false },
      { ruta: "/admin/pagos", ico: "tarjeta", txt: "Pagos", admin: false },
      { ruta: "/admin/espacios", ico: "edificio", txt: "Espacios", admin: true },
      { ruta: "/admin/espacios", ico: "wallet", txt: "Tarifas", admin: true },
      { ruta: "/admin/apariencia", ico: "ajustes", txt: "Configuración", admin: true },
      { ruta: "/admin/estadisticas", ico: "grafica", txt: "Reportes", admin: true },
    ].filter((n) => !n.admin || esAdmin()).map((n) => `<a class="menu-item" href="#${n.ruta}"${activa === n.ruta ? ' aria-current="page"' : ""}>${icono(n.ico)}<span>${esc(n.txt)}</span></a>`).join("");
  }
  lat.innerHTML = html;
}

/* =====================================================================
   Barra superior
   ===================================================================== */
function montarTopbar() {
  const barra = $("#topbar");
  $("#btn-menu").innerHTML = icono("menu", { size: 22 });
  $("#btn-atras").innerHTML = icono("atras", { size: 20 });
  $("#btn-notif").innerHTML = icono("campana", { size: 20 });
  actualizarBotonTema();

  $("#btn-menu").addEventListener("click", abrirDrawer);
  $("#btn-atras").addEventListener("click", () => history.back());
  $("#btn-notif").addEventListener("click", () => ir("/notificaciones"));
  $("#btn-tema").addEventListener("click", () => {
    const orden = ["auto", "claro", "oscuro"];
    const siguiente = orden[(orden.indexOf(getTema()) + 1) % orden.length];
    setTema(siguiente);
    actualizarBotonTema();
    toast(t("config.tema") + ": " + t(siguiente === "auto" ? "config.temaAuto" : siguiente === "claro" ? "config.temaClaro" : "config.temaOscuro"));
  });
  barra.hidden = false;
}

function actualizarBotonTema() {
  const btn = $("#btn-tema");
  if (!btn) return;
  btn.innerHTML = icono(temaEfectivo() === "oscuro" ? "luna" : "sol", { size: 20 });
}

function actualizarTopbar({ ruta, modulo }) {
  document.documentElement.dataset.seccion = ruta.startsWith("/admin") ? "admin" : "app";
  const raiz = ruta === "/" || ruta === "/mapa" || ruta === "/reservas" || ruta === "/favoritos" || ruta === "/perfil";
  $("#btn-menu").hidden = !raiz;
  $("#btn-atras").hidden = raiz;
  $("#tb-texto").textContent = typeof modulo?.titulo === "function" ? modulo.titulo() : (modulo?.titulo || APP.name);
  $("#tb-sub").textContent = typeof modulo?.subtitulo === "function" ? (modulo.subtitulo() || "") : (modulo?.subtitulo || "");
  $("#topbar").hidden = modulo?.topbar === false;
  $("#nav").hidden = modulo?.nav === false;

  const noLeidas = store.get().noLeidas;
  const btnNotif = $("#btn-notif");
  btnNotif.innerHTML = icono("campana", { size: 20 }) + (noLeidas ? `<span class="contador" style="position:absolute;top:2px;right:2px">${noLeidas}</span>` : "");
  btnNotif.style.position = "relative";
  btnNotif.hidden = !store.get().sesion;
}

/* =====================================================================
   Franja de estado (sin conexión / cambios pendientes / actualización)
   ===================================================================== */
function actualizarFranja() {
  const el = $("#franja-estado");
  if (!el) return;
  const { conectado, pendientesSync } = store.get();

  if (!conectado) {
    el.className = "franja";
    el.innerHTML = `${icono("offline", { size: 14 })} ${esc(t("app.sinConexion"))}`;
    el.hidden = false;
  } else if (pendientesSync > 0) {
    el.className = "franja franja-info";
    el.innerHTML = `${icono("nube", { size: 14 })} ${esc(t("app.pendientes", { n: pendientesSync }))}`;
    el.hidden = false;
  } else if (el.dataset.actualizacion === "1") {
    el.className = "franja franja-info";
    el.innerHTML = `${esc(t("app.actualizacion"))} <button type="button" id="btn-recargar">${esc(t("app.actualizar"))}</button>`;
    el.hidden = false;
    $("#btn-recargar")?.addEventListener("click", () => location.reload());
  } else {
    el.hidden = true;
  }
}

/* =====================================================================
   Splash
   ===================================================================== */
function ocultarSplash() {
  const s = document.getElementById("splash");
  const app = document.getElementById("app");
  if (app) app.hidden = false;
  if (!s) return;
  s.classList.add("fuera");
  setTimeout(() => s.remove(), 480);
}

/* =====================================================================
   Arranque
   ===================================================================== */
async function arrancar() {
  // Antes de NADA, y se espera a que termine.
  //
  // Si la base se limpió para el lanzamiento, hay que tirar lo que este
  // equipo tenga guardado. Esto iba sin `await`, y era una carrera: la
  // purga borraba IndexedDB mientras `getEspacios()` ya estaba leyendo
  // de ahí, así que la primera pantalla de la época nueva podía salir
  // con los datos viejos — justo los que se estaban borrando.
  //
  // Sólo ocurre una vez por época y por equipo; el resto de arranques
  // comprueba una clave de localStorage y sigue. El coste es aceptable.
  //
  // El techo es una válvula por si IndexedDB se queda colgado: sin él,
  // un navegador con la base bloqueada no arrancaría nunca. Si salta,
  // la época NO se da por hecha y se reintenta en el siguiente arranque.
  try {
    await Promise.race([
      revisarEpocaDeLanzamiento(),
      new Promise((_, rechazar) =>
        setTimeout(() => rechazar(new Error("la purga tardó demasiado")), 8000)),
    ]);
  } catch (e) {
    console.warn("[main] purga de lanzamiento:", e?.message || e);
  }

  initTema();
  document.documentElement.lang = getIdioma();

  registrarRutas();
  montarTopbar();
  montarDrawer();

  // Si venimos de un enlace de correo (recuperar contraseña, confirmar
  // cuenta, enlace mágico), Supabase deja el token en la URL. Hay que
  // leerlo ANTES de arrancar el router, o la ruta se pierde.
  const enlace = revisarEnlaceDeCorreo();
  if (enlace.error) {
    setTimeout(() => toast(enlace.error, { tipo: "error", ms: 7000 }), 900);
  }

  // Sesión y catálogo arrancan a la vez, pero NO se espera a los dos.
  //
  // Antes se hacía `Promise.all` con un techo de 2,5 s, así que con el
  // servidor lento la portada tardaba esos 2,5 s completos aunque el
  // catálogo local estuviera listo en 200 ms. Ahora:
  //   • Ruta pública  → basta el catálogo (techo 1 s).
  //   • Ruta privada  → sí hay que saber si hay sesión antes de decidir
  //                     si se entra o se manda a iniciar sesión.
  const sesionLista = iniciarAuth().catch((e) => { console.warn("[main] auth", e); return null; });
  const catalogoListo = api.getEspacios().catch((e) => { console.warn("[main] catálogo", e); return []; });

  const rutaInicial = (enlace.destino || location.hash.slice(1) || "/").split("?")[0];
  const necesitaSesion = rutaProtegida(rutaInicial);
  const techo = (ms) => new Promise((r) => setTimeout(r, ms));

  await Promise.race([
    necesitaSesion ? Promise.all([sesionLista, catalogoListo]) : catalogoListo,
    techo(necesitaSesion ? 2500 : 1000),
  ]);

  // Tutorial la primera vez.
  let inicial = enlace.destino || location.hash.slice(1) || "/";
  const tutorialVisto = leerFlag(STORAGE_KEYS.tutorialVisto);
  if (FEATURES.tutorial && !tutorialVisto && inicial === "/" && !enlace.destino) {
    history.replaceState(null, "", "#/tutorial");
    inicial = "/tutorial";
  }

  // El cascarón se muestra en cuanto está listo. La vista puede tardar
  // (el mapa 3D descarga bastante) y para eso el router ya pinta su
  // propio indicador de carga: dejar la pantalla de bienvenida encima
  // haría parecer que la app se colgó.
  const vistaLista = iniciarRouter($("#vista"));
  ocultarSplash();

  pintarNav();
  pintarLateral();
  actualizarFranja();
  await vistaLista;

  // Segundo plano: nada de esto bloquea la primera pantalla.
  sesionLista.then(async (sesion) => {
    if (sesion) {
      await Promise.allSettled([api.getMisReservas(), api.getFavoritos(), api.getNotificaciones()]);
      pintarNav();
      iniciarRealtime().catch(() => {});
    } else {
      iniciarRealtime().catch(() => {});
    }
  });
  // Lo guardado en este dispositivo se lee antes de pintar nada.
  import("./data/mock.js").then((m) => m.cargarEstadoLocal?.()).catch(() => {});
  iniciarSync();
  iniciarPWA();
  if (FEATURES.promociones) api.getPromociones().catch(() => {});
}

/** ¿Esa ruta exige haber iniciado sesión? Lo sabe el propio router. */
function rutaProtegida(ruta) {
  const PRIVADAS = ["/reservas", "/favoritos", "/notificaciones", "/perfil",
                    "/pagos", "/chat", "/checkout", "/admin"];
  return PRIVADAS.some((p) => ruta === p || ruta.startsWith(p + "/"))
    || /\/reservar$/.test(ruta);
}

function leerFlag(clave) {
  try { return localStorage.getItem(clave) === "1"; } catch { return false; }
}

/* =====================================================================
   Reacciones a eventos globales
   ===================================================================== */
onBus(EV.RUTA_CAMBIO, (info) => {
  actualizarTopbar(info);
  pintarNav();
  pintarLateral();
  window.scrollTo(0, 0);
});

onBus(EV.CONEXION, actualizarFranja);
onBus(EV.SYNC_PENDIENTE, actualizarFranja);
onBus(EV.SYNC_COMPLETA, ({ enviadas }) => {
  actualizarFranja();
  if (enviadas) toast(`${enviadas} cambio(s) sincronizado(s)`, { tipo: "ok" });
});

onBus(EV.APP_ACTUALIZABLE, () => {
  const el = $("#franja-estado");
  if (el) { el.dataset.actualizacion = "1"; actualizarFranja(); }
});

onBus(EV.AUTH_CAMBIO, () => { pintarNav(); pintarLateral(); actualizarTopbar({ ruta: rutaActual(), modulo: {} }); });
onBus(EV.RESERVA_CREADA, pintarNav);
onBus(EV.RESERVA_CANCELADA, pintarNav);
onBus(EV.TEMA_CAMBIO, actualizarBotonTema);
onBus(EV.IDIOMA_CAMBIO, () => { pintarNav(); pintarLateral(); recargarVista(); });

onBus(EV.NOTIFICACION, (n) => {
  toast(n.titulo, { tipo: n.tipo === "recordatorio" ? "warm" : "info", accion: n.enlace ? { texto: t("app.ver"), fn: () => ir(n.enlace) } : null });
  actualizarTopbar({ ruta: rutaActual(), modulo: {} });
});

store.subscribe((_, motivo) => {
  if (motivo === "notificaciones") actualizarTopbar({ ruta: rutaActual(), modulo: {} });
});

/* Exponer utilidades mínimas para depurar desde la consola. */
if (typeof window !== "undefined") {
  window.__app = { store, api, ir, t, nombreUsuario, avatarUsuario, iniciales, esAdmin };
}

arrancar().catch((e) => {
  console.error("[main] fallo al arrancar", e);
  ocultarSplash();
  const v = $("#vista");
  if (v) {
    v.innerHTML = `<div class="vista-scroll"><div class="vacio">
      <div class="vacio-ico">⚠️</div><h3>No se pudo iniciar la aplicación</h3>
      <p>${esc(String(e?.message || e))}</p>
      <button class="btn btn-primario" data-recargar>Reintentar</button>
    </div></div>`;
    // Sin onclick en línea: la CSP prohíbe los manejadores incrustados.
    v.querySelector("[data-recargar]")?.addEventListener("click", () => location.reload());
  }
});
