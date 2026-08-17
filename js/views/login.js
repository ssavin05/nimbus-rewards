/* ======================================================================
   login.js — Inicio de sesión, registro y recuperación de contraseña.
   Una sola vista con tres pestañas, según la ruta que la abrió.
   ====================================================================== */
import { html, raw, esc, esEmail, evaluarPassword, rutaInterna } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { $, toast, toastOk, toastError, conCarga, botonCargando, temblar, avisar } from "../core/ui.js";
import { ir, rutaActual, queryActual } from "../core/router.js";
import * as auth from "../auth/auth.js";
import { APP, AUTH } from "../core/config.js";
import { enModoDemo } from "../data/api.js";

export const titulo = () => t("auth.entrar");
export const nav = false;
export const topbar = false;

let modo = "entrar";     // entrar | registro | recuperar
let redirect = "/";
// Último correo con el que se intentó entrar o registrarse: lo usa el
// botón de reenviar la confirmación.
let ultimoCorreo = "";

export function render(contenedor, ctx) {
  const ruta = ctx?.ruta || rutaActual();
  modo = ruta.includes("registro") ? "registro" : ruta.includes("recuperar") ? "recuperar" : "entrar";
  // Sólo rutas internas: "//evil.com" o "https://evil.com" se descartan.
  redirect = rutaInterna((ctx?.query || queryActual()).get("redirect"), "/");

  contenedor.innerHTML = html`
    <section class="vista-scroll auth-vista">
      <div class="auth-caja">
        <a class="auth-volver" href="#/">${raw(icono("atras", { size: 18 }))} ${t("app.volver")}</a>

        <div class="auth-marca">
          <div class="auth-logo">${raw(logoSvg())}</div>
          <h1 id="auth-titulo"></h1>
          <p class="texto-sm texto-dim" id="auth-sub"></p>
        </div>

        ${enModoDemo() ? raw(`<div class="aviso aviso-warm">
          <strong>Modo local.</strong> Todavía no hay servidor conectado. Lo que hagas aquí es una
          demostración guardada en este dispositivo y no se convierte después en una reserva real.
        </div>`) : ""}

        <form id="form-auth" novalidate autocomplete="on"></form>

        <div class="auth-social" id="auth-social" ${AUTH.googleEnabled || AUTH.appleEnabled ? "" : "hidden"}>
          <div class="auth-divisor"><span>${t("auth.oDivisor")}</span></div>
          ${AUTH.googleEnabled ? raw(`<button type="button" class="btn btn-contorno btn-bloque" data-oauth="google">
            ${googleSvg()} ${t("auth.google")}
          </button>`) : ""}
          ${AUTH.appleEnabled ? raw(`<button type="button" class="btn btn-contorno btn-bloque ${AUTH.googleEnabled ? "mt-2" : ""}" data-oauth="apple">
            ${appleSvg()} ${t("auth.apple")}
          </button>`) : ""}
        </div>

        <p class="auth-cambio texto-sm" id="auth-cambio"></p>
        <p class="texto-xs texto-suave texto-centro mt-4">${APP.name} · v${APP.version}</p>
      </div>
    </section>`;

  pintarFormulario(contenedor);

  contenedor.addEventListener("click", (e) => {
    const cambio = e.target.closest("[data-modo]");
    if (cambio) { modo = cambio.dataset.modo; pintarFormulario(contenedor); return; }

    const oauth = e.target.closest("[data-oauth]");
    if (oauth) return entrarConProveedor(oauth.dataset.oauth, oauth);

    const reenviar = e.target.closest("#reenviar-confirmacion");
    if (reenviar) return reenviarConfirmacion(contenedor, reenviar);

    const ojo = e.target.closest("[data-ojo]");
    if (ojo) {
      const input = contenedor.querySelector(`#${ojo.dataset.ojo}`);
      if (!input) return;
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      ojo.innerHTML = icono(visible ? "candado" : "info", { size: 16 });
      ojo.setAttribute("aria-label", visible ? "Mostrar contraseña" : "Ocultar contraseña");
    }
  });

  contenedor.addEventListener("submit", (e) => {
    e.preventDefault();
    if (modo === "entrar") return enviarEntrar(contenedor);
    if (modo === "registro") return enviarRegistro(contenedor);
    return enviarRecuperar(contenedor);
  });

  contenedor.addEventListener("input", (e) => {
    if (e.target.id === "pw-registro") medirFuerza(contenedor, e.target.value);
    const campo = e.target.closest(".campo");
    if (campo) {
      campo.dataset.error = "false";
      e.target.removeAttribute("aria-invalid");
      const m = campo.querySelector(".campo-error");
      if (m) m.textContent = "";
    }
  });
}

