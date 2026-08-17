/* ======================================================================
   espacio.js — Ficha completa de una oficina o sala:
   galería, vista 360°, video, descripción, amenidades, servicios,
   reglamento, horarios, ubicación en el mapa 3D, reseñas y reserva.
   ====================================================================== */
import { html, raw, esc, isoFecha, formatMoneda, fechaLarga, urlSegura } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { toastOk, toastError, abrirHoja, compartir, confirmar, vacio } from "../core/ui.js";
import { ir } from "../core/router.js";
import { vibrar } from "../core/haptics.js";
import store from "../core/store.js";
import api from "../data/api.js";
import { CONTACT, FEATURES, BOOKING } from "../core/config.js";
import { on as onBus, EV } from "../core/bus.js";
import {
  galeriaHtml, activarGaleria, visor360Html, activarVisor360, amenidadesHtml,
  selectorDias, rejillaHorarios, listaResenas, resumenCalificacion, insigniaEstado, estrellasHtml,
} from "./componentes.js";

export const titulo = () => estado.espacio?.nombre || t("app.cargando");
export const subtitulo = () => estado.espacio?.codigo || "";

const estado = { espacio: null, fecha: isoFecha(), bloque: null, disponibilidad: [], amenidades: [], resenas: [] };
let desuscribir = [];

export async function render(contenedor, ctx) {
  const id = ctx.params.id;
  estado.fecha = ctx.query.get("fecha") || isoFecha();
  estado.bloque = null;

  contenedor.innerHTML = `<div class="vista-scroll"><div class="vista-contenido">
    <div class="esqueleto" style="height:220px;border-radius:var(--r)"></div>
    <div class="esqueleto esq-linea mt-4" style="width:60%;height:22px"></div>
    <div class="esqueleto esq-linea" style="width:40%"></div>
    <div class="esqueleto esq-tarjeta mt-4"></div>
  </div></div>`;

  const [espacio, amenidades] = await Promise.all([api.getEspacio(id), api.getAmenidades()]);
  if (!espacio) {
    contenedor.innerHTML = `<div class="vista-scroll">${vacio({
      ico: "🏚️", titulo: "Espacio no encontrado",
      desc: "Puede que lo hayan retirado del catálogo.",
      accion: '<a class="btn btn-primario" href="#/espacios">Ver catálogo</a>',
    })}</div>`;
    return;
  }
  estado.espacio = espacio;
  estado.amenidades = amenidades;

  pintar(contenedor);

  // Cargas secundarias
  Promise.all([
    api.getDisponibilidad(espacio.id, estado.fecha),
    FEATURES.resenas ? api.getResenas(espacio.id) : Promise.resolve([]),
  ]).then(([disp, resenas]) => {
    estado.disponibilidad = disp;
    estado.resenas = resenas;
    pintarHorarios(contenedor);
    pintarResenas(contenedor);
  });

  desuscribir.push(onBus(EV.DISPONIBILIDAD_CAMBIO, async ({ espacioId }) => {
    if (String(espacioId) !== String(estado.espacio.id)) return;
    estado.disponibilidad = await api.getDisponibilidad(estado.espacio.id, estado.fecha, { forzar: true });
    pintarHorarios(contenedor);
  }));
}

export function destruir() {
  desuscribir.forEach((f) => { try { f(); } catch { /* ignora */ } });
  desuscribir = [];
}

/* ---------------------------------------------------------------------
   Render principal
   --------------------------------------------------------------------- */
