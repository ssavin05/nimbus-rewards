/* ======================================================================
   componentes.js — Piezas de interfaz compartidas entre vistas:
   tarjeta de espacio, selector de día, rejilla de horarios, galería,
   estrellas, insignias de estado.
   ====================================================================== */
import { html, raw, esc, formatMoneda, etiquetaDia, isoFecha, rangoDias, fechaLarga,
         bloqueEnPasado, promedio, truncar, localeActual, urlMedioSegura } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import store from "../core/store.js";
import { BOOKING } from "../core/config.js";

/* ---------------------------------------------------------------------
   Estado / disponibilidad
   --------------------------------------------------------------------- */
export const ETIQUETA_ESTADO = {
  disponible: () => t("espacio.disponible"),
  reservada: () => t("espacio.reservada"),
  mantenimiento: () => t("espacio.mantenimiento"),
  proximamente: () => t("espacio.proximamente"),
  inactiva: () => t("espacio.inactiva"),
};

/** Clase de color según cuántos bloques quedan libres. */
export function nivelDisponibilidad(libres, total) {
  if (!total || libres <= 0) return "taken";
  if (libres >= total) return "ok";
  return "warm";
}

export function insigniaEstado(espacio, disponibilidad = null) {
  if (!espacio?.reservable) {
    return html`<span class="chip chip-taken"><i class="punto punto-taken"></i>${t("espacio.noReservable")}</span>`;
  }
  if (espacio.estado && espacio.estado !== "disponible") {
    const clase = { reservada: "taken", mantenimiento: "neutro", proximamente: "purple", inactiva: "neutro" }[espacio.estado] || "neutro";
    return html`<span class="chip chip-${raw(clase)}"><i class="punto punto-${raw(clase)}"></i>${ETIQUETA_ESTADO[espacio.estado]?.() || espacio.estado}</span>`;
  }
  if (disponibilidad) {
    const { libres, total } = disponibilidad;
    const nivel = nivelDisponibilidad(libres, total);
    const texto = libres === 0 ? t("espacio.sinHorariosHoy") : t("espacio.libresHoy", { n: libres, total });
    return html`<span class="chip chip-${raw(nivel)}"><i class="punto punto-${raw(nivel)}"></i>${texto}</span>`;
  }
  return html`<span class="chip chip-ok"><i class="punto punto-ok"></i>${t("espacio.disponible")}</span>`;
}

/* ---------------------------------------------------------------------
   Tarjeta de espacio
   --------------------------------------------------------------------- */
