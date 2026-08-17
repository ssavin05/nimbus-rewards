/* ======================================================================
   checkout.js — Pago y confirmación de la reserva.

   Secuencia:
     1. Se crea la reserva en estado "pendiente" (la base valida el
        horario de forma atómica: nadie puede ganártelo a medio pago).
     2. Se cobra con el método elegido.
     3. Se registra el pago y la reserva pasa a "confirmada".
     4. Pantalla de éxito con comprobante y recordatorios programados.
   ====================================================================== */
import { html, raw, esc, isoFecha, fechaLarga, formatMoneda } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { toastOk, toastError, conCarga, vacio, confirmar, abrirHoja } from "../core/ui.js";
import { ir } from "../core/router.js";
import { vibrar } from "../core/haptics.js";
import api from "../data/api.js";
import store from "../core/store.js";
import { resumenPrecio } from "./componentes.js";
import { metodosDisponibles, getAdaptador, META } from "../payments/index.js";
import { verComprobante } from "../payments/comprobante.js";
import { pedirPermisoPush } from "../pwa.js";
import { FEATURES } from "../core/config.js";

export const titulo = () => t("pago.titulo");
export const nav = false;

const st = {
  espacio: null, fecha: null, bloque: null, asistentes: 1, notas: "", cupon: null,
  cotizacion: null, metodos: [], metodoSel: null, sesionPago: null, reserva: null,
};

export async function render(contenedor, ctx) {
  if (!FEATURES.pagos) {
    contenedor.innerHTML = `<div class="vista-scroll"><div class="vista-contenido">${vacio({
      ico: "💳", titulo: "Pago en línea no disponible",
      desc: "El checkout está desactivado. No se creará ningún apartado sin pago.",
      accion: '<a class="btn btn-primario" href="#/espacios">Volver a espacios</a>',
    })}</div></div>`;
    return;
  }
  st.fecha = ctx.query.get("fecha") || isoFecha();
  st.bloque = ctx.query.get("bloque");
  st.asistentes = Number(ctx.query.get("asistentes") || 1);
  st.notas = ctx.query.get("notas") || "";
  st.cupon = ctx.query.get("cupon") || null;
  st.reserva = null; st.sesionPago = null; st.metodoSel = null; st.metodos = [];

  // Recargar la pantalla de pago no puede obligar a reservar otra vez:
  // la primera reserva sigue apartando ese horario y la segunda
  // chocaría contra ella misma («ese horario ya está ocupado»... por ti).
  // El id viaja en la URL para sobrevivir al F5.
  const reservaEnCurso = ctx.query.get("reserva");
  if (reservaEnCurso) {
    try {
      const previa = await api.reanudarReserva(reservaEnCurso);
      if (previa?.estado === "pendiente") st.reserva = previa;
      else if (previa?.estado === "confirmada" || previa?.estado === "en_curso") {
        st.reserva = previa;
        return exito(contenedor, {});
      }
    } catch (e) {
      // Apartado vencido o reserva ajena: se empieza de nuevo, y se
      // avisa para que nadie crea que perdió el pago.
      toastError(e.message || "El apartado venció. Elige el horario otra vez.");
    }
  }

  const espacio = await api.getEspacio(ctx.params.id);
  if (!espacio || !st.bloque) {
    contenedor.innerHTML = `<div class="vista-scroll">${vacio({
      ico: "🧾", titulo: "Falta información de la reserva",
      accion: '<a class="btn btn-primario" href="#/espacios">Volver al catálogo</a>',
    })}</div>`;
    return;
  }
  if (!api.esReservableV1(espacio)) {
    contenedor.innerHTML = `<div class="vista-scroll">${vacio({
      ico: "🚫", titulo: "Espacio no reservable",
      desc: "Smart Hub V1 sólo permite reservar las oficinas A, B, C y D.",
      accion: '<a class="btn btn-primario" href="#/espacios">Ver oficinas disponibles</a>',
    })}</div>`;
    return;
  }
  st.espacio = espacio;
  st.cotizacion = await api.cotizar({ espacioId: espacio.id, bloque: st.bloque, cupon: st.cupon });

  contenedor.innerHTML = html`
    <div class="vista-scroll checkout">
      <div class="vista-contenido">

        <div class="pasos">
          <span class="paso hecho">1 Espacio</span>
          <span class="paso hecho">2 Horario</span>
          <span class="paso activo">3 Pago</span>
        </div>

        <section class="tarjeta tarjeta-pad">
          <div class="fila" style="gap:14px">
            <span class="tr-ico" aria-hidden="true">${espacio.icono || "🏢"}</span>
            <div class="crece">
              <strong>${espacio.nombre}</strong>
              <div class="texto-sm texto-dim">${fechaLarga(st.fecha)} · ${st.bloque.replace("-", "–")}</div>
              <div class="texto-sm texto-dim">${st.asistentes} asistente${st.asistentes === 1 ? "" : "s"}</div>
            </div>
          </div>
          ${st.notas ? raw(`<p class="texto-sm texto-dim mt-4" style="border-top:1px solid var(--linea);padding-top:10px">
            <strong>Nota:</strong> ${esc(st.notas)}</p>`) : ""}
        </section>

        <section class="seccion mt-6">
          <h2 class="seccion-titulo">${t("reserva.resumen")}</h2>
          ${raw(resumenPrecio(st.cotizacion))}
        </section>

        <section class="seccion">
          <h2 class="seccion-titulo">${t("pago.metodo")}</h2>
          <div id="ck-metodos" class="lista tarjeta">
            <div class="cargando-centro"><div class="spinner"></div></div>
          </div>
        </section>

        <section class="seccion" id="ck-formulario" hidden>
          <div class="tarjeta tarjeta-pad" id="ck-form-contenido"></div>
        </section>

        <p class="texto-xs texto-suave texto-centro">
          Al confirmar aceptas el reglamento del espacio y la política de cancelación:
          reembolso completo hasta 24 h antes.
        </p>
      </div>

      <div class="barra-accion">
        <div class="crece">
          <strong>${formatMoneda(st.reserva?.total ?? st.cotizacion.total)}</strong>
          <span class="texto-xs texto-dim">${st.cotizacion.horas} h · IVA incluido</span>
        </div>
        <button type="button" class="btn btn-primario btn-lg" id="ck-pagar" disabled>${t("reserva.confirmar")}</button>
      </div>
    </div>`;

  await pintarMetodos(contenedor);

  contenedor.addEventListener("click", async (e) => {
    const metodo = e.target.closest("[data-metodo]");
    if (metodo) return elegirMetodo(contenedor, metodo.dataset.metodo);
    if (e.target.closest("#ck-pagar")) return pagar(contenedor, e.target.closest("#ck-pagar"));
  });
}

