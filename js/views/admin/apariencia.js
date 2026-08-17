/* ======================================================================
   admin/apariencia.js — Modo administrador: quitar cosas de la app.

   Aquí la administración decide QUÉ SE VE. Cada interruptor apaga una
   sección completa de la aplicación: si no la usas, no tiene por qué
   estar ocupando pantalla ni distrayendo a quien viene a reservar.

   Los cambios se guardan en el equipo y se aplican al recargar. No se
   recarga sola a mitad de la lista: sería molesto estar tocando
   interruptores y que la página se reinicie a cada rato.
   ====================================================================== */
import { html, raw, esc } from "../../core/utils.js";
import { icono } from "../../core/iconos.js";
import { toastOk, confirmar } from "../../core/ui.js";
import { getAjustes, setAjustes } from "../../core/config.js";
import api from "../../data/api.js";
import store from "../../core/store.js";

export const titulo = () => "Qué se ve en la app";
export const subtitulo = () => "Modo administrador";

/* Cada fila: [ruta del ajuste, título, explicación, valor de fábrica] */
const SECCIONES = [
  ["Contenido de la app", [
    ["features.promociones", "Descuentos y códigos promocionales",
      "La sección de promociones en el inicio y el campo de código al reservar.", false],
    ["features.adornos", "Adornos y testimonios",
      "Testimonios, insignias y contadores decorativos.", false],
    ["features.resenas", "Reseñas y calificaciones",
      "Estrellas y opiniones en la ficha de cada espacio.", true],
    ["features.favoritos", "Favoritos",
      "El corazón para guardar espacios y su pestaña.", true],
    ["features.listaEspera", "Lista de espera",
      "Avisar cuando se libere un horario ocupado.", true],
    ["features.tutorial", "Tutorial de bienvenida",
      "Las pantallas de presentación la primera vez.", true],
  ]],
  ["Comunicación", [
    ["features.chat", "Chat con administración", "Conversación dentro de la app.", true],
    ["features.asistenteIA", "Asistente virtual", "Búsqueda conversacional y recomendaciones.", true],
  ]],
  ["Mapa del edificio", [
    ["features.mapa3d", "Mapa del edificio", "La pestaña del mapa y el acceso desde el inicio.", true],
  ]],
  ["Cobros", [
    ["features.pagos", "Cobro en línea", "Si se apaga, el checkout queda cerrado y no se crean apartados.", true],
  ]],
];

const ESTILOS_MAPA = [
  ["plano", "Plano de colores", "Bloques planos, se lee de un vistazo y abre al instante."],
  ["realista", "Maqueta realista", "Muebles, gente y vegetación. Más bonito, más pesado."],
];