export function tarjetaEspacio(espacio, { disponibilidad = null, compacta = false, mostrarFavorito = true } = {}) {
  if (espacio?.tipo === "oficina" && !urlMedioSegura(espacio.portada) && !espacio?.fotos?.some((f) => urlMedioSegura(f?.url) && !f?.es_360)) return "";
  const favorito = store.esFavorito(espacio.id);
  const precio = Number(espacio.precio_hora ?? espacio.precioHora ?? 0);
  const cal = Number(espacio.calificacion || 0);

  return html`
  <article class="tarjeta tarjeta-espacio${raw(compacta ? " compacta" : "")}" data-espacio="${espacio.id}">
    <a class="te-medio" href="#/espacios/${espacio.id}" aria-label="${espacio.nombre}">
      ${urlMedioSegura(espacio.portada)
        ? raw(`<img src="${esc(urlMedioSegura(espacio.portada))}" alt="${esc(espacio.nombre)}" loading="lazy" decoding="async">`)
        : raw(`<span class="te-sin-foto" aria-hidden="true">Sin foto</span>`)}
      ${espacio.estado !== "disponible" ? raw(`<span class="galeria-etiqueta">${esc(ETIQUETA_ESTADO[espacio.estado]?.() || "")}</span>`) : ""}
    </a>
    <div class="te-cuerpo">
      <div class="fila-sep">
        <a class="te-titulo" href="#/espacios/${espacio.id}">${espacio.nombre}</a>
        ${mostrarFavorito ? raw(`
          <button type="button" class="btn btn-fantasma btn-icono btn-sm te-fav" data-fav="${esc(espacio.id)}"
                  aria-pressed="${favorito}" aria-label="${esc(favorito ? t("espacio.quitarFavorito") : t("espacio.agregarFavorito"))}">
            ${icono(favorito ? "corazonLleno" : "corazon", { size: 18 })}
          </button>`) : ""}
      </div>
      <p class="te-meta">
        <span class="mono">${espacio.codigo}</span>
        ${espacio.capacidad ? raw(` · ${icono("personas", { size: 13 })} ${espacio.capacidad}`) : ""}
        ${cal > 0 ? raw(` · <span class="te-cal">★ ${cal.toFixed(1)}</span> <span class="texto-suave">(${espacio.total_resenas || 0})</span>`) : ""}
      </p>
      ${!compacta && espacio.descripcion ? raw(`<p class="te-desc">${esc(truncar(espacio.descripcion, 96))}</p>`) : ""}
      <div class="fila-sep te-pie">
        ${insigniaEstado(espacio, disponibilidad)}
        ${precio > 0
          ? raw(`<span class="te-precio">${esc(formatMoneda(precio))}<small>/h</small></span>`)
          : raw(`<span class="texto-sm texto-dim">${esc(t("espacio.noReservable"))}</span>`)}
      </div>
    </div>
  </article>`;
}

/** Fila compacta para listas y resultados de búsqueda. */
export function filaEspacio(espacio, extra = "") {
  const precio = Number(espacio.precio_hora ?? espacio.precioHora ?? 0);
  return html`
  <a class="lista-item" href="#/espacios/${espacio.id}">
    <span class="li-ico">${espacio.icono || "🏢"}</span>
    <span class="li-txt">
      <span class="li-titulo">${espacio.nombre}</span>
      <span class="li-sub">${espacio.codigo}${espacio.capacidad ? ` · ${espacio.capacidad} personas` : ""}${extra ? ` · ${extra}` : ""}</span>
    </span>
    <span class="li-fin">${precio ? formatMoneda(precio) + "/h" : ""}${raw(icono("chevron", { size: 16 }))}</span>
  </a>`;
}

/* ---------------------------------------------------------------------
   Calendario rápido
   --------------------------------------------------------------------- */
export function selectorDias(fechaSel = isoFecha(), dias = BOOKING.diasVisibles) {
  const fechas = rangoDias(dias);
  return html`
  <div class="cinta selector-dias" role="group" aria-label="${t("reserva.fecha")}">
    ${fechas.map((d, i) => {
      const iso = isoFecha(d);
      const { top, num } = etiquetaDia(d, i, t);
      const activo = iso === fechaSel;
      return raw(`<button type="button" class="dia-pill" data-dia="${iso}" aria-pressed="${activo}">
        <span class="dp-top">${esc(top)}</span><span class="dp-num">${num}</span>
      </button>`);
    })}
  </div>`;
}

