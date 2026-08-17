/* ======================================================================
   admin/estadisticas.js — Analítica: ingresos, reservas, ocupación,
   espacios más solicitados, horarios pico y exportación a CSV.

   Las gráficas se dibujan con SVG en línea: sin librerías, ligeras y
   legibles en modo claro y oscuro.
   ====================================================================== */
import { html, raw, esc, formatMoneda, formatNumero, formatPorcentaje, isoFecha, fechaCorta } from "../../core/utils.js";
import { t } from "../../core/i18n.js";
import { icono } from "../../core/iconos.js";
import { toastOk, toastError, vacio } from "../../core/ui.js";
import api from "../../data/api.js";
import store from "../../core/store.js";

export const titulo = () => t("admin.estadisticas");

let datos = null;
let periodo = 30;

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <div class="fila-sep mb-4">
          <div class="segmentado">
            <button type="button" data-periodo="7" aria-pressed="${periodo === 7}">7 d</button>
            <button type="button" data-periodo="30" aria-pressed="${periodo === 30}">30 d</button>
            <button type="button" data-periodo="90" aria-pressed="${periodo === 90}">90 d</button>
            <button type="button" data-periodo="365" aria-pressed="${periodo === 365}">1 año</button>
          </div>
          <button type="button" class="btn btn-contorno btn-sm" data-exportar>
            ${raw(icono("descargar", { size: 15 }))} ${t("admin.exportar")}</button>
        </div>
        <div id="es-contenido">${raw('<div class="esqueleto esq-tarjeta" style="margin-bottom:12px"></div>'.repeat(4))}</div>
      </div>
    </div>`;

  await cargar(contenedor);

  contenedor.addEventListener("click", async (e) => {
    const p = e.target.closest("[data-periodo]");
    if (p) {
      periodo = Number(p.dataset.periodo);
      contenedor.querySelectorAll("[data-periodo]").forEach((b) => b.setAttribute("aria-pressed", String(b === p)));
      await cargar(contenedor);
      return;
    }
    if (e.target.closest("[data-exportar]")) exportarCSV();
  });
}

async function cargar(contenedor) {
  const caja = contenedor.querySelector("#es-contenido");
  caja.innerHTML = '<div class="cargando-centro"><div class="spinner"></div></div>';
  datos = await api.adminMetricas({ dias: periodo }).catch(() => null);

  if (!datos || (!datos.diarias.length && !datos.populares.length)) {
    caja.innerHTML = vacio({
      ico: "📊", titulo: "Todavía no hay datos",
      desc: "Las estadísticas se calculan a partir de las reservas registradas.",
    });
    return;
  }
  pintar(caja);
}

function pintar(caja) {
  const tot = datos.totales;
  const ocupacionMedia = calcularOcupacion();

  caja.innerHTML = html`
    <div class="grid-3 mb-6">
      ${kpi(formatMoneda(tot.ingresos), t("admin.ingresos"), "ok")}
      ${kpi(formatNumero(tot.reservas), t("admin.reservas"), "marca")}
      ${kpi(formatMoneda(tot.ticketPromedio), "Ticket promedio", "purple")}
      ${kpi(`${Math.round(tot.horas)} h`, "Horas vendidas", "marca")}
      ${kpi(formatPorcentaje(tot.tasaCancelacion, 1), "Cancelación", tot.tasaCancelacion > 0.15 ? "taken" : "neutro")}
      ${kpi(formatPorcentaje(ocupacionMedia, 0), t("admin.ocupacion"), "ok")}
    </div>

    <section class="seccion">
      <h2 class="seccion-titulo">Ingresos por día</h2>
      <div class="tarjeta tarjeta-pad">${raw(graficaArea(datos.diarias))}</div>
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Reservas por día</h2>
      <div class="tarjeta tarjeta-pad">${raw(graficaBarras(datos.diarias))}</div>
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">${t("admin.masReservadas")}</h2>
      <div class="tarjeta tarjeta-pad">${raw(rankingEspacios(datos.populares))}</div>
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">${t("admin.horariosPico")}</h2>
      <div class="tarjeta tarjeta-pad">${raw(mapaCalor(datos.pico))}</div>
    </section>`;
}

const kpi = (valor, etiqueta, tono) => html`
  <div class="tarjeta stat stat-kpi">
    <strong class="stat-valor">${valor}</strong>
    <span class="stat-etiqueta">${etiqueta}</span>
    <span class="stat-linea stat-${raw(tono)}"></span>
  </div>`;

function calcularOcupacion() {
  const reservables = store.get().espacios.filter((e) => e.reservable).length || 1;
  const horasDisponibles = reservables * 12 * periodo;   // 12 h reservables al día
  return Math.min(1, (datos.totales.horas || 0) / horasDisponibles);
}

/* ---------------------------------------------------------------------
   Gráficas SVG
   --------------------------------------------------------------------- */
function graficaArea(filas) {
  if (!filas.length) return '<p class="texto-sm texto-dim">Sin datos.</p>';
  const w = 640, h = 180, pad = 28;
  const valores = filas.map((f) => Number(f.ingresos || 0));
  const max = Math.max(1, ...valores);
  const paso = (w - pad * 2) / Math.max(1, filas.length - 1);

  const puntos = valores.map((v, i) => [pad + i * paso, h - pad - (v / max) * (h - pad * 2)]);
  const linea = puntos.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${linea} L${puntos[puntos.length - 1][0].toFixed(1)},${h - pad} L${pad},${h - pad} Z`;

  return `
  <div class="grafica-wrap">
    <svg viewBox="0 0 ${w} ${h}" class="grafica" role="img" aria-label="Ingresos por día">
      <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--marca)" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="var(--marca)" stop-opacity="0"/></linearGradient></defs>
      ${[0, 0.5, 1].map((f) => `<line x1="${pad}" y1="${h - pad - f * (h - pad * 2)}" x2="${w - pad}" y2="${h - pad - f * (h - pad * 2)}"
          stroke="var(--linea)" stroke-width="1" stroke-dasharray="3 4"/>`).join("")}
      <path d="${area}" fill="url(#ga)"/>
      <path d="${linea}" fill="none" stroke="var(--marca)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${puntos.filter((_, i) => i % Math.ceil(puntos.length / 12) === 0).map((p) =>
        `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="var(--marca)"/>`).join("")}
      <text x="${pad}" y="14" font-size="11" fill="var(--text-dim)">${esc(formatMoneda(max))}</text>
      <text x="${pad}" y="${h - 8}" font-size="11" fill="var(--text-dim)">${esc(fechaCorta(filas[0].dia))}</text>
      <text x="${w - pad}" y="${h - 8}" font-size="11" fill="var(--text-dim)" text-anchor="end">${esc(fechaCorta(filas[filas.length - 1].dia))}</text>
    </svg>
  </div>`;
}

