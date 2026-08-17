/* ======================================================================
   admin/promociones.js — Gestión de códigos de descuento.
   ====================================================================== */
import { html, raw, esc, formatMoneda, fechaCorta, isoFecha } from "../../core/utils.js";
import { t } from "../../core/i18n.js";
import { icono } from "../../core/iconos.js";
import { toastOk, toastError, confirmar, abrirHoja, conCarga, vacio, copiar } from "../../core/ui.js";
import api from "../../data/api.js";

export const titulo = () => t("admin.promociones");

let promos = [];

const TIPOS = [
  ["porcentaje", "Porcentaje de descuento", "%"],
  ["monto", "Monto fijo", "$"],
  ["horas_gratis", "Horas de cortesía", "h"],
];

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <div class="fila-sep mb-4">
          <span class="texto-sm texto-dim" id="pr-conteo"></span>
          <button type="button" class="btn btn-primario btn-sm" data-nueva>
            ${raw(icono("mas", { size: 16 }))} Nueva promoción</button>
        </div>
        <div id="pr-lista">${raw('<div class="esqueleto esq-tarjeta" style="height:88px;margin-bottom:10px"></div>'.repeat(3))}</div>
      </div>
    </div>`;

  await cargar(contenedor);

  contenedor.addEventListener("click", async (e) => {
    if (e.target.closest("[data-nueva]")) return editor(contenedor, null);
    const editar = e.target.closest("[data-editar]");
    if (editar) return editor(contenedor, promos.find((p) => String(p.id) === editar.dataset.editar));
    const borrar = e.target.closest("[data-borrar]");
    if (borrar) return eliminar(contenedor, borrar.dataset.borrar);
    const cop = e.target.closest("[data-copiar]");
    if (cop) return copiar(cop.dataset.copiar, `Código ${cop.dataset.copiar} copiado`);
  });
}

async function cargar(contenedor) {
  promos = await api.getPromociones().catch(() => []);
  pintar(contenedor);
}

function pintar(contenedor) {
  contenedor.querySelector("#pr-conteo").textContent = `${promos.length} promoción(es) activa(s)`;
  const caja = contenedor.querySelector("#pr-lista");
  if (!promos.length) {
    caja.innerHTML = vacio({ ico: "🎟️", titulo: "Sin promociones", desc: "Crea un código para atraer nuevas reservas." });
    return;
  }
  caja.innerHTML = promos.map((p) => {
    const tipo = TIPOS.find(([v]) => v === p.tipo) || TIPOS[0];
    const valor = p.tipo === "porcentaje" ? `${p.valor} %` : p.tipo === "monto" ? formatMoneda(p.valor) : `${p.valor} h`;
    const usos = p.usos_maximos ? `${p.usos_actuales}/${p.usos_maximos}` : `${p.usos_actuales}`;
    const vencida = p.termina && new Date(p.termina) < new Date();
    return html`
      <article class="tarjeta tarjeta-pad mb-2">
        <div class="fila-sep">
          <div class="crece">
            <div class="fila" style="gap:8px">
              <button type="button" class="promo-codigo" data-copiar="${p.codigo}">
                <span class="mono">${p.codigo}</span>${raw(icono("copiar", { size: 13 }))}</button>
              <span class="chip chip-${raw(vencida ? "taken" : "ok")}">${vencida ? "Vencida" : "Activa"}</span>
            </div>
            <strong class="mt-2" style="display:block">${p.titulo}</strong>
            <p class="texto-sm texto-dim">${p.descripcion || ""}</p>
            <p class="texto-xs texto-suave mt-2">
              ${tipo[1]}: <strong>${valor}</strong> · usos: ${usos}
              ${p.termina ? ` · vence ${fechaCorta(p.termina)}` : " · sin vencimiento"}
              ${Number(p.minimo_compra) > 0 ? ` · mínimo ${formatMoneda(p.minimo_compra)}` : ""}
            </p>
          </div>
          <div class="ae-acciones">
            <button type="button" class="btn btn-fantasma btn-icono btn-sm" data-editar="${p.id}" aria-label="Editar">${raw(icono("lapiz", { size: 15 }))}</button>
            <button type="button" class="btn btn-fantasma btn-icono btn-sm" data-borrar="${p.id}" aria-label="Eliminar" style="color:var(--taken)">${raw(icono("basura", { size: 15 }))}</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