/** Calendario mensual completo, para elegir fechas lejanas. */
export function calendarioMes(anio, mes, { seleccion = null, disponibles = null, minimo = new Date() } = {}) {
  const primero = new Date(anio, mes, 1);
  const dias = new Date(anio, mes + 1, 0).getDate();
  const offset = (primero.getDay() + 6) % 7;   // semana que empieza en lunes
  const nombreMes = primero.toLocaleDateString(localeActual(), { month: "long", year: "numeric" });
  const min0 = new Date(minimo); min0.setHours(0, 0, 0, 0);

  let celdas = "";
  for (let i = 0; i < offset; i++) celdas += '<span class="cal-celda vacia"></span>';
  for (let d = 1; d <= dias; d++) {
    const fecha = new Date(anio, mes, d);
    const iso = isoFecha(fecha);
    const pasado = fecha < min0;
    const libre = !disponibles || disponibles[iso] !== 0;
    const sel = seleccion === iso;
    celdas += `<button type="button" class="cal-celda${sel ? " sel" : ""}${!libre ? " lleno" : ""}"
      data-dia="${iso}" ${pasado ? "disabled" : ""} aria-pressed="${sel}">${d}</button>`;
  }

  return html`
  <div class="calendario">
    <div class="cal-cab">
      <button type="button" class="btn btn-fantasma btn-icono btn-sm" data-mes="-1" aria-label="Mes anterior">${raw(icono("atras", { size: 16 }))}</button>
      <strong>${nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)}</strong>
      <button type="button" class="btn btn-fantasma btn-icono btn-sm" data-mes="1" aria-label="Mes siguiente">${raw(icono("adelante", { size: 16 }))}</button>
    </div>
    <div class="cal-semana">${["L", "M", "M", "J", "V", "S", "D"].map((d) => raw(`<span>${d}</span>`))}</div>
    <div class="cal-rejilla">${raw(celdas)}</div>
  </div>`;
}

/* ---------------------------------------------------------------------
   Bloques horarios
   --------------------------------------------------------------------- */
export function rejillaHorarios(disponibilidad, { fecha = isoFecha(), seleccion = null } = {}) {
  // Tres casos distintos, y hay que separarlos.
  //
  // `null` es «no se sabe»: el servidor no contestó. Antes caía en el
  // mismo saco que «todavía no ha llegado» y se quedaba un esqueleto
  // girando para siempre, que le dice a la persona que espere algo que
  // no va a venir. Se dice la verdad y se ofrece reintentar.
  if (disponibilidad === null) {
    return html`
      <div class="aviso-espera">
        <p class="texto-sm">No pudimos consultar la disponibilidad.</p>
        <button type="button" class="btn btn-contorno btn-sm" data-reintentar-disp>
          ${raw(icono("refrescar", { size: 15 }))} Reintentar
        </button>
      </div>`;
  }
  // `undefined` sí es «todavía cargando».
  if (disponibilidad === undefined) {
    return html`<div class="esqueleto" style="height:96px"></div>`;
  }
  // `[]` es «ese día no abre».
  if (!disponibilidad.length) {
    return html`<p class="texto-sm texto-dim">Ese día no hay horarios disponibles.</p>`;
  }
  const hayLibres = disponibilidad.some((b) => b.libre && !bloqueEnPasado(fecha, b.bloque));
  const rejilla = html`
    <div class="bloques-grid" role="group" aria-label="${t("reserva.horario")}">
      ${disponibilidad.map(({ bloque, libre }) => {
        const pasado = bloqueEnPasado(fecha, bloque);
        const deshabilitado = !libre || pasado;
        const sel = seleccion === bloque;
        return raw(`<button type="button" class="bloque" data-bloque="${esc(bloque)}"
          aria-pressed="${sel}" ${deshabilitado ? "disabled" : ""}
          title="${deshabilitado ? (pasado ? "Ya pasó" : "Ocupado") : "Disponible"}">
          ${esc(bloque.replace("-", " – "))}
        </button>`);
      })}
    </div>`;
  if (hayLibres) return rejilla;
  return raw(rejilla + html`
    <div class="aviso-espera">
      <p class="texto-sm">${t("reserva.nadaDisponible")}</p>
      <button type="button" class="btn btn-contorno btn-sm" data-espera>${raw(icono("campana", { size: 15 }))} ${t("reserva.listaEspera")}</button>
    </div>`);
}

/* ---------------------------------------------------------------------
   Estrellas
   --------------------------------------------------------------------- */
