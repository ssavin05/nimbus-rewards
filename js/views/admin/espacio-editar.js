/* ======================================================================
   admin/espacio-editar.js — Alta y edición completa de un espacio:
   datos, precios, geometría del plano, amenidades, horarios y fotos.
   ====================================================================== */
import { html, raw, esc, slug, urlMedioSegura } from "../../core/utils.js";
import { t } from "../../core/i18n.js";
import { icono } from "../../core/iconos.js";
import { toastOk, toastError, conCarga, confirmar } from "../../core/ui.js";
import { ir, atras } from "../../core/router.js";
import api from "../../data/api.js";
import store from "../../core/store.js";
import { subirArchivo, borrarArchivo, getDB } from "../../data/db.js";
import { SUPABASE } from "../../core/config.js";

export const titulo = () => (esNuevo ? t("admin.nuevoEspacio") : "Editar espacio");
export const nav = false;

let esNuevo = false;
let espacio = null;
let amenidades = [];
let seleccionadas = new Set();
let fotos = [];

const TIPOS = [
  ["oficina", "🏢 Oficina privada"], ["sala_juntas", "📊 Sala de juntas"],
  ["coworking", "🧑‍💻 Coworking"], ["auditorio", "🎤 Auditorio"],
  ["estacionamiento", "🚗 Estacionamiento"], ["servicio", "🧹 Servicio"], ["comun", "🛋 Área común"],
];
const ESTADOS = [
  ["disponible", "Disponible"], ["reservada", "Reservada"], ["mantenimiento", "Mantenimiento"],
  ["proximamente", "Próximamente"], ["inactiva", "No disponible"],
];
const LADOS = [["n", "Norte"], ["s", "Sur"], ["e", "Este"], ["w", "Oeste"]];

