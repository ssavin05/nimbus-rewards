/* ======================================================================
   reserva-detalle.js — Detalle de una reserva: cancelar, modificar,
   calificar, ver comprobante y pedir factura.
   ====================================================================== */
import { html, raw, esc, fechaLarga, formatMoneda, isoFecha, tiempoRelativo } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { toastOk, toastError, confirmar, abrirHoja, conCarga, vacio, copiar } from "../core/ui.js";
import { ir } from "../core/router.js";
import { vibrar } from "../core/haptics.js";
import api from "../data/api.js";
import store from "../core/store.js";
import { BOOKING, FEATURES } from "../core/config.js";
import { selectorDias, rejillaHorarios, selectorEstrellas } from "./componentes.js";
import { verComprobante, solicitarFactura } from "../payments/comprobante.js";

export const titulo = () => "Detalle de reserva";
export const nav = false;

let reserva = null;

async function verificarRetornoClip(reservaId) {
  try {
    const clip = await import("../payments/clip.js");
    const pendiente = clip.pendienteGuardado?.();
    if (!pendiente?.payment_request_id || String(pendiente.reservaId) !== String(reservaId)) return false;

    // sessionStorage sobrevive a la redirección, pero no tiene sentido
    // perseguir para siempre un checkout abandonado.
    const edad = Date.now() - Number(pendiente.creado || 0);
    if (!Number.isFinite(edad) || edad > 2 * 60 * 60 * 1000) {
      clip.olvidarPendiente?.();
      return false;
    }

    const resultado = await clip.verificar(pendiente.payment_request_id);
    const estado = String(resultado?.estado || "").toUpperCase();
    if (resultado?.pagado && !resultado?.caducada) {
      clip.olvidarPendiente?.();
      toastOk("Pago con Clip verificado. Tu reserva quedó confirmada.");
      return true;
    }
    if (resultado?.caducada || ["CANCELLED", "CANCELED", "EXPIRED", "RECHAZADO", "REEMBOLSADO"].includes(estado)) {
      clip.olvidarPendiente?.();
      if (resultado?.caducada) toastError("El apartado venció durante el pago. El cargo se marcó para reembolso.");
      return true;
    }
    // PENDING: se conserva para que otra visita pueda volver a verificar.
    return true;
  } catch (e) {
    console.warn("[clip] no se pudo verificar el regreso del checkout", e);
    return false;
  }
}

