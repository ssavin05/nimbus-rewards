/* ======================================================================
   configuracion.js — Apariencia, idioma, notificaciones, háptica,
   calidad 3D, datos y privacidad.
   ====================================================================== */
import { html, raw, esc, evaluarPassword } from "../core/utils.js";
import { t, IDIOMAS, getIdioma, setIdioma } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { toastOk, toastError, confirmar, avisar, abrirHoja, conCarga, temblar } from "../core/ui.js";
import { getTema, setTema, getAnimaciones, setAnimaciones } from "../core/tema.js";
import { getHaptics, setHaptics, soportaHaptics, vibrar } from "../core/haptics.js";
import { APP, GRAPHICS, STORAGE_KEYS, CONTACT, AUTH } from "../core/config.js";
import store from "../core/store.js";
import api from "../data/api.js";
import cache from "../data/cache.js";
import { descargarMisDatos, eliminarCuenta, cambiarPassword, cerrarOtrasSesiones, tienePassword } from "../auth/auth.js";
import { estadoPush, pedirPermisoPush, desactivarPush, puedeInstalar, instalarApp } from "../pwa.js";
import { enModoDemo } from "../data/api.js";

export const titulo = () => t("config.titulo");

export async function render(contenedor) {
  const { perfil, sesion } = store.get();
  const push = await estadoPush();
  const uso = await cache.usoEstimado();
  const calidad = leer(STORAGE_KEYS.calidad3d, GRAPHICS.quality);

  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">

        <section class="seccion">
          <h2 class="seccion-titulo">${t("config.apariencia")}</h2>
          <div class="tarjeta">
            <div class="lista-item">
              <span class="li-ico">${raw(icono("sol", { size: 17 }))}</span>
              <span class="li-txt"><span class="li-titulo">${t("config.tema")}</span></span>
              <span class="li-fin">
                <div class="segmentado">
                  <button type="button" data-tema="claro" aria-pressed="${getTema() === "claro"}">${t("config.temaClaro")}</button>
                  <button type="button" data-tema="oscuro" aria-pressed="${getTema() === "oscuro"}">${t("config.temaOscuro")}</button>
                  <button type="button" data-tema="auto" aria-pressed="${getTema() === "auto"}">${t("config.temaAuto")}</button>
                </div>
              </span>
            </div>
            <div class="lista-item">
              <span class="li-ico">${raw(icono("idioma", { size: 17 }))}</span>
              <span class="li-txt"><span class="li-titulo">${t("config.idioma")}</span></span>
              <span class="li-fin">
                <select id="cfg-idioma" class="input" style="min-height:36px;width:auto">
                  ${IDIOMAS.map((i) => raw(`<option value="${i.code}" ${getIdioma() === i.code ? "selected" : ""}>${esc(i.bandera)} ${esc(i.nombre)}</option>`))}
                </select>
              </span>
            </div>
            ${interruptor("cfg-animaciones", t("config.animaciones"), "Transiciones y efectos de movimiento", getAnimaciones(), "cubo")}
            ${soportaHaptics() ? interruptor("cfg-haptica", t("config.haptica"), "Vibración al tocar botones", getHaptics(), "telefono") : ""}
          </div>
        </section>

        <section class="seccion">
          <h2 class="seccion-titulo">${t("config.notificaciones")}</h2>
          <div class="tarjeta">
            <div class="lista-item">
              <span class="li-ico">${raw(icono("campana", { size: 17 }))}</span>
              <span class="li-txt">
                <span class="li-titulo">${t("config.push")}</span>
                <span class="li-sub" id="push-estado">${estadoPushTexto(push)}</span>
              </span>
              <span class="li-fin">
                <label class="switch"><input type="checkbox" id="cfg-push" ${push.activo ? "checked" : ""}
                  ${push.soportado ? "" : "disabled"}><span class="switch-pista"></span></label>
              </span>
            </div>
            ${interruptor("cfg-recordatorios", t("config.recordatorios"), "24 h y 1 h antes de cada reserva", perfil?.notif_recordatorios !== false, "reloj")}
            ${AUTH.emailDeliveryEnabled
              ? interruptor("cfg-email", t("config.correo"), "Confirmaciones y comprobantes", perfil?.notif_email !== false, "correo")
              : ""}
          </div>
        </section>

        <section class="seccion">
          <h2 class="seccion-titulo">${t("mapa.titulo")}</h2>
          <div class="tarjeta">
            <div class="lista-item">
              <span class="li-ico">${raw(icono("cubo", { size: 17 }))}</span>
              <span class="li-txt">
                <span class="li-titulo">${t("config.calidad3d")}</span>
                <span class="li-sub">Baja el nivel si el mapa va lento en tu teléfono</span>
              </span>
              <span class="li-fin">
                <select id="cfg-calidad" class="input" style="min-height:36px;width:auto">
                  <option value="auto" ${calidad === "auto" ? "selected" : ""}>Automática</option>
                  <option value="bajo" ${calidad === "bajo" ? "selected" : ""}>Baja</option>
                  <option value="medio" ${calidad === "medio" ? "selected" : ""}>Media</option>
                  <option value="alto" ${calidad === "alto" ? "selected" : ""}>Alta</option>
                </select>
              </span>
            </div>
          </div>
        </section>

        <section class="seccion">
          <h2 class="seccion-titulo">${t("config.datos")}</h2>
          <div class="tarjeta">
            <div class="lista-item">
              <span class="li-ico">${raw(icono("nube", { size: 17 }))}</span>
              <span class="li-txt">
                <span class="li-titulo">Almacenamiento usado</span>
                <span class="li-sub">${formatoBytes(uso.usado)}${uso.cuota ? ` de ${formatoBytes(uso.cuota)}` : ""}</span>
              </span>
            </div>
            <button type="button" class="lista-item" data-limpiar>
              <span class="li-ico">${raw(icono("refrescar", { size: 17 }))}</span>
              <span class="li-txt"><span class="li-titulo">${t("config.limpiarCache")}</span>
                <span class="li-sub">Vuelve a descargar el catálogo</span></span>
              <span class="li-fin">${raw(icono("chevron", { size: 16 }))}</span>
            </button>
            ${sesion ? raw(`<button type="button" class="lista-item" data-descargar>
              <span class="li-ico">${icono("descargar", { size: 17 })}</span>
              <span class="li-txt"><span class="li-titulo">${esc(t("config.descargarDatos"))}</span>
                <span class="li-sub">Exporta todo en formato JSON</span></span>
              <span class="li-fin">${icono("chevron", { size: 16 })}</span>
            </button>`) : ""}
          </div>
        </section>

        ${sesion ? raw(`
        <section class="seccion">
          <h2 class="seccion-titulo">${esc(t("auth.seguridad"))}</h2>
          <div class="tarjeta">
            <button type="button" class="lista-item" data-password>
              <span class="li-ico">${icono("candado", { size: 17 })}</span>
              <span class="li-txt">
                <span class="li-titulo">${esc(t("auth.cambiarPassword"))}</span>
                <span class="li-sub">${esc(tienePassword() ? t("auth.passwordPista") : t("auth.sinPassword"))}</span>
              </span>
              <span class="li-fin">${icono("chevron", { size: 16 })}</span>
            </button>
            <button type="button" class="lista-item" data-cerrar-otras>
              <span class="li-ico">${icono("salir", { size: 17 })}</span>
              <span class="li-txt">
                <span class="li-titulo">${esc(t("auth.cerrarOtras"))}</span>
                <span class="li-sub">${esc(t("auth.cerrarOtrasDesc"))}</span>
              </span>
              <span class="li-fin">${icono("chevron", { size: 16 })}</span>
            </button>
          </div>
        </section>`) : ""}

        <section class="seccion" id="sec-instalar" hidden>
          <div class="tarjeta tarjeta-pad fila" style="gap:12px">
            <span class="li-ico">${raw(icono("descargar", { size: 18 }))}</span>
            <div class="crece">
              <strong>${t("app.instalar")}</strong>
              <p class="texto-sm texto-dim">Ábrela desde tu pantalla de inicio, sin navegador y con soporte offline.</p>
            </div>
            <button type="button" class="btn btn-primario btn-sm" data-instalar>Instalar</button>
          </div>
        </section>

        <section class="seccion">
          <h2 class="seccion-titulo">${t("config.acercaDe")}</h2>
          <div class="tarjeta">
            ${filaInfo(t("config.version"), APP.version)}
            ${CONTACT.email ? filaInfo("Contacto", CONTACT.email) : ""}
            ${CONTACT.telefonoVisible ? filaInfo("Teléfono", CONTACT.telefonoVisible) : ""}
            ${enModoDemo() ? filaInfo("Modo", "Local — tus datos se guardan en este dispositivo") : filaInfo("Servidor", "Conectado")}
            <a class="lista-item" href="#/ayuda">
              <span class="li-txt"><span class="li-titulo">${t("ayuda.titulo")}</span></span>
              <span class="li-fin">${raw(icono("chevron", { size: 16 }))}</span></a>
          </div>
        </section>

        ${sesion ? raw(`<button type="button" class="btn btn-fantasma btn-bloque" data-eliminar
          style="color:var(--taken)">${icono("basura", { size: 16 })} ${esc(t("config.eliminarCuenta"))}</button>`) : ""}
      </div>
    </div>`;

  if (puedeInstalar()) contenedor.querySelector("#sec-instalar").hidden = false;
  enlazar(contenedor);
}

/* ---------------------------------------------------------------------
   Piezas
   --------------------------------------------------------------------- */
const interruptor = (id, titulo, sub, activo, ico) => html`
  <div class="lista-item">
    <span class="li-ico">${raw(icono(ico, { size: 17 }))}</span>
    <span class="li-txt"><span class="li-titulo">${titulo}</span><span class="li-sub">${sub}</span></span>
    <span class="li-fin">
      <label class="switch"><input type="checkbox" id="${id}" ${activo ? "checked" : ""}><span class="switch-pista"></span></label>
    </span>
  </div>`;

const filaInfo = (k, v) => html`
  <div class="lista-item">
    <span class="li-txt"><span class="li-titulo">${k}</span></span>
    <span class="li-fin texto-sm">${v}</span>
  </div>`;

function estadoPushTexto(push) {
  if (!push.soportado) return "No compatible con este navegador";
  if (push.permiso === "denied") return "Bloqueadas en los ajustes del navegador";
  if (!push.configurado) return "Falta configurar la llave VAPID en el servidor";
  return push.activo ? "Activas en este dispositivo" : "Desactivadas";
}

function formatoBytes(n) {
  if (!n) return "0 KB";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function leer(clave, porDefecto) {
  try { return localStorage.getItem(clave) || porDefecto; } catch { return porDefecto; }
}

/* ---------------------------------------------------------------------
   Eventos
   --------------------------------------------------------------------- */
function enlazar(contenedor) {
  contenedor.addEventListener("click", async (e) => {
    const tema = e.target.closest("[data-tema]");
    if (tema) {
      setTema(tema.dataset.tema);
      contenedor.querySelectorAll("[data-tema]").forEach((b) => b.setAttribute("aria-pressed", String(b === tema)));
      vibrar("seleccion");
      return;
    }
    if (e.target.closest("[data-limpiar]")) return limpiarCache();
    if (e.target.closest("[data-descargar]")) return exportarDatos();
    if (e.target.closest("[data-eliminar]")) return borrarCuenta();
    if (e.target.closest("[data-password]")) return abrirCambioPassword();
    if (e.target.closest("[data-cerrar-otras]")) return cerrarOtras(e.target.closest("[data-cerrar-otras]"));
    if (e.target.closest("[data-instalar]")) {
      const ok = await instalarApp();
      if (ok) toastOk("Aplicación instalada");
    }
  });

  contenedor.querySelector("#cfg-idioma")?.addEventListener("change", (e) => {
    setIdioma(e.target.value);
    toastOk("Idioma actualizado");
  });

  contenedor.querySelector("#cfg-animaciones")?.addEventListener("change", (e) => {
    setAnimaciones(e.target.checked);
  });

  contenedor.querySelector("#cfg-haptica")?.addEventListener("change", (e) => {
    setHaptics(e.target.checked);
  });

  contenedor.querySelector("#cfg-calidad")?.addEventListener("change", (e) => {
    try { localStorage.setItem(STORAGE_KEYS.calidad3d, e.target.value); } catch { /* ignora */ }
    toastOk("Se aplicará al abrir el mapa");
  });

  contenedor.querySelector("#cfg-push")?.addEventListener("change", async (e) => {
    const estado = contenedor.querySelector("#push-estado");
    if (e.target.checked) {
      const res = await pedirPermisoPush();
      e.target.checked = res.activo;
      estado.textContent = estadoPushTexto(res);
      if (res.activo) toastOk("Notificaciones activadas");
      else if (res.permiso === "denied") toastError("Tienes las notificaciones bloqueadas en el navegador.");
      else if (!res.configurado) toastError("Falta la llave VAPID en el servidor.");
    } else {
      await desactivarPush();
      estado.textContent = "Desactivadas";
      toastOk("Notificaciones desactivadas");
    }
  });

  contenedor.querySelector("#cfg-recordatorios")?.addEventListener("change", (e) => {
    api.actualizarPerfil({ notif_recordatorios: e.target.checked }).catch(() => {});
  });
  contenedor.querySelector("#cfg-email")?.addEventListener("change", (e) => {
    api.actualizarPerfil({ notif_email: e.target.checked }).catch(() => {});
  });
}

async function limpiarCache() {
  const ok = await confirmar({
    titulo: t("config.limpiarCache"),
    mensaje: "Se borrarán los datos guardados en este dispositivo. Tus reservas y tu cuenta no se tocan.",
    aceptar: "Limpiar",
  });
  if (!ok) return;
  await cache.limpiarTodo();
  if ("caches" in window) {
    const claves = await caches.keys();
    await Promise.all(claves.map((k) => caches.delete(k)));
  }
  toastOk("Caché limpiada");
  setTimeout(() => location.reload(), 700);
}

async function exportarDatos() {
  try {
    const datos = await descargarMisDatos();
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toastOk("Datos descargados");
  } catch (e) { toastError(e.message); }
}

/* ---------------------------------------------------------------------
   Cambio de contraseña estando dentro
   --------------------------------------------------------------------- */
function abrirCambioPassword() {
  if (!tienePassword()) return toastError(t("auth.sinPassword"));

  const { el, cerrar } = abrirHoja({
    titulo: t("auth.cambiarPassword"),
    contenido: html`
      <div class="campo">
        <label for="cp-actual">${t("auth.passwordActual")}</label>
        <input id="cp-actual" type="password" autocomplete="current-password" required>
      </div>
      <div class="campo">
        <label for="cp-nueva">${t("auth.nuevaPasswordCampo")}</label>
        <input id="cp-nueva" type="password" autocomplete="new-password" minlength="8" required>
        <span class="campo-ayuda">${t("auth.passwordPista")}</span>
      </div>
      <div class="campo">
        <label for="cp-nueva2">${t("auth.password2")}</label>
        <input id="cp-nueva2" type="password" autocomplete="new-password" minlength="8" required>
      </div>
      <label class="switch">
        <input type="checkbox" id="cp-cerrar" checked>
        <span class="switch-pista"></span>
        <span class="texto-sm">${t("auth.cerrarOtras")}</span>
      </label>`,
    pie: html`
      <button type="button" class="btn btn-contorno" data-cancelar>${t("app.cancelar")}</button>
      <button type="button" class="btn btn-primario" data-guardar>${t("app.guardar")}</button>`,
  });

  el.querySelector("[data-cancelar]").addEventListener("click", () => cerrar());
  el.querySelector("[data-guardar]").addEventListener("click", async (ev) => {
    const actual = el.querySelector("#cp-actual").value;
    const nueva = el.querySelector("#cp-nueva").value;
    const nueva2 = el.querySelector("#cp-nueva2").value;

    if (!actual) { temblar(el.querySelector("#cp-actual").closest(".campo")); return toastError(t("auth.requerido")); }
    const fuerza = evaluarPassword(nueva);
    if (!fuerza.ok) { temblar(el.querySelector("#cp-nueva").closest(".campo")); return toastError(fuerza.mensaje); }
    if (nueva !== nueva2) { temblar(el.querySelector("#cp-nueva2").closest(".campo")); return toastError(t("auth.passwordNoCoincide")); }

    try {
      await conCarga(ev.currentTarget, cambiarPassword(nueva, {
        actual, cerrarOtras: el.querySelector("#cp-cerrar").checked,
      }));
      cerrar();
      toastOk(t("auth.passwordActualizada"));
    } catch (err) { toastError(err.message); }
  });
}

async function cerrarOtras(boton) {
  const ok = await confirmar({
    titulo: t("auth.cerrarOtras"),
    mensaje: t("auth.cerrarOtrasDesc"),
    aceptar: t("auth.cerrarOtras"),
  });
  if (!ok) return;
  try {
    await conCarga(boton, cerrarOtrasSesiones());
    toastOk(t("auth.cerrarOtrasHecho"));
  } catch (e) { toastError(e.message); }
}

/* ---------------------------------------------------------------------
   Borrado de cuenta
   --------------------------------------------------------------------- */
async function borrarCuenta() {
  const palabra = t("borrar.palabra");
  const proximas = store.get().reservas.filter(
    (r) => r.estado !== "cancelada" && new Date(r.inicio).getTime() > Date.now()
  ).length;

  const lista = (clave) => t(clave).split("|").map(
    (x) => `<li>${esc(x)}</li>`).join("");

  const { el, cerrar } = abrirHoja({
    titulo: t("borrar.titulo"),
    contenido: html`
      <div class="aviso aviso-warm"><strong>${t("borrar.aviso")}</strong></div>

      <p class="etiqueta">${t("borrar.seBorra")}</p>
      <ul class="lista-borrado borra">${raw(lista("borrar.seBorraLista"))}</ul>

      <p class="etiqueta mt-4">${t("borrar.seConserva")}</p>
      <ul class="lista-borrado conserva">${raw(lista("borrar.seConservaLista"))}</ul>

      ${proximas ? raw(`<p class="texto-sm mt-4" style="color:var(--warm)">
        ${esc(t("borrar.futuras", { n: proximas }))}</p>`) : ""}

      <div class="tarjeta tarjeta-pad mt-4">
        <p class="texto-sm">${t("borrar.descarga")}</p>
        <button type="button" class="btn btn-contorno btn-sm btn-bloque mt-2" data-exportar-antes>
          ${raw(icono("descargar", { size: 15 }))} ${t("borrar.descargar")}</button>
      </div>

      <div class="campo mt-4">
        <label for="bc-palabra">${t("borrar.confirmaEscribe", { palabra })}</label>
        <input id="bc-palabra" type="text" autocomplete="off" autocapitalize="characters"
               spellcheck="false" placeholder="${palabra}">
      </div>`,
    pie: html`
      <button type="button" class="btn btn-contorno" data-cancelar>${t("app.cancelar")}</button>
      <button type="button" class="btn btn-peligro" data-confirmar disabled>${t("borrar.confirmar")}</button>`,
  });

  const input = el.querySelector("#bc-palabra");
  const btn = el.querySelector("[data-confirmar]");
  input.addEventListener("input", () => {
    btn.disabled = input.value.trim().toUpperCase() !== palabra;
  });

  el.querySelector("[data-cancelar]").addEventListener("click", () => cerrar());
  el.querySelector("[data-exportar-antes]").addEventListener("click", exportarDatos);

  btn.addEventListener("click", async (ev) => {
    try {
      await conCarga(ev.currentTarget, eliminarCuenta());
      cerrar();
      await avisar({ titulo: t("borrar.hecho"), mensaje: t("borrar.hechoDesc") });
      location.hash = "#/";
      location.reload();
    } catch (e) {
      toastError(e.message || "No se pudo eliminar la cuenta. Escríbenos y lo hacemos nosotros.");
    }
  });
}