function graficaBarras(filas) {
  if (!filas.length) return '<p class="texto-sm texto-dim">Sin datos.</p>';
  const w = 640, h = 160, pad = 26;
  const max = Math.max(1, ...filas.map((f) => Number(f.reservas || 0)));
  const ancho = (w - pad * 2) / filas.length;

  return `
  <div class="grafica-wrap">
    <svg viewBox="0 0 ${w} ${h}" class="grafica" role="img" aria-label="Reservas por día">
      ${filas.map((f, i) => {
        const alto = (Number(f.reservas) / max) * (h - pad * 2);
        const cancel = (Number(f.canceladas || 0) / max) * (h - pad * 2);
        const x = pad + i * ancho;
        return `<rect x="${(x + 1).toFixed(1)}" y="${(h - pad - alto).toFixed(1)}" width="${Math.max(1.5, ancho - 2).toFixed(1)}" height="${alto.toFixed(1)}"
                  rx="2" fill="var(--marca)" opacity="0.85"><title>${esc(fechaCorta(f.dia))}: ${f.reservas} reservas</title></rect>
                ${cancel > 0 ? `<rect x="${(x + 1).toFixed(1)}" y="${(h - pad - cancel).toFixed(1)}" width="${Math.max(1.5, ancho - 2).toFixed(1)}" height="${cancel.toFixed(1)}"
                  rx="2" fill="var(--taken)" opacity="0.8"/>` : ""}`;
      }).join("")}
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--linea-fuerte)" stroke-width="1"/>
    </svg>
    <div class="grafica-leyenda">
      <span><i class="punto" style="background:var(--marca)"></i>Reservas</span>
      <span><i class="punto" style="background:var(--taken)"></i>Canceladas</span>
    </div>
  </div>`;
}

function rankingEspacios(populares) {
  if (!populares.length) return '<p class="texto-sm texto-dim">Sin datos.</p>';
  const max = Math.max(1, ...populares.map((p) => Number(p.reservas || 0)));
  return populares.slice(0, 10).map((p, i) => html`
    <div class="barra-fila">
      <span class="rank-num">${i + 1}</span>
      <span class="texto-sm crece">${p.nombre}</span>
      <div class="barra" style="flex:1.6"><span style="width:${Math.round((Number(p.reservas) / max) * 100)}%"></span></div>
      <span class="mono texto-sm" style="min-width:88px;text-align:right">${formatMoneda(p.ingresos || 0)}</span>
    </div>`).join("");
}

function mapaCalor(pico) {
  if (!pico?.length) return '<p class="texto-sm texto-dim">Sin datos.</p>';
  const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const horas = [...new Set(pico.map((p) => p.hora))].sort();
  const max = Math.max(1, ...pico.map((p) => Number(p.reservas || 0)));
  const valor = (d, hr) => Number(pico.find((p) => p.dia_semana === d && p.hora === hr)?.reservas || 0);

  return `
  <div class="calor-wrap">
    <table class="calor">
      <thead><tr><th></th>${horas.map((hr) => `<th>${esc(hr.slice(0, 2))}</th>`).join("")}</tr></thead>
      <tbody>
        ${dias.map((nombre, d) => `<tr>
          <th>${nombre}</th>
          ${horas.map((hr) => {
            const v = valor(d, hr);
            const intensidad = v / max;
            return `<td><span class="calor-celda" style="opacity:${(0.12 + intensidad * 0.88).toFixed(2)}"
              title="${nombre} ${esc(hr)}: ${v} reservas"></span></td>`;
          }).join("")}
        </tr>`).join("")}
      </tbody>
    </table>
    <p class="texto-xs texto-dim mt-2">Cuanto más intenso el color, más solicitado ese horario.</p>
  </div>`;
}

/* ---------------------------------------------------------------------
   Exportación
   --------------------------------------------------------------------- */
function exportarCSV() {
  if (!datos) return;
  const filas = [["fecha", "reservas", "canceladas", "ingresos", "horas"]];
  for (const d of datos.diarias) {
    filas.push([d.dia, d.reservas, d.canceladas, Number(d.ingresos).toFixed(2), Number(d.horas).toFixed(2)]);
  }
  filas.push([]);
  filas.push(["espacio", "codigo", "reservas", "ingresos", "calificacion"]);
  for (const p of datos.populares) {
    filas.push([p.nombre, p.codigo, p.reservas, Number(p.ingresos).toFixed(2), p.calificacion]);
  }

  const csv = filas.map((f) => f.map((c) => {
    const s = String(c ?? "");
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `estadisticas-${isoFecha()}-${periodo}d.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toastOk("CSV descargado");
}