export async function render(contenedor, ctx) {
  const id = ctx.params.id;
  esNuevo = id === "nuevo";

  const [amen, edificios] = await Promise.all([api.getAmenidades(), api.getEdificios().catch(() => [])]);
  amenidades = amen;

  espacio = esNuevo
    ? nuevoEspacio(edificios[0])
    : (await api.getEspacio(id)) || nuevoEspacio(edificios[0]);
  seleccionadas = new Set(espacio.amenidades || []);
  fotos = espacio.fotos || [];

  const pisos = edificios.flatMap((e) => (e.pisos || []).map((p) => ({ ...p, edificio: e.nombre })));

  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">
        <form id="ee-form">

          <section class="seccion">
            <h2 class="seccion-titulo">Datos básicos</h2>
            <div class="tarjeta tarjeta-pad">
              <div class="grid-2">
                <div class="campo"><label for="f-nombre">Nombre</label>
                  <input id="f-nombre" type="text" value="${esc(espacio.nombre || "")}" required></div>
                <div class="campo"><label for="f-codigo">Código</label>
                  <input id="f-codigo" type="text" value="${esc(espacio.codigo || "")}" style="text-transform:uppercase" required></div>
              </div>
              <div class="grid-2">
                <div class="campo"><label for="f-tipo">Tipo</label>
                  <select id="f-tipo">${TIPOS.map(([v, l]) => raw(`<option value="${v}" ${espacio.tipo === v ? "selected" : ""}>${esc(l)}</option>`))}</select></div>
                <div class="campo"><label for="f-estado">Estado</label>
                  <select id="f-estado">${ESTADOS.map(([v, l]) => raw(`<option value="${v}" ${espacio.estado === v ? "selected" : ""}>${esc(l)}</option>`))}</select></div>
              </div>
              <div class="grid-2">
                <div class="campo"><label for="f-icono">Icono (emoji)</label>
                  <input id="f-icono" type="text" value="${esc(espacio.icono || "🏢")}" maxlength="4"></div>
                <div class="campo"><label for="f-capacidad">Capacidad</label>
                  <input id="f-capacidad" type="number" min="0" max="500" value="${espacio.capacidad || 1}"></div>
              </div>
              <div class="campo"><label for="f-piso">Piso</label>
                <select id="f-piso">
                  <option value="">— sin asignar —</option>
                  ${pisos.map((p) => raw(`<option value="${esc(p.id)}" ${espacio.piso_id === p.id ? "selected" : ""}>${esc(p.edificio)} · ${esc(p.nombre)}</option>`))}
                </select></div>
              <label class="switch"><input type="checkbox" id="f-reservable" ${espacio.reservable ? "checked" : ""}>
                <span class="switch-pista"></span><span class="texto-sm">Se puede reservar</span></label>
            </div>
          </section>

          <section class="seccion">
            <h2 class="seccion-titulo">Precios</h2>
            <div class="tarjeta tarjeta-pad grid-3">
              <div class="campo"><label for="f-ph">Por hora</label>
                <input id="f-ph" type="number" min="0" step="10" value="${Number(espacio.precio_hora) || 0}"></div>
              <div class="campo"><label for="f-pd">Por día</label>
                <input id="f-pd" type="number" min="0" step="50" value="${espacio.precio_dia ?? ""}"></div>
              <div class="campo"><label for="f-pm">Por mes</label>
                <input id="f-pm" type="number" min="0" step="100" value="${espacio.precio_mes ?? ""}"></div>
            </div>
          </section>

          <section class="seccion">
            <h2 class="seccion-titulo">Descripción y reglas</h2>
            <div class="tarjeta tarjeta-pad">
              <div class="campo"><label for="f-desc">Descripción</label>
                <textarea id="f-desc" rows="4">${esc(espacio.descripcion || "")}</textarea></div>
              <div class="campo"><label for="f-servicios">Servicios incluidos (uno por línea)</label>
                <textarea id="f-servicios" rows="3">${esc((espacio.servicios || []).join("\n"))}</textarea></div>
              <div class="campo"><label for="f-reglamento">Reglamento</label>
                <textarea id="f-reglamento" rows="3">${esc(espacio.reglamento || "")}</textarea></div>
            </div>
          </section>

          <section class="seccion">
            <h2 class="seccion-titulo">${t("espacio.amenidades")}</h2>
            <div class="tarjeta tarjeta-pad fila envolver" style="gap:8px" id="ee-amenidades">
              ${amenidades.map((a) => raw(`<button type="button" class="chip" data-amenidad="${esc(a.clave)}"
                aria-pressed="${seleccionadas.has(a.clave)}"><span>${esc(a.icono)}</span>${esc(a.etiqueta)}</button>`))}
            </div>
          </section>

          <section class="seccion">
            <h2 class="seccion-titulo">Geometría en el plano (metros)</h2>
            <div class="tarjeta tarjeta-pad">
              <p class="campo-ayuda mb-4">Posición de la esquina noroeste y medidas del espacio. Así lo dibuja el mapa 3D.</p>
              <div class="grid-2">
                <div class="campo"><label for="f-x">Posición X</label>
                  <input id="f-x" type="number" step="0.01" value="${Number(espacio.pos_x) || 0}"></div>
                <div class="campo"><label for="f-y">Posición Y</label>
                  <input id="f-y" type="number" step="0.01" value="${Number(espacio.pos_y) || 0}"></div>
              </div>
              <div class="grid-2">
                <div class="campo"><label for="f-w">Ancho</label>
                  <input id="f-w" type="number" step="0.01" min="0.5" value="${Number(espacio.ancho) || 3}"></div>
                <div class="campo"><label for="f-d">Fondo</label>
                  <input id="f-d" type="number" step="0.01" min="0.5" value="${Number(espacio.fondo) || 3}"></div>
              </div>
              <div class="grid-3">
                <div class="campo"><label for="f-puerta-lado">Lado de la puerta</label>
                  <select id="f-puerta-lado">${LADOS.map(([v, l]) => raw(`<option value="${v}" ${espacio.puerta?.side === v ? "selected" : ""}>${esc(l)}</option>`))}</select></div>
                <div class="campo"><label for="f-puerta-off">Desplazamiento</label>
                  <input id="f-puerta-off" type="number" step="0.01" value="${Number(espacio.puerta?.offset) || 0}"></div>
                <div class="campo"><label for="f-puerta-w">Ancho de puerta</label>
                  <input id="f-puerta-w" type="number" step="0.05" min="0.6" value="${Number(espacio.puerta?.width) || 1}"></div>
              </div>
              <label class="switch"><input type="checkbox" id="f-abierto" ${espacio.abierto ? "checked" : ""}>
                <span class="switch-pista"></span><span class="texto-sm">Espacio abierto (sin muros: patio, jardín, cochera)</span></label>
            </div>
          </section>

          <section class="seccion">
            <h2 class="seccion-titulo">Multimedia</h2>
            <div class="tarjeta tarjeta-pad">
              <div class="campo"><label for="f-video">URL de video</label>
                <input id="f-video" type="url" value="${esc(espacio.video_url || "")}" placeholder="https://…/recorrido.mp4"></div>
              <div class="campo"><label for="f-tour">Recorrido virtual (Matterport, etc.)</label>
                <input id="f-tour" type="url" value="${esc(espacio.tour_url || "")}" placeholder="https://my.matterport.com/show/?m=…"></div>
              <div class="campo"><label for="f-pano">Imagen 360° (equirectangular)</label>
                <input id="f-pano" type="url" value="${esc(espacio.panorama_url || "")}"></div>
              <div class="campo"><label for="f-modelo">Modelo 3D (GLB/GLTF)</label>
                <input id="f-modelo" type="url" value="${esc(espacio.modelo_3d_url || "")}"></div>

              <span class="etiqueta">Fotografías</span>
              <div class="fotos-grid mt-2" id="ee-fotos"></div>
              <input type="file" id="ee-file" accept="image/*" multiple hidden>
              <button type="button" class="btn btn-contorno btn-sm mt-2" data-subir>
                ${raw(icono("camara", { size: 15 }))} Subir fotos</button>
              <p class="campo-ayuda">JPG, PNG o WebP hasta 10 MB. La primera es la portada.</p>
            </div>
          </section>

          <div class="col" style="gap:10px">
            <button type="submit" class="btn btn-primario btn-lg btn-bloque">${t("app.guardar")}</button>
            <button type="button" class="btn btn-fantasma btn-bloque" data-cancelar>${t("app.cancelar")}</button>
          </div>
        </form>
      </div>
    </div>`;

  pintarFotos(contenedor);

  contenedor.querySelector("#ee-amenidades").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-amenidad]");
    if (!chip) return;
    const k = chip.dataset.amenidad;
    seleccionadas.has(k) ? seleccionadas.delete(k) : seleccionadas.add(k);
    chip.setAttribute("aria-pressed", String(seleccionadas.has(k)));
  });

  contenedor.querySelector("[data-cancelar]").addEventListener("click", () => atras());
  contenedor.querySelector("[data-subir]").addEventListener("click", () => contenedor.querySelector("#ee-file").click());
  contenedor.querySelector("#ee-file").addEventListener("change", (e) => subirFotos(contenedor, [...e.target.files]));

  contenedor.querySelector("#ee-fotos").addEventListener("click", async (e) => {
    const quitar = e.target.closest("[data-quitar-foto]");
    if (quitar) return quitarFoto(contenedor, quitar.dataset.quitarFoto);
    const portada = e.target.closest("[data-portada]");
    if (portada) return marcarPortada(contenedor, portada.dataset.portada);
  });

  contenedor.querySelector("#ee-form").addEventListener("submit", (e) => {
    e.preventDefault();
    guardar(contenedor, e.target.querySelector('button[type="submit"]'));
  });

  // Autogenera el código a partir del nombre en altas nuevas.
  if (esNuevo) {
    contenedor.querySelector("#f-nombre").addEventListener("input", (e) => {
      const codigo = contenedor.querySelector("#f-codigo");
      if (!codigo.dataset.tocado) codigo.value = slug(e.target.value).toUpperCase().slice(0, 12);
    });
    contenedor.querySelector("#f-codigo").addEventListener("input", (e) => { e.target.dataset.tocado = "1"; });
  }
}

function nuevoEspacio(edificio) {
  return {
    nombre: "", codigo: "", tipo: "oficina", icono: "🏢", estado: "disponible",
    capacidad: 4, reservable: true, precio_hora: 200, precio_dia: null, precio_mes: null,
    descripcion: "", servicios: [], reglamento: "", amenidades: [],
    pos_x: 0, pos_y: 0, ancho: 3, fondo: 3, altura: 1.35, abierto: false,
    puerta: { side: "s", offset: 0, width: 1 },
    edificio_id: edificio?.id || null, sede_id: edificio?.sede_id || null,
    piso_id: edificio?.pisos?.[0]?.id || null,
    fotos: [],
  };
}

/* ---------------------------------------------------------------------
   Fotos
   --------------------------------------------------------------------- */
function pintarFotos(contenedor) {
  const caja = contenedor.querySelector("#ee-fotos");
  if (!fotos.length) {
    caja.innerHTML = `<p class="texto-sm texto-dim">Todavía no hay fotos.</p>`;
    return;
  }
  caja.innerHTML = fotos.map((f) => html`
    <figure class="foto-item${raw(f.es_portada ? " portada" : "")}">
      <img src="${urlMedioSegura(f.url)}" alt="${f.titulo || ""}" loading="lazy">
      <div class="foto-acciones">
        <button type="button" class="btn btn-icono btn-sm" data-portada="${f.id || f.url}" aria-label="Marcar como portada">
          ${raw(icono("estrella", { size: 14 }))}</button>
        <button type="button" class="btn btn-icono btn-sm" data-quitar-foto="${f.id || f.url}" aria-label="Quitar">
          ${raw(icono("basura", { size: 14 }))}</button>
      </div>
      ${f.es_portada ? raw('<figcaption class="chip chip-ok">Portada</figcaption>') : ""}
    </figure>`).join("");
}

async function subirFotos(contenedor, archivos) {
  if (!archivos.length) return;
  if (esNuevo) return toastError("Guarda el espacio primero y después sube las fotos.");

  for (const archivo of archivos) {
    if (archivo.size > 10 * 1024 * 1024) { toastError(`${archivo.name} pesa más de 10 MB.`); continue; }
    try {
      const ext = (archivo.name.split(".").pop() || "jpg").toLowerCase();
      const ruta = `${espacio.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { url } = await subirArchivo(SUPABASE.buckets.espacios, ruta, archivo);

      const db = await getDB();
      const { data } = await db.from("espacio_fotos").insert({
        espacio_id: espacio.id, url, ruta, orden: fotos.length,
        es_portada: fotos.length === 0,
      }).select().single();

      fotos.push(data || { url, ruta, es_portada: fotos.length === 0 });
      pintarFotos(contenedor);
      toastOk(`${archivo.name} subida`);
    } catch (e) {
      toastError(e.message || `No se pudo subir ${archivo.name}`);
    }
  }
}