export function estrellasHtml(valor, { conNumero = true, total = null } = {}) {
  const v = Number(valor) || 0;
  const llenas = Math.round(v);
  return html`<span class="fila" style="gap:6px">
    <span class="estrellas" aria-label="${v.toFixed(1)} de 5">${raw("★".repeat(llenas) + "☆".repeat(5 - llenas))}</span>
    ${conNumero ? raw(`<span class="texto-sm texto-dim">${v.toFixed(1)}${total != null ? ` (${total})` : ""}</span>`) : ""}
  </span>`;
}

export function selectorEstrellas(valor = 0) {
  return html`<div class="estrellas-input" role="radiogroup" aria-label="Calificación">
    ${[1, 2, 3, 4, 5].map((n) => raw(
      `<button type="button" data-estrella="${n}" data-on="${n <= valor}" role="radio" aria-checked="${n === valor}" aria-label="${n} estrella${n > 1 ? "s" : ""}">★</button>`
    ))}
  </div>`;
}

/* ---------------------------------------------------------------------
   Amenidades
   --------------------------------------------------------------------- */
export function amenidadesHtml(claves = [], catalogo = []) {
  if (!claves?.length) return "";
  const mapa = new Map(catalogo.map((a) => [a.clave, a]));
  return html`<div class="amenidades">
    ${claves.map((k) => {
      const a = mapa.get(k);
      return raw(`<span class="chip"><span aria-hidden="true">${esc(a?.icono || "•")}</span>${esc(a?.etiqueta || k)}</span>`);
    })}
  </div>`;
}

/* ---------------------------------------------------------------------
   Galería con puntos, vídeo y vista 360°
   --------------------------------------------------------------------- */
export function galeriaHtml(espacio) {
  const fotos = espacio.fotos?.filter((f) => !f.es_360) || [];
  const slides = [];

  if (fotos.length) {
    for (const f of fotos) {
      const u = urlMedioSegura(f.url);
      if (u) slides.push(`<div class="galeria-slide"><img src="${esc(u)}" alt="${esc(f.titulo || espacio.nombre)}" loading="lazy" decoding="async"></div>`);
    }
  } else {
    slides.push(`<div class="galeria-slide"><span class="galeria-sin-foto" aria-hidden="true">Sin foto disponible</span></div>`);
  }
  const video = urlMedioSegura(espacio.video_url);
  if (video) {
    slides.push(`<div class="galeria-slide">
      <video src="${esc(video)}" controls playsinline preload="none"
             poster="${esc(urlMedioSegura(espacio.portada) || "")}"></video>
      <span class="galeria-etiqueta">${esc(t("espacio.video"))}</span>
    </div>`);
  }

  return html`
  <div class="galeria" data-galeria>
    <div class="galeria-pista">${raw(slides.join(""))}</div>
    ${slides.length > 1 ? raw(`<div class="galeria-puntos">${slides.map((_, i) => `<i data-on="${i === 0}"></i>`).join("")}</div>`) : ""}
  </div>`;
}

/** Engancha los puntos de la galería al desplazamiento horizontal. */
export function activarGaleria(raiz) {
  const g = raiz.querySelector("[data-galeria]");
  if (!g) return;
  const pista = g.querySelector(".galeria-pista");
  const puntos = [...g.querySelectorAll(".galeria-puntos i")];
  if (!pista || !puntos.length) return;
  pista.addEventListener("scroll", () => {
    const i = Math.round(pista.scrollLeft / pista.clientWidth);
    puntos.forEach((p, j) => p.setAttribute("data-on", String(j === i)));
  }, { passive: true });
  puntos.forEach((p, i) => p.addEventListener("click", () => {
    pista.scrollTo({ left: i * pista.clientWidth, behavior: "smooth" });
  }));
}

/* ---------------------------------------------------------------------
   Visor 360° (imagen equirectangular arrastrable, sin WebGL)
   --------------------------------------------------------------------- */
