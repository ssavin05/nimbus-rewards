/* Pagos administrativos: lectura del historial real de cobros. */
import { html, raw, esc, formatMoneda, fechaHora, normalizar, debounce } from "../../core/utils.js";
import { icono } from "../../core/iconos.js";
import { vacio, abrirHoja } from "../../core/ui.js";
import { getDB } from "../../data/db.js";
import api from "../../data/api.js";

export const titulo = "Pagos";
let pagos = [];
let filtro = "todos";
let texto = "";

export async function render(contenedor) {
  contenedor.innerHTML = html`<div class="vista-scroll"><div class="vista-contenido admin-pagos">
    <div class="admin-cabecera"><div><p class="eyebrow">ADMINISTRACIÓN</p><h1>Pagos</h1><p class="texto-sm texto-dim">Clip Online para reservas digitales y Clip Terminal para cobros presenciales.</p></div></div>
    <div class="pagos-canales">
      <article class="tarjeta tarjeta-pad"><span class="metodo-clip">CLIP</span><div><strong>Clip Online</strong><small>El cliente paga al completar su reservación en la web o app.</small></div><span class="chip chip-ok">Conectado</span></article>
      <article class="tarjeta tarjeta-pad"><span class="metodo-clip">CLIP</span><div><strong>Clip Terminal</strong><small>Cobros realizados físicamente en recepción; conserva aquí su referencia.</small></div><span class="chip chip-neutro">Presencial</span></article>
    </div>
    <div class="admin-filtros"><div class="segmentado"><button data-filtro="todos" aria-pressed="true">Todos</button><button data-filtro="pendiente">Pendientes</button><button data-filtro="aprobado">Pagados</button><button data-filtro="reembolsado">Reembolsados</button></div><div class="buscador"><span class="ci">${raw(icono("buscar",{size:16}))}</span><input id="ap-busq" type="search" placeholder="Buscar pago…"></div></div>
    <div id="ap-tabla"><div class="cargando-centro"><div class="spinner"></div></div></div>
  </div></div>`;
  pagos = await cargarPagos(); pintar(contenedor);
  contenedor.querySelector("#ap-busq").addEventListener("input", debounce((e)=>{texto=e.target.value;pintar(contenedor);},180));
  contenedor.addEventListener("click", (e)=>{
    const f=e.target.closest("[data-filtro]"); if(f){filtro=f.dataset.filtro;contenedor.querySelectorAll("[data-filtro]").forEach(b=>b.setAttribute("aria-pressed",String(b===f)));pintar(contenedor);return;}
    const d=e.target.closest("[data-pago]"); if(d) detalle(d.dataset.pago);
  });
}

async function cargarPagos() {
  try {
    const db = await getDB();
    if (db) {
      const { data, error } = await db.from("pagos").select("*, reservas(folio, usuarios(nombre,email), espacios(nombre,codigo))").order("creado_en",{ascending:false}).limit(300);
      if (!error) return data || [];
    }
  } catch {}
  return api.getPagos().catch(()=>[]);
}

function pintar(contenedor){
  const q=normalizar(texto); const lista=pagos.filter(p=>(filtro==="todos"||p.estado===filtro)&&(!q||normalizar(`${p.folio} ${p.reservas?.folio} ${p.reservas?.usuarios?.nombre} ${p.metodo}`).includes(q)));
  const caja=contenedor.querySelector("#ap-tabla"); if(!lista.length){caja.innerHTML=vacio({ico:"🧾",titulo:"Sin pagos",desc:"Los cobros de Clip aparecerán aquí."});return;}
  caja.innerHTML=html`<div class="tabla-scroll"><table class="tabla-admin"><thead><tr><th>Fecha</th><th>Reservación</th><th>Cliente</th><th>Método</th><th>Total</th><th>Estatus</th><th></th></tr></thead><tbody>${lista.map(p=>raw(`<tr><td>${esc(fechaHora(p.creado_en))}</td><td class="mono">${esc(p.reservas?.folio||p.folio||"—")}</td><td>${esc(p.reservas?.usuarios?.nombre||"Cliente")}</td><td><span class="metodo-clip">CLIP</span> ${esc(etiquetaMetodo(p.metodo))}</td><td class="mono"><strong>${esc(formatMoneda(p.monto||0))}</strong></td><td><span class="chip chip-${p.estado==="aprobado"?"ok":p.estado==="pendiente"?"warm":"neutro"}">${esc(p.estado||"pendiente")}</span></td><td><button class="btn btn-fantasma btn-icono btn-sm" data-pago="${esc(p.id)}" aria-label="Ver detalle">${icono("info",{size:15})}</button></td></tr>`)).join("")}</tbody></table></div>`;
}
const etiquetaMetodo=(m)=>({clip:"Clip Online",clip_terminal:"Clip Terminal",terminal:"Clip Terminal",efectivo:"Efectivo / terminal (histórico)",stripe:"Stripe (histórico)",mercadopago:"Mercado Pago (histórico)",paypal:"PayPal (histórico)"}[m]||m||"—");
function detalle(id){const p=pagos.find(x=>String(x.id)===String(id));if(!p)return;abrirHoja({titulo:p.folio||"Detalle de pago",contenido:html`<div class="pago-detalle"><div>${fila("Reservación",p.reservas?.folio||"—")}${fila("Cliente",p.reservas?.usuarios?.nombre||"—")}${fila("Método",etiquetaMetodo(p.metodo))}${fila("Referencia",p.referencia||p.id)}</div><div class="pago-totales">${fila("Subtotal",formatMoneda((p.monto||0)/1.16))}${fila("IVA (16%)",formatMoneda((p.monto||0)-(p.monto||0)/1.16))}${fila("Total",formatMoneda(p.monto||0))}${fila("Estatus",p.estado||"pendiente")}</div></div>`});}
const fila=(k,v)=>html`<div class="fila-sep pago-fila"><span class="texto-dim">${k}</span><strong>${v}</strong></div>`;