function pintar(contenedor) {
  const e = estado.espacio;
  const favorito = store.esFavorito(e.id);
  const precio = Number(e.precio_hora ?? e.precioHora ?? 0);
  // Un `href` con esquema javascript: ejecuta al hacer clic aunque las
  // comillas estén escapadas, así que la URL se valida, no sólo se escapa.
  const panorama = urlSegura(e.panorama_url || e.panoramas?.[0] || "");
  const tourSeguro = urlSegura(e.tour_url);
  const reservable = api.esReservableV1(e) && e.estado === "disponible";

  contenedor.innerHTML = html`
    <div class="vista-scroll ficha">
      <div class="ficha-medios">
        ${raw(galeriaHtml(e))}
        <div class="ficha-acciones">
          <button type="button" class="btn btn-icono ficha-btn" data-fav aria-pressed="${favorito}"
                  aria-label="${favorito ? "Quitar de favoritos" : "Agregar a favoritos"}">
            ${raw(icono(favorito ? "corazonLleno" : "corazon", { size: 20 }))}
          </button>
          <button type="button" class="btn btn-icono ficha-btn" data-compartir aria-label="Compartir">
            ${raw(icono("compartir", { size: 18 }))}
          </button>
        </div>
        ${(panorama || e.tour_url) ? raw(`<div class="ficha-tabs-medios">
          ${panorama ? `<button type="button" class="chip" data-ver360>${icono("vista360", { size: 14 })} ${esc(t("espacio.vista360"))}</button>` : ""}
          ${tourSeguro ? `<a class="chip" href="${esc(tourSeguro)}" target="_blank" rel="noopener noreferrer">${icono("cubo", { size: 14 })} ${esc(t("espacio.recorrido"))}</a>` : ""}
        </div>`) : ""}
      </div>

      <div class="vista-contenido">
        <header class="ficha-cab">
          <div class="fila-sep">
            <div class="crece">
              <p class="eyebrow">${e.codigo}</p>
              <h1>${e.nombre}</h1>
            </div>
            ${precio ? raw(`<div class="ficha-precio">
              <strong>${esc(formatMoneda(precio))}</strong><span>/${esc(t("espacio.porHora").replace("por ", ""))}</span>
              ${e.precio_dia ? `<div class="texto-xs texto-dim">${esc(formatMoneda(e.precio_dia))} ${esc(t("espacio.porDia"))}</div>` : ""}
            </div>`) : ""}
          </div>
          <div class="fila envolver mt-2" style="gap:8px">
            ${insigniaEstado(e)}
            ${e.capacidad ? raw(`<span class="chip">${icono("personas", { size: 14 })} ${e.capacidad} ${esc(t("espacio.personas", { n: e.capacidad }).replace(/^\d+\s*/, ""))}</span>`) : ""}
            ${Number(e.calificacion) > 0 ? raw(`<span class="chip chip-warm">★ ${Number(e.calificacion).toFixed(1)} · ${e.total_resenas}</span>`) : ""}
            ${e.tipo ? raw(`<span class="chip">${esc(nombreTipo(e.tipo))}</span>`) : ""}
          </div>
        </header>

        ${reservable ? raw(`
        <section class="seccion tarjeta tarjeta-pad" id="sec-reserva">
          <div class="seccion-cab"><h2>${esc(t("reserva.elegirHorario"))}</h2>
            <button type="button" class="enlace" data-calendario>${icono("calendario", { size: 14 })} Ver calendario</button>
          </div>
          <div id="ficha-dias">${selectorDias(estado.fecha)}</div>
          <p class="texto-sm texto-dim mt-2" id="ficha-fecha">${esc(fechaLarga(estado.fecha))}</p>
          <div id="ficha-horarios" class="mt-2">
            <div class="esqueleto" style="height:88px"></div>
          </div>
        </section>`) : raw(`
        <div class="aviso aviso-warm">
          ${e.estado === "proximamente" ? "Este espacio estará disponible próximamente." : ""}
          ${e.estado === "mantenimiento" ? "Este espacio está en mantenimiento y no se puede reservar por ahora." : ""}
          ${e.estado === "reservada" ? "Este espacio está ocupado en este momento." : ""}
          ${!api.esReservableV1(e) ? "Este es un espacio común del edificio, no se reserva." : ""}
        </div>`)}

        ${e.descripcion ? raw(`<section class="seccion">
          <h2 class="seccion-titulo">${esc(t("espacio.descripcion"))}</h2>
          <p>${esc(e.descripcion)}</p>
        </section>`) : ""}

        ${e.amenidades?.length ? raw(`<section class="seccion">
          <h2 class="seccion-titulo">${esc(t("espacio.amenidades"))}</h2>
          ${amenidadesHtml(e.amenidades, estado.amenidades)}
        </section>`) : ""}

        ${e.servicios?.length ? raw(`<section class="seccion">
          <h2 class="seccion-titulo">${esc(t("espacio.servicios"))}</h2>
          <ul class="lista-puntos">${e.servicios.map((s) => `<li>${icono("check", { size: 15 })}<span>${esc(s)}</span></li>`).join("")}</ul>
        </section>`) : ""}

        <section class="seccion">
          <h2 class="seccion-titulo">${t("espacio.horarios")}</h2>
          <div class="tarjeta tarjeta-pad texto-sm">
            <div class="fila-sep"><span>Bloques configurados</span><strong class="mono">${esc(BOOKING.bloques.join(", "))}</strong></div>
            <p class="texto-xs texto-dim mt-2">La disponibilidad real depende de la fecha y se consulta antes de reservar.</p>
          </div>
        </section>

        ${e.reglamento ? raw(`<section class="seccion">
          <h2 class="seccion-titulo">${esc(t("espacio.reglamento"))}</h2>
          <p class="texto-sm texto-dim">${esc(e.reglamento)}</p>
        </section>`) : ""}

        ${FEATURES.mapa3d ? raw(`<section class="seccion">
          <h2 class="seccion-titulo">${esc(t("espacio.ubicacion"))}</h2>
          <a class="tarjeta banner-mapa" href="#/mapa?espacio=${encodeURIComponent(e.id)}">
            <span class="bm-txt">
              <strong>Ver en el mapa 3D</strong>
              <span class="texto-sm">Ubica este espacio dentro del edificio</span>
            </span>
            <span class="bm-ico" aria-hidden="true">${icono("ubicacion", { size: 26 })}</span>
          </a>
        </section>`) : ""}

        ${FEATURES.resenas ? raw(`<section class="seccion" id="sec-resenas">
          <div class="seccion-cab"><h2>${esc(t("espacio.resenas"))}</h2></div>
          <div class="esqueleto" style="height:80px"></div>
        </section>`) : ""}

        ${(CONTACT.whatsapp || CONTACT.telefono || CONTACT.email || FEATURES.chat) ? raw(`<section class="seccion">
          <h2 class="seccion-titulo">¿Dudas sobre este espacio?</h2>
          <div class="grid-3">
            ${CONTACT.whatsapp ? `<a class="btn btn-contorno" href="https://wa.me/${esc(CONTACT.whatsapp)}?text=${encodeURIComponent(`Hola, tengo una pregunta sobre ${e.nombre} (${e.codigo}).`)}" target="_blank" rel="noopener">
              ${icono("whatsapp", { size: 17 })} WhatsApp</a>` : ""}
            ${CONTACT.telefono ? `<a class="btn btn-contorno" href="tel:${esc(CONTACT.telefono)}">${icono("telefono", { size: 17 })} Llamar</a>` : ""}
            ${CONTACT.email ? `<a class="btn btn-contorno" href="mailto:${esc(CONTACT.email)}?subject=${encodeURIComponent(`Consulta sobre ${e.nombre}`)}">${icono("correo", { size: 17 })} Correo</a>` : ""}
            ${FEATURES.chat ? `<a class="btn btn-contorno" href="#/chat">${icono("chat", { size: 17 })} Chat</a>` : ""}
          </div>
        </section>`) : ""}
      </div>

      ${reservable ? raw(`
      <div class="barra-accion" id="barra-reserva">
        <div class="crece">
          <strong id="ba-precio">${esc(formatMoneda(precio))}</strong>
          <span class="texto-xs texto-dim" id="ba-detalle">Elige un horario</span>
        </div>
        <button type="button" class="btn btn-primario btn-lg" id="ba-btn" disabled>${esc(t("espacio.reservar"))}</button>
      </div>`) : ""}
    </div>`;

  activarGaleria(contenedor);
  enlazarEventos(contenedor);
  if (estado.disponibilidad.length) pintarHorarios(contenedor);
  if (estado.resenas.length) pintarResenas(contenedor);
}