export function visor360Html(url) {
  const u = urlMedioSegura(url);
  if (!u) return html`<p class="texto-sm texto-dim">${t("espacio.vista360")}: URL no válida.</p>`;
  return html`
  <div class="visor360" data-visor360>
    <img src="${u}" alt="${t("espacio.vista360")}" draggable="false">
    <span class="visor360-hint">${raw(icono("vista360", { size: 13 }))} arrastra para mirar alrededor</span>
  </div>`;
}

export function activarVisor360(raiz) {
  const v = raiz.querySelector("[data-visor360]");
  if (!v) return;
  const img = v.querySelector("img");
  let x = 0, arrastrando = false, inicio = 0, base = 0;

  const aplicar = () => { img.style.transform = `translateX(${x}px)`; };
  const abajo = (e) => {
    arrastrando = true; v.classList.add("arrastrando");
    inicio = (e.touches?.[0] || e).clientX; base = x;
  };
  const mover = (e) => {
    if (!arrastrando) return;
    const dx = (e.touches?.[0] || e).clientX - inicio;
    const limite = Math.max(0, img.scrollWidth - v.clientWidth);
    x = Math.min(0, Math.max(-limite, base + dx));
    aplicar();
  };
  const arriba = () => { arrastrando = false; v.classList.remove("arrastrando"); };

  v.addEventListener("mousedown", abajo);
  v.addEventListener("touchstart", abajo, { passive: true });
  window.addEventListener("mousemove", mover);
  v.addEventListener("touchmove", mover, { passive: true });
  window.addEventListener("mouseup", arriba);
  v.addEventListener("touchend", arriba);
}

/* ---------------------------------------------------------------------
   Resumen de precio (checkout)
   --------------------------------------------------------------------- */
export function resumenPrecio({ subtotal, descuento = 0, impuestos, total, tasa = 0.16, promocion = null }) {
  return html`
  <div class="resumen">
    <div class="fila-sep"><span>${t("reserva.subtotal")}</span><strong class="mono">${formatMoneda(subtotal)}</strong></div>
    ${descuento > 0 ? raw(`<div class="fila-sep resumen-desc">
      <span>${esc(t("reserva.descuento"))}${promocion ? ` · ${esc(promocion.codigo)}` : ""}</span>
      <strong class="mono">−${esc(formatMoneda(descuento))}</strong></div>`) : ""}
    <div class="fila-sep"><span>${t("reserva.impuestos", { p: Math.round(tasa * 100) + " %" })}</span><strong class="mono">${formatMoneda(impuestos)}</strong></div>
    <div class="fila-sep resumen-total"><span>${t("reserva.total")}</span><strong class="mono">${formatMoneda(total)}</strong></div>
  </div>`;
}

/* ---------------------------------------------------------------------
   Tarjeta de reserva
   --------------------------------------------------------------------- */
const CLASE_ESTADO_RESERVA = {
  pendiente: "warm", confirmada: "ok", en_curso: "ok",
  completada: "neutro", cancelada: "taken", no_asistio: "taken",
};
const TEXTO_ESTADO_RESERVA = {
  pendiente: "Pendiente de pago", confirmada: "Confirmada", en_curso: "En curso",
  completada: "Completada", cancelada: "Cancelada", no_asistio: "No asistió",
};

