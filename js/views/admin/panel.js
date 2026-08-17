/* Panel ejecutivo: métricas reales de Supabase, sin cifras inventadas. */
import { html, raw, esc, formatMoneda, formatNumero, formatPorcentaje, fechaHora } from "../../core/utils.js";
import { icono } from "../../core/iconos.js";
import { vacio } from "../../core/ui.js";
import api, { enModoDemo } from "../../data/api.js";
import store from "../../core/store.js";

export const titulo = "Dashboard";
export const subtitulo = () => store.get().organizacion?.nombre || "Smart Hub";

export async function render(contenedor) {
  contenedor.innerHTML = html`<div class="vista-scroll"><div class="vista-contenido admin-dashboard">
    <div class="admin-cabecera">
      <div><p class="eyebrow">ADMINISTRACIÓN</p><h1>Dashboard ejecutivo</h1><p class="texto-sm texto-dim">Ingresos, ocupación y actividad operativa en un solo lugar.</p></div>
      <div class="fila envolver"><a class="btn btn-contorno" href="#/admin/calendario">${raw(icono("calendario", { size: 16 }))} Ver calendario</a><a class="btn btn-primario" href="#/espacios">${raw(icono("mas", { size: 16 }))} Nueva reservación</a></div>
    </div>
    ${enModoDemo() ? raw(`<div class="aviso aviso-warm"><strong>Modo local.</strong> Conecta Supabase para compartir reservaciones, clientes y pagos entre dispositivos.</div>`) : ""}
    <div class="dashboard-kpis" id="ad-kpis">${raw('<div class="esqueleto" style="height:116px"></div>'.repeat(4))}</div>
    <div class="dashboard-grid">
      <section class="tarjeta tarjeta-pad dashboard-grafica"><div class="seccion-cab"><h2>Ingresos (MXN)</h2><span class="texto-xs texto-dim">Últimos 30 días</span></div><div id="ad-grafica" class="grafica-vacia"></div></section>
      <section class="tarjeta tarjeta-pad"><div class="seccion-cab"><h2>Reservaciones por espacio</h2><a class="enlace" href="#/admin/estadisticas">Ver reporte</a></div><div id="ad-ocupacion"></div></section>
      <section class="tarjeta tarjeta-pad"><div class="seccion-cab"><h2>Próximas reservaciones</h2><a class="enlace" href="#/admin/calendario">Ver calendario</a></div><div id="ad-proximas"></div></section>
      <section class="tarjeta tarjeta-pad"><div class="seccion-cab"><h2>Clientes recurrentes</h2><a class="enlace" href="#/admin/usuarios">Ver clientes</a></div><div id="ad-clientes"></div></section>
    </div>
    <section class="seccion mt-6"><h2 class="seccion-titulo">Operación rápida</h2><div class="grid-auto">
      ${acceso("/admin/calendario", "calendario", "Calendario", "Día, semana y mes")}
      ${acceso("/admin/reservas", "panel", "Reservaciones", "Buscar, confirmar o cancelar")}
      ${acceso("/admin/pagos", "tarjeta", "Pagos", "Clip Online y Clip Terminal")}
      ${acceso("/admin/usuarios", "personas", "Clientes", "Datos, reservas e historial")}
    </div></section>
  </div></div>`;

  const ahora = new Date().toISOString();
  const [metricas, proximas, recientes, espacios] = await Promise.all([
    api.adminMetricas({ dias: 30 }).catch(() => ({ diarias: [], populares: [], totales: {} })),
    api.adminReservas({ desde: ahora, limite: 12 }).catch(() => []),
    api.adminReservas({ limite: 500 }).catch(() => []),
    api.getEspacios().catch(() => []),
  ]);
  pintarKpis(contenedor, metricas, espacios);
  pintarGrafica(contenedor, metricas.diarias || []);
  pintarOcupacion(contenedor, metricas.populares || []);
  pintarProximas(contenedor, proximas);
  pintarClientes(contenedor, recientes);
}

const acceso = (ruta, ico, titulo, desc) => html`<a class="tarjeta tarjeta-pad canal" href="#${ruta}"><span class="canal-ico">${raw(icono(ico, { size: 19 }))}</span><strong>${titulo}</strong><span class="texto-sm texto-dim">${desc}</span></a>`;

function pintarKpis(contenedor, metricas, espacios) {
  const t = metricas.totales || {};
  const reservables = espacios.filter((e) => e.reservable).length || 1;
  const ocupacion = Math.min(1, Number(t.horas || 0) / (reservables * 11 * 30));
  contenedor.querySelector("#ad-kpis").innerHTML = [
    kpi("Ingresos del mes", formatMoneda(t.ingresos || 0), "wallet", "Facturación confirmada"),
    kpi("Reservaciones", formatNumero(t.reservas || 0), "calendario", `${formatNumero(t.canceladas || 0)} canceladas`),
    kpi("Horas ocupadas", `${formatNumero(t.horas || 0)} h`, "reloj", "Tiempo reservado"),
    kpi("Ocupación promedio", formatPorcentaje(ocupacion, 0), "grafica", "Capacidad estimada"),
  ].join("");
}

