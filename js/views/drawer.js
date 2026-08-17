/* ======================================================================
   drawer.js — Menú lateral deslizante.
   ====================================================================== */
import { $, crear, confirmar, toast } from "../core/ui.js";
import { icono } from "../core/iconos.js";
import { t } from "../core/i18n.js";
import { esc, html, raw, iniciales, urlMedioSegura } from "../core/utils.js";
import store from "../core/store.js";
import { esStaff } from "../auth/permisos.js";
import { nombreUsuario, avatarUsuario, salir } from "../auth/auth.js";
import { ir } from "../core/router.js";
import { FEATURES, APP, CONTACT } from "../core/config.js";
import { enModoDemo } from "../data/api.js";

let velo = null;

export function montarDrawer() { /* se crea bajo demanda */ }

export function abrirDrawer() {
  if (velo) return;
  velo = crear("div", { id: "drawer-velo" });
  const panel = crear("nav", { clase: "drawer", "aria-label": t("nav.menu") });
  panel.innerHTML = contenido();
  velo.append(panel);
  document.body.append(velo);
  document.body.style.overflow = "hidden";

  velo.addEventListener("click", (e) => { if (e.target === velo) cerrarDrawer(); });
  panel.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='#']");
    if (a) { cerrarDrawer(); return; }
    const b = e.target.closest("[data-accion]");
    if (b) manejar(b.dataset.accion);
  });
  document.addEventListener("keydown", onEscape, true);
  habilitarGestoCierre(panel);
}

function onEscape(e) { if (e.key === "Escape") cerrarDrawer(); }

export function cerrarDrawer() {
  if (!velo) return;
  document.removeEventListener("keydown", onEscape, true);
  velo.classList.add("cerrando");
  const v = velo;
  velo = null;
  setTimeout(() => { v.remove(); document.body.style.overflow = ""; }, 220);
}

