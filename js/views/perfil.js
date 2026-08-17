/* ======================================================================
   perfil.js — Perfil del usuario: datos, foto, estadísticas y accesos.
   ====================================================================== */
import { html, raw, esc, iniciales, formatMoneda, fechaCorta, urlMedioSegura } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { toastOk, toastError, conCarga, abrirHoja, confirmar } from "../core/ui.js";
import { ir } from "../core/router.js";
import store from "../core/store.js";
import api from "../data/api.js";
import { nombreUsuario, avatarUsuario, salir, refrescarAcceso } from "../auth/auth.js";
import { subirArchivo } from "../data/db.js";
import { SUPABASE, FEATURES } from "../core/config.js";
import { esStaff, ETIQUETA_ROL } from "../auth/permisos.js";

export const titulo = () => t("perfil.titulo");

export async function render(contenedor) {
  const { perfil, usuario, rol } = store.get();
  const nombre = nombreUsuario();
  const avatar = avatarUsuario();

  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">

        <header class="perfil-cab">
          <button type="button" class="avatar avatar-lg perfil-avatar" data-foto aria-label="${t("perfil.foto")}">
            ${urlMedioSegura(avatar) ? raw(`<img src="${esc(urlMedioSegura(avatar))}" alt="">`) : iniciales(nombre)}
            <span class="perfil-avatar-ico">${raw(icono("camara", { size: 14 }))}</span>
          </button>
          <h1>${nombre}</h1>
          <p class="texto-dim">${perfil?.email || usuario?.email || ""}</p>
          ${rol !== "usuario" ? raw(`<span class="chip chip-purple mt-2">${esc(ETIQUETA_ROL[rol] || rol)}</span>`) : ""}
          ${perfil?.creado_en ? raw(`<p class="texto-xs texto-suave mt-2">${esc(t("perfil.miembroDesde", { fecha: fechaCorta(perfil.creado_en) }))}</p>`) : ""}
        </header>

        ${esStaff() ? raw(`<a class="tarjeta tarjeta-pad acceso-admin-ok" href="#/admin">
          <span class="canal-ico">${icono("panel", { size: 20 })}</span>
          <span class="crece"><strong>Entrar al panel administrativo</strong><small>Dashboard, calendario, clientes, pagos y espacios</small></span>
          ${icono("chevron", { size: 17 })}
        </a>`) : raw(`<div class="tarjeta tarjeta-pad acceso-admin-revisar">
          <span class="canal-ico">${icono("candado", { size: 20 })}</span>
          <span class="crece"><strong>¿Esta cuenta debe ser administradora?</strong><small>Vuelve a consultar el rol directamente en Supabase.</small></span>
          <button type="button" class="btn btn-contorno btn-sm" data-verificar-admin>Verificar acceso</button>
        </div>`)}

        <div class="grid-3 mt-6" id="perfil-stats">
          ${raw('<div class="esqueleto" style="height:74px;border-radius:var(--r)"></div>'.repeat(3))}
        </div>

        <section class="seccion mt-6">
          <h2 class="seccion-titulo">Mis datos</h2>
          <form id="perfil-form" class="tarjeta tarjeta-pad">
            <div class="campo">
              <label for="p-nombre">${t("auth.nombre")}</label>
              <input id="p-nombre" type="text" value="${esc(perfil?.nombre || "")}" autocomplete="name">
            </div>
            <div class="campo">
              <label for="p-telefono">${t("auth.telefono")}</label>
              <input id="p-telefono" type="tel" value="${esc(perfil?.telefono || "")}" autocomplete="tel">
            </div>
            <div class="campo">
              <label for="p-empresa">${t("perfil.empresa")}</label>
              <input id="p-empresa" type="text" value="${esc(perfil?.empresa || "")}" autocomplete="organization">
            </div>
            ${FEATURES.facturacion ? raw(`<div class="campo">
              <label for="p-rfc">${esc(t("perfil.rfc"))}</label>
              <input id="p-rfc" type="text" value="${esc(perfil?.rfc || "")}" style="text-transform:uppercase" maxlength="13">
              <span class="campo-ayuda">Se usa únicamente para solicitudes de facturación.</span>
            </div>`) : ""}
            <button type="submit" class="btn btn-primario btn-bloque">${t("app.guardar")}</button>
          </form>
        </section>

        <section class="seccion">
          <div class="lista tarjeta">
            <a class="lista-item" href="#/reservas">
              <span class="li-ico">${raw(icono("calendario", { size: 17 }))}</span>
              <span class="li-txt"><span class="li-titulo">${t("misReservas.titulo")}</span></span>
              <span class="li-fin">${raw(icono("chevron", { size: 16 }))}</span></a>
            <a class="lista-item" href="#/favoritos">
              <span class="li-ico">${raw(icono("corazon", { size: 17 }))}</span>
              <span class="li-txt"><span class="li-titulo">${t("favoritos.titulo")}</span></span>
              <span class="li-fin">${raw(icono("chevron", { size: 16 }))}</span></a>
            <a class="lista-item" href="#/pagos">
              <span class="li-ico">${raw(icono("recibo", { size: 17 }))}</span>
              <span class="li-txt"><span class="li-titulo">${t("pago.historial")}</span></span>
              <span class="li-fin">${raw(icono("chevron", { size: 16 }))}</span></a>
            <a class="lista-item" href="#/configuracion">
              <span class="li-ico">${raw(icono("ajustes", { size: 17 }))}</span>
              <span class="li-txt"><span class="li-titulo">${t("config.titulo")}</span></span>
              <span class="li-fin">${raw(icono("chevron", { size: 16 }))}</span></a>
            <a class="lista-item" href="#/ayuda">
              <span class="li-ico">${raw(icono("ayuda", { size: 17 }))}</span>
              <span class="li-txt"><span class="li-titulo">${t("ayuda.titulo")}</span></span>
              <span class="li-fin">${raw(icono("chevron", { size: 16 }))}</span></a>
            ${esStaff() ? raw(`<a class="lista-item" href="#/admin">
              <span class="li-ico">${icono("panel", { size: 17 })}</span>
              <span class="li-txt"><span class="li-titulo">${esc(t("admin.titulo"))}</span></span>
              <span class="li-fin">${icono("chevron", { size: 16 })}</span></a>`) : ""}
          </div>
        </section>

        <button type="button" class="btn btn-contorno btn-bloque" data-salir>
          ${raw(icono("salir", { size: 17 }))} ${t("auth.salir")}</button>

        <input type="file" id="p-file" accept="image/*" hidden>
      </div>
    </div>`;

  pintarEstadisticas(contenedor);

  contenedor.querySelector("[data-verificar-admin]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    try {
      await conCarga(btn, refrescarAcceso());
      if (["staff", "admin", "superadmin"].includes(store.get().rol)) {
        toastOk("Acceso administrativo confirmado");
        ir("/admin");
        return;
      }
      const email = String(store.get().perfil?.email || store.get().usuario?.email || "tu-correo@ejemplo.com").replace(/'/g, "''");
      abrirHoja({
        titulo: "El rol aún no está asignado",
        contenido: html`<div class="aviso aviso-warm"><strong>Tu sesión funciona, pero Supabase devuelve el rol “${store.get().rol}”.</strong></div>
          <p>El propietario del proyecto debe ejecutar una sola vez en Supabase → SQL Editor:</p>
          <pre class="codigo-admin">update public.usuarios
set rol = 'admin'
where lower(email) = lower('${email}');</pre>
          <p class="texto-sm texto-dim">Después vuelve aquí y pulsa “Verificar acceso”. No necesitas cerrar sesión.</p>`,
      });
    } catch (err) { toastError(err.message || "No se pudo verificar el acceso"); }
  });

  contenedor.querySelector("#perfil-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    try {
      await conCarga(btn, api.actualizarPerfil({
        nombre: contenedor.querySelector("#p-nombre").value.trim(),
        telefono: contenedor.querySelector("#p-telefono").value.trim(),
        empresa: contenedor.querySelector("#p-empresa").value.trim(),
        ...(FEATURES.facturacion ? { rfc: contenedor.querySelector("#p-rfc")?.value.trim().toUpperCase() || null } : {}),
      }));
      toastOk(t("app.guardado"));
    } catch (err) { toastError(err.message); }
  });

  contenedor.querySelector("[data-foto]").addEventListener("click", () => contenedor.querySelector("#p-file").click());
  contenedor.querySelector("#p-file").addEventListener("change", (e) => subirAvatar(contenedor, e.target.files[0]));

  contenedor.querySelector("[data-salir]").addEventListener("click", async () => {
    const ok = await confirmar({
      titulo: t("auth.salir"),
      mensaje: "Se cerrará la sesión y se borrarán del equipo tus datos guardados. Los favoritos pendientes de sincronizar se conservan.",
      peligro: true,
      aceptar: t("auth.salir"),
    });
    if (!ok) return;
    await salir();
    toastOk("Sesión cerrada");
    ir("/");
  });
}

async function pintarEstadisticas(contenedor) {
  const caja = contenedor.querySelector("#perfil-stats");
  const { total, horas, gasto } = await api.getEstadisticasUsuario();
  caja.innerHTML = html`
    ${tarjetaStat(total, t("perfil.reservasTotales"), "calendario")}
    ${tarjetaStat(horas + " h", t("perfil.horasTotales"), "reloj")}
    ${tarjetaStat(formatMoneda(gasto), t("perfil.gastoTotal"), "wallet")}`;
}

const tarjetaStat = (valor, etiqueta, ico) => html`
  <div class="tarjeta stat">
    <span class="stat-ico">${raw(icono(ico, { size: 18 }))}</span>
    <strong class="stat-valor">${valor}</strong>
    <span class="stat-etiqueta">${etiqueta}</span>
  </div>`;

async function subirAvatar(contenedor, archivo) {
  if (!archivo) return;
  if (archivo.size > 3 * 1024 * 1024) return toastError("La imagen no puede pesar más de 3 MB.");
  const { usuario } = store.get();
  if (!usuario) return;

  try {
    const ext = (archivo.name.split(".").pop() || "jpg").toLowerCase();
    const ruta = `${usuario.id}/avatar-${Date.now()}.${ext}`;
    const { url } = await subirArchivo(SUPABASE.buckets.avatares, ruta, archivo);
    await api.actualizarPerfil({ avatar_url: url });
    const av = contenedor.querySelector(".perfil-avatar");
    av.innerHTML = `<img src="${esc(url)}" alt=""><span class="perfil-avatar-ico">${icono("camara", { size: 14 })}</span>`;
    toastOk("Foto actualizada");
  } catch (e) {
    toastError(e.message || "No se pudo subir la imagen");
  }
}
