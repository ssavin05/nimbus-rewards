/* ======================================================================
   admin/espacios.js — Listado y gestión de espacios:
   crear, editar, cambiar estado, cambiar precio y eliminar.
   ====================================================================== */
import { html, raw, esc, formatMoneda, debounce, normalizar } from "../../core/utils.js";
import { t } from "../../core/i18n.js";
import { icono } from "../../core/iconos.js";
import { toastOk, toastError, confirmar, abrirHoja, conCarga, vacio } from "../../core/ui.js";
import { ir } from "../../core/router.js";
import api from "../../data/api.js";
import { puede } from "../../auth/permisos.js";

export const titulo = () => t("admin.espacios");

const ESTADOS = [
  ["disponible", "Disponible", "ok"],
  ["reservada", "Reservada", "taken"],
  ["mantenimiento", "Mantenimiento", "neutro"],
  ["proximamente", "Próximamente", "purple"],
  ["inactiva", "No disponible", "neutro"],
];

let espacios = [];
let filtro = "";

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <div class="fila-sep mb-4">
          <div class="buscador crece">
            ${raw(icono("buscar", { size: 17, clase: "ci" }))}
            <input id="ae-busq" type="search" placeholder="Buscar por nombre o código…">
          </div>
          ${puede("espacio.crear") ? raw(`<button type="button" class="btn btn-primario btn-sm" data-nuevo>
            ${icono("mas", { size: 16 })} ${esc(t("admin.nuevoEspacio"))}</button>`) : ""}
        </div>

        <div id="ae-lista">${raw('<div class="esqueleto esq-tarjeta" style="height:76px;margin-bottom:10px"></div>'.repeat(5))}</div>
      </div>
    </div>`;

  espacios = await api.getEspacios({ forzar: true });
  pintar(contenedor);

  contenedor.querySelector("#ae-busq").addEventListener("input", debounce((e) => {
    filtro = e.target.value.trim();
    pintar(contenedor);
  }, 200));

  contenedor.addEventListener("click", async (e) => {
    if (e.target.closest("[data-nuevo]")) return ir("/admin/espacios/nuevo");

    const editar = e.target.closest("[data-editar]");
    if (editar) return ir(`/admin/espacios/${editar.dataset.editar}`);

    const estado = e.target.closest("[data-estado]");
    if (estado) return cambiarEstado(contenedor, estado.dataset.estado);

    const precio = e.target.closest("[data-precio]");
    if (precio) return cambiarPrecio(contenedor, precio.dataset.precio);

    const borrar = e.target.closest("[data-borrar]");
    if (borrar) return eliminar(contenedor, borrar.dataset.borrar);
  });
}

function pintar(contenedor) {
  const q = normalizar(filtro);
  const lista = espacios.filter((e) =>
    !q || normalizar(e.nombre).includes(q) || normalizar(e.codigo).includes(q));

  const caja = contenedor.querySelector("#ae-lista");
  if (!lista.length) {
    caja.innerHTML = vacio({ ico: "🏢", titulo: "Sin espacios", desc: "Crea el primero para empezar." });
    return;
  }

  caja.innerHTML = `<div class="lista tarjeta">${lista.map((e) => {
    const est = ESTADOS.find(([v]) => v === e.estado) || ESTADOS[0];
    return html`
      <div class="lista-item ae-fila">
        <span class="li-ico">${e.icono || "🏢"}</span>
        <span class="li-txt">
          <span class="li-titulo">${e.nombre}</span>
          <span class="li-sub mono">${e.codigo} · ${e.capacidad} pers. · ${e.reservable ? formatMoneda(e.precio_hora) + "/h" : "no reservable"}</span>
        </span>
        <span class="li-fin ae-acciones">
          <span class="chip chip-${raw(est[2])}">${est[1]}</span>
          ${puede("espacio.cambiarEstado") ? raw(`<button type="button" class="btn btn-fantasma btn-icono btn-sm" data-estado="${esc(e.id)}" aria-label="Cambiar estado">${icono("refrescar", { size: 15 })}</button>`) : ""}
          ${puede("espacio.precios") ? raw(`<button type="button" class="btn btn-fantasma btn-icono btn-sm" data-precio="${esc(e.id)}" aria-label="Cambiar precio">${icono("wallet", { size: 15 })}</button>`) : ""}
          ${puede("espacio.editar") ? raw(`<button type="button" class="btn btn-fantasma btn-icono btn-sm" data-editar="${esc(e.id)}" aria-label="Editar">${icono("lapiz", { size: 15 })}</button>`) : ""}
          ${puede("espacio.eliminar") ? raw(`<button type="button" class="btn btn-fantasma btn-icono btn-sm" data-borrar="${esc(e.id)}" aria-label="Eliminar" style="color:var(--taken)">${icono("basura", { size: 15 })}</button>`) : ""}
        </span>
      </div>`;
  }).join("")}</div>`;
}

async function cambiarEstado(contenedor, id) {
  const espacio = espacios.find((e) => String(e.id) === id);
  if (!espacio) return;

  const { el, cerrar } = abrirHoja({
    titulo: `Estado de ${espacio.nombre}`,
    centrado: true, ancho: "420px",
    contenido: html`<div class="col" style="gap:8px">
      ${ESTADOS.map(([valor, etiqueta, tono]) => raw(`
        <button type="button" class="lista-item" data-set="${valor}" style="border-radius:var(--r-sm)">
          <span class="punto punto-${tono}"></span>
          <span class="li-txt"><span class="li-titulo">${esc(etiqueta)}</span></span>
          ${espacio.estado === valor ? icono("check", { size: 16 }) : ""}
        </button>`))}
    </div>`,
  });

  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-set]");
    if (!b) return;
    try {
      await api.adminCambiarEstado(id, b.dataset.set);
      espacios = await api.getEspacios({ forzar: true });
      cerrar();
      pintar(contenedor);
      toastOk("Estado actualizado");
    } catch (err) { toastError(err.message); }
  });
}

async function cambiarPrecio(contenedor, id) {
  const espacio = espacios.find((e) => String(e.id) === id);
  if (!espacio) return;

  const { el, cerrar } = abrirHoja({
    titulo: `Precios de ${espacio.nombre}`,
    centrado: true, ancho: "440px",
    contenido: html`
      <div class="campo"><label for="pr-hora">Precio por hora (MXN)</label>
        <input id="pr-hora" type="number" min="0" step="10" value="${Number(espacio.precio_hora) || 0}"></div>
      <div class="campo"><label for="pr-dia">Precio por día (opcional)</label>
        <input id="pr-dia" type="number" min="0" step="50" value="${espacio.precio_dia ?? ""}"></div>
      <div class="campo"><label for="pr-mes">Precio mensual (opcional)</label>
        <input id="pr-mes" type="number" min="0" step="100" value="${espacio.precio_mes ?? ""}"></div>
      <p class="campo-ayuda">Los precios se muestran sin IVA; el impuesto se calcula al reservar.</p>`,
    pie: html`
      <button type="button" class="btn btn-contorno" data-cerrar>${t("app.cancelar")}</button>
      <button type="button" class="btn btn-primario" data-guardar>${t("app.guardar")}</button>`,
  });

  el.querySelector("[data-cerrar]").addEventListener("click", () => cerrar());
  el.querySelector("[data-guardar]").addEventListener("click", async (ev) => {
    const hora = Number(el.querySelector("#pr-hora").value);
    const dia = el.querySelector("#pr-dia").value;
    const mes = el.querySelector("#pr-mes").value;
    if (hora < 0) return toastError("El precio no puede ser negativo.");
    try {
      await conCarga(ev.currentTarget, api.adminGuardarEspacio({
        id, precio_hora: hora,
        precio_dia: dia === "" ? null : Number(dia),
        precio_mes: mes === "" ? null : Number(mes),
      }));
      espacios = await api.getEspacios({ forzar: true });
      cerrar();
      pintar(contenedor);
      toastOk("Precios actualizados");
    } catch (err) { toastError(err.message); }
  });
}

async function eliminar(contenedor, id) {
  const espacio = espacios.find((e) => String(e.id) === id);
  const ok = await confirmar({
    titulo: `Eliminar ${espacio?.nombre || "espacio"}`,
    mensaje: "El espacio dejará de aparecer en el catálogo y en el mapa.",
    detalle: "Se conserva el historial de reservas asociado, por eso es una baja lógica y no un borrado definitivo.",
    aceptar: t("app.eliminar"), peligro: true,
  });
  if (!ok) return;
  try {
    await api.adminBorrarEspacio(id);
    espacios = await api.getEspacios({ forzar: true });
    pintar(contenedor);
    toastOk("Espacio eliminado");
  } catch (e) { toastError(e.message); }
}