export function tarjetaReserva(reserva) {
  const espacio = reserva.espacios || store.getEspacio(reserva.espacio_id) || {};
  const inicio = new Date(reserva.inicio);
  const fin = new Date(reserva.fin);
  const hora = `${String(inicio.getHours()).padStart(2, "0")}:${String(inicio.getMinutes()).padStart(2, "0")} – ${String(fin.getHours()).padStart(2, "0")}:${String(fin.getMinutes()).padStart(2, "0")}`;
  const clase = CLASE_ESTADO_RESERVA[reserva.estado] || "neutro";

  return html`
  <a class="tarjeta tarjeta-reserva" href="#/reservas/${reserva.id}">
    <span class="tr-ico" aria-hidden="true">${espacio.icono || "🏢"}</span>
    <span class="tr-txt">
      <strong>${espacio.nombre || "Espacio"}</strong>
      <span class="texto-sm texto-dim">${fechaLarga(inicio)} · ${hora}</span>
      <span class="fila" style="gap:6px;margin-top:4px">
        <span class="chip chip-${raw(clase)}">${TEXTO_ESTADO_RESERVA[reserva.estado] || reserva.estado}</span>
        ${reserva.folio ? raw(`<span class="mono texto-xs texto-suave">${esc(reserva.folio)}</span>`) : ""}
        ${reserva.pendiente ? raw('<span class="chip chip-warm">Sin sincronizar</span>') : ""}
      </span>
    </span>
    <span class="tr-fin">
      <strong class="mono">${formatMoneda(reserva.total || 0)}</strong>
      ${raw(icono("chevron", { size: 16 }))}
    </span>
  </a>`;
}

/* ---------------------------------------------------------------------
   Reseñas
   --------------------------------------------------------------------- */
export function listaResenas(resenas) {
  if (!resenas?.length) {
    return html`<p class="texto-sm texto-dim">Todavía no hay reseñas de este espacio.</p>`;
  }
  return html`<div class="resenas">
    ${resenas.map((r) => {
      const nombre = r.usuarios?.nombre || "Usuario";
      const avatar = urlMedioSegura(r.usuarios?.avatar_url);
      const fecha = new Date(r.creado_en).toLocaleDateString(localeActual(), { month: "short", year: "numeric" });
      return raw(`<article class="resena">
        <div class="fila">
          <span class="avatar avatar-sm">${avatar ? `<img src="${esc(avatar)}" alt="">` : esc(nombre.charAt(0).toUpperCase())}</span>
          <div class="crece">
            <strong class="texto-sm">${esc(nombre)}</strong>
            <div class="texto-xs texto-dim">${esc(fecha)}</div>
          </div>
          <span class="estrellas texto-sm">${"★".repeat(r.calificacion)}${"☆".repeat(5 - r.calificacion)}</span>
        </div>
        ${r.comentario ? `<p class="texto-sm mt-2">${esc(r.comentario)}</p>` : ""}
        ${r.respuesta ? `<div class="resena-respuesta"><strong class="texto-xs">Respuesta de la administración</strong><p class="texto-sm">${esc(r.respuesta)}</p></div>` : ""}
      </article>`);
    })}
  </div>`;
}

export function resumenCalificacion(resenas) {
  const valores = (resenas || []).map((r) => r.calificacion);
  const media = promedio(valores);
  const conteo = [5, 4, 3, 2, 1].map((n) => ({ n, c: valores.filter((v) => v === n).length }));
  const max = Math.max(1, ...conteo.map((x) => x.c));
  return html`
  <div class="calif-resumen">
    <div class="calif-num">
      <strong>${media.toFixed(1)}</strong>
      ${estrellasHtml(media, { conNumero: false })}
      <span class="texto-xs texto-dim">${valores.length} reseña${valores.length === 1 ? "" : "s"}</span>
    </div>
    <div class="calif-barras">
      ${conteo.map(({ n, c }) => raw(`<div class="calif-fila">
        <span class="texto-xs">${n}★</span>
        <div class="barra barra-warm"><span style="width:${Math.round((c / max) * 100)}%"></span></div>
        <span class="texto-xs texto-dim">${c}</span>
      </div>`))}
    </div>
  </div>`;
}

export default {
  tarjetaEspacio, filaEspacio, selectorDias, calendarioMes, rejillaHorarios,
  estrellasHtml, selectorEstrellas, amenidadesHtml, galeriaHtml, activarGaleria,
  visor360Html, activarVisor360, resumenPrecio, tarjetaReserva, listaResenas,
  resumenCalificacion, insigniaEstado, nivelDisponibilidad,
  ETIQUETA_ESTADO,
};