async function quitarFoto(contenedor, clave) {
  const foto = fotos.find((f) => String(f.id || f.url) === clave);
  if (!foto) return;
  const ok = await confirmar({ titulo: "Quitar foto", mensaje: "Se eliminará del espacio.", peligro: true, aceptar: t("app.eliminar") });
  if (!ok) return;
  try {
    const db = await getDB();
    if (foto.id && db) await db.from("espacio_fotos").delete().eq("id", foto.id);
    if (foto.ruta) await borrarArchivo(SUPABASE.buckets.espacios, foto.ruta).catch(() => {});
    fotos = fotos.filter((f) => f !== foto);
    pintarFotos(contenedor);
    toastOk("Foto eliminada");
  } catch (e) { toastError(e.message); }
}

async function marcarPortada(contenedor, clave) {
  try {
    const db = await getDB();
    for (const f of fotos) {
      const esta = String(f.id || f.url) === clave;
      f.es_portada = esta;
      if (f.id && db) await db.from("espacio_fotos").update({ es_portada: esta }).eq("id", f.id);
    }
    pintarFotos(contenedor);
    toastOk("Portada actualizada");
  } catch (e) { toastError(e.message); }
}

/* ---------------------------------------------------------------------
   Guardar
   --------------------------------------------------------------------- */
