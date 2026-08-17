/* ======================================================================
   inicio.js — Pantalla principal: saludo, buscador inteligente, próxima
   reserva, recomendaciones, disponibles hoy y promociones.
   ====================================================================== */
import { html, raw, esc, isoFecha, debounce, formatMoneda, fechaLarga, tiempoRelativo } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { vacio, toastError, toastOk } from "../core/ui.js";
import store from "../core/store.js";
import api from "../data/api.js";
import { nombreUsuario } from "../auth/auth.js";
import { tarjetaEspacio, filaEspacio } from "./componentes.js";
import { buscar, recomendar } from "../ai/busqueda.js";
import { FEATURES } from "../core/config.js";
import { on as onBus, EV } from "../core/bus.js";

export const titulo = () => t("app.nombre");
export const subtitulo = () => {
  // Sólo tiene sentido cuando hay varias sedes: si no, repetiría el título.
  const { sede, sedes } = store.get();
  return (sedes?.length || 0) > 1 ? (sede?.nombre || "") : "";
};

let desuscribir = [];

export async function render(contenedor) {
  const { sesion } = store.get();
  const nombre = sesion ? nombreUsuario().split(" ")[0] : null;

  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">

        <section class="inicio-hero-premium" aria-labelledby="hero-titulo">
          <div class="inicio-hero-fondo" aria-hidden="true"></div>
          <div class="inicio-hero-contenido">
            <p class="eyebrow">SMART HUB · EXECUTIVE BUSINESS CLUB</p>
            <h1 id="hero-titulo">Reserva tu espacio, trabaja, conecta e <em>impulsa tu negocio.</em></h1>
            <p>Oficinas ejecutivas, atención profesional y una experiencia de reserva simple, segura y conectada.</p>
            <div class="inicio-hero-acciones">
              <a class="btn btn-primario btn-lg" href="#/espacios">Reservar ahora</a>
              <a class="btn btn-contorno btn-lg" href="#/espacios">Ver espacios</a>
              ${FEATURES.mapa3d ? raw(`<a class="btn btn-fantasma btn-lg" href="#/mapa">${icono("cubo", { size: 18 })} Explorar mapa 3D</a>`) : ""}
            </div>
          </div>
        </section>

        <header class="inicio-cab">
          <p class="eyebrow">${fechaLarga(new Date())}</p>
          <h1>${nombre ? t("home.saludo", { nombre }) : t("home.titulo")}</h1>
        </header>

        <div class="buscador" role="search">
          ${raw(icono("buscar", { size: 18, clase: "ci" }))}
          <label for="busq" class="sr-only">${t("home.buscar")}</label>
          <input id="busq" type="search" placeholder="${t("home.buscar")}" autocomplete="off"
                 role="combobox" aria-expanded="false" aria-controls="busq-res">
          <button type="button" class="btn btn-fantasma btn-icono btn-sm" id="busq-x" hidden aria-label="Limpiar">
            ${raw(icono("cerrar", { size: 16 }))}
          </button>
          <div id="busq-res" class="buscador-res" role="listbox" hidden></div>
        </div>

        <div class="cinta filtros-rapidos mt-4" id="filtros">
          <button type="button" class="chip" data-filtro="todos" aria-pressed="true">${t("app.todos")}</button>
          <button type="button" class="chip" data-filtro="oficina" aria-pressed="false">🏢 Oficinas</button>
          <button type="button" class="chip" data-filtro="libre" aria-pressed="false">✅ Libres hoy</button>
          <button type="button" class="chip" data-filtro="barato" aria-pressed="false">💸 Más económicos</button>
        </div>

        <section id="sec-proxima" class="seccion mt-6"></section>

        ${FEATURES.mapa3d ? raw(`
        <a class="banner-mapa" href="#/mapa">
          <span class="bm-txt">
            <strong>${esc(t("home.verMapa"))}</strong>
            <span class="texto-sm">${esc(t("home.verMapaDesc"))}</span>
          </span>
          <span class="bm-ico" aria-hidden="true">${icono("cubo", { size: 30 })}</span>
        </a>`) : ""}

        <a class="tarjeta tarjeta-pad banner-nosotros" href="#/nosotros">
          <span class="bn-ico" aria-hidden="true">${raw(icono("info", { size: 22 }))}</span>
          <span class="bm-txt">
            <strong>${t("nosotros.conocenos")}</strong>
            <span class="texto-sm">${t("nosotros.conocenosDesc")}</span>
          </span>
          <span class="bn-fin" aria-hidden="true">${raw(icono("chevron", { size: 18 }))}</span>
        </a>

        <section id="sec-promos" class="seccion"></section>

        <section class="seccion">
          <div class="seccion-cab">
            <h2 id="titulo-lista">${t("home.destacados")}</h2>
            <a class="enlace" href="#/espacios">${t("home.verTodo")}</a>
          </div>
          <div class="grid-auto" id="lista-espacios">
            ${raw('<div class="esqueleto esq-tarjeta"></div>'.repeat(4))}
          </div>
        </section>

      </div>
    </div>`;

  const lista = contenedor.querySelector("#lista-espacios");

  /* ---------- datos ----------
     El catálogo se pinta en cuanto llega. La disponibilidad va aparte:
     es un adorno sobre las tarjetas (cuántos horarios quedan libres), no
     un requisito para verlas. Esperando a las dos cosas juntas, la
     portada se quedaba en blanco hasta 3,5 s si el servidor tardaba en
     contestar al mapa de horarios. */
  const espacios = await api.getEspacios();
  const reservables = espacios.filter((e) => api.esReservableV1(e) && tieneFoto(e));

  let filtroActivo = "todos";
  let disponibilidad = {};
  pintarLista(reservables, disponibilidad, lista, filtroActivo);

  api.getDisponibilidadMapa(isoFecha()).then((mapa) => {
    if (!mapa || !contenedor.isConnected) return;
    disponibilidad = mapa;
    pintarLista(reservables, disponibilidad, lista, filtroActivo);
  }).catch(() => { /* las tarjetas ya están puestas */ });
  pintarProxima(contenedor);
  if (FEATURES.promociones) pintarPromos(contenedor);

  /* ---------- buscador ---------- */
  const input = contenedor.querySelector("#busq");
  const resultados = contenedor.querySelector("#busq-res");
  const limpiar = contenedor.querySelector("#busq-x");

  const ejecutarBusqueda = debounce(async (q) => {
    limpiar.hidden = !q;
    if (!q || q.length < 2) {
      resultados.hidden = true;
      input.setAttribute("aria-expanded", "false");
      return;
    }
    const encontrados = await buscar(q, reservables, disponibilidad);
    resultados.hidden = false;
    input.setAttribute("aria-expanded", "true");
    resultados.innerHTML = encontrados.length
      ? encontrados.slice(0, 8).map((r) => filaEspacio(r.espacio, r.razon)).join("")
      : `<div class="buscador-vacio">
           <p class="texto-sm">${esc(t("home.sinCoincidencias", { q }))}</p>
           <a class="btn btn-contorno btn-sm" href="#/asistente?q=${encodeURIComponent(q)}">
             ${icono("robot", { size: 15 })} ${esc(t("home.preguntarIA"))}</a>
         </div>`;
  }, 220);

  input.addEventListener("input", (e) => ejecutarBusqueda(e.target.value.trim()));
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2) resultados.hidden = false; });
  limpiar.addEventListener("click", () => { input.value = ""; resultados.hidden = true; limpiar.hidden = true; input.focus(); });
  document.addEventListener("click", cerrarResultados);
  function cerrarResultados(e) { if (!e.target.closest(".buscador")) resultados.hidden = true; }
  desuscribir.push(() => document.removeEventListener("click", cerrarResultados));

  /* ---------- filtros ---------- */
  contenedor.querySelector("#filtros").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filtro]");
    if (!chip) return;
    filtroActivo = chip.dataset.filtro;
    contenedor.querySelectorAll("#filtros .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    contenedor.querySelector("#titulo-lista").textContent = tituloFiltro(filtroActivo);
    pintarLista(reservables, disponibilidad, lista, filtroActivo);
  });

  /* ---------- favoritos ---------- */
  contenedor.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-fav]");
    if (!btn) return;
    e.preventDefault();
    try {
      const activo = await api.alternarFavorito(btn.dataset.fav);
      btn.setAttribute("aria-pressed", String(activo));
      btn.innerHTML = icono(activo ? "corazonLleno" : "corazon", { size: 18 });
      toastOk(activo ? t("favoritos.agregado") : t("favoritos.quitado"));
    } catch (err) { toastError(err.message); }
  });

  /* ---------- disponibilidad en vivo ---------- */
  desuscribir.push(onBus(EV.DISPONIBILIDAD_CAMBIO, async () => {
    const nueva = await api.getDisponibilidadMapa(isoFecha()).catch(() => null);
    if (nueva) pintarLista(reservables, nueva, lista, filtroActivo);
  }));
  desuscribir.push(onBus(EV.RESERVA_CREADA, () => pintarProxima(contenedor)));
  desuscribir.push(onBus(EV.RESERVA_CANCELADA, () => pintarProxima(contenedor)));
}

export function destruir() {
  desuscribir.forEach((f) => { try { f(); } catch { /* ignora */ } });
  desuscribir = [];
}

/* ---------------------------------------------------------------------
   Secciones
   --------------------------------------------------------------------- */
function tituloFiltro(f) {
  return {
    todos: t("home.destacados"), oficina: "Oficinas privadas",
    libre: t("home.disponiblesHoy"), barato: "Los más económicos",
  }[f] || t("home.destacados");
}

function tieneFoto(espacio) {
  return Boolean(espacio?.portada || espacio?.fotos?.some((f) => f?.url && !f?.es_360));
}

function pintarLista(espacios, disponibilidad, contenedor, filtro) {
  let lista = [...espacios];
  if (filtro === "oficina") {
    lista = lista.filter((e) => e.tipo === filtro);
  } else if (filtro === "libre") {
    lista = lista.filter((e) => (disponibilidad[e.id]?.libres || 0) > 0 && e.estado === "disponible");
  } else if (filtro === "barato") {
    lista.sort((a, b) => Number(a.precio_hora) - Number(b.precio_hora));
  } else {
    lista = recomendar(lista, disponibilidad);
  }

  contenedor.innerHTML = lista.length
    ? lista.map((e) => tarjetaEspacio(e, { disponibilidad: disponibilidad[e.id] })).join("")
    : vacio({ ico: "🔍", titulo: "Sin resultados", desc: "Prueba con otro filtro o revisa otro día." });
}

function pintarProxima(contenedor) {
  const sec = contenedor.querySelector("#sec-proxima");
  if (!sec) return;
  const { sesion, reservas } = store.get();

  if (!sesion) {
    sec.innerHTML = html`
      <div class="tarjeta tarjeta-pad cta-sesion">
        <div class="crece">
          <strong>Guarda tus reservas</strong>
          <p class="texto-sm texto-dim">Crea una cuenta para reservar, recibir recordatorios y guardar favoritos.</p>
        </div>
        <a class="btn btn-primario btn-sm" href="#/login">${t("auth.entrar")}</a>
      </div>`;
    return;
  }

  const ahora = Date.now();
  const proxima = reservas
    .filter((r) => r.estado !== "cancelada" && new Date(r.inicio).getTime() > ahora)
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio))[0];

  if (!proxima) {
    sec.innerHTML = html`
      <div class="tarjeta tarjeta-pad cta-sesion">
        <div class="crece">
          <strong>${t("home.sinProxima")}</strong>
          <p class="texto-sm texto-dim">Reserva una oficina privada para tu próxima jornada.</p>
        </div>
        <a class="btn btn-contorno btn-sm" href="#/espacios">${t("home.reservarAhora")}</a>
      </div>`;
    return;
  }

  const espacio = proxima.espacios || store.getEspacio(proxima.espacio_id) || {};
  const inicio = new Date(proxima.inicio);
  const fin = new Date(proxima.fin);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  sec.innerHTML = html`
    <div class="seccion-cab"><h2>${t("home.proxima")}</h2></div>
    <a class="tarjeta proxima-reserva" href="#/reservas/${proxima.id}">
      <span class="pr-ico" aria-hidden="true">${espacio.icono || "🏢"}</span>
      <span class="pr-txt">
        <strong>${espacio.nombre || "Tu espacio"}</strong>
        <span class="texto-sm">${fechaLarga(inicio)} · ${hhmm(inicio)}–${hhmm(fin)}</span>
        <span class="chip chip-ok mt-2">${tiempoRelativo(inicio)}</span>
      </span>
      <span class="pr-fin">${raw(icono("chevron", { size: 18 }))}</span>
    </a>`;
}

async function pintarPromos(contenedor) {
  const sec = contenedor.querySelector("#sec-promos");
  if (!sec) return;
  const promos = await api.getPromociones().catch(() => []);
  if (!promos.length) { sec.innerHTML = ""; return; }

  sec.innerHTML = html`
    <div class="seccion-cab"><h2>${t("home.promos")}</h2></div>
    <div class="cinta">
      ${promos.map((p) => raw(`
        <article class="promo-card">
          <span class="promo-ico" aria-hidden="true">${icono("promo", { size: 20 })}</span>
          <strong>${esc(p.titulo)}</strong>
          <p class="texto-sm">${esc(p.descripcion || "")}</p>
          <button type="button" class="promo-codigo" data-copiar="${esc(p.codigo)}">
            <span class="mono">${esc(p.codigo)}</span>${icono("copiar", { size: 14 })}
          </button>
        </article>`))}
    </div>`;

  sec.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copiar]");
    if (!b) return;
    const { copiar } = await import("../core/ui.js");
    copiar(b.dataset.copiar, `Código ${b.dataset.copiar} copiado`);
  });
}