export async function render(contenedor, ctx) {
  const verificoClip = await verificarRetornoClip(ctx.params.id);
  reserva = await api.getReserva(ctx.params.id, { forzar: verificoClip });
  if (!reserva) {
    contenedor.innerHTML = `<div class="vista-scroll">${vacio({ ico: "🧾", titulo: "Reserva no encontrada" })}</div>`;
    return;
  }

  const espacio = reserva.espacios || store.getEspacio(reserva.espacio_id) || {};
  const inicio = new Date(reserva.inicio);
  const fin = new Date(reserva.fin);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const futura = inicio.getTime() > Date.now();
  const activa = !["cancelada", "completada", "no_asistio"].includes(reserva.estado);
  const horasFaltantes = (inicio.getTime() - Date.now()) / 3600000;
  const gratis = horasFaltantes >= BOOKING.horasCancelacionGratis;
  const pago = reserva.pagos?.[0] || null;

  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">

        <div class="detalle-cab tarjeta tarjeta-pad">
          <span class="tr-ico grande" aria-hidden="true">${espacio.icono || "🏢"}</span>
          <h1>${espacio.nombre || "Espacio"}</h1>
          <p class="texto-dim">${espacio.codigo || ""}</p>
          <span class="chip chip-${raw(claseEstado(reserva.estado))} mt-2">${textoEstado(reserva.estado)}</span>
          ${futura && activa ? raw(`<p class="texto-sm texto-dim mt-2">Empieza ${esc(tiempoRelativo(inicio))}</p>`) : ""}
        </div>

        <section class="tarjeta mt-4">
          ${dato(t("reserva.codigo"), reserva.folio || "—", true)}
          ${dato(t("reserva.fecha"), fechaLarga(inicio))}
          ${dato(t("reserva.horario"), `${hhmm(inicio)} – ${hhmm(fin)}`)}
          ${dato("Asistentes", String(reserva.asistentes || 1))}
          ${reserva.notas ? dato("Notas", reserva.notas) : ""}
        </section>

        <section class="seccion mt-6">
          <h2 class="seccion-titulo">${t("reserva.resumen")}</h2>
          <div class="tarjeta tarjeta-pad">
            <div class="fila-sep"><span>${t("reserva.subtotal")}</span><strong class="mono">${formatMoneda(reserva.subtotal || 0)}</strong></div>
            ${Number(reserva.descuento) > 0 ? raw(`<div class="fila-sep mt-2"><span>${esc(t("reserva.descuento"))}</span><strong class="mono">−${esc(formatMoneda(reserva.descuento))}</strong></div>`) : ""}
            <div class="fila-sep mt-2"><span>IVA</span><strong class="mono">${formatMoneda(reserva.impuestos || 0)}</strong></div>
            <div class="fila-sep mt-2" style="border-top:1px solid var(--linea);padding-top:10px">
              <strong>${t("reserva.total")}</strong><strong class="mono">${formatMoneda(reserva.total || 0)}</strong></div>
            ${pago ? raw(`<div class="fila-sep mt-4 texto-sm texto-dim">
              <span>Pagado con ${esc(nombreMetodo(pago.metodo))}${pago.ultimos4 ? ` ····${esc(pago.ultimos4)}` : ""}</span>
              <span class="chip chip-${pago.estado === "aprobado" ? "ok" : "warm"}">${esc(pago.estado)}</span></div>`) : ""}
            ${Number(reserva.monto_reembolso) > 0 ? raw(`<div class="fila-sep mt-2 texto-sm">
              <span>Reembolso</span><strong class="mono">${esc(formatMoneda(reserva.monto_reembolso))}</strong></div>`) : ""}
          </div>
        </section>

        <div class="col mt-6" style="gap:10px">
          <button type="button" class="btn btn-contorno btn-bloque" data-comprobante>
            ${raw(icono("recibo", { size: 17 }))} ${t("misReservas.recibo")}</button>
          ${FEATURES.facturacion ? raw(`<button type="button" class="btn btn-contorno btn-bloque" data-factura>
            ${icono("descargar", { size: 17 })} ${esc(t("pago.factura"))}</button>`) : ""}
          <a class="btn btn-contorno btn-bloque" href="#/espacios/${reserva.espacio_id}">
            ${raw(icono("edificio", { size: 17 }))} Ver el espacio</a>

          ${futura && activa ? raw(`
            <button type="button" class="btn btn-contorno btn-bloque" data-modificar>
              ${icono("calendario", { size: 17 })} ${esc(t("reserva.modificar"))}</button>
            <button type="button" class="btn btn-peligro btn-bloque" data-cancelar>
              ${icono("cerrar", { size: 17 })} ${esc(t("reserva.cancelar"))}</button>
            <p class="texto-xs texto-suave texto-centro">
              ${gratis
                ? esc(t("reserva.cancelarGratis")) + ` — hasta ${BOOKING.horasCancelacionGratis} h antes.`
                : esc(t("reserva.cancelarPenaliza", { p: Math.round(BOOKING.penalizacionTardia * 100) + " %", h: BOOKING.horasCancelacionGratis }))}
            </p>`) : ""}

          ${!futura && reserva.estado !== "cancelada" ? raw(`
            <button type="button" class="btn btn-primario btn-bloque" data-calificar>
              ${icono("estrella", { size: 17 })} ${esc(t("misReservas.calificar"))}</button>`) : ""}
        </div>
      </div>
    </div>`;

  contenedor.addEventListener("click", async (e) => {
    if (e.target.closest("[data-copiar]")) {
      copiar(e.target.closest("[data-copiar]").dataset.copiar);
      return;
    }
    if (e.target.closest("[data-comprobante]")) return verComprobante(reserva, pago);
    if (e.target.closest("[data-factura]")) return solicitarFactura(reserva);
    if (e.target.closest("[data-cancelar]")) return cancelar(gratis);
    if (e.target.closest("[data-modificar]")) return modificar(contenedor);
    if (e.target.closest("[data-calificar]")) return calificar(espacio);
  });
}

const dato = (k, v, copiable = false) => html`
  <div class="lista-item">
    <span class="li-txt"><span class="li-sub">${k}</span><span class="li-titulo">${v}</span></span>
    ${copiable ? raw(`<button type="button" class="btn btn-fantasma btn-icono btn-sm" data-copiar="${esc(v)}" aria-label="Copiar">${icono("copiar", { size: 15 })}</button>`) : ""}
  </div>`;

const claseEstado = (e) => ({ pendiente: "warm", confirmada: "ok", en_curso: "ok", completada: "neutro", cancelada: "taken", no_asistio: "taken" }[e] || "neutro");
const textoEstado = (e) => ({ pendiente: "Pendiente de pago", confirmada: "Confirmada", en_curso: "En curso", completada: "Completada", cancelada: "Cancelada", no_asistio: "No asistió" }[e] || e);
const nombreMetodo = (m) => ({ clip: "Clip", stripe: "tarjeta", mercadopago: "Mercado Pago", paypal: "PayPal", googlepay: "Google Pay", applepay: "Apple Pay", transferencia: "transferencia" }[m] || m);

/* ---------------------------------------------------------------------
   Acciones
   --------------------------------------------------------------------- */
async function cancelar(gratis) {
  const ok = await confirmar({
    titulo: t("reserva.cancelar"),
    mensaje: t("reserva.cancelarConfirm"),
    detalle: gratis
      ? `Se te reembolsará el total: ${formatMoneda(reserva.total)}.`
      : `Se retendrá el ${Math.round(BOOKING.penalizacionTardia * 100)} %. Reembolso estimado: ${formatMoneda(reserva.total * (1 - BOOKING.penalizacionTardia))}.`,
    aceptar: t("reserva.cancelar"), cancelar: "Conservar", peligro: true,
  });
  if (!ok) return;
  try {
    await api.cancelarReserva(reserva.id);
    vibrar("advertencia");
    toastOk(t("reserva.cancelada"));
    ir("/reservas");
  } catch (e) { toastError(e.message); }
}

async function modificar(contenedor) {
  let fecha = isoFecha(new Date(reserva.inicio));
  let bloque = null;
  let disponibilidad = await api.getDisponibilidad(reserva.espacio_id, fecha);

  const { el, cuerpo, cerrar } = abrirHoja({
    titulo: t("reserva.modificar"),
    contenido: html`
      <div id="mod-dias">${raw(selectorDias(fecha))}</div>
      <p class="texto-sm texto-dim mt-2" id="mod-fecha">${fechaLarga(fecha)}</p>
      <div id="mod-horarios" class="mt-4">${raw(rejillaHorarios(disponibilidad, { fecha }))}</div>`,
    pie: html`
      <button type="button" class="btn btn-contorno" data-cerrar>${t("app.cancelar")}</button>
      <button type="button" class="btn btn-primario" data-guardar disabled>${t("app.guardar")}</button>`,
  });

  const btnGuardar = el.querySelector("[data-guardar]");

  el.addEventListener("click", async (e) => {
    if (e.target.closest("[data-cerrar]")) return cerrar();

    const dia = e.target.closest("[data-dia]");
    if (dia) {
      fecha = dia.dataset.dia; bloque = null;
      el.querySelectorAll("[data-dia]").forEach((d) => d.setAttribute("aria-pressed", String(d === dia)));
      el.querySelector("#mod-fecha").textContent = fechaLarga(fecha);
      el.querySelector("#mod-horarios").innerHTML = '<div class="esqueleto" style="height:88px"></div>';
      disponibilidad = await api.getDisponibilidad(reserva.espacio_id, fecha, { forzar: true });
      el.querySelector("#mod-horarios").innerHTML = rejillaHorarios(disponibilidad, { fecha });
      btnGuardar.disabled = true;
      return;
    }

    if (e.target.closest("[data-reintentar-disp]")) {
      el.querySelector("#mod-horarios").innerHTML = '<div class="esqueleto" style="height:88px"></div>';
      disponibilidad = await api.getDisponibilidad(reserva.espacio_id, fecha, { forzar: true });
      el.querySelector("#mod-horarios").innerHTML = rejillaHorarios(disponibilidad, { fecha });
      return;
    }

    const b = e.target.closest("[data-bloque]");
    if (b && !b.disabled) {
      bloque = b.dataset.bloque;
      el.querySelectorAll("[data-bloque]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      btnGuardar.disabled = false;
      vibrar("seleccion");
      return;
    }

    if (e.target.closest("[data-guardar]") && bloque) {
      try {
        await conCarga(btnGuardar, api.modificarReserva(reserva.id, { fecha, bloque }));
        cerrar();
        toastOk("Reserva actualizada");
        vibrar("exito");
        ir("/reservas/" + reserva.id, { reemplazar: true });
      } catch (err) { toastError(err.message); }
    }
  });
}

async function calificar(espacio) {
  let valor = 5;
  const { el, cerrar } = abrirHoja({
    titulo: `Califica ${espacio.nombre || "el espacio"}`,
    centrado: true, ancho: "440px",
    contenido: html`
      <div class="texto-centro">${raw(selectorEstrellas(valor))}</div>
      <div class="campo mt-4">
        <label for="cal-com">Comentario (opcional)</label>
        <textarea id="cal-com" placeholder="¿Qué tal estuvo el espacio? ¿Recomendarías algo?" maxlength="600"></textarea>
      </div>`,
    pie: html`
      <button type="button" class="btn btn-contorno" data-cerrar>${t("app.cancelar")}</button>
      <button type="button" class="btn btn-primario" data-enviar>Publicar reseña</button>`,
  });

  el.addEventListener("click", async (e) => {
    const est = e.target.closest("[data-estrella]");
    if (est) {
      valor = Number(est.dataset.estrella);
      el.querySelectorAll("[data-estrella]").forEach((b) => {
        b.dataset.on = String(Number(b.dataset.estrella) <= valor);
        b.setAttribute("aria-checked", String(Number(b.dataset.estrella) === valor));
      });
      vibrar("toque");
      return;
    }
    if (e.target.closest("[data-cerrar]")) return cerrar();
    if (e.target.closest("[data-enviar]")) {
      try {
        await conCarga(e.target.closest("[data-enviar]"), api.publicarResena({
          espacioId: reserva.espacio_id,
          reservaId: reserva.id,
          calificacion: valor,
          comentario: el.querySelector("#cal-com").value.trim(),
        }));
        cerrar();
        toastOk("¡Gracias por tu reseña!");
        vibrar("exito");
      } catch (err) { toastError(err.message); }
    }
  });
}