async function guardar(contenedor, boton) {
  const v = (sel) => contenedor.querySelector(sel).value;
  const n = (sel) => Number(contenedor.querySelector(sel).value);
  const chk = (sel) => contenedor.querySelector(sel).checked;

  const nombre = v("#f-nombre").trim();
  const codigo = v("#f-codigo").trim().toUpperCase();
  if (!nombre) return toastError("El nombre es obligatorio.");
  if (!codigo) return toastError("El código es obligatorio.");

  const pd = v("#f-pd"), pm = v("#f-pm");

  const payload = {
    ...(esNuevo ? {} : { id: espacio.id }),
    nombre, codigo,
    tipo: v("#f-tipo"),
    estado: v("#f-estado"),
    icono: v("#f-icono") || "🏢",
    capacidad: n("#f-capacidad"),
    reservable: chk("#f-reservable"),
    piso_id: v("#f-piso") || null,
    edificio_id: espacio.edificio_id || null,
    sede_id: espacio.sede_id || null,
    precio_hora: n("#f-ph"),
    precio_dia: pd === "" ? null : Number(pd),
    precio_mes: pm === "" ? null : Number(pm),
    descripcion: v("#f-desc").trim() || null,
    servicios: v("#f-servicios").split("\n").map((s) => s.trim()).filter(Boolean),
    reglamento: v("#f-reglamento").trim() || null,
    amenidades: [...seleccionadas],
    pos_x: n("#f-x"), pos_y: n("#f-y"),
    ancho: n("#f-w"), fondo: n("#f-d"),
    abierto: chk("#f-abierto"),
    altura: chk("#f-abierto") ? 0.32 : (chk("#f-reservable") ? 1.35 : 0.9),
    puerta: { side: v("#f-puerta-lado"), offset: n("#f-puerta-off"), width: n("#f-puerta-w") },
    video_url: v("#f-video").trim() || null,
    tour_url: v("#f-tour").trim() || null,
    panorama_url: v("#f-pano").trim() || null,
    modelo_3d_url: v("#f-modelo").trim() || null,
  };

  try {
    const guardado = await conCarga(boton, api.adminGuardarEspacio(payload));
    toastOk(esNuevo ? "Espacio creado" : "Cambios guardados");
    if (esNuevo && guardado?.id) ir(`/admin/espacios/${guardado.id}`, { reemplazar: true });
    else ir("/admin/espacios");
  } catch (e) {
    toastError(e.message);
  }
}
