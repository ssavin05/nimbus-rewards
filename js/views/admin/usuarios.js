/* ======================================================================
   admin/usuarios.js — Usuarios registrados y control de roles.
   ====================================================================== */
import { html, raw, esc, iniciales, fechaCorta, normalizar, debounce, urlMedioSegura } from "../../core/utils.js";
import { t } from "../../core/i18n.js";
import { icono } from "../../core/iconos.js";
import { toastOk, toastError, abrirHoja, vacio, confirmar } from "../../core/ui.js";
import api from "../../data/api.js";
import store from "../../core/store.js";
import { puede, ETIQUETA_ROL, ROLES } from "../../auth/permisos.js";

export const titulo = () => t("admin.usuarios");

let usuarios = [];
let filtro = "";
let reservasPorUsuario = new Map();

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <div class="admin-cabecera"><div><p class="eyebrow">ADMINISTRACIÓN</p><h1>Clientes</h1><p class="texto-sm texto-dim">Directorio, empresa, contacto, reservaciones e historial.</p></div></div>
        <div class="buscador mb-4">
          ${raw(icono("buscar", { size: 17, clase: "ci" }))}
          <input id="au-busq" type="search" placeholder="Nombre, correo o empresa…">
        </div>
        <p class="texto-sm texto-dim mb-2" id="au-conteo"></p>
        <div id="au-lista">${raw('<div class="esqueleto esq-linea" style="height:58px;margin-bottom:8px"></div>'.repeat(5))}</div>
      </div>
    </div>`;

  const [listaUsuarios, reservas] = await Promise.all([
    api.adminUsuarios().catch(() => []),
    api.adminReservas({ limite: 500 }).catch(() => []),
  ]);
  usuarios = listaUsuarios;
  reservasPorUsuario = reservas.reduce((mapa, r) => {
    const id = String(r.usuario_id || "");
    if (!id) return mapa;
    const actual = mapa.get(id) || { total: 0, ultima: null };
    actual.total += 1;
    if (!actual.ultima || new Date(r.inicio) > new Date(actual.ultima)) actual.ultima = r.inicio;
    mapa.set(id, actual);
    return mapa;
  }, new Map());
  pintar(contenedor);

  contenedor.querySelector("#au-busq").addEventListener("input", debounce((e) => {
    filtro = e.target.value.trim();
    pintar(contenedor);
  }, 200));

  contenedor.addEventListener("click", (e) => {
    const rol = e.target.closest("[data-rol]");
    if (rol) return cambiarRol(contenedor, rol.dataset.rol);
  });
}

function pintar(contenedor) {
  const q = normalizar(filtro);
  const lista = usuarios.filter((u) => !q
    || normalizar(u.nombre || "").includes(q)
    || normalizar(u.email || "").includes(q)
    || normalizar(u.empresa || "").includes(q));

  contenedor.querySelector("#au-conteo").textContent = `${lista.length} usuario(s)`;
  const caja = contenedor.querySelector("#au-lista");
  if (!lista.length) {
    caja.innerHTML = vacio({ ico: "👥", titulo: "Sin usuarios", desc: "Aparecerán aquí conforme se registren." });
    return;
  }

  caja.innerHTML = html`<div class="tabla-scroll tarjeta"><table class="tabla-admin tabla-clientes"><thead><tr><th>Nombre</th><th>Empresa</th><th>Teléfono</th><th>Correo</th><th>Reservas</th><th>Historial</th><th>Acciones</th></tr></thead><tbody>${lista.map((u) => {
    const actividad = reservasPorUsuario.get(String(u.id)) || { total: 0, ultima: null };
    return raw(`<tr><td><span class="cliente-identidad"><span class="avatar avatar-sm">${urlMedioSegura(u.avatar_url) ? `<img src="${esc(urlMedioSegura(u.avatar_url))}" alt="">` : esc(iniciales(u.nombre || u.email || "?"))}</span><strong>${esc(u.nombre || "Sin nombre")}</strong></span></td><td>${esc(u.empresa || "—")}</td><td>${esc(u.telefono || "—")}</td><td>${esc(u.email || "—")}</td><td><strong>${actividad.total}</strong></td><td>${actividad.ultima ? esc(fechaCorta(actividad.ultima)) : `Desde ${esc(fechaCorta(u.creado_en))}`}</td><td><span class="ae-acciones"><span class="chip chip-${u.rol === "usuario" ? "neutro" : "purple"}">${esc(ETIQUETA_ROL[u.rol] || u.rol)}</span>${puede("usuarios.cambiarRol") ? `<button type="button" class="btn btn-fantasma btn-icono btn-sm" data-rol="${esc(u.id)}" aria-label="Cambiar rol">${icono("ajustes", { size: 15 })}</button>` : ""}</span></td></tr>`);
  }).join("")}</tbody></table></div>`;
}

async function cambiarRol(contenedor, id) {
  const u = usuarios.find((x) => String(x.id) === id);
  if (!u) return;
  if (String(id) === String(store.get().usuario?.id)) {
    return toastError("No puedes cambiar tu propio rol.");
  }

  const disponibles = ROLES.filter((r) => r !== "invitado");
  const { el, cerrar } = abrirHoja({
    titulo: `Rol de ${u.nombre || u.email}`,
    centrado: true, ancho: "420px",
    contenido: html`<div class="col" style="gap:8px">
      ${disponibles.map((r) => raw(`<button type="button" class="lista-item" data-set="${r}" style="border-radius:var(--r-sm)">
        <span class="li-txt"><span class="li-titulo">${esc(ETIQUETA_ROL[r])}</span>
        <span class="li-sub">${esc(descripcionRol(r))}</span></span>
        ${u.rol === r ? icono("check", { size: 16 }) : ""}</button>`))}
    </div>`,
  });

  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-set]");
    if (!b) return;
    const nuevo = b.dataset.set;
    if (["admin", "superadmin"].includes(nuevo)) {
      const ok = await confirmar({
        titulo: "Conceder permisos de administración",
        mensaje: `${u.nombre || u.email} podrá crear, editar y eliminar espacios, ver todas las reservas y las estadísticas.`,
        aceptar: "Conceder", peligro: true,
      });
      if (!ok) return;
    }
    try {
      await api.adminCambiarRol(id, nuevo);
      u.rol = nuevo;
      cerrar();
      pintar(contenedor);
      toastOk("Rol actualizado");
    } catch (err) { toastError(err.message); }
  });
}

function descripcionRol(rol) {
  return {
    usuario: "Reservar, calificar y gestionar sus propias reservas",
    staff: "Ver todas las reservas, cambiar estados y responder el chat",
    admin: "Todo lo anterior más espacios, precios, promociones y estadísticas",
    superadmin: "Control total, incluida la organización y la auditoría",
  }[rol] || "";
}