/* ---------------------------------------------------------------------
   Formularios
   --------------------------------------------------------------------- */
function pintarFormulario(c) {
  const form = c.querySelector("#form-auth");
  const tit = c.querySelector("#auth-titulo");
  const sub = c.querySelector("#auth-sub");
  const cambio = c.querySelector("#auth-cambio");
  const social = c.querySelector("#auth-social");

  if (modo === "entrar") {
    tit.textContent = t("auth.bienvenido");
    sub.textContent = "Entra para ver tus reservas y reservar en segundos.";
    social.hidden = !(AUTH.googleEnabled || AUTH.appleEnabled);
    form.innerHTML = html`
      ${campoEmail("email-login")}
      ${campoPassword("pw-login", t("auth.password"), "current-password")}
      <div class="fila-sep mb-4">
        <label class="switch">
          <input type="checkbox" id="recordarme" checked>
          <span class="switch-pista"></span>
          <span class="texto-sm">${t("auth.recordarme")}</span>
        </label>
        ${AUTH.emailDeliveryEnabled ? raw(`<button type="button" class="texto-sm" data-modo="recuperar" style="color:var(--marca);font-weight:600">${t("auth.olvide")}</button>`) : ""}
      </div>
      <button type="submit" class="btn btn-primario btn-lg btn-bloque">${t("auth.entrar")}</button>
      ${AUTH.emailDeliveryEnabled ? raw(`<button type="button" id="reenviar-confirmacion" class="texto-sm"
              style="margin-top:10px;color:var(--marca);font-weight:600;display:none">
        Reenviar el correo de confirmación
      </button>`) : ""}`;
    cambio.innerHTML = html`${t("auth.noTengo")} <button type="button" data-modo="registro">${t("auth.registrarse")}</button>`;
  } else if (modo === "registro") {
    tit.textContent = t("auth.crearCuenta");
    sub.textContent = "Tarda menos de un minuto.";
    social.hidden = !(AUTH.googleEnabled || AUTH.appleEnabled);
    form.innerHTML = html`
      <div class="campo">
        <label for="nombre">${t("auth.nombre")}</label>
        <input id="nombre" type="text" autocomplete="name" required placeholder="Ana Ruiz"
               aria-describedby="nombre-error">
        <span class="campo-error" id="nombre-error" role="alert"></span>
      </div>
      ${campoEmail("email-registro")}
      <div class="campo">
        <label for="telefono">${t("auth.telefono")} <span class="texto-suave">(opcional)</span></label>
        <input id="telefono" type="tel" autocomplete="tel" inputmode="tel" placeholder="+52 000 000 0000"
               aria-describedby="telefono-error">
        <span class="campo-error" id="telefono-error" role="alert"></span>
      </div>
      ${campoPassword("pw-registro", t("auth.password"), "new-password")}
      <div class="fuerza" id="fuerza" aria-live="polite"><span></span><span></span><span></span><span></span></div>
      <p class="campo-ayuda mb-4" id="fuerza-txt">Usa al menos 8 caracteres, con mayúsculas y números.</p>
      ${campoPassword("pw2-registro", t("auth.password2"), "new-password")}
      <label class="switch mb-4">
        <input type="checkbox" id="terminos" required aria-describedby="terminos-ayuda">
        <span class="switch-pista"></span>
        <span class="texto-sm" id="terminos-ayuda">
          Acepto los <a href="#/legal/terminos" target="_blank" rel="noopener">términos y condiciones</a>
          y el <a href="#/legal/privacidad" target="_blank" rel="noopener">aviso de privacidad</a>
        </span>
      </label>
      <button type="submit" class="btn btn-primario btn-lg btn-bloque">${t("auth.registrarse")}</button>`;
    cambio.innerHTML = html`<button type="button" data-modo="entrar">${t("auth.yaTengo")}</button>`;
  } else {
    tit.textContent = t("auth.recuperar");
    social.hidden = true;
    if (!AUTH.emailDeliveryEnabled) {
      sub.textContent = "Recuperación temporalmente no disponible.";
      form.innerHTML = html`<div class="aviso aviso-warm">El envío de correo todavía no está habilitado en este despliegue. Contacta a administración para recuperar el acceso.</div>`;
    } else {
      sub.textContent = t("auth.recuperarDesc");
      form.innerHTML = html`
        ${campoEmail("email-recuperar")}
        <button type="submit" class="btn btn-primario btn-lg btn-bloque">${t("auth.enviarEnlace")}</button>`;
    }
    cambio.innerHTML = html`<button type="button" data-modo="entrar">${t("app.volver")}</button>`;
  }

  setTimeout(() => form.querySelector("input")?.focus(), 120);
}

