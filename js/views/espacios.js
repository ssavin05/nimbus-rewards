/* ======================================================================
   espacios.js — Catálogo completo con filtros y ordenamiento.
   ====================================================================== */
import { html, raw, esc, isoFecha, debounce, formatMoneda } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { vacio, toastError, toastOk, abrirHoja } from "../core/ui.js";
import api from "../data/api.js";
import { tarjetaEspacio } from "./componentes.js";
import { buscar } from "../ai/busqueda.js";

export const titulo = () => t("admin.espacios");

const filtros = {
  texto: "", tipo: "", capacidadMin: 0, precioMax: 0,
  amenidades: new Set(), soloLibres: false, orden: "recomendado",
};

let datos = { espacios: [], disponibilidad: {}, amenidades: [] };

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <h1 class="sr-only">${t("admin.espacios")}</h1>
        <div class="buscador" role="search">
          ${raw(icono("buscar", { size: 18, clase: "ci" }))}
          <input id="cat-busq" type="search" placeholder="${t("home.buscar")}" value="${filtros.texto}">
          <button type="button" class="btn btn-fantasma btn-icono btn-sm" id="cat-filtros" aria-label="Filtros">
            ${raw(icono("filtro", { size: 18 }))}
          </button>
        </div>

        <div class="fila-sep mt-4">
          <span class="texto-sm texto-dim" id="cat-conteo"></span>
          <select id="cat-orden" class="input" aria-label="Ordenar los espacios"
                  style="width:auto;min-height:36px;font-size:var(--txt-sm)">
            <option value="recomendado">Recomendados</option>
            <option value="precio-asc">Precio: menor a mayor</option>
            <option value="precio-desc">Precio: mayor a menor</option>
            <option value="capacidad">Mayor capacidad</option>
            <option value="calificacion">Mejor calificados</option>
            <option value="nombre">Nombre (A–Z)</option>
          </select>
        </div>

        <div id="cat-chips" class="cinta mt-2"></div>

        <div class="grid-auto mt-4" id="cat-lista">
          ${raw('<div class="esqueleto esq-tarjeta"></div>'.repeat(6))}
        </div>
      </div>
    </div>`;

  const [espacios, disponibilidad, amenidades] = await Promise.all([
    api.getEspacios(),
    api.getDisponibilidadMapa(isoFecha()).then((m) => m || {}).catch(() => ({})),
    api.getAmenidades().catch(() => []),
  ]);
  datos = { espacios: espacios.filter((e) => api.esReservableV1(e) && tieneFoto(e)), disponibilidad, amenidades };

  contenedor.querySelector("#cat-orden").value = filtros.orden;
  await pintar(contenedor);

  contenedor.querySelector("#cat-busq").addEventListener("input", debounce((e) => {
    filtros.texto = e.target.value.trim();
    pintar(contenedor);
  }, 220));

  contenedor.querySelector("#cat-orden").addEventListener("change", (e) => {
    filtros.orden = e.target.value;
    pintar(contenedor);
  });

  contenedor.querySelector("#cat-filtros").addEventListener("click", () => abrirFiltros(contenedor));

  contenedor.addEventListener("click", async (e) => {
    const quitar = e.target.closest("[data-quitar]");
    if (quitar) {
      const { quitar: q } = quitar.dataset;
      if (q === "tipo") filtros.tipo = "";
      else if (q === "capacidad") filtros.capacidadMin = 0;
      else if (q === "precio") filtros.precioMax = 0;
      else if (q === "libres") filtros.soloLibres = false;
      else filtros.amenidades.delete(q);
      return pintar(contenedor);
    }
    const fav = e.target.closest("[data-fav]");
    if (fav) {
      e.preventDefault();
      try {
        const activo = await api.alternarFavorito(fav.dataset.fav);
        fav.setAttribute("aria-pressed", String(activo));
        fav.innerHTML = icono(activo ? "corazonLleno" : "corazon", { size: 18 });
        toastOk(activo ? t("favoritos.agregado") : t("favoritos.quitado"));
      } catch (err) { toastError(err.message); }
    }
  });
}

async function pintar(contenedor) {
  let lista = [...datos.espacios];

  if (filtros.texto) {
    const res = await buscar(filtros.texto, lista, datos.disponibilidad);
    lista = res.map((r) => r.espacio);
  }
  if (filtros.tipo) lista = lista.filter((e) => e.tipo === filtros.tipo);
  if (filtros.capacidadMin) lista = lista.filter((e) => Number(e.capacidad) >= filtros.capacidadMin);
  if (filtros.precioMax) lista = lista.filter((e) => Number(e.precio_hora) <= filtros.precioMax);
  if (filtros.amenidades.size) {
    lista = lista.filter((e) => [...filtros.amenidades].every((a) => (e.amenidades || []).includes(a)));
  }
  if (filtros.soloLibres) lista = lista.filter((e) => (datos.disponibilidad[e.id]?.libres || 0) > 0);

  if (filtros.orden === "precio-asc") lista.sort((a, b) => Number(a.precio_hora) - Number(b.precio_hora));
  else if (filtros.orden === "precio-desc") lista.sort((a, b) => Number(b.precio_hora) - Number(a.precio_hora));
  else if (filtros.orden === "capacidad") lista.sort((a, b) => Number(b.capacidad) - Number(a.capacidad));
  else if (filtros.orden === "calificacion") lista.sort((a, b) => Number(b.calificacion) - Number(a.calificacion));
  else if (filtros.orden === "nombre") lista.sort((a, b) => a.nombre.localeCompare(b.nombre));

  contenedor.querySelector("#cat-conteo").textContent =
    `${lista.length} espacio${lista.length === 1 ? "" : "s"}`;

  contenedor.querySelector("#cat-chips").innerHTML = chipsActivos();

  contenedor.querySelector("#cat-lista").innerHTML = lista.length
    ? lista.map((e) => tarjetaEspacio(e, { disponibilidad: datos.disponibilidad[e.id] })).join("")
    : vacio({ ico: "🔍", titulo: "Sin coincidencias", desc: "Prueba quitando algún filtro o cambiando la fecha." });
}

const ETIQUETA_TIPO = {
  oficina: "🏢 Oficinas",
  sala_juntas: "📊 Salas de juntas",
  coworking: "🧑‍💻 Coworking",
  auditorio: "🎤 Auditorio",
};

function chipsActivos() {
  const chips = [];
  const TIPOS = Object.fromEntries(Object.entries(ETIQUETA_TIPO).map(([k, v]) => [k, v.replace(/^[^ ]+ /, "")]));
  if (filtros.tipo) chips.push(["tipo", TIPOS[filtros.tipo] || filtros.tipo]);
  if (filtros.capacidadMin) chips.push(["capacidad", `${filtros.capacidadMin}+ personas`]);
  if (filtros.precioMax) chips.push(["precio", `Hasta ${formatMoneda(filtros.precioMax)}/h`]);
  if (filtros.soloLibres) chips.push(["libres", "Con horarios libres"]);
  for (const a of filtros.amenidades) {
    const def = datos.amenidades.find((x) => x.clave === a);
    chips.push([a, `${def?.icono || ""} ${def?.etiqueta || a}`.trim()]);
  }
  return chips.map(([k, txt]) =>
    `<button type="button" class="chip chip-activo" data-quitar="${esc(k)}">${esc(txt)} ${icono("cerrar", { size: 12 })}</button>`
  ).join("");
}

function tieneFoto(espacio) {
  return Boolean(espacio?.portada || espacio?.fotos?.some((f) => f?.url && !f?.es_360));
}

function abrirFiltros(contenedor) {
  // No enseñamos categorías vacías. En V1 el catálogo comercial actual
  // son cuatro oficinas; si mañana se activa una sala o coworking, la
  // opción aparece sola porque viene del catálogo real.
  const tiposPresentes = [...new Set(datos.espacios.map((e) => e.tipo))];
  const TIPOS = [
    ["", "Todos"],
    ...tiposPresentes.map((tipo) => [tipo, ETIQUETA_TIPO[tipo] || tipo]),
  ];

  const { el, cerrar } = abrirHoja({
    titulo: "Filtros",
    contenido: html`
      <div class="campo">
        <label for="f-tipo">Tipo de espacio</label>
        <select id="f-tipo">${TIPOS.map(([v, txt]) => raw(`<option value="${v}" ${filtros.tipo === v ? "selected" : ""}>${esc(txt)}</option>`))}</select>
      </div>

      <div class="campo">
        <label for="f-cap">Capacidad mínima: <span id="f-cap-val">${filtros.capacidadMin || "cualquiera"}</span></label>
        <input id="f-cap" type="range" min="0" max="20" step="1" value="${filtros.capacidadMin}">
      </div>

      <div class="campo">
        <label for="f-precio">Precio máximo por hora: <span id="f-precio-val">${filtros.precioMax ? formatMoneda(filtros.precioMax) : "sin límite"}</span></label>
        <input id="f-precio" type="range" min="0" max="600" step="10" value="${filtros.precioMax}">
      </div>

      <label class="switch mb-4">
        <input type="checkbox" id="f-libres" ${filtros.soloLibres ? "checked" : ""}>
        <span class="switch-pista"></span>
        <span class="texto-sm">Sólo con horarios libres hoy</span>
      </label>

      <div class="campo">
        <span class="etiqueta">${t("espacio.amenidades")}</span>
        <div class="fila envolver" style="gap:8px">
          ${datos.amenidades.map((a) => raw(
            `<button type="button" class="chip" data-amenidad="${esc(a.clave)}" aria-pressed="${filtros.amenidades.has(a.clave)}">
               <span aria-hidden="true">${esc(a.icono)}</span>${esc(a.etiqueta)}</button>`))}
        </div>
      </div>`,
    pie: html`
      <button type="button" class="btn btn-contorno" data-limpiar>Limpiar</button>
      <button type="button" class="btn btn-primario" data-aplicar>Ver resultados</button>`,
  });

  el.addEventListener("click", (e) => {
    const am = e.target.closest("[data-amenidad]");
    if (am) {
      const k = am.dataset.amenidad;
      filtros.amenidades.has(k) ? filtros.amenidades.delete(k) : filtros.amenidades.add(k);
      am.setAttribute("aria-pressed", String(filtros.amenidades.has(k)));
      return;
    }
    if (e.target.closest("[data-limpiar]")) {
      filtros.tipo = ""; filtros.capacidadMin = 0; filtros.precioMax = 0;
      filtros.amenidades.clear(); filtros.soloLibres = false;
      cerrar(); pintar(contenedor); return;
    }
    if (e.target.closest("[data-aplicar]")) {
      filtros.tipo = el.querySelector("#f-tipo").value;
      filtros.capacidadMin = Number(el.querySelector("#f-cap").value);
      filtros.precioMax = Number(el.querySelector("#f-precio").value);
      filtros.soloLibres = el.querySelector("#f-libres").checked;
      cerrar(); pintar(contenedor);
    }
  });

  el.querySelector("#f-cap").addEventListener("input", (e) => {
    el.querySelector("#f-cap-val").textContent = e.target.value === "0" ? "cualquiera" : e.target.value;
  });
  el.querySelector("#f-precio").addEventListener("input", (e) => {
    el.querySelector("#f-precio-val").textContent = e.target.value === "0" ? "sin límite" : formatMoneda(e.target.value);
  });
}