export function destruir() {
  try { st.sesionPago?.desmontar?.(); } catch { /* ignora */ }
  st.sesionPago = null;
  st.metodoSel = null;
  st.metodos = [];
}

/* ---------------------------------------------------------------------
   Métodos de pago
   --------------------------------------------------------------------- */
async function pintarMetodos(contenedor) {
  const cont = contenedor.querySelector("#ck-metodos");
  st.metodos = await metodosDisponibles();

  if (!st.metodos.length) {
    cont.innerHTML = html`
      <div class="aviso aviso-warm" style="margin:0">
        <strong>Pago en línea temporalmente no disponible.</strong>
        No crearemos un apartado sin un método de pago listo. Inténtalo más tarde o solicita apoyo en recepción.
      </div>`;
    const boton = contenedor.querySelector("#ck-pagar");
    boton.disabled = true;
    boton.textContent = "Pago no disponible";
    st.metodoSel = null;
    return;
  }

  cont.innerHTML = st.metodos.map((m) => html`
    <button type="button" class="lista-item" data-metodo="${m.id}" aria-pressed="false">
      <span class="li-ico" aria-hidden="true">${m.emoji || "💳"}</span>
      <span class="li-txt">
        <span class="li-titulo">${m.nombre()}</span>
        <span class="li-sub">${m.sub}</span>
      </span>
      <span class="li-fin"><span class="radio-punto"></span></span>
    </button>`).join("");

  // Selecciona el primero automáticamente
  await elegirMetodo(contenedor, st.metodos[0].id);
}

