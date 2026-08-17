/* ======================================================================
   nueva-password.js — Pantalla a la que lleva el enlace de recuperación.

   Dos situaciones:
     • Se llega desde el correo: hay una sesión temporal y sólo hay que
       escribir la contraseña nueva.
     • Se llega sin sesión (enlace caducado, o entrando a mano): en vez
       de un error críptico, se ofrece pedir otro enlace.
   ====================================================================== */
import { html, raw, esc, evaluarPassword, esEmail } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { toastOk, toastError, conCarga, temblar, avisar } from "../core/ui.js";
import { ir } from "../core/router.js";
import { cambiarPassword, recuperarPassword } from "../auth/auth.js";
import { getDB } from "../data/db.js";
import store from "../core/store.js";
import { on as onBus, EV } from "../core/bus.js";
import { AUTH } from "../core/config.js";

export const titulo = () => t("auth.nuevaPassword");
export const nav = false;
export const topbar = false;

let desuscribir = [];

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <section class="vista-scroll auth-vista">
      <div class="auth-caja" id="np-caja">
        <div class="cargando-centro"><div class="spinner"></div></div>
      </div>
    </section>`;

  // La sesión del enlace puede tardar un instante en establecerse.
  const haySesion = await esperarSesion(6000);
  if (haySesion) pintarFormulario(contenedor);
  else pintarSinSesion(contenedor);

  // Si el evento de recuperación llega tarde, se repinta.
  desuscribir.push(onBus(EV.RECUPERAR_PASSWORD, () => pintarFormulario(contenedor)));
}

export function destruir() {
  desuscribir.forEach((f) => { try { f(); } catch { /* ignora */ } });
  desuscribir = [];
}

/** Espera a que la biblioteca procese el token del enlace. */
async function esperarSesion(msMaximo) {
  const limite = Date.now() + msMaximo;
  const db = await getDB();
  if (!db) return false;
  while (Date.now() < limite) {
    const { data } = await db.auth.getSession();
    if (data?.session) return true;
    if (store.get().sesion) return true;
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

/* ---------------------------------------------------------------------
   Con sesión: formulario de contraseña nueva
   --------------------------------------------------------------------- */
function pintarFormulario(contenedor) {
  const caja = contenedor.querySelector("#np-caja");
  if (!caja || caja.dataset.modo === "form") return;
  caja.dataset.modo = "form";

  const correo = store.get().perfil?.email || store.get().usuario?.email || "";

  caja.innerHTML = html`
    <div class="auth-marca">
      <div class="auth-logo">${raw(icono("candado", { size: 40 }))}</div>
      <h1>${t("auth.nuevaPassword")}</h1>
      <p class="texto-sm texto-dim">
        ${correo ? t("auth.nuevaPasswordPara", { email: correo }) : t("auth.nuevaPasswordDesc")}
      </p>
    </div>

    <form id="np-form" novalidate>
      <div class="campo">
        <label for="np1">${t("auth.nuevaPasswordCampo")}</label>
        <div class="campo-icono">
          ${raw(icono("candado", { size: 18, clase: "ci" }))}
          <input id="np1" type="password" autocomplete="new-password" minlength="8" required placeholder="••••••••">
          <button type="button" class="btn btn-fantasma btn-icono btn-sm campo-accion" data-ojo="np1"
                  aria-label="${t("auth.mostrarPassword")}">${raw(icono("info", { size: 16 }))}</button>
        </div>
        <span class="campo-error"></span>
      </div>

      <div class="fuerza" id="fuerza" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <p class="campo-ayuda mb-4" id="fuerza-txt" aria-live="polite">${t("auth.passwordPista")}</p>

      <div class="campo">
        <label for="np2">${t("auth.password2")}</label>
        <div class="campo-icono">
          ${raw(icono("candado", { size: 18, clase: "ci" }))}
          <input id="np2" type="password" autocomplete="new-password" minlength="8" required placeholder="••••••••">
        </div>
        <span class="campo-error"></span>
      </div>

      <label class="switch mb-4">
        <input type="checkbox" id="np-cerrar" checked>
        <span class="switch-pista"></span>
        <span class="texto-sm">${t("auth.cerrarOtras")}</span>
      </label>

      <button type="submit" class="btn btn-primario btn-lg btn-bloque">${t("app.guardar")}</button>
    </form>

    <p class="auth-cambio texto-sm"><a href="#/">${t("app.volver")}</a></p>`;

  caja.querySelector("#np1").addEventListener("input", (e) => medirFuerza(caja, e.target.value));

  caja.addEventListener("click", (e) => {
    const ojo = e.target.closest("[data-ojo]");
    if (!ojo) return;
    const input = caja.querySelector(`#${ojo.dataset.ojo}`);
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    ojo.setAttribute("aria-label", visible ? t("auth.mostrarPassword") : t("auth.ocultarPassword"));
  });

  caja.querySelector("#np-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = caja.querySelector("#np1");
    const p2 = caja.querySelector("#np2");

    const fuerza = evaluarPassword(p1.value);
    if (!fuerza.ok) { temblar(p1.closest(".campo")); return toastError(fuerza.mensaje); }
    if (p1.value !== p2.value) { temblar(p2.closest(".campo")); return toastError(t("auth.passwordNoCoincide")); }

    const btn = e.target.querySelector('button[type="submit"]');
    try {
      await conCarga(btn, cambiarPassword(p1.value, { cerrarOtras: caja.querySelector("#np-cerrar").checked }));
      toastOk(t("auth.passwordActualizada"));
      ir("/", { reemplazar: true });
    } catch (err) {
      toastError(err.message);
    }
  });

  setTimeout(() => caja.querySelector("#np1")?.focus(), 120);
}

