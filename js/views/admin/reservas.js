/* ======================================================================
   admin/reservas.js — Todas las reservas del centro: buscar, filtrar,
   confirmar, cancelar y exportar.
   ====================================================================== */
import { html, raw, esc, formatMoneda, fechaHora, isoFecha, normalizar, debounce } from "../../core/utils.js";
import { t } from "../../core/i18n.js";
import { icono } from "../../core/iconos.js";
import { toastOk, toastError, confirmar, vacio, abrirHoja } from "../../core/ui.js";
import api from "../../data/api.js";
import { getDB } from "../../data/db.js";
import { puede } from "../../auth/permisos.js";

export const titulo = () => t("admin.reservas");

let reservas = [];
const filtros = { texto: "", estado: "", desde: "", hasta: "" };

export async function render(contenedor, ctx) {
  filtros.texto = ctx?.query?.get("folio") || "";

  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <div class="buscador mb-4">
          ${raw(icono("buscar", { size: 17, clase: "ci" }))}
          <input id="ar-busq" type="search" placeholder="Folio, espacio o cliente…" value="${esc(filtros.texto)}">
        </div>

        <div class="fila envolver mb-4" style="gap:8px">
          <select id="ar-estado" class="input" style="width:auto;min-height:38px">
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendientes</option>
            <option value="confirmada">Confirmadas</option>
            <option value="en_curso">En curso</option>
            <option value="completada">Completadas</option>
            <option value="cancelada">Canceladas</option>
          </select>
          <input id="ar-desde" type="date" class="input" style="width:auto;min-height:38px">
          <input id="ar-hasta" type="date" class="input" style="width:auto;min-height:38px">
          <button type="button" class="btn btn-contorno btn-sm" data-buscar>Filtrar</button>
          <button type="button" class="btn btn-fantasma btn-sm" data-exportar>${raw(icono("descargar", { size: 15 }))} CSV</button>
        </div>

        <p class="texto-sm texto-dim mb-2" id="ar-conteo"></p>
        <div id="ar-lista">${raw('<div class="esqueleto esq-linea" style="height:64px;margin-bottom:8px"></div>'.repeat(5))}</div>
      </div>
    </div>`;

  await cargar(contenedor);

  contenedor.querySelector("#ar-busq").addEventListener("input", debounce((e) => {
    filtros.texto = e.target.value.trim();
    pintar(contenedor);
  }, 200));

  contenedor.addEventListener("click", async (e) => {
    if (e.target.closest("[data-buscar]")) {
      filtros.estado = contenedor.querySelector("#ar-estado").value;
      filtros.desde = contenedor.querySelector("#ar-desde").value;
      filtros.hasta = contenedor.querySelector("#ar-hasta").value;
      return cargar(contenedor);
    }
    if (e.target.closest("[data-exportar]")) return exportar();

    const detalle = e.target.closest("[data-detalle]");
    if (detalle) return verDetalle(contenedor, detalle.dataset.detalle);

    const confirmar_ = e.target.closest("[data-confirmar]");
    if (confirmar_) return cambiarEstado(contenedor, confirmar_.dataset.confirmar, "confirmada");

    const cancelar = e.target.closest("[data-cancelar]");
    if (cancelar) return cancelarReserva(contenedor, cancelar.dataset.cancelar);
  });
}

async function cargar(contenedor) {
  const caja = contenedor.querySelector("#ar-lista");
  caja.innerHTML = '<div class="cargando-centro"><div class="spinner"></div></div>';
  reservas = await api.adminReservas({
    estado: filtros.estado || null,
    desde: filtros.desde ? `${filtros.desde}T00:00:00` : null,
    hasta: filtros.hasta ? `${filtros.hasta}T23:59:59` : null,
    limite: 300,
  }).catch(() => []);
  pintar(contenedor);
}

function pintar(contenedor) {
  const q = normalizar(filtros.texto);
  const lista = reservas.filter((r) => !q
    || normalizar(r.folio || "").includes(q)
    || normalizar(r.espacios?.nombre || "").includes(q)
    || normalizar(r.usuarios?.nombre || "").includes(q)
    || normalizar(r.usuarios?.email || "").includes(q));

  contenedor.querySelector("#ar-conteo").textContent =
    `${lista.length} reserva${lista.length === 1 ? "" : "s"} · ${formatMoneda(lista.filter((r) => r.estado !== "cancelada").reduce((a, r) => a + Number(r.total || 0), 0))}`;

  const caja = contenedor.querySelector("#ar-lista");
  if (!lista.length) {
    caja.innerHTML = vacio({ ico: "📅", titulo: "Sin reservas", desc: "Ajusta los filtros o cambia el rango de fechas." });
    return;
  }

  caja.innerHTML = `<div class="lista tarjeta">${lista.map((r) => html`
    <div class="lista-item">
      <span class="li-ico">${r.espacios?.icono || "🏢"}</span>
      <span class="li-txt">
        <span class="li-titulo">${r.espacios?.nombre || "Espacio"} <span class="mono texto-xs texto-suave">${r.folio || ""}</span></span>
        <span class="li-sub">${r.usuarios?.nombre || r.usuarios?.email || "Usuario"} · ${fechaHora(r.inicio)}</span>
      </span>
      <span class="li-fin ae-acciones">
        <strong class="mono texto-sm">${formatMoneda(r.total || 0)}</strong>
        <span class="chip chip-${raw(clase(r.estado))}">${r.estado}</span>
        <button type="button" class="btn btn-fantasma btn-icono btn-sm" data-detalle="${esc(r.id)}" aria-label="Detalle">${raw(icono("info", { size: 15 }))}</button>
        ${r.estado === "pendiente" && puede("reservas.verTodas") ? raw(`<button type="button" class="btn btn-fantasma btn-icono btn-sm" data-confirmar="${esc(r.id)}" aria-label="Confirmar" style="color:var(--ok)">${icono("check", { size: 15 })}</button>`) : ""}
        ${r.estado !== "cancelada" && puede("reserva.cancelarAjena") ? raw(`<button type="button" class="btn btn-fantasma btn-icono btn-sm" data-cancelar="${esc(r.id)}" aria-label="Cancelar" style="color:var(--taken)">${icono("cerrar", { size: 15 })}</button>`) : ""}
      </span>
    </div>`).join("")}</div>`;
}

const clase = (e) => ({ pendiente: "warm", confirmada: "ok", en_curso: "ok", completada: "neutro", cancelada: "taken", no_asistio: "taken" }[e] || "neutro");

async function cambiarEstado(contenedor, id, estado) {
  try {
    const db = await getDB();
    if (!db) throw new Error("Backend no configurado");
    const { error } = await db.from("reservas").update({ estado }).eq("id", id);
    if (error) throw error;
    toastOk("Reserva confirmada");
    await cargar(contenedor);
  } catch (e) { toastError(e.message); }
}

async function cancelarReserva(contenedor, id) {
  const ok = await confirmar({
    titulo: "Cancelar reserva",
    mensaje: "Se notificará al cliente y se liberará el horario.",
    peligro: true, aceptar: "Cancelar reserva", cancelar: "Volver",
  });
  if (!ok) return;
  try {
    await api.cancelarReserva(id, "Cancelada por la administración");
    toastOk("Reserva cancelada");
    await cargar(contenedor);
  } catch (e) { toastError(e.message); }
}

function verDetalle(contenedor, id) {
  const r = reservas.find((x) => String(x.id) === id);
  if (!r) return;
  abrirHoja({
    titulo: r.folio || "Reserva",
    contenido: html`
      <div class="lista">
        ${fila("Espacio", r.espacios?.nombre || "—")}
        ${fila("Cliente", r.usuarios?.nombre || "—")}
        ${fila("Correo", r.usuarios?.email || "—")}
        ${fila("Teléfono", r.usuarios?.telefono || "—")}
        ${fila("Inicio", fechaHora(r.inicio))}
        ${fila("Fin", fechaHora(r.fin))}
        ${fila("Asistentes", String(r.asistentes || 1))}
        ${fila("Estado", r.estado)}
        ${fila("Subtotal", formatMoneda(r.subtotal || 0))}
        ${fila("Descuento", formatMoneda(r.descuento || 0))}
        ${fila("IVA", formatMoneda(r.impuestos || 0))}
        ${fila("Total", formatMoneda(r.total || 0))}
        ${r.notas ? fila("Notas", r.notas) : ""}
        ${r.motivo_cancelacion ? fila("Motivo de cancelación", r.motivo_cancelacion) : ""}
      </div>`,
  });
}

const fila = (k, v) => html`<div class="lista-item">
  <span class="li-txt"><span class="li-sub">${k}</span><span class="li-titulo">${v}</span></span></div>`;

function exportar() {
  const filas = [["folio", "espacio", "cliente", "email", "inicio", "fin", "estado", "subtotal", "descuento", "iva", "total"]];
  for (const r of reservas) {
    filas.push([r.folio, r.espacios?.nombre, r.usuarios?.nombre, r.usuarios?.email,
      r.inicio, r.fin, r.estado, r.subtotal, r.descuento, r.impuestos, r.total]);
  }
  const csv = filas.map((f) => f.map((c) => {
    const s = String(c ?? "");
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reservas-${isoFecha()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toastOk("CSV descargado");
}
