/* ======================================================================
   legal.js — Aviso de privacidad, términos, cancelación, reembolso y
   eliminación de cuenta.

   Vista pública: tiene que verse SIN iniciar sesión, porque el enlace
   está en la casilla de aceptación del registro. Pedir cuenta para leer
   las condiciones que estás aceptando no tiene sentido.

   Los huecos que sólo puede rellenar el propietario se pintan
   resaltados, no ocultos: un documento a medio rellenar publicado como
   si estuviera terminado es peor que uno que dice claramente qué le
   falta.
   ====================================================================== */
import { html, raw, esc } from "../core/utils.js";
import { icono } from "../core/iconos.js";
import { DOCUMENTOS, ORDEN } from "../data/legal.js";
import { APP } from "../core/config.js";

/* El router llama a titulo() sin argumentos, así que el documento activo
   se recuerda aquí al pintarlo. */
let claveActual = "privacidad";

export const titulo = () => DOCUMENTOS[claveActual]?.titulo || "Legal";

/* El router entrega el CONTEXTO completo —{ params, query, ruta, … }—,
   no los params sueltos. */
export async function render(contenedor, ctx = {}) {
  const pedido = ctx.params?.doc;
  const clave = ORDEN.includes(pedido) ? pedido : "privacidad";
  claveActual = clave;
  const doc = DOCUMENTOS[clave];

  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido legal">

        <nav class="cinta mb-4" aria-label="Documentos legales">
          ${raw(ORDEN.map((k) => `
            <a class="chip" href="#/legal/${k}" ${k === clave ? 'aria-current="page"' : ""}>
              ${esc(DOCUMENTOS[k].titulo)}
            </a>`).join(""))}
        </nav>

        <header class="mb-4">
          <h1>${doc.titulo}</h1>
          <p class="texto-sm texto-dim">${doc.resumen}</p>
        </header>

        ${raw(avisoBorrador(doc))}

        ${raw(doc.secciones.map(seccion).join(""))}

        <p class="texto-xs texto-suave mt-4">
          ${esc(APP.name)} · Documento generado por la aplicación · v${esc(APP.version)}
        </p>
      </div>
    </div>`;
}

/* Cuenta los huecos del documento y lo dice arriba del todo. */
function avisoBorrador(doc) {
  const faltan = doc.secciones.flatMap((s) => s.pendientes || []);
  if (!faltan.length) return "";
  return `
    <div class="aviso aviso-warm mb-4" role="status">
      <strong>Borrador — faltan ${faltan.length} dato(s) de la empresa.</strong>
      <p class="texto-sm">Los huecos aparecen marcados dentro del texto. Este documento
      no debe publicarse hasta rellenarlos y revisarlo con asesoría legal.</p>
    </div>`;
}

function seccion(s) {
  const marcar = (txt) => {
    // Las marcas van en MAYÚSCULAS_CON_GUION_BAJO dentro del propio texto.
    let salida = esc(txt);
    for (const p of s.pendientes || []) {
      salida = salida.replaceAll(esc(p),
        `<mark class="legal-pendiente" title="Lo tiene que rellenar el propietario">${esc(humano(p))}</mark>`);
    }
    return salida;
  };

  return `
    <section class="seccion">
      <h2 class="seccion-titulo">${esc(s.h)}</h2>
      ${(s.p || []).map((x) => `<p>${marcar(x)}</p>`).join("")}
      ${s.lista ? `<ul class="legal-lista">${s.lista.map((x) => `<li>${marcar(x)}</li>`).join("")}</ul>` : ""}
    </section>`;
}

/** REGLAS_ADICIONALES → «pendiente: reglas adicionales» */
function humano(marca) {
  return `pendiente: ${marca.toLowerCase().replaceAll("_", " ")}`;
}

export default { titulo, render };