const kpi = (etiqueta, valor, ico, sub) => html`<article class="tarjeta tarjeta-pad dashboard-kpi"><span class="stat-ico stat-marca">${raw(icono(ico, { size: 18 }))}</span><span class="texto-xs texto-dim">${etiqueta}</span><strong>${valor}</strong><small>${sub}</small></article>`;

function pintarGrafica(contenedor, filas) {
  const caja = contenedor.querySelector("#ad-grafica");
  if (!filas.length || !filas.some((f) => Number(f.ingresos))) { caja.innerHTML = vacio({ ico: "📈", titulo: "Aún sin ingresos", desc: "La gráfica aparecerá con los primeros pagos aprobados." }); return; }
  const valores = filas.map((f) => Number(f.ingresos || 0));
  const max = Math.max(1, ...valores); const ancho = 720; const alto = 210;
  const puntos = valores.map((v, i) => `${(i / Math.max(1, valores.length - 1)) * ancho},${alto - (v / max) * (alto - 24)}`).join(" ");
  caja.innerHTML = `<svg class="dashboard-linea" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Ingresos diarios"><defs><linearGradient id="oro-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6aa43" stop-opacity=".36"/><stop offset="1" stop-color="#d6aa43" stop-opacity="0"/></linearGradient></defs><polygon points="0,${alto} ${puntos} ${ancho},${alto}" fill="url(#oro-area)"/><polyline points="${puntos}" fill="none" stroke="#e6bb55" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="grafica-leyenda"><span>${esc(filas[0]?.dia || "")}</span><strong>Máximo ${esc(formatMoneda(max))}</strong><span>${esc(filas.at(-1)?.dia || "")}</span></div>`;
}

function pintarOcupacion(contenedor, populares) {
  const caja = contenedor.querySelector("#ad-ocupacion");
  if (!populares.length) { caja.innerHTML = vacio({ ico: "📊", titulo: "Sin datos todavía", desc: "Aquí se compararán las cuatro oficinas." }); return; }
  const colores = ["#d6aa43", "#57a765", "#7b61b5", "#3269a8"];
  const total = populares.reduce((n, p) => n + Number(p.reservas || 0), 0) || 1;
  let acumulado = 0; const cortes = populares.slice(0, 4).map((p, i) => { const inicio = acumulado; acumulado += Number(p.reservas || 0) / total * 100; return `${colores[i]} ${inicio}% ${acumulado}%`; });
  caja.innerHTML = `<div class="dashboard-donut-wrap"><div class="dashboard-donut" style="background:conic-gradient(${cortes.join(",")})"><span>${formatNumero(total)}<small>reservas</small></span></div><div class="dashboard-leyenda">${populares.slice(0, 4).map((p, i) => `<div><i style="background:${colores[i]}"></i><span>${esc(p.nombre || "Oficina")}</span><strong>${Math.round(Number(p.reservas || 0) / total * 100)}%</strong></div>`).join("")}</div></div>`;
}

function pintarProximas(contenedor, reservas) {
  const lista = reservas.filter((r) => r.estado !== "cancelada").sort((a, b) => new Date(a.inicio) - new Date(b.inicio)).slice(0, 5);
  contenedor.querySelector("#ad-proximas").innerHTML = lista.length ? `<div class="dashboard-lista">${lista.map((r) => `<a href="#/admin/reservas?folio=${encodeURIComponent(r.folio || "")}"><span>${esc(fechaHora(r.inicio))}</span><strong>${esc(r.espacios?.nombre || "Oficina")}</strong><small>${esc(r.usuarios?.nombre || r.usuarios?.email || "Cliente")}</small></a>`).join("")}</div>` : vacio({ ico: "📅", titulo: "Sin próximas reservas" });
}

function pintarClientes(contenedor, reservas) {
  const mapa = new Map();
  reservas.filter((r) => r.estado !== "cancelada").forEach((r) => { const clave = r.usuario_id || r.usuarios?.email; if (!clave) return; const actual = mapa.get(clave) || { nombre: r.usuarios?.nombre || r.usuarios?.email || "Cliente", total: 0 }; actual.total++; mapa.set(clave, actual); });
  const lista = [...mapa.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  contenedor.querySelector("#ad-clientes").innerHTML = lista.length ? `<ol class="dashboard-ranking">${lista.map((u) => `<li><span>${esc(u.nombre)}</span><strong>${formatNumero(u.total)} reservas</strong></li>`).join("")}</ol>` : vacio({ ico: "👥", titulo: "Sin clientes recurrentes" });
}
