/* ======================================================================
   nosotros.js — "Quiénes somos": la carta de presentación del centro.

   Es una vista pública: se puede ver sin iniciar sesión. El contenido
   editable vive en js/data/contenido.js.
   ====================================================================== */
import { html, raw, esc, iniciales, formatMoneda, urlMedioSegura } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { compartir } from "../core/ui.js";
import { CONTACT, FEATURES } from "../core/config.js";
import { NOSOTROS } from "../data/contenido.js";
import api from "../data/api.js";
import store from "../core/store.js";
import { estrellasHtml } from "./componentes.js";

export const titulo = () => t("nosotros.titulo");

export async function render(contenedor) {
  const N = NOSOTROS;

  contenedor.innerHTML = html`
    <div class="vista-scroll nosotros">

      <!-- Portada -->
      <header class="ns-portada">
        ${urlMedioSegura(N.imagenPortada)
          ? raw(`<img class="ns-portada-img" src="${esc(urlMedioSegura(N.imagenPortada))}" alt="" loading="eager">`)
          : raw(ilustracionEdificio())}
        <div class="ns-portada-txt">
          <p class="eyebrow">${N.eyebrow}</p>
          <h1>${N.titulo}</h1>
          <p class="ns-entrada">${N.entrada}</p>
          <div class="fila envolver mt-4" style="gap:10px">
            <a class="btn btn-primario" href="#/espacios">
              ${raw(icono("edificio", { size: 17 }))} ${t("nosotros.verEspacios")}</a>
            ${FEATURES.mapa3d ? raw(`<a class="btn btn-contorno" href="#/mapa">
              ${icono("cubo", { size: 17 })} ${esc(t("home.verMapa"))}</a>`) : ""}
          </div>
        </div>
      </header>

      <div class="vista-contenido">

        <!-- Cifras -->
        <section class="ns-cifras">
          ${N.cifras.map((c) => raw(`
            <div class="ns-cifra">
              <span class="ns-cifra-ico">${icono(c.icono, { size: 18 })}</span>
              <strong>${esc(c.valor)}</strong>
              <span>${esc(c.etiqueta)}</span>
            </div>`))}
        </section>

        <!-- Historia -->
        <section class="seccion">
          <h2 class="seccion-titulo">${N.historia.titulo}</h2>
          <div class="ns-texto">
            ${N.historia.parrafos.map((p) => raw(`<p>${esc(p)}</p>`))}
          </div>
        </section>

        <!-- Servicios -->
        <section class="seccion">
          <h2 class="seccion-titulo">${t("nosotros.queOfrecemos")}</h2>
          <div class="grid-auto">
            ${N.servicios.map((s) => raw(`
              <article class="tarjeta tarjeta-pad ns-servicio">
                <span class="ns-servicio-ico" aria-hidden="true">${esc(s.icono)}</span>
                <strong>${esc(s.titulo)}</strong>
                <p class="texto-sm texto-dim">${esc(s.texto)}</p>
              </article>`))}
          </div>
          <div id="ns-desde" class="ns-desde"></div>
        </section>

        <!-- Por qué nosotros -->
        <section class="seccion">
          <h2 class="seccion-titulo">${N.porQue.titulo}</h2>
          <div class="ns-puntos">
            ${N.porQue.puntos.map((p) => raw(`
              <div class="ns-punto">
                <span class="ns-punto-ico">${icono("check", { size: 15 })}</span>
                <div>
                  <strong>${esc(p.titulo)}</strong>
                  <p class="texto-sm texto-dim">${esc(p.texto)}</p>
                </div>
              </div>`))}
          </div>
        </section>

        <!-- El edificio -->
        <section class="seccion">
          <h2 class="seccion-titulo">${N.edificio.titulo}</h2>
          <div class="tarjeta tarjeta-pad">
            <p>${N.edificio.texto}</p>
            <ul class="lista-puntos mt-4">
              ${N.edificio.amenidades.map((a) => raw(
                `<li>${icono("check", { size: 15 })}<span>${esc(a)}</span></li>`))}
            </ul>
            ${FEATURES.mapa3d ? raw(`
              <a class="btn btn-contorno btn-bloque mt-4" href="#/mapa">
                ${icono("cubo", { size: 16 })} ${esc(t("nosotros.recorrer"))}</a>`) : ""}
          </div>
        </section>

        ${N.equipo?.personas?.length ? raw(`
        <!-- Equipo: sólo se publica cuando hay personas autorizadas -->
        <section class="seccion">
          <h2 class="seccion-titulo">${esc(N.equipo.titulo)}</h2>
          ${N.equipo.texto ? `<p class="texto-sm texto-dim mb-4">${esc(N.equipo.texto)}</p>` : ""}
          <div class="ns-equipo">
            ${N.equipo.personas.map((p) => `
              <figure class="ns-persona">
                <span class="avatar avatar-lg">${urlMedioSegura(p.imagen)
                  ? `<img src="${esc(urlMedioSegura(p.imagen))}" alt="">`
                  : esc(iniciales(p.nombre))}</span>
                <figcaption>
                  <strong>${esc(p.nombre)}</strong>
                  <span class="texto-sm texto-dim">${esc(p.puesto)}</span>
                </figcaption>
              </figure>`).join("")}
          </div>
        </section>`) : ""}

        <!-- Reseñas reales -->
        <section class="seccion" id="ns-resenas" hidden>
          <h2 class="seccion-titulo">${t("nosotros.loQueDicen")}</h2>
          <div class="cinta" id="ns-resenas-lista"></div>
        </section>

        <!-- Horarios y ubicación -->
        <section class="seccion">
          <h2 class="seccion-titulo">${t("nosotros.dondeEstamos")}</h2>
          <div class="grid-2 ns-visita">
            <div class="tarjeta tarjeta-pad">
              <strong>${t("espacio.horarios")}</strong>
              <div class="mt-2">
                ${N.horarios.map((h) => raw(`
                  <div class="fila-sep texto-sm" style="padding:5px 0">
                    <span>${esc(h.dia)}</span><strong class="mono">${esc(h.horas)}</strong>
                  </div>`))}
              </div>
            </div>
            ${CONTACT.direccion ? raw(`<div class="tarjeta tarjeta-pad">
              <strong>${esc(t("nosotros.direccion"))}</strong>
              <p class="texto-sm texto-dim mt-2">${esc(CONTACT.direccion)}</p>
              <a class="btn btn-contorno btn-sm btn-bloque mt-2" target="_blank" rel="noopener"
                 href="https://maps.google.com/?q=${encodeURIComponent(CONTACT.direccion)}">
                ${icono("ubicacion", { size: 15 })} ${esc(t("nosotros.comoLlegar"))}</a>
            </div>`) : ""}
          </div>
        </section>

        <!-- Contacto -->
        <section class="seccion">
          <h2 class="seccion-titulo">${t("nosotros.hablemos")}</h2>
          <div class="grid-3">
            ${CONTACT.whatsapp ? raw(`<a class="btn btn-contorno" href="https://wa.me/${esc(CONTACT.whatsapp)}" target="_blank" rel="noopener">
              ${icono("whatsapp", { size: 17 })} WhatsApp</a>`) : ""}
            ${CONTACT.telefono ? raw(`<a class="btn btn-contorno" href="tel:${esc(CONTACT.telefono)}">
              ${icono("telefono", { size: 17 })} ${esc(t("ayuda.llamar"))}</a>`) : ""}
            ${CONTACT.email ? raw(`<a class="btn btn-contorno" href="mailto:${esc(CONTACT.email)}">
              ${icono("correo", { size: 17 })} ${esc(t("ayuda.correo"))}</a>`) : ""}
          </div>
        </section>

        <!-- Cierre -->
        <section class="ns-cierre">
          <h2>${t("nosotros.cierreTitulo")}</h2>
          <p class="texto-dim">${t("nosotros.cierreTexto")}</p>
          <div class="fila envolver centro mt-4" style="gap:10px;justify-content:center">
            <a class="btn btn-primario btn-lg" href="#/espacios">${t("home.reservarAhora")}</a>
            <button type="button" class="btn btn-contorno btn-lg" data-compartir>
              ${raw(icono("compartir", { size: 17 }))} ${t("nosotros.compartir")}</button>
          </div>
        </section>
      </div>
    </div>`;

  /* ---------- datos reales que enriquecen la página ---------- */
  cargarPrecioDesde(contenedor);
  if (FEATURES.resenas) cargarResenas(contenedor);

  contenedor.addEventListener("click", (e) => {
    if (e.target.closest("[data-compartir]")) {
      compartir({
        titulo: NOSOTROS.titulo,
        texto: NOSOTROS.entrada,
        url: `${location.origin}${location.pathname}#/nosotros`,
      });
    }
  });
}