function nombreTipo(tipo) {
  return {
    oficina: "Oficina privada", sala_juntas: "Sala de juntas", coworking: "Coworking",
    auditorio: "Auditorio", estacionamiento: "Estacionamiento", servicio: "Servicio", comun: "Área común",
  }[tipo] || tipo;
}

/* ---------------------------------------------------------------------
   Eventos
   --------------------------------------------------------------------- */
function enlazarEventos(contenedor) {
  const e = estado.espacio;

  contenedor.addEventListener("click", async (ev) => {
    /* favorito */
    if (ev.target.closest("[data-fav]")) {
      const btn = ev.target.closest("[data-fav]");
      try {
        const activo = await api.alternarFavorito(e.id);
        btn.setAttribute("aria-pressed", String(activo));
        btn.innerHTML = icono(activo ? "corazonLleno" : "corazon", { size: 20 });
        vibrar("seleccion");
        toastOk(activo ? t("favoritos.agregado") : t("favoritos.quitado"));
      } catch (err) { toastError(err.message); }
      return;
    }

    /* compartir */
    if (ev.target.closest("[data-compartir]")) {
      compartir({
        titulo: e.nombre,
        texto: `${e.nombre} · ${formatMoneda(e.precio_hora)}/h en ${store.get().organizacion?.nombre || "el centro de oficinas"}`,
        url: `${location.origin}${location.pathname}#/espacios/${e.id}`,
      });
      return;
    }

    /* vista 360 */
    if (ev.target.closest("[data-ver360]")) {
      const { cuerpo } = abrirHoja({ titulo: t("espacio.vista360"), contenido: visor360Html(panorama) });
      activarVisor360(cuerpo);
      return;
    }

    /* calendario completo */
    if (ev.target.closest("[data-calendario]")) return abrirCalendario(contenedor);

    /* día */
    const dia = ev.target.closest("[data-dia]");
    if (dia) {
      estado.fecha = dia.dataset.dia;
      estado.bloque = null;
      contenedor.querySelectorAll("[data-dia]").forEach((d) => d.setAttribute("aria-pressed", String(d === dia)));
      contenedor.querySelector("#ficha-fecha").textContent = fechaLarga(estado.fecha);
      contenedor.querySelector("#ficha-horarios").innerHTML = '<div class="esqueleto" style="height:88px"></div>';
      actualizarBarra(contenedor);
      estado.disponibilidad = await api.getDisponibilidad(e.id, estado.fecha);
      pintarHorarios(contenedor);
      vibrar("toque");
      return;
    }

    /* reintentar la consulta de disponibilidad */
    if (ev.target.closest("[data-reintentar-disp]")) {
      contenedor.querySelector("#ficha-horarios").innerHTML =
        '<div class="esqueleto" style="height:88px"></div>';
      estado.disponibilidad = await api.getDisponibilidad(estado.espacio.id, estado.fecha, { forzar: true });
      pintarHorarios(contenedor);
      return;
    }

    /* bloque horario */
    const bloque = ev.target.closest("[data-bloque]");
    if (bloque && !bloque.disabled) {
      estado.bloque = estado.bloque === bloque.dataset.bloque ? null : bloque.dataset.bloque;
      contenedor.querySelectorAll("[data-bloque]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.bloque === estado.bloque)));
      actualizarBarra(contenedor);
      vibrar("seleccion");
      return;
    }

    /* lista de espera */
    if (ev.target.closest("[data-espera]")) return unirseListaEspera();

    /* reservar */
    if (ev.target.closest("#ba-btn")) {
      if (!store.get().sesion) {
        return ir(`/login?redirect=${encodeURIComponent(`/espacios/${e.id}/reservar?fecha=${estado.fecha}&bloque=${estado.bloque}`)}`);
      }
      ir(`/espacios/${e.id}/reservar?fecha=${estado.fecha}&bloque=${encodeURIComponent(estado.bloque)}`);
    }
  });
}

function pintarHorarios(contenedor) {
  const cont = contenedor.querySelector("#ficha-horarios");
  if (!cont) return;
  cont.innerHTML = rejillaHorarios(estado.disponibilidad, { fecha: estado.fecha, seleccion: estado.bloque });
  actualizarBarra(contenedor);
}

function actualizarBarra(contenedor) {
  const btn = contenedor.querySelector("#ba-btn");
  const detalle = contenedor.querySelector("#ba-detalle");
  const precioEl = contenedor.querySelector("#ba-precio");
  if (!btn) return;

  const precio = Number(estado.espacio.precio_hora || 0);
  if (estado.bloque) {
    const horas = 2;
    btn.disabled = false;
    precioEl.textContent = formatMoneda(precio * horas);
    detalle.textContent = `${fechaLarga(estado.fecha)} · ${estado.bloque.replace("-", "–")}`;
  } else {
    btn.disabled = true;
    precioEl.textContent = formatMoneda(precio);
    detalle.textContent = "Elige un horario";
  }
}

async function pintarResenas(contenedor) {
  const sec = contenedor.querySelector("#sec-resenas");
  if (!sec) return;
  const resenas = estado.resenas;
  sec.innerHTML = html`
    <div class="seccion-cab">
      <h2>${t("espacio.resenas")}</h2>
      ${resenas.length ? estrellasHtml(estado.espacio.calificacion, { total: estado.espacio.total_resenas }) : ""}
    </div>
    ${resenas.length ? raw(resumenCalificacion(resenas)) : ""}
    ${raw(listaResenas(resenas))}`;
}

/* ---------------------------------------------------------------------
   Calendario mensual
   --------------------------------------------------------------------- */
async function abrirCalendario(contenedor) {
  const { calendarioMes } = await import("./componentes.js");
  const hoy = new Date();
  let anio = hoy.getFullYear(), mes = hoy.getMonth();

  const { el, cuerpo, cerrar } = abrirHoja({
    titulo: t("reserva.fecha"),
    contenido: calendarioMes(anio, mes, { seleccion: estado.fecha }),
  });

  el.addEventListener("click", async (ev) => {
    const nav = ev.target.closest("[data-mes]");
    if (nav) {
      mes += Number(nav.dataset.mes);
      if (mes < 0) { mes = 11; anio--; }
      if (mes > 11) { mes = 0; anio++; }
      cuerpo.innerHTML = calendarioMes(anio, mes, { seleccion: estado.fecha });
      return;
    }
    const dia = ev.target.closest("[data-dia]");
    if (dia && !dia.disabled) {
      estado.fecha = dia.dataset.dia;
      estado.bloque = null;
      cerrar();
      contenedor.querySelector("#ficha-fecha").textContent = fechaLarga(estado.fecha);
      contenedor.querySelector("#ficha-dias").innerHTML = selectorDias(estado.fecha);
      contenedor.querySelector("#ficha-horarios").innerHTML = '<div class="esqueleto" style="height:88px"></div>';
      estado.disponibilidad = await api.getDisponibilidad(estado.espacio.id, estado.fecha);
      pintarHorarios(contenedor);
    }
  });
}

/* ---------------------------------------------------------------------
   Lista de espera
   --------------------------------------------------------------------- */
async function unirseListaEspera() {
  if (!store.get().sesion) return ir(`/login?redirect=${encodeURIComponent(`/espacios/${estado.espacio.id}`)}`);
  const ok = await confirmar({
    titulo: t("reserva.listaEspera"),
    mensaje: `Te avisaremos en cuanto se libere un horario en ${estado.espacio.nombre} el ${fechaLarga(estado.fecha)}.`,
    aceptar: "Avisarme",
  });
  if (!ok) return;
  try {
    await api.apuntarseListaEspera(estado.espacio.id, estado.fecha, null);
    toastOk(t("reserva.enListaEspera"));
    vibrar("exito");
  } catch (e) { toastError(e.message); }
}
