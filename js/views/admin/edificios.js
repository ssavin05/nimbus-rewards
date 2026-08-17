/* ======================================================================
   admin/edificios.js — Sucursales, edificios y pisos (escalabilidad
   multiedificio y multiempresa).
   ====================================================================== */
import { html, raw, esc } from "../../core/utils.js";
import { t } from "../../core/i18n.js";
import { icono } from "../../core/iconos.js";
import { toastOk, toastError, abrirHoja, conCarga, vacio } from "../../core/ui.js";
import api from "../../data/api.js";
import store from "../../core/store.js";
import { ENVOLVENTE } from "../../data/planta.js";

export const titulo = () => t("admin.edificios");

let sedes = [];
let edificios = [];

export async function render(contenedor) {
  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <section class="seccion">
          <div class="seccion-cab">
            <h2>${t("admin.sedes")}</h2>
            <button type="button" class="btn btn-contorno btn-sm" data-nueva-sede>${raw(icono("mas", { size: 15 }))} Nueva sede</button>
          </div>
          <div id="ed-sedes">${raw('<div class="esqueleto esq-linea" style="height:56px"></div>')}</div>
        </section>

        <section class="seccion">
          <div class="seccion-cab">
            <h2>Edificios y pisos</h2>
            <button type="button" class="btn btn-contorno btn-sm" data-nuevo-edificio>${raw(icono("mas", { size: 15 }))} Nuevo edificio</button>
          </div>
          <div id="ed-edificios">${raw('<div class="esqueleto esq-tarjeta"></div>')}</div>
        </section>
      </div>
    </div>`;

  await cargar(contenedor);

  contenedor.addEventListener("click", (e) => {
    if (e.target.closest("[data-nueva-sede]")) return editorSede(contenedor, null);
    if (e.target.closest("[data-nuevo-edificio]")) return editorEdificio(contenedor, null);
    const s = e.target.closest("[data-sede]");
    if (s) return editorSede(contenedor, sedes.find((x) => String(x.id) === s.dataset.sede));
    const ed = e.target.closest("[data-edificio]");
    if (ed) return editorEdificio(contenedor, edificios.find((x) => String(x.id) === ed.dataset.edificio));
    const piso = e.target.closest("[data-piso]");
    if (piso) return editorPiso(contenedor, piso.dataset.piso, null);
    const nuevoPiso = e.target.closest("[data-nuevo-piso]");
    if (nuevoPiso) return editorPiso(contenedor, nuevoPiso.dataset.nuevoPiso, null);
  });
}

async function cargar(contenedor) {
  [sedes, edificios] = await Promise.all([
    api.getSedes().catch(() => []),
    api.getEdificios().catch(() => []),
  ]);

  const cajaSedes = contenedor.querySelector("#ed-sedes");
  cajaSedes.innerHTML = sedes.length
    ? `<div class="lista tarjeta">${sedes.map((s) => html`
        <button type="button" class="lista-item" data-sede="${s.id}">
          <span class="li-ico">${raw(icono("ubicacion", { size: 16 }))}</span>
          <span class="li-txt"><span class="li-titulo">${s.nombre}</span>
            <span class="li-sub">${s.direccion || ""}${s.ciudad ? ` · ${s.ciudad}` : ""}</span></span>
          <span class="li-fin">${raw(icono("lapiz", { size: 15 }))}</span>
        </button>`).join("")}</div>`
    : vacio({ ico: "📍", titulo: "Sin sucursales", desc: "Crea la primera para agrupar edificios." });

  const cajaEd = contenedor.querySelector("#ed-edificios");
  cajaEd.innerHTML = edificios.length
    ? edificios.map((e) => html`
        <article class="tarjeta tarjeta-pad mb-2">
          <div class="fila-sep">
            <div class="crece">
              <strong>${e.nombre}</strong>
              <p class="texto-sm texto-dim">${e.descripcion || ""}</p>
              <p class="texto-xs texto-suave mono">${e.ancho_m} × ${e.fondo_m} m</p>
            </div>
            <button type="button" class="btn btn-fantasma btn-icono btn-sm" data-edificio="${e.id}" aria-label="Editar">${raw(icono("lapiz", { size: 15 }))}</button>
          </div>
          <div class="fila envolver mt-4" style="gap:6px">
            ${(e.pisos || []).map((p) => raw(`<span class="chip">${icono("panel", { size: 12 })} ${esc(p.nombre)}</span>`))}
            <button type="button" class="chip" data-nuevo-piso="${e.id}">${raw(icono("mas", { size: 12 }))} Piso</button>
          </div>
        </article>`).join("")
    : vacio({ ico: "🏗️", titulo: "Sin edificios", desc: "Crea uno para empezar a colocar espacios." });
}

function editorSede(contenedor, sede) {
  const esNueva = !sede;
  const s = sede || { nombre: "", slug: "", direccion: "", ciudad: "", estado: "", telefono: "", email: "", activa: true };

  const { el, cerrar } = abrirHoja({
    titulo: esNueva ? "Nueva sucursal" : `Editar ${s.nombre}`,
    contenido: html`
      <div class="campo"><label for="s-nombre">Nombre</label><input id="s-nombre" type="text" value="${esc(s.nombre)}" required></div>
      <div class="campo"><label for="s-dir">Dirección</label><input id="s-dir" type="text" value="${esc(s.direccion || "")}"></div>
      <div class="grid-2">
        <div class="campo"><label for="s-ciudad">Ciudad</label><input id="s-ciudad" type="text" value="${esc(s.ciudad || "")}"></div>
        <div class="campo"><label for="s-estado">Estado</label><input id="s-estado" type="text" value="${esc(s.estado || "")}"></div>
      </div>
      <div class="grid-2">
        <div class="campo"><label for="s-tel">Teléfono</label><input id="s-tel" type="tel" value="${esc(s.telefono || "")}"></div>
        <div class="campo"><label for="s-mail">Correo</label><input id="s-mail" type="email" value="${esc(s.email || "")}"></div>
      </div>`,
    pie: html`<button type="button" class="btn btn-contorno" data-cerrar>${t("app.cancelar")}</button>
      <button type="button" class="btn btn-primario" data-guardar>${t("app.guardar")}</button>`,
  });

  el.querySelector("[data-cerrar]").addEventListener("click", () => cerrar());
  el.querySelector("[data-guardar]").addEventListener("click", async (ev) => {
    const nombre = el.querySelector("#s-nombre").value.trim();
    if (!nombre) return toastError("El nombre es obligatorio.");
    try {
      await conCarga(ev.currentTarget, api.adminGuardarSede({
        ...(esNueva ? {} : { id: s.id }),
        nombre,
        slug: s.slug || nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-"),
        direccion: el.querySelector("#s-dir").value.trim(),
        ciudad: el.querySelector("#s-ciudad").value.trim(),
        estado: el.querySelector("#s-estado").value.trim(),
        telefono: el.querySelector("#s-tel").value.trim(),
        email: el.querySelector("#s-mail").value.trim(),
      }));
      cerrar();
      await cargar(contenedor);
      toastOk(esNueva ? "Sucursal creada" : "Cambios guardados");
    } catch (e) { toastError(e.message); }
  });
}

function editorEdificio(contenedor, edificio) {
  const esNuevo = !edificio;
  const e = edificio || { nombre: "", descripcion: "", ancho_m: ENVOLVENTE.ancho, fondo_m: ENVOLVENTE.fondo, sede_id: sedes[0]?.id || null };

  const { el, cerrar } = abrirHoja({
    titulo: esNuevo ? "Nuevo edificio" : `Editar ${e.nombre}`,
    contenido: html`
      <div class="campo"><label for="e-nombre">Nombre</label><input id="e-nombre" type="text" value="${esc(e.nombre)}" required></div>
      <div class="campo"><label for="e-desc">Descripción</label><textarea id="e-desc" rows="2">${esc(e.descripcion || "")}</textarea></div>
      <div class="campo"><label for="e-sede">Sucursal</label>
        <select id="e-sede">${sedes.map((s) => raw(`<option value="${esc(s.id)}" ${e.sede_id === s.id ? "selected" : ""}>${esc(s.nombre)}</option>`))}</select></div>
      <div class="grid-2">
        <div class="campo"><label for="e-ancho">Ancho (m)</label><input id="e-ancho" type="number" step="0.01" value="${e.ancho_m}"></div>
        <div class="campo"><label for="e-fondo">Fondo (m)</label><input id="e-fondo" type="number" step="0.01" value="${e.fondo_m}"></div>
      </div>
      <div class="campo"><label for="e-modelo">Modelo 3D del edificio (GLB)</label>
        <input id="e-modelo" type="url" value="${esc(e.modelo_3d_url || "")}" placeholder="https://…/edificio.glb"></div>
      <div class="campo"><label for="e-hdri">HDRI de iluminación (.hdr)</label>
        <input id="e-hdri" type="url" value="${esc(e.hdri_url || "")}" placeholder="https://…/cielo.hdr"></div>`,
    pie: html`<button type="button" class="btn btn-contorno" data-cerrar>${t("app.cancelar")}</button>
      <button type="button" class="btn btn-primario" data-guardar>${t("app.guardar")}</button>`,
  });

  el.querySelector("[data-cerrar]").addEventListener("click", () => cerrar());
  el.querySelector("[data-guardar]").addEventListener("click", async (ev) => {
    const nombre = el.querySelector("#e-nombre").value.trim();
    if (!nombre) return toastError("El nombre es obligatorio.");
    try {
      await conCarga(ev.currentTarget, api.adminGuardarEdificio({
        ...(esNuevo ? {} : { id: e.id }),
        nombre,
        descripcion: el.querySelector("#e-desc").value.trim() || null,
        sede_id: el.querySelector("#e-sede").value || null,
        ancho_m: Number(el.querySelector("#e-ancho").value),
        fondo_m: Number(el.querySelector("#e-fondo").value),
        modelo_3d_url: el.querySelector("#e-modelo").value.trim() || null,
        hdri_url: el.querySelector("#e-hdri").value.trim() || null,
      }));
      cerrar();
      await cargar(contenedor);
      toastOk(esNuevo ? "Edificio creado" : "Cambios guardados");
    } catch (err) { toastError(err.message); }
  });
}

function editorPiso(contenedor, edificioId) {
  const edificio = edificios.find((x) => String(x.id) === String(edificioId));
  const numero = (edificio?.pisos?.length || 0) + 1;

  const { el, cerrar } = abrirHoja({
    titulo: `Nuevo piso en ${edificio?.nombre || "el edificio"}`,
    centrado: true, ancho: "420px",
    contenido: html`
      <div class="campo"><label for="pi-nombre">Nombre</label>
        <input id="pi-nombre" type="text" value="Piso ${numero}" required></div>
      <div class="campo"><label for="pi-numero">Número</label>
        <input id="pi-numero" type="number" value="${numero}" min="-5" max="99"></div>
      <div class="campo"><label for="pi-altura">Altura del muro (m)</label>
        <input id="pi-altura" type="number" step="0.1" value="2.6"></div>`,
    pie: html`<button type="button" class="btn btn-contorno" data-cerrar>${t("app.cancelar")}</button>
      <button type="button" class="btn btn-primario" data-guardar>${t("app.guardar")}</button>`,
  });

  el.querySelector("[data-cerrar]").addEventListener("click", () => cerrar());
  el.querySelector("[data-guardar]").addEventListener("click", async (ev) => {
    try {
      await conCarga(ev.currentTarget, api.adminGuardarPiso({
        edificio_id: edificioId,
        nombre: el.querySelector("#pi-nombre").value.trim(),
        numero: Number(el.querySelector("#pi-numero").value),
        altura_m: Number(el.querySelector("#pi-altura").value),
      }));
      cerrar();
      await cargar(contenedor);
      toastOk("Piso creado");
    } catch (e) { toastError(e.message); }
  });
}
