/* Calendario operativo semanal: reservas reales desde Supabase o modo local. */
import { html, raw, esc, fechaHora, formatMoneda } from "../../core/utils.js";
import { abrirHoja } from "../../core/ui.js";
import { icono } from "../../core/iconos.js";
import api from "../../data/api.js";

export const titulo = "Calendario de reservaciones";

let ancla = new Date();
let vista = "semana";
let reservas = [];

const inicioSemana = (fecha) => {
  const d = new Date(fecha); d.setHours(0, 0, 0, 0);
  const dia = d.getDay() || 7; d.setDate(d.getDate() - dia + 1); return d;
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tonos = ["oro", "verde", "morado", "azul", "naranja"];
const tonoReserva = (r) => tonos[Math.abs(String(r.espacios?.codigo || r.espacio_id || "A").split("").reduce((n, c) => n + c.charCodeAt(0), 0)) % tonos.length];

export async function render(contenedor) {
  contenedor.innerHTML = html`<div class="vista-scroll"><div class="vista-contenido admin-calendario">
    <div class="admin-cabecera">
      <div><p class="eyebrow">ADMINISTRACIÓN</p><h1>Calendario de reservaciones</h1><p class="texto-sm texto-dim">Consulta la ocupación por oficina y abre cualquier reserva.</p></div>
      <a class="btn btn-primario" href="#/admin/reservas">${raw(icono("mas", { size: 16 }))} Nueva reservación</a>
    </div>
    <div class="cal-toolbar">
      <div class="fila" style="gap:7px"><button class="btn btn-contorno btn-sm" data-hoy>Hoy</button><button class="btn btn-fantasma btn-icono btn-sm" data-mover="-1" aria-label="Anterior">‹</button><button class="btn btn-fantasma btn-icono btn-sm" data-mover="1" aria-label="Siguiente">›</button></div>
      <strong id="cal-rango"></strong>
      <div class="segmentado"><button data-vista="dia">Día</button><button data-vista="semana" aria-pressed="true">Semana</button><button data-vista="mes">Mes</button></div>
    </div>
    <div id="cal-contenido"><div class="cargando-centro"><div class="spinner"></div></div></div>
  </div></div>`;

  await cargar(contenedor);
  contenedor.addEventListener("click", async (e) => {
    const mover = e.target.closest("[data-mover]");
    if (mover) {
      const paso = Number(mover.dataset.mover);
      if (vista === "mes") ancla.setMonth(ancla.getMonth() + paso);
      else ancla.setDate(ancla.getDate() + paso * (vista === "semana" ? 7 : 1));
      return cargar(contenedor);
    }
    if (e.target.closest("[data-hoy]")) { ancla = new Date(); return cargar(contenedor); }
    const cambiar = e.target.closest("[data-vista]");
    if (cambiar) { vista = cambiar.dataset.vista; contenedor.querySelectorAll("[data-vista]").forEach((b) => b.setAttribute("aria-pressed", String(b === cambiar))); return cargar(contenedor); }
    const bloque = e.target.closest("[data-reserva]");
    if (bloque) verReserva(bloque.dataset.reserva);
  });
}

async function cargar(contenedor) {
  const inicio = vista === "mes" ? new Date(ancla.getFullYear(), ancla.getMonth(), 1) : inicioSemana(ancla);
  const fin = vista === "mes" ? new Date(ancla.getFullYear(), ancla.getMonth() + 1, 0, 23, 59, 59) : new Date(inicio.getTime() + 7 * 86400000 - 1);
  reservas = await api.adminReservas({ desde: inicio.toISOString(), hasta: fin.toISOString(), limite: 500 }).catch(() => []);
  pintar(contenedor);
}

function pintar(contenedor) {
  if (vista === "mes") return pintarMes(contenedor);
  const inicio = vista === "dia" ? new Date(ancla.setHours(0,0,0,0)) : inicioSemana(ancla);
  const dias = Array.from({ length: vista === "dia" ? 1 : 7 }, (_, i) => new Date(inicio.getTime() + i * 86400000));
  const fin = dias.at(-1);
  contenedor.querySelector("#cal-rango").textContent = vista === "dia"
    ? inicio.toLocaleDateString("es-MX", { weekday:"long", day:"numeric", month:"long", year:"numeric" })
    : `${inicio.getDate()}–${fin.getDate()} ${fin.toLocaleDateString("es-MX", { month:"long", year:"numeric" })}`;
  const horas = Array.from({ length: 13 }, (_, i) => i + 8);
  contenedor.querySelector("#cal-contenido").innerHTML = html`
    <div class="cal-semana" style="--dias:${dias.length}">
      <div class="cal-esquina"></div>${dias.map((d) => raw(`<div class="cal-dia-cab">${esc(d.toLocaleDateString("es-MX", { weekday:"short" }))}<strong>${d.getDate()}</strong></div>`))}
      <div class="cal-horas">${horas.map((h) => raw(`<span>${String(h).padStart(2,"0")}:00</span>`))}</div>
      ${dias.map((d) => raw(`<div class="cal-columna">${horas.map(() => '<i></i>').join("")}${bloquesDia(d)}</div>`))}
    </div>`;
}

function bloquesDia(dia) {
  return reservas.filter((r) => iso(new Date(r.inicio)) === iso(dia) && r.estado !== "cancelada").map((r) => {
    const ini = new Date(r.inicio); const fin = new Date(r.fin);
    const top = Math.max(0, ((ini.getHours() + ini.getMinutes()/60) - 8) * 58);
    const alto = Math.max(42, ((fin - ini) / 3600000) * 58 - 4);
    return `<button class="cal-reserva cal-${tonoReserva(r)}" style="top:${top}px;height:${alto}px" data-reserva="${esc(r.id)}"><strong>${esc(r.usuarios?.nombre || "Cliente")}</strong><span>${esc(r.espacios?.nombre || "Oficina")}</span><small>${ini.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}–${fin.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}</small></button>`;
  }).join("");
}

function pintarMes(contenedor) {
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
  const inicio = inicioSemana(primero);
  const dias = Array.from({length:42}, (_,i) => new Date(inicio.getTime()+i*86400000));
  contenedor.querySelector("#cal-rango").textContent = ancla.toLocaleDateString("es-MX", { month:"long", year:"numeric" });
  contenedor.querySelector("#cal-contenido").innerHTML = `<div class="cal-mes">${dias.map((d) => {
    const rs = reservas.filter((r) => iso(new Date(r.inicio)) === iso(d) && r.estado !== "cancelada");
    return `<button data-dia-mes="${iso(d)}" class="${d.getMonth() === ancla.getMonth() ? "" : "fuera"}"><strong>${d.getDate()}</strong>${rs.slice(0,3).map((r)=>`<span class="cal-${tonoReserva(r)}">${esc(r.espacios?.codigo || "Oficina")} · ${new Date(r.inicio).getHours()}:00</span>`).join("")}${rs.length>3?`<small>+${rs.length-3} más</small>`:""}</button>`;
  }).join("")}</div>`;
}

function verReserva(id) {
  const r = reservas.find((x) => String(x.id) === String(id)); if (!r) return;
  abrirHoja({ titulo: r.folio || "Detalle de reserva", contenido: html`<div class="lista tarjeta">
    ${fila("Cliente", r.usuarios?.nombre || r.usuarios?.email || "—")}${fila("Espacio", r.espacios?.nombre || "—")}${fila("Horario", `${fechaHora(r.inicio)} — ${new Date(r.fin).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}`)}${fila("Estado", r.estado)}${fila("Total", formatMoneda(r.total || 0))}
  </div>` });
}
const fila = (k,v) => html`<div class="lista-item"><span class="li-txt"><span class="li-sub">${k}</span><span class="li-titulo">${v}</span></span></div>`;