/* El mensaje de error lleva id propio y `role="alert"`, y el campo lo
   referencia con aria-describedby: sin eso un lector de pantalla nunca
   se entera de por qué no avanza el formulario. */
const campoEmail = (id) => html`
  <div class="campo">
    <label for="${id}">${t("auth.email")}</label>
    <div class="campo-icono">
      ${raw(icono("correo", { size: 18, clase: "ci" }))}
      <input id="${id}" type="email" autocomplete="email" inputmode="email" required
             placeholder="tu@correo.com" aria-describedby="${id}-error">
    </div>
    <span class="campo-error" id="${id}-error" role="alert"></span>
  </div>`;

const campoPassword = (id, etiqueta, autocomplete) => html`
  <div class="campo">
    <label for="${id}">${etiqueta}</label>
    <div class="campo-icono">
      ${raw(icono("candado", { size: 18, clase: "ci" }))}
      <input id="${id}" type="password" autocomplete="${autocomplete}" required
             placeholder="••••••••" minlength="8" aria-describedby="${id}-error">
      <button type="button" class="btn btn-fantasma btn-icono btn-sm campo-accion" data-ojo="${id}" aria-label="Mostrar contraseña">
        ${raw(icono("candado", { size: 16 }))}
      </button>
    </div>
    <span class="campo-error" id="${id}-error" role="alert"></span>
  </div>`;

function medirFuerza(c, valor) {
  const { fuerza, ok } = evaluarPassword(valor);
  const barras = c.querySelectorAll("#fuerza span");
  const colores = ["var(--taken)", "var(--taken)", "var(--warm)", "var(--ok)", "var(--ok)"];
  barras.forEach((b, i) => { b.style.background = i < fuerza ? colores[fuerza] : "var(--superficie-3)"; });
  const txt = c.querySelector("#fuerza-txt");
  if (txt) {
    txt.textContent = !valor ? "Usa al menos 8 caracteres, con mayúsculas y números."
      : ok ? ["", "Débil", "Aceptable", "Buena", "Excelente"][fuerza] : "Muy corta o demasiado simple";
    txt.style.color = ok ? "var(--ok)" : "var(--text-suave)";
  }
}

/* ---------------------------------------------------------------------
   Envío
   --------------------------------------------------------------------- */
function marcarError(c, id, mensaje) {
  return marcarErrores(c, [[id, mensaje]]);
}

/**
 * Marca TODOS los campos que fallan de una vez y deja el foco en el
 * primero. Antes se validaba en cascada y sólo se señalaba el primer
 * error: con tres campos mal, había que enviar tres veces para
 * enterarse de los tres.
 *
 * Devuelve false siempre, para poder escribir `return marcarErrores(...)`.
 */
function marcarErrores(c, errores) {
  const reales = errores.filter(([, mensaje]) => mensaje);
  reales.forEach(([id, mensaje], i) => {
    const input = c.querySelector(`#${id}`);
    const campo = input?.closest(".campo");
    if (!campo) return;
    campo.dataset.error = "true";
    input.setAttribute("aria-invalid", "true");
    const m = campo.querySelector(".campo-error");
    if (m) m.textContent = mensaje;
    if (i === 0) { temblar(campo); input.focus(); }
  });
  return false;
}

async function enviarEntrar(c) {
  const email = c.querySelector("#email-login").value.trim();
  const password = c.querySelector("#pw-login").value;
  const recordar = c.querySelector("#recordarme").checked;
  if (!esEmail(email)) return marcarError(c, "email-login", t("auth.emailInvalido"));
  if (!password) return marcarError(c, "pw-login", t("auth.requerido"));

  const btn = c.querySelector('button[type="submit"]');
  ultimoCorreo = email;
  try {
    await conCarga(btn, auth.entrar({ email, password, recordar }));
    toastOk("¡Bienvenido de vuelta!");
    ir(redirect, { reemplazar: true });
  } catch (e) {
    toastError(e.message);
    marcarError(c, "pw-login", "");
    // Si lo que falta es confirmar el correo, no basta con decirlo: hay
    // que ofrecer la salida. El botón sólo aparece en ese caso.
    const reenviar = c.querySelector("#reenviar-confirmacion");
    if (reenviar && /confirmar tu correo/i.test(String(e.message))) {
      reenviar.style.display = "block";
    }
  }
}

async function reenviarConfirmacion(c, btn) {
  if (!ultimoCorreo) return;
  try {
    await conCarga(btn, auth.reenviarConfirmacion(ultimoCorreo));
    // Mensaje neutro, igual que en el registro: no se confirma ni se
    // desmiente que exista una cuenta con ese correo.
    toastOk("Si hace falta confirmar esa cuenta, te llegará un correo.");
  } catch (e) {
    toastError(e.message);
  }
}