/* ---------------------------------------------------------------------
   Sin sesión: el enlace caducó o se entró a mano
   --------------------------------------------------------------------- */
function pintarSinSesion(contenedor) {
  const caja = contenedor.querySelector("#np-caja");
  if (!caja) return;
  caja.dataset.modo = "sin-sesion";

  if (!AUTH.emailDeliveryEnabled) {
    caja.innerHTML = html`
      <div class="auth-marca">
        <div class="auth-logo" style="color:var(--warm)">${raw(icono("alerta", { size: 40 }))}</div>
        <h1>${t("auth.enlaceCaducado")}</h1>
        <p class="texto-sm texto-dim">La recuperación por correo todavía no está habilitada en este despliegue. Contacta a administración para recuperar el acceso.</p>
      </div>
      <p class="auth-cambio texto-sm"><a href="#/login">${t("auth.entrar")}</a></p>`;
    return;
  }

  caja.innerHTML = html`
    <div class="auth-marca">
      <div class="auth-logo" style="color:var(--warm)">${raw(icono("alerta", { size: 40 }))}</div>
      <h1>${t("auth.enlaceCaducado")}</h1>
      <p class="texto-sm texto-dim">${t("auth.enlaceCaducadoDesc")}</p>
    </div>

    <form id="np-reenviar">
      <div class="campo">
        <label for="np-email">${t("auth.email")}</label>
        <div class="campo-icono">
          ${raw(icono("correo", { size: 18, clase: "ci" }))}
          <input id="np-email" type="email" inputmode="email" autocomplete="email" required placeholder="tu@correo.com">
        </div>
      </div>
      <button type="submit" class="btn btn-primario btn-lg btn-bloque">${t("auth.enviarEnlace")}</button>
    </form>

    <p class="auth-cambio texto-sm"><a href="#/login">${t("auth.entrar")}</a></p>`;

  caja.querySelector("#np-reenviar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = caja.querySelector("#np-email");
    const email = input.value.trim();
    if (!esEmail(email)) { temblar(input.closest(".campo")); return toastError(t("auth.emailInvalido")); }

    const btn = e.target.querySelector('button[type="submit"]');
    try {
      await conCarga(btn, recuperarPassword(email));
      await avisar({
        titulo: t("auth.revisaCorreo"),
        mensaje: t("auth.revisaCorreoDesc", { email }),
      });
      ir("/login", { reemplazar: true });
    } catch (err) {
      toastError(err.message);
    }
  });
}

function medirFuerza(caja, valor) {
  const { fuerza, ok } = evaluarPassword(valor);
  const colores = ["var(--taken)", "var(--taken)", "var(--warm)", "var(--ok)", "var(--ok)"];
  caja.querySelectorAll("#fuerza span").forEach((b, i) => {
    b.style.background = i < fuerza ? colores[fuerza] : "var(--superficie-3)";
  });
  const txt = caja.querySelector("#fuerza-txt");
  if (!txt) return;
  txt.textContent = !valor
    ? t("auth.passwordPista")
    : ok ? ["", t("auth.fuerza1"), t("auth.fuerza2"), t("auth.fuerza3"), t("auth.fuerza4")][fuerza]
         : t("auth.passwordDebil");
  txt.style.color = ok ? "var(--ok)" : "var(--text-suave)";
}