async function elegirMetodo(contenedor, idMetodo) {
  if (st.metodoSel === idMetodo) return;
  st.metodoSel = idMetodo;

  contenedor.querySelectorAll("[data-metodo]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.metodo === idMetodo)));

  try { st.sesionPago?.desmontar?.(); } catch { /* ignora */ }
  st.sesionPago = null;

  const seccion = contenedor.querySelector("#ck-formulario");
  const caja = contenedor.querySelector("#ck-form-contenido");
  const boton = contenedor.querySelector("#ck-pagar");
  seccion.hidden = false;
  caja.innerHTML = '<div class="cargando-centro"><div class="spinner"></div></div>';
  boton.disabled = true;
  vibrar("seleccion");

  // Clip necesita una reserva pendiente antes de crear su checkout: el
  // servidor toma de esa reserva el importe oficial y la expiración del
  // apartado. Nada de eso se confía al navegador.
  try {
    const adaptador = await getAdaptador(idMetodo);

    // Primero valida la pasarela. Si faltan secretos o la Edge Function
    // no está lista, NO creamos un apartado que bloquee el horario.
    await adaptador.preparar?.();

    const reserva = await reservaPendiente();
    st.sesionPago = await adaptador.cobrar({
      reserva,
      monto: reserva.total,
      moneda: reserva.moneda || st.espacio.moneda || "MXN",
      descripcion: `${st.espacio.nombre} · ${fechaLarga(st.fecha)} ${st.bloque}`,
      contenedor: caja,
    });
    boton.textContent = st.sesionPago.botonPropio
      ? "Completa el pago arriba"
      : (st.sesionPago.textoBoton || `Pagar ${formatMoneda(reserva.total)}`);
    if (st.sesionPago.botonPropio) {
      boton.disabled = true;
      st.sesionPago.confirmar().then((r) => finalizar(contenedor, r)).catch((e) => {
        console.error("[checkout]", e);
        toastError(e.message || t("pago.fallo"));
      });
      return;
    }
    boton.disabled = false;
  } catch (e) {
    console.error("[checkout] al montar el método", e);
    caja.innerHTML = html`
      <div class="aviso aviso-warm" style="margin:0">
        <strong>No pudimos preparar el pago.</strong>
        <p class="texto-sm" style="margin:6px 0 0">${esc(e.message || "Inténtalo de nuevo.")}</p>
      </div>`;
    boton.disabled = true;
    // Si el horario se ocupó mientras tanto, se ofrece cambiarlo.
    if (/ocupad|conflicto/i.test(e.message || "")) {
      st.reserva = null;
      const ok = await confirmar({
        titulo: "Ese horario se acaba de ocupar",
        mensaje: "Alguien reservó este bloque mientras elegías el método de pago. ¿Quieres elegir otro horario?",
        aceptar: "Elegir otro",
      });
      if (ok) ir(`/espacios/${st.espacio.id}/reservar?fecha=${st.fecha}`);
    }
  }
}

/* ---------------------------------------------------------------------
   Cobro
   --------------------------------------------------------------------- */
/**
 * Devuelve la reserva pendiente de este checkout, creándola sólo la
 * primera vez. Es el apartado temporal: nace con `expira_en` y, si nadie
 * paga, `expirar_reservas_pendientes()` la suelta a los 15 minutos.
 *
 * Se llama al preparar el pago y al pulsar pagar. Re-renderizar el
 * checkout o recargar NO crea otra: se reutiliza el mismo apartado.
 */
async function reservaPendiente() {
  if (st.reserva) return st.reserva;

  st.reserva = await api.crearReserva({
    espacioId: st.espacio.id,
    fecha: st.fecha,
    bloque: st.bloque,
    asistentes: st.asistentes,
    notas: st.notas,
    cupon: st.cupon,
  });

  // El id va a la URL sin recargar: si ahora hay un F5, se reanuda ésta
  // en vez de crear una segunda que chocaría contra la primera.
  if (st.reserva?.id) {
    try {
      const u = new URL(location.href);
      u.hash = `${u.hash.split("&reserva=")[0]}&reserva=${st.reserva.id}`;
      history.replaceState(null, "", u.toString());
    } catch { /* si el navegador no deja, se sigue igual */ }
  }
  return st.reserva;
}

async function pagar(contenedor, boton) {
  try {
    boton.dataset.cargando = "true";
    boton.disabled = true;

    // El formulario ya está montado desde que se eligió el método, así
    // que aquí sólo se cobra. Antes este botón hacía dos cosas
    // distintas: el primer clic montaba Elements y el segundo pagaba,
    // que es exactamente la confusión que había que quitar.
    const reserva = await reservaPendiente();

    if (!st.metodoSel || !st.sesionPago) {
      throw new Error("No hay un método de pago disponible. No se creó un cobro.");
    }

    const resultado = await st.sesionPago.confirmar();
    await finalizar(contenedor, resultado);

  } catch (e) {
    boton.dataset.cargando = "false";
    boton.disabled = false;
    console.error("[checkout]", e);
    toastError(e.message || t("pago.fallo"));
    vibrar("error");

    // Si el banco rechaza, la reserva sigue apartada y se puede probar
    // otra tarjeta sobre la MISMA reserva: no se crea una segunda.
    if (/ocupad|conflicto/i.test(e.message || "")) {
      st.reserva = null;
      const ok = await confirmar({
        titulo: "Ese horario se acaba de ocupar",
        mensaje: "Alguien reservó este bloque mientras completabas el pago. ¿Quieres elegir otro horario?",
        aceptar: "Elegir otro",
      });
      if (ok) ir(`/espacios/${st.espacio.id}/reservar?fecha=${st.fecha}`);
    } else if (st.reserva?.total) {
      boton.textContent = `Pagar ${formatMoneda(st.reserva.total)}`;
    }
  }
}

async function finalizar(contenedor, resultado) {
  // Defensa adicional: el registro público sólo conoce Clip. Si una
  // configuración o módulo manipulado intentara devolver otro método,
  // no se crea ninguna fila de pago desde el navegador.
  if (resultado?.metodo !== "clip") {
    throw new Error("Método de pago no permitido en esta versión.");
  }

  if (resultado.estado === "aprobado") {
    // La reserva la confirma el servidor después de verificar el estado
    // directamente con Clip; puede tardar unos segundos.
    return esperarConfirmacion(contenedor);
  }
  if (resultado.estado === "procesando" || resultado.estado === "pendiente") {
    return exito(contenedor, { pendiente: true });
  }
  toastError(t("pago.fallo"));
}

async function esperarConfirmacion(contenedor, { intentos = 8 } = {}) {
  contenedor.innerHTML = html`
    <div class="vista-contenido exito">
      <div class="col" style="align-items:center;gap:16px;text-align:center;padding:40px 20px">
        <div class="spinner"></div>
        <h2 style="margin:0">Pago recibido</h2>
        <p class="texto-dim" style="max-width:34ch">
          Estamos terminando de confirmar tu reserva. No cierres esta pantalla.
        </p>
      </div>
    </div>`;

  for (let i = 0; i < intentos; i++) {
    await new Promise((r) => setTimeout(r, i < 3 ? 1000 : 2000));
    let fresca = null;
    try {
      fresca = await api.getReserva(st.reserva.id, { forzar: true });
    } catch { /* se reintenta */ }

    if (fresca?.estado === "confirmada" || fresca?.estado === "en_curso") {
      st.reserva = fresca;
      await api.getMisReservas({ forzar: true }).catch(() => {});
      return exito(contenedor, {});
    }
    if (fresca?.estado === "cancelada") {
      return exito(contenedor, { pendiente: true, aviso: "La reserva se canceló. Si te cobraron, escríbenos." });
    }
  }

  // El webhook tarda más de lo normal. El dinero está cobrado y la
  // reserva sigue apartada: no se pierde nada, pero hay que decirlo.
  await api.getMisReservas({ forzar: true }).catch(() => {});
  exito(contenedor, {
    pendiente: true,
    aviso: "Tu pago se recibió correctamente. La confirmación puede tardar un momento; " +
           "la verás en «Mis reservas» en cuanto termine.",
  });
}

/* ---------------------------------------------------------------------
   Pantalla de éxito
   --------------------------------------------------------------------- */
function exito(contenedor, { pendiente = false, offline = false, aviso = "" } = {}) {
  vibrar("exito");
  const reserva = st.reserva;

  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido exito">
        <div class="exito-marca pulso-ok" aria-hidden="true">
          ${raw(icono(pendiente ? "reloj" : "checkCirculo", { size: 64, stroke: 1.6 }))}
        </div>
        <h1>${offline ? "Reserva guardada" : pendiente ? "Reserva apartada" : t("reserva.confirmada")}</h1>
        <p class="texto-dim">
          ${offline
            ? "No hay conexión ahora mismo. La enviaremos automáticamente en cuanto vuelvas a estar en línea."
            : pendiente
              ? (aviso || "Tenemos tu horario apartado. En cuanto confirmemos el pago recibirás el aviso.")
              : "Tu comprobante queda disponible en la app y la reserva ya está confirmada."}
        </p>

        <div class="tarjeta tarjeta-pad mt-6 texto-izq">
          <div class="fila-sep"><span class="texto-sm texto-dim">${t("reserva.codigo")}</span>
            <strong class="mono">${reserva?.folio || "—"}</strong></div>
          <div class="fila-sep mt-2"><span class="texto-sm texto-dim">Espacio</span>
            <strong>${st.espacio.nombre}</strong></div>
          <div class="fila-sep mt-2"><span class="texto-sm texto-dim">${t("reserva.fecha")}</span>
            <strong>${fechaLarga(st.fecha)}</strong></div>
          <div class="fila-sep mt-2"><span class="texto-sm texto-dim">${t("reserva.horario")}</span>
            <strong class="mono">${st.bloque.replace("-", "–")}</strong></div>
          <div class="fila-sep mt-2"><span class="texto-sm texto-dim">${t("reserva.total")}</span>
            <strong class="mono">${formatMoneda(st.reserva?.total ?? st.cotizacion.total)}</strong></div>
        </div>

        <div class="col mt-6" style="gap:10px">
          <button type="button" class="btn btn-contorno btn-bloque" data-calendario>
            ${raw(icono("calendario", { size: 17 }))} Agregar a mi calendario</button>
          ${!offline ? raw(`<button type="button" class="btn btn-contorno btn-bloque" data-comprobante>
            ${icono("recibo", { size: 17 })} ${esc(t("pago.comprobante"))}</button>`) : ""}
          <a class="btn btn-primario btn-bloque" href="#/reservas">${t("misReservas.titulo")}</a>
          <a class="btn btn-fantasma btn-bloque" href="#/">${t("nav.inicio")}</a>
        </div>
      </div>
    </div>`;

  // Pide permiso de notificaciones justo cuando tiene sentido.
  if (!pendiente && !offline) setTimeout(() => pedirPermisoPush({ silencioso: true }), 1400);

  contenedor.addEventListener("click", (e) => {
    if (e.target.closest("[data-calendario]")) descargarICS();
    if (e.target.closest("[data-comprobante]")) verComprobante({ ...reserva, espacios: st.espacio });
  });
}

/** Archivo .ics para Google Calendar, Outlook o Apple Calendario. */
function descargarICS() {
  const inicio = new Date(st.reserva?.inicio || `${st.fecha}T${st.bloque.split("-")[0]}`);
  const fin = new Date(st.reserva?.fin || `${st.fecha}T${st.bloque.split("-")[1]}`);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const org = store.get().organizacion?.nombre || "Smart Hub";

  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Smart Hub//ES",
    "BEGIN:VEVENT",
    `UID:${st.reserva?.id || Date.now()}@centro-oficinas`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(inicio)}`,
    `DTEND:${fmt(fin)}`,
    `SUMMARY:${st.espacio.nombre} · ${org}`,
    `DESCRIPTION:Reserva ${st.reserva?.folio || ""}. ${st.notas || ""}`,
    `LOCATION:${org}`,
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Tu reserva empieza en 1 hora", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reserva-${st.reserva?.folio || "espacio"}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toastOk("Evento descargado");
}