function editor(contenedor, promo) {
  const esNueva = !promo;
  const p = promo || {
    codigo: "", titulo: "", descripcion: "", tipo: "porcentaje", valor: 10,
    minimo_compra: 0, termina: "", usos_maximos: null, usos_por_usuario: 1, activa: true,
  };

  const { el, cerrar } = abrirHoja({
    titulo: esNueva ? "Nueva promoción" : `Editar ${p.codigo}`,
    contenido: html`
      <div class="grid-2">
        <div class="campo"><label for="p-codigo">Código</label>
          <input id="p-codigo" type="text" value="${esc(p.codigo)}" style="text-transform:uppercase" maxlength="24" required></div>
        <div class="campo"><label for="p-tipo">Tipo</label>
          <select id="p-tipo">${TIPOS.map(([v, l]) => raw(`<option value="${v}" ${p.tipo === v ? "selected" : ""}>${esc(l)}</option>`))}</select></div>
      </div>
      <div class="campo"><label for="p-titulo">Título</label>
        <input id="p-titulo" type="text" value="${esc(p.titulo)}" required></div>
      <div class="campo"><label for="p-desc">Descripción</label>
        <textarea id="p-desc" rows="2">${esc(p.descripcion || "")}</textarea></div>
      <div class="grid-2">
        <div class="campo"><label for="p-valor">Valor</label>
          <input id="p-valor" type="number" min="0" step="1" value="${p.valor}"></div>
        <div class="campo"><label for="p-minimo">Compra mínima (MXN)</label>
          <input id="p-minimo" type="number" min="0" step="50" value="${p.minimo_compra || 0}"></div>
      </div>
      <div class="grid-2">
        <div class="campo"><label for="p-termina">Vence el</label>
          <input id="p-termina" type="date" value="${p.termina ? isoFecha(p.termina) : ""}"></div>
        <div class="campo"><label for="p-usos">Usos máximos (vacío = ilimitado)</label>
          <input id="p-usos" type="number" min="1" value="${p.usos_maximos ?? ""}"></div>
      </div>
      <label class="switch"><input type="checkbox" id="p-activa" ${p.activa !== false ? "checked" : ""}>
        <span class="switch-pista"></span><span class="texto-sm">Promoción activa</span></label>`,
    pie: html`
      <button type="button" class="btn btn-contorno" data-cerrar>${t("app.cancelar")}</button>
      <button type="button" class="btn btn-primario" data-guardar>${t("app.guardar")}</button>`,
  });

  el.querySelector("[data-cerrar]").addEventListener("click", () => cerrar());
  el.querySelector("[data-guardar]").addEventListener("click", async (ev) => {
    const codigo = el.querySelector("#p-codigo").value.trim().toUpperCase();
    const titulo_ = el.querySelector("#p-titulo").value.trim();
    if (!codigo) return toastError("El código es obligatorio.");
    if (!titulo_) return toastError("El título es obligatorio.");

    const usos = el.querySelector("#p-usos").value;
    const termina = el.querySelector("#p-termina").value;

    try {
      await conCarga(ev.currentTarget, api.adminGuardarPromocion({
        ...(esNueva ? {} : { id: p.id }),
        codigo, titulo: titulo_,
        descripcion: el.querySelector("#p-desc").value.trim() || null,
        tipo: el.querySelector("#p-tipo").value,
        valor: Number(el.querySelector("#p-valor").value),
        minimo_compra: Number(el.querySelector("#p-minimo").value) || 0,
        termina: termina ? new Date(`${termina}T23:59:59`).toISOString() : null,
        usos_maximos: usos === "" ? null : Number(usos),
        activa: el.querySelector("#p-activa").checked,
      }));
      cerrar();
      await cargar(contenedor);
      toastOk(esNueva ? "Promoción creada" : "Cambios guardados");
    } catch (e) { toastError(e.message); }
  });
}

async function eliminar(contenedor, id) {
  const ok = await confirmar({ titulo: "Eliminar promoción", mensaje: "Dejará de poder aplicarse.", peligro: true, aceptar: t("app.eliminar") });
  if (!ok) return;
  try {
    await api.adminBorrarPromocion(id);
    await cargar(contenedor);
    toastOk("Promoción eliminada");
  } catch (e) { toastError(e.message); }
}