/* ---------------------------------------------------------------------
   "Desde $X por hora": se toma del catálogo real, no se escribe a mano.
   --------------------------------------------------------------------- */
async function cargarPrecioDesde(contenedor) {
  const caja = contenedor.querySelector("#ns-desde");
  if (!caja) return;
  try {
    const espacios = await api.getEspacios();
    const precios = espacios
      .filter((e) => api.esReservableV1(e) && Number(e.precio_hora) > 0 && (e.portada || e.fotos?.some((f) => f?.url && !f?.es_360)))
      .map((e) => Number(e.precio_hora));
    if (!precios.length) return;
    caja.innerHTML = html`
      <p class="texto-sm texto-dim">
        ${t("nosotros.desde")} <strong>${formatMoneda(Math.min(...precios))}</strong>
        ${t("espacio.porHora")} · ${t("nosotros.ivaAparte")}
      </p>`;
  } catch { /* sin catálogo, simplemente no se muestra */ }
}

/* ---------------------------------------------------------------------
   Reseñas mejor calificadas de los espacios reales.
   --------------------------------------------------------------------- */
async function cargarResenas(contenedor) {
  const seccion = contenedor.querySelector("#ns-resenas");
  const lista = contenedor.querySelector("#ns-resenas-lista");
  if (!seccion || !lista) return;

  // En modo demostración las reseñas son inventadas. Publicar testimonios
  // falsos en la carta de presentación del negocio sería engañoso, así que
  // la sección sólo aparece cuando vienen de la base de datos real.
  if (api.enModoDemo()) return;

  try {
    const espacios = (await api.getEspacios()).filter((e) => api.esReservableV1(e) && (e.portada || e.fotos?.some((f) => f?.url && !f?.es_360))).slice(0, 4);
    const grupos = await Promise.all(espacios.map((e) => api.getResenas(e.id, { limite: 3 }).catch(() => [])));

    const mejores = grupos.flat()
      .filter((r) => r.calificacion >= 4 && r.comentario)
      .sort((a, b) => b.calificacion - a.calificacion)
      .slice(0, 6);

    if (!mejores.length) return;

    lista.innerHTML = mejores.map((r) => html`
      <article class="ns-resena">
        ${estrellasHtml(r.calificacion, { conNumero: false })}
        <p class="texto-sm">“${r.comentario}”</p>
        <span class="texto-xs texto-suave">${r.usuarios?.nombre || t("nosotros.clienteAnonimo")}</span>
      </article>`).join("");
    seccion.hidden = false;
  } catch { /* si falla, la sección se queda oculta */ }
}

