/* ======================================================================
   reservar.js — Paso de confirmación: fecha, horario, asistentes, notas
   y cupón, con el resumen de precio antes de pagar.
   ====================================================================== */
import { html, raw, esc, isoFecha, fechaLarga, formatMoneda, duracionHoras } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { toastOk, toastError, conCarga, vacio, temblar } from "../core/ui.js";
import { ir } from "../core/router.js";
import { vibrar } from "../core/haptics.js";
import api from "../data/api.js";
import store from "../core/store.js";
import { calendarioMes, rejillaHorarios, resumenPrecio } from "./componentes.js";
import { sugerirAlternativas } from "../ai/busqueda.js";
import { FEATURES } from "../core/config.js";

export const titulo = () => t("reserva.titulo");
export const nav = false;

const st = { espacio: null, fecha: isoFecha(), mes: new Date(), bloque: null, disponibilidad: [], asistentes: 1, notas: "", cupon: null, cotizacion: null };

export async function render(contenedor, ctx) {
  st.fecha = ctx.query.get("fecha") || isoFecha();
  st.mes = new Date(`${st.fecha}T12:00:00`);
  st.bloque = ctx.query.get("bloque") || null;
  if (st.bloque === "null") st.bloque = null;
  st.asistentes = 1; st.notas = ""; st.cupon = null;

  const espacio = await api.getEspacio(ctx.params.id);
  if (!espacio) {
    contenedor.innerHTML = `<div class="vista-scroll">${vacio({ ico: "🏚️", titulo: "Espacio no encontrado" })}</div>`;
    return;
  }
  if (!api.esReservableV1(espacio)) {
    contenedor.innerHTML = `<div class="vista-scroll">${vacio({
      ico: "🚫",
      titulo: "Espacio no reservable",
      desc: "Smart Hub V1 sólo permite reservar las oficinas A, B, C y D.",
      accion: '<a class="btn btn-primario" href="#/espacios">Ver oficinas disponibles</a>',
    })}</div>`;
    return;
  }
  st.espacio = espacio;
  st.asistentes = Math.min(2, Number(espacio.capacidad) || 1);
  const oficinas = (await api.getEspacios()).filter((e) =>
    api.esReservableV1(e)
    && (e.portada || e.fotos?.some((f) => f?.url && !f?.es_360)));

  contenedor.innerHTML = html`
    <div class="vista-scroll reservar">
      <div class="vista-contenido">

        <nav class="reserva-pasos" aria-label="Progreso de la reservación">
          <span class="completo"><b>1</b> Espacio</span><i></i>
          <span class="activo"><b>2</b> Fecha y hora</span><i></i>
          <span><b>3</b> Detalles</span><i></i>
          <span><b>4</b> Confirmación</span>
        </nav>

        <section class="seccion reserva-oficinas">
          <div class="seccion-cab"><div><h1>Selecciona tu espacio</h1><p class="texto-sm texto-dim">Elige la oficina que mejor se adapte a tus necesidades.</p></div></div>
          <div class="reserva-oficinas-grid">
            ${oficinas.map((of) => raw(`<a class="reserva-oficina${String(of.id) === String(espacio.id) ? " activa" : ""}" href="#/espacios/${esc(of.id)}/reservar?fecha=${esc(st.fecha)}">
              <span>${esc(String(of.codigo || "").replace("OF-", ""))}</span>
              <strong>${esc(of.nombre)}</strong>
              <small>${esc(formatMoneda(of.precio_hora || 0))} + IVA / hora</small>
            </a>`)).join("")}
          </div>
        </section>

        <div class="tarjeta tarjeta-pad fila" style="gap:14px">
          <span class="tr-ico" aria-hidden="true">${espacio.icono || "🏢"}</span>
          <div class="crece">
            <strong>${espacio.nombre}</strong>
            <div class="texto-sm texto-dim">${espacio.codigo} · hasta ${espacio.capacidad} personas</div>
          </div>
          <a class="btn btn-fantasma btn-sm" href="#/espacios/${espacio.id}">${t("app.ver")}</a>
        </div>

        <div class="reserva-config-grid">
        <section class="seccion reserva-panel">
          <h2 class="seccion-titulo">${t("reserva.fecha")}</h2>
          <div id="rv-dias">${raw(calendarioMes(st.mes.getFullYear(), st.mes.getMonth(), { seleccion: st.fecha }))}</div>
          <p class="texto-sm texto-dim mt-2" id="rv-fecha">${fechaLarga(st.fecha)}</p>
        </section>

        <section class="seccion reserva-panel">
          <h2 class="seccion-titulo">${t("reserva.horario")}</h2>
          <div id="rv-horarios"><div class="esqueleto" style="height:88px"></div></div>
          <div class="duracion-reserva">
            <span><strong>Duración</strong><small>Bloques de reservación</small></span>
            <b>1 hora</b>
          </div>
        </section>

        <section class="seccion reserva-panel">
          <h2 class="seccion-titulo">Detalles</h2>
          <div class="campo">
            <label for="rv-asistentes">Número de asistentes</label>
            <div class="contador-campo">
              <button type="button" class="btn btn-contorno btn-icono" data-paso="-1" aria-label="Menos">${raw(icono("menos", { size: 16 }))}</button>
              <input id="rv-asistentes" type="number" min="1" max="${espacio.capacidad || 1}" value="${st.asistentes}" inputmode="numeric">
              <button type="button" class="btn btn-contorno btn-icono" data-paso="1" aria-label="Más">${raw(icono("mas", { size: 16 }))}</button>
            </div>
            <span class="campo-ayuda">Capacidad máxima: ${espacio.capacidad} personas</span>
          </div>

          <div class="campo">
            <label for="rv-notas">${t("reserva.notas")}</label>
            <textarea id="rv-notas" placeholder="Necesito el proyector conectado, llegaré 10 minutos antes…" maxlength="400"></textarea>
          </div>
        </section>
        </div>

        ${FEATURES.promociones ? raw(`<section class="seccion">
          <h2 class="seccion-titulo">${esc(t("reserva.cupon"))}</h2>
          <div class="fila" style="gap:8px">
            <input id="rv-cupon" class="input crece" type="text" placeholder="Código" autocapitalize="characters" style="text-transform:uppercase">
            <button type="button" class="btn btn-contorno" id="rv-aplicar">${esc(t("reserva.aplicar"))}</button>
          </div>
          <p class="texto-xs mt-2" id="rv-cupon-msg"></p>
        </section>`) : ""}

        <section class="seccion" id="rv-resumen"></section>
      </div>

      <div class="barra-accion">
        <div class="crece">
          <strong id="rv-total">—</strong>
          <span class="texto-xs texto-dim" id="rv-detalle">Elige un horario</span>
        </div>
        <button type="button" class="btn btn-primario btn-lg" id="rv-continuar" disabled>${t("app.continuar")}</button>
      </div>
    </div>`;

  st.disponibilidad = await api.getDisponibilidad(espacio.id, st.fecha);
  pintarHorarios(contenedor);
  await recalcular(contenedor);

  contenedor.addEventListener("click", async (e) => {
    const dia = e.target.closest("[data-dia]");
    if (dia) {
      st.fecha = dia.dataset.dia; st.bloque = null;
      contenedor.querySelectorAll("[data-dia]").forEach((d) => d.setAttribute("aria-pressed", String(d === dia)));
      contenedor.querySelector("#rv-fecha").textContent = fechaLarga(st.fecha);
      contenedor.querySelector("#rv-horarios").innerHTML = '<div class="esqueleto" style="height:88px"></div>';
      st.disponibilidad = await api.getDisponibilidad(st.espacio.id, st.fecha);
      pintarHorarios(contenedor);
      await recalcular(contenedor);
      return;
    }

    const mes = e.target.closest("[data-mes]");
    if (mes) {
      st.mes = new Date(st.mes.getFullYear(), st.mes.getMonth() + Number(mes.dataset.mes), 1);
      contenedor.querySelector("#rv-dias").innerHTML = calendarioMes(st.mes.getFullYear(), st.mes.getMonth(), { seleccion: st.fecha });
      return;
    }

    if (e.target.closest("[data-reintentar-disp]")) {
      contenedor.querySelector("#rv-horarios").innerHTML =
        '<div class="esqueleto" style="height:88px"></div>';
      st.disponibilidad = await api.getDisponibilidad(st.espacio.id, st.fecha, { forzar: true });
      pintarHorarios(contenedor);
      await recalcular(contenedor);
      return;
    }

    const bloque = e.target.closest("[data-bloque]");
    if (bloque && !bloque.disabled) {
      st.bloque = st.bloque === bloque.dataset.bloque ? null : bloque.dataset.bloque;
      contenedor.querySelectorAll("[data-bloque]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.bloque === st.bloque)));
      vibrar("seleccion");
      await recalcular(contenedor);
      return;
    }

    const paso = e.target.closest("[data-paso]");
    if (paso) {
      const input = contenedor.querySelector("#rv-asistentes");
      const max = Number(st.espacio.capacidad) || 1;
      st.asistentes = Math.max(1, Math.min(max, Number(input.value) + Number(paso.dataset.paso)));
      input.value = st.asistentes;
      vibrar("toque");
      return;
    }

    if (e.target.closest("#rv-aplicar")) return aplicarCupon(contenedor);

    if (e.target.closest("#rv-continuar")) return continuar(contenedor);

    if (e.target.closest("[data-espera]")) {
      if (!store.get().sesion) return ir("/login");
      try {
        await api.apuntarseListaEspera(st.espacio.id, st.fecha, null);
        toastOk(t("reserva.enListaEspera"));
      } catch (err) { toastError(err.message); }
    }

    const alt = e.target.closest("[data-alternativa]");
    if (alt) {
      st.bloque = alt.dataset.alternativa;
      pintarHorarios(contenedor);
      await recalcular(contenedor);
    }
  });

  contenedor.querySelector("#rv-notas").addEventListener("input", (e) => { st.notas = e.target.value; });
  contenedor.querySelector("#rv-asistentes").addEventListener("change", (e) => {
    const max = Number(st.espacio.capacidad) || 1;
    st.asistentes = Math.max(1, Math.min(max, Number(e.target.value) || 1));
    e.target.value = st.asistentes;
  });
}

function pintarHorarios(contenedor) {
  const cont = contenedor.querySelector("#rv-horarios");

  // `null` significa «no se pudo consultar», que NO es lo mismo que
  // «todo libre» ni que «todo ocupado». Antes, ante un fallo de red se
  // rellenaba con una ocupación inventada; ahora se dice la verdad y se
  // ofrece reintentar, porque enseñar huecos que quizá no existan lleva
  // a que alguien crea que reservó.
  if (!Array.isArray(st.disponibilidad)) {
    st.bloque = null;
    cont.innerHTML = html`
      <div class="aviso aviso-warm" style="margin:0">
        <strong>No pudimos consultar la disponibilidad.</strong>
        <p class="texto-sm" style="margin:6px 0 10px">
          No sabemos qué horarios están libres ahora mismo, y preferimos
          no adivinarlo. Comprueba tu conexión e inténtalo de nuevo.
        </p>
        <button type="button" class="btn btn-contorno" data-reintentar-disp>Reintentar</button>
      </div>`;
    return;
  }

  cont.innerHTML = rejillaHorarios(st.disponibilidad, { fecha: st.fecha, seleccion: st.bloque });

  // Si el horario que traía la URL ya no está libre, ofrece alternativas.
  if (st.bloque && !st.disponibilidad.some((b) => b.bloque === st.bloque && b.libre)) {
    const alternativas = sugerirAlternativas(st.disponibilidad, st.bloque);
    st.bloque = null;
    if (alternativas.length) {
      cont.insertAdjacentHTML("beforeend", html`
        <div class="aviso aviso-warm mt-2">
          <strong>Ese horario ya se ocupó.</strong> Cerca hay:
          <div class="fila envolver mt-2" style="gap:6px">
            ${alternativas.map((b) => raw(`<button type="button" class="chip" data-alternativa="${esc(b)}">${esc(b.replace("-", "–"))}</button>`))}
          </div>
        </div>`);
    }
  }
}

async function recalcular(contenedor) {
  const btn = contenedor.querySelector("#rv-continuar");
  const total = contenedor.querySelector("#rv-total");
  const detalle = contenedor.querySelector("#rv-detalle");
  const resumen = contenedor.querySelector("#rv-resumen");

  if (!st.bloque) {
    btn.disabled = true;
    total.textContent = "—";
    detalle.textContent = "Elige un horario";
    resumen.innerHTML = "";
    return;
  }

  const cotizacion = await api.cotizar({ espacioId: st.espacio.id, bloque: st.bloque, cupon: st.cupon });
  st.cotizacion = cotizacion;

  btn.disabled = false;
  total.textContent = formatMoneda(cotizacion.total);
  detalle.textContent = `${fechaLarga(st.fecha)} · ${st.bloque.replace("-", "–")} · ${cotizacion.horas} h`;
  resumen.innerHTML = html`
    <h2 class="seccion-titulo">${t("reserva.resumen")}</h2>
    ${raw(resumenPrecio(cotizacion))}`;
}

async function aplicarCupon(contenedor) {
  if (!FEATURES.promociones) return;
  const input = contenedor.querySelector("#rv-cupon");
  const msg = contenedor.querySelector("#rv-cupon-msg");
  const codigo = input.value.trim().toUpperCase();
  if (!codigo) return;
  if (!st.bloque) {
    msg.textContent = "Primero elige un horario.";
    msg.style.color = "var(--warm)";
    return;
  }

  const cotizacionBase = await api.cotizar({ espacioId: st.espacio.id, bloque: st.bloque });
  const promo = await api.validarPromocion(codigo, st.espacio.id, cotizacionBase.subtotal);

  if (!promo) {
    st.cupon = null;
    msg.textContent = t("reserva.cuponInvalido");
    msg.style.color = "var(--taken)";
    temblar(input);
    await recalcular(contenedor);
    return;
  }
  st.cupon = codigo;
  msg.textContent = `${t("reserva.cuponAplicado")}: ${promo.titulo} (−${formatMoneda(promo.descuento)})`;
  msg.style.color = "var(--ok)";
  vibrar("exito");
  await recalcular(contenedor);
}

function continuar(contenedor) {
  if (!st.bloque) return;
  const params = new URLSearchParams({
    fecha: st.fecha, bloque: st.bloque,
    asistentes: String(st.asistentes),
    notas: st.notas || "",
  });
  if (st.cupon) params.set("cupon", st.cupon);
  ir(`/checkout/${st.espacio.id}?${params.toString()}`);
}