function habilitarGestoCierre(panel) {
  let x0 = 0, dx = 0, activo = false;
  panel.addEventListener("touchstart", (e) => { activo = true; x0 = e.touches[0].clientX; dx = 0; panel.style.transition = "none"; }, { passive: true });
  panel.addEventListener("touchmove", (e) => {
    if (!activo) return;
    dx = Math.min(0, e.touches[0].clientX - x0);
    panel.style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  panel.addEventListener("touchend", () => {
    activo = false; panel.style.transition = ""; panel.style.transform = "";
    if (dx < -70) cerrarDrawer();
  });
}

function contenido() {
  const { sesion, perfil, rol } = store.get();
  const nombre = sesion ? nombreUsuario() : "Invitado";
  const avatar = avatarUsuario();

  const enlaces = [
    { r: "/", i: "inicio", txt: t("nav.inicio") },
    FEATURES.mapa3d && { r: "/mapa", i: "cubo", txt: t("mapa.titulo") },
    { r: "/espacios", i: "edificio", txt: t("admin.espacios") },
    { r: "/nosotros", i: "info", txt: t("nav.nosotros") },
    { r: "/reservas", i: "calendario", txt: t("misReservas.titulo") },
    FEATURES.favoritos && { r: "/favoritos", i: "corazon", txt: t("favoritos.titulo") },
    { r: "/notificaciones", i: "campana", txt: t("config.notificaciones"), contador: store.get().noLeidas },
    { r: "/pagos", i: "recibo", txt: t("pago.historial") },
  ].filter(Boolean);

  const soporte = [
    FEATURES.asistenteIA && { r: "/asistente", i: "robot", txt: t("ayuda.asistente") },
    FEATURES.chat && { r: "/chat", i: "chat", txt: t("ayuda.chat") },
    { r: "/ayuda", i: "ayuda", txt: t("ayuda.titulo") },
    { r: "/configuracion", i: "ajustes", txt: t("config.titulo") },
  ].filter(Boolean);

  const admin = esStaff() ? [
    { r: "/admin", i: "panel", txt: "Dashboard" },
    { r: "/admin/calendario", i: "calendario", txt: "Calendario" },
    { r: "/admin/reservas", i: "calendario", txt: "Reservaciones" },
    { r: "/admin/usuarios", i: "personas", txt: "Clientes" },
    { r: "/admin/pagos", i: "tarjeta", txt: "Pagos" },
    { r: "/admin/espacios", i: "edificio", txt: t("admin.espacios") },
    { r: "/admin/apariencia", i: "ajustes", txt: "Qué se ve en la app" },
    { r: "/admin/edificios", i: "cubo", txt: t("admin.edificios") },
    { r: "/admin/estadisticas", i: "grafica", txt: t("admin.estadisticas") },
  ] : [];

  const item = (n) => `<a class="menu-item" href="#${n.r}">${icono(n.i)}<span class="crece">${esc(n.txt)}</span>${n.contador ? `<span class="contador">${n.contador}</span>` : ""}</a>`;

  return html`
    <div class="drawer-cab">
      <div class="fila">
        <span class="avatar avatar-lg">${urlMedioSegura(avatar) ? raw(`<img src="${esc(urlMedioSegura(avatar))}" alt="">`) : iniciales(nombre)}</span>
        <div class="crece">
          <strong>${nombre}</strong>
          <div class="texto-sm texto-dim">${sesion ? (perfil?.email || "") : "Explora sin cuenta"}</div>
          ${rol !== "usuario" && rol !== "invitado" ? raw(`<span class="chip chip-purple" style="margin-top:6px">${esc(rol)}</span>`) : ""}
        </div>
      </div>
      ${sesion
        ? raw(`<a class="btn btn-contorno btn-sm btn-bloque mt-4" href="#/perfil">${esc(t("perfil.editar"))}</a>`)
        : raw(`<a class="btn btn-primario btn-sm btn-bloque mt-4" href="#/login">${esc(t("auth.entrar"))}</a>`)}
    </div>

    <div class="menu-sep"></div>
    ${raw(enlaces.map(item).join(""))}

    ${admin.length ? raw(`<div class="menu-sep"></div><div class="menu-titulo">${esc(t("nav.admin"))}</div>${admin.map(item).join("")}`) : ""}

    <div class="menu-sep"></div>
    <div class="menu-titulo">Soporte</div>
    ${raw(soporte.map(item).join(""))}
    ${CONTACT.whatsapp ? raw(`<a class="menu-item" href="https://wa.me/${esc(CONTACT.whatsapp)}" target="_blank" rel="noopener">
      ${icono("whatsapp")}<span>${esc(t("ayuda.whatsapp"))}</span>
    </a>`) : ""}

    <div class="crece"></div>
    <div class="menu-sep"></div>
    ${sesion ? raw(`<button type="button" class="menu-item" data-accion="salir">${icono("salir")}<span>${esc(t("auth.salir"))}</span></button>`) : ""}
    <div class="drawer-pie">
      <nav class="drawer-legal" aria-label="Información legal">
        <a href="#/legal/terminos">Términos</a>
        <a href="#/legal/privacidad">Privacidad</a>
        <a href="#/legal/cancelacion">Cancelación</a>
      </nav>
      <span class="texto-xs texto-suave">${APP.name} · v${APP.version}</span>
      ${enModoDemo() ? raw('<span class="chip chip-warm" style="margin-top:6px">Modo local</span>') : ""}
    </div>`;
}

async function manejar(accion) {
  if (accion === "salir") {
    const ok = await confirmar({
      titulo: t("auth.salir"),
      mensaje: "¿Quieres cerrar tu sesión en este dispositivo?",
      aceptar: t("auth.salir"), peligro: true,
    });
    if (!ok) return;
    await salir();
    cerrarDrawer();
    toast("Sesión cerrada", { tipo: "ok" });
    ir("/");
  }
}

export default { montarDrawer, abrirDrawer, cerrarDrawer };