/* ---------------------------------------------------------------------
   Ilustración del edificio, por si no hay fotografía todavía.
   --------------------------------------------------------------------- */
function ilustracionEdificio() {
  return `
  <svg class="ns-portada-svg" viewBox="0 0 400 220" role="img" aria-label="Ilustración del edificio">
    <defs>
      <linearGradient id="nsCielo" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--marca)" stop-opacity=".28"/>
        <stop offset="100%" stop-color="var(--acento)" stop-opacity=".05"/>
      </linearGradient>
      <linearGradient id="nsMuro" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="var(--superficie)"/>
        <stop offset="100%" stop-color="var(--superficie-3)"/>
      </linearGradient>
    </defs>

    <rect width="400" height="220" fill="url(#nsCielo)"/>

    <!-- suelo -->
    <path d="M0 170 L400 150 L400 220 L0 220 Z" fill="var(--superficie-2)" opacity=".7"/>

    <!-- edificio principal en isométrico -->
    <g stroke="var(--linea-fuerte)" stroke-width="1.4" stroke-linejoin="round">
      <path d="M120 90 L250 70 L330 105 L200 130 Z" fill="url(#nsMuro)"/>
      <path d="M120 90 L200 130 L200 185 L120 148 Z" fill="var(--superficie-3)"/>
      <path d="M200 130 L330 105 L330 158 L200 185 Z" fill="var(--superficie-2)"/>
    </g>

    <!-- ventanas -->
    <g fill="var(--marca)" opacity=".55">
      ${[0, 1, 2].map((f) => [0, 1, 2, 3].map((c) =>
        `<rect x="${212 + c * 27}" y="${138 + f * 15}" width="17" height="9" rx="1.5" transform="skewY(-11)"/>`
      ).join("")).join("")}
    </g>
    <g fill="var(--acento)" opacity=".4">
      ${[0, 1, 2].map((f) => [0, 1].map((c) =>
        `<rect x="${134 + c * 26}" y="${104 + f * 15}" width="16" height="9" rx="1.5" transform="skewY(26)"/>`
      ).join("")).join("")}
    </g>

    <!-- jardín -->
    <g fill="var(--ok)" opacity=".55">
      <ellipse cx="72" cy="176" rx="30" ry="9"/>
      <ellipse cx="352" cy="166" rx="26" ry="8"/>
    </g>
    <g fill="var(--ok)">
      <circle cx="64" cy="158" r="13"/><rect x="62" y="166" width="4" height="14" fill="var(--warm-dim, #8a5a3a)"/>
      <circle cx="90" cy="163" r="9"/><rect x="88" y="169" width="3" height="10" fill="var(--warm-dim, #8a5a3a)"/>
      <circle cx="356" cy="150" r="11"/><rect x="354" y="157" width="4" height="12" fill="var(--warm-dim, #8a5a3a)"/>
    </g>

    <!-- marcador -->
    <g transform="translate(255,52)">
      <path d="M0 22 C-9 10 -13 6 -13 0 A13 13 0 1 1 13 0 C13 6 9 10 0 22 Z" fill="var(--marca)"/>
      <circle cy="0" r="5" fill="var(--superficie)"/>
    </g>
  </svg>`;
}