async function enviarRegistro(c) {
  const nombre = c.querySelector("#nombre").value.trim();
  const email = c.querySelector("#email-registro").value.trim();
  const telefono = c.querySelector("#telefono").value.trim();
  const pw = c.querySelector("#pw-registro").value;
  const pw2 = c.querySelector("#pw2-registro").value;

  const fuerza = evaluarPassword(pw);
  const errores = [
    ["nombre", nombre.length < 2 ? t("auth.requerido") : ""],
    ["email-registro", esEmail(email) ? "" : t("auth.emailInvalido")],
    ["pw-registro", fuerza.ok ? "" : fuerza.mensaje],
    // Que las contraseñas no coincidan sólo se señala si la segunda ya
    // se escribió: si no, se avisa de algo que la persona aún no falla.
    ["pw2-registro", pw2 && pw !== pw2 ? t("auth.passwordNoCoincide") : (pw2 ? "" : t("auth.requerido"))],
  ];
  if (errores.some(([, m]) => m)) return marcarErrores(c, errores);

  if (!c.querySelector("#terminos").checked) {
    toastError("Necesitas aceptar los términos para continuar");
    return temblar(c.querySelector("#terminos").closest(".switch"));
  }

  const btn = c.querySelector('button[type="submit"]');
  try {
    const { necesitaConfirmar } = await conCarga(btn, auth.registrar({ email, password: pw, nombre, telefono }));
    if (necesitaConfirmar) {
      // Mensaje deliberadamente neutro: es el mismo exista o no ya una
      // cuenta con ese correo, para que nadie pueda averiguar quién
      // está registrado probando direcciones.
      await avisar({
        titulo: "Revisa tu correo",
        mensaje: "Si es necesario, recibirás un correo con instrucciones para continuar. " +
                 "Revisa tu bandeja de entrada y la carpeta de spam.",
      });
      ultimoCorreo = email;
      modo = "entrar";
      pintarFormulario(c);
    } else {
      toastOk("¡Cuenta creada!");
      ir(redirect, { reemplazar: true });
    }
  } catch (e) {
    toastError(e.message);
  }
}

async function enviarRecuperar(c) {
  if (!AUTH.emailDeliveryEnabled) return toastError("La recuperación por correo todavía no está habilitada.");
  const email = c.querySelector("#email-recuperar").value.trim();
  if (!esEmail(email)) return marcarError(c, "email-recuperar", t("auth.emailInvalido"));
  const btn = c.querySelector('button[type="submit"]');
  try {
    await conCarga(btn, auth.recuperarPassword(email));
    await avisar({
      titulo: "Revisa tu correo",
      mensaje: `Enviamos un enlace a ${email} para crear una contraseña nueva. Si no aparece, revisa la carpeta de spam.`,
    });
    modo = "entrar";
    pintarFormulario(c);
  } catch (e) {
    toastError(e.message);
  }
}

async function entrarConProveedor(proveedor, btn) {
  if ((proveedor === "google" && !AUTH.googleEnabled) || (proveedor === "apple" && !AUTH.appleEnabled)) {
    return toastError("Ese proveedor de acceso no está habilitado.");
  }
  // Antes esto sólo marcaba data-cargando, así que el botón seguía
  // pulsable: cuatro clics seguidos abrían cuatro veces el proveedor.
  // botonCargando() además pone disabled.
  try {
    botonCargando(btn, true);
    if (proveedor === "google") await auth.entrarConGoogle({ redirect: "#" + redirect });
    else await auth.entrarConApple({ redirect: "#" + redirect });
  } catch (e) {
    botonCargando(btn, false);
    toastError(e.message);
  }
}

/* ---------- logos ---------- */
function logoSvg() {
  return `<svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
    <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="var(--marca)"/><stop offset="100%" stop-color="var(--acento)"/></linearGradient></defs>
    <path d="M32 4 58 18v28L32 60 6 46V18z" fill="none" stroke="url(#lg)" stroke-width="3" stroke-linejoin="round"/>
    <path d="M6 18l26 14 26-14M32 32v28" fill="none" stroke="url(#lg)" stroke-width="2.2" opacity=".7"/>
  </svg>`;
}

function googleSvg() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.5h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2-1.9 3.3-4.7 3.3-8.2z"/>
    <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23z"/>
    <path fill="#FBBC05" d="M5.7 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.6-2.8z"/>
    <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.1 7.1l3.6 2.8C6.6 7.4 9.1 5.4 12 5.4z"/>
  </svg>`;
}

function appleSvg() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M16.4 12.7c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.7 2.5 3 2.4 1.2 0 1.6-.8 3.1-.8 1.4 0 1.8.8 3.1.7 1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.5-3.9zM14 5.3c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/>
  </svg>`;
}