export async function render(contenedor) {
  const ajustes = getAjustes();
  const valor = (ruta, porDefecto) => {
    const partes = ruta.split(".");
    let cur = ajustes;
    for (const p of partes) {
      if (cur == null || typeof cur !== "object" || !(p in cur)) return porDefecto;
      cur = cur[p];
    }
    return cur;
  };

  const estiloActual = valor("graphics.estilo", "plano");
  const espacios = await api.getEspacios().catch(() => []);

  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">

        <div class="aviso aviso-info">
          ${raw(icono("info", { size: 16 }))}
          <div><span class="texto-sm">Lo que apagues aquí desaparece para todo el mundo en este
          equipo. Nada se borra: se puede volver a encender cuando quieras.</span></div>
        </div>

        ${raw(SECCIONES.map(([grupo, filas]) => `
          <section class="seccion mt-5">
            <h2 class="seccion-titulo">${esc(grupo)}</h2>
            <div class="lista tarjeta">
              ${filas.map(([ruta, nombre, ayuda, def]) => `
                <label class="lista-item lista-item-switch">
                  <span class="li-txt">
                    <span class="li-titulo">${esc(nombre)}</span>
                    <span class="li-sub">${esc(ayuda)}</span>
                  </span>
                  <input type="checkbox" class="interruptor" data-ajuste="${esc(ruta)}"
                         ${valor(ruta, def) ? "checked" : ""}>
                </label>`).join("")}
            </div>
          </section>`).join(""))}

        <section class="seccion mt-5">
          <h2 class="seccion-titulo">Estilo del mapa</h2>
          <div class="lista tarjeta">
            ${raw(ESTILOS_MAPA.map(([id, nombre, ayuda]) => `
              <label class="lista-item">
                <span class="li-txt">
                  <span class="li-titulo">${esc(nombre)}</span>
                  <span class="li-sub">${esc(ayuda)}</span>
                </span>
                <input type="radio" name="estilo-mapa" value="${esc(id)}"
                       ${estiloActual === id ? "checked" : ""}>
              </label>`).join(""))}
          </div>
        </section>

        <section class="seccion mt-5">
          <h2 class="seccion-titulo">Plano arquitectónico</h2>
          <div class="tarjeta tarjeta-pad">
            <p class="texto-sm texto-dim">Si pones aquí la imagen de tu plano, el mapa la dibuja
            a escala debajo de los bloques de color. Deja de ser una reconstrucción: pasa a ser
            <strong>tu plano</strong>, con los cuartos reservables marcados encima.</p>
            <div class="campo mt-3">
              <label for="ap-plano">Archivo o dirección de la imagen</label>
              <input id="ap-plano" type="text" spellcheck="false"
                     placeholder="assets/plano.png"
                     value="${esc(valor("graphics.planoUrl", ""))}">
              <span class="campo-ayuda">Guarda el plano como <code>assets/plano.png</code> dentro
              del proyecto y déjalo tal cual. Recórtalo justo por los muros exteriores para que
              cuadre con las medidas.</span>
            </div>
            <label class="lista-item lista-item-switch" style="padding-inline:0">
              <span class="li-txt">
                <span class="li-titulo">Usar el plano de fondo</span>
                <span class="li-sub">Apágalo para ver sólo los bloques de color.</span>
              </span>
              <input type="checkbox" class="interruptor" data-ajuste="graphics.usarPlano"
                     ${valor("graphics.usarPlano", false) ? "checked" : ""}>
            </label>
          </div>
        </section>

        <section class="seccion mt-5">
          <h2 class="seccion-titulo">Modelo 3D del edificio</h2>
          <div class="tarjeta tarjeta-pad">
            <p class="texto-sm texto-dim">Si tienes una maqueta en GLB o GLTF (por ejemplo
            generada en Meshy, Blender o SketchUp), déjala en <code>assets/edificio.glb</code>
            y aparece encima del plano. Se escala sola para encajar en la parcela.</p>
            <div class="campo mt-3">
              <label for="ap-modelo">Archivo o dirección del modelo</label>
              <input id="ap-modelo" type="text" spellcheck="false"
                     placeholder="assets/edificio.glb"
                     value="${esc(valor("graphics.modeloUrl", ""))}">
              <span class="campo-ayuda">Déjalo vacío para ver sólo los bloques de color.</span>
            </div>
          </div>
        </section>

        <section class="seccion mt-5">
          <div class="seccion-cab">
            <h2>Espacios visibles en el catálogo</h2>
            <span class="texto-xs texto-dim">${espacios.length} en total</span>
          </div>
          <p class="texto-sm texto-dim">Quitar un espacio lo esconde del catálogo, del buscador y
          del mapa. Las reservas que ya existan no se tocan.</p>
          <div class="lista tarjeta mt-2">
            ${raw(espacios.map((e) => `
              <label class="lista-item lista-item-switch">
                <span class="li-ico" aria-hidden="true">${esc(e.icono || "▦")}</span>
                <span class="li-txt">
                  <span class="li-titulo">${esc(e.nombre)}</span>
                  <span class="li-sub">${esc(e.codigo)} · ${esc(e.tipo.replace(/_/g, " "))}</span>
                </span>
                <input type="checkbox" class="interruptor" data-espacio="${esc(e.id)}"
                       ${valor(`ocultos.${e.id}`, false) ? "" : "checked"}>
              </label>`).join("") || '<div class="lista-item"><span class="li-txt">Sin espacios todavía</span></div>')}
          </div>
        </section>

        <div class="mt-6 pila-2">
          <button type="button" class="btn btn-primario btn-bloque" data-aplicar>
            ${raw(icono("check", { size: 17 }))} Guardar y aplicar</button>
          <button type="button" class="btn btn-contorno btn-bloque" data-restablecer>
            Restablecer todo</button>
        </div>
      </div>
    </div>`;

  let pendiente = structuredClone(ajustes);

  const fijar = (ruta, v) => {
    const partes = ruta.split(".");
    let cur = pendiente;
    for (const p of partes.slice(0, -1)) {
      if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
      cur = cur[p];
    }
    cur[partes.at(-1)] = v;
  };

  contenedor.querySelector("#ap-plano")?.addEventListener("input", (e) => {
    fijar("graphics.planoUrl", e.target.value.trim());
  });

  contenedor.querySelector("#ap-modelo")?.addEventListener("input", (e) => {
    fijar("graphics.modeloUrl", e.target.value.trim());
  });

  contenedor.addEventListener("change", (e) => {
    const sw = e.target.closest("[data-ajuste]");
    if (sw) return fijar(sw.dataset.ajuste, sw.checked);

    const esp = e.target.closest("[data-espacio]");
    // El interruptor dice "visible", el ajuste guarda "oculto": se invierte.
    if (esp) return fijar(`ocultos.${esp.dataset.espacio}`, !esp.checked);

    if (e.target.name === "estilo-mapa") fijar("graphics.estilo", e.target.value);
  });

  contenedor.querySelector("[data-aplicar]").addEventListener("click", () => {
    setAjustes(pendiente);
    toastOk("Guardado. Recargando para aplicarlo…");
    setTimeout(() => location.reload(), 600);
  });

  contenedor.querySelector("[data-restablecer]").addEventListener("click", async () => {
    const ok = await confirmar({
      titulo: "Restablecer",
      mensaje: "Todo vuelve a como venía de fábrica. ¿Seguimos?",
      aceptar: "Restablecer", peligro: true,
    });
    if (!ok) return;
    setAjustes({});
    toastOk("Restablecido. Recargando…");
    setTimeout(() => location.reload(), 600);
  });
}

/** Espacios que la administración escondió. Lo usa el catálogo. */
export function espaciosOcultos() {
  const ocultos = getAjustes().ocultos || {};
  return new Set(Object.keys(ocultos).filter((id) => ocultos[id]));
}

export default { render, titulo, subtitulo, espaciosOcultos };
