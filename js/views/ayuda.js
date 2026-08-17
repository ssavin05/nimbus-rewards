/* ======================================================================
   ayuda.js — Centro de ayuda: preguntas frecuentes y canales de contacto.
   ====================================================================== */
import { html, raw, esc } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { icono } from "../core/iconos.js";
import { CONTACT, FEATURES, APP, AUTH } from "../core/config.js";
import { debounce, normalizar } from "../core/utils.js";

export const titulo = () => t("ayuda.titulo");

const FAQ = [
  {
    cat: "Reservas",
    p: "¿Cómo reservo una oficina?",
    r: "Entra al mapa 3D o al catálogo, toca el espacio que te interese, elige día y bloque de horario y continúa al checkout. La reserva sólo queda confirmada después de que la pasarela verifique el pago.",
  },
  {
    cat: "Reservas",
    p: "¿Con cuánta anticipación puedo reservar?",
    r: "Puedes reservar hasta con 90 días de anticipación y hasta el mismo día, siempre que el bloque no haya empezado.",
  },
  {
    cat: "Reservas",
    p: "¿Puedo cambiar la fecha u hora de mi reserva?",
    r: "Sí. Entra a Mis reservas, abre la reserva y toca “Modificar reserva”. Si el nuevo horario está libre, el cambio es inmediato y sin costo.",
  },
  {
    cat: "Cancelaciones",
    p: "¿Cuál es la política de cancelación?",
    r: "Cancelaciones con 24 horas o más de anticipación: reembolso del 100 %. Con menos de 24 horas: se retiene el 50 % del importe. El reembolso vuelve al mismo método de pago; el tiempo de acreditación depende de Clip y del banco y normalmente puede tardar varios días hábiles.",
  },
  {
    cat: "Cancelaciones",
    p: "¿Qué pasa si no llego a mi reserva?",
    r: "Si no vas a llegar, cancela desde Mis reservas lo antes posible. Una reserva marcada como “no asistió” no genera devolución; si vas con retraso, usa los canales de contacto disponibles en la app.",
  },
  {
    cat: "Pagos",
    p: "¿Qué métodos de pago aceptan?",
    r: "En el checkout aparece únicamente el método de pago que esté realmente habilitado. La V1 está preparada para cobrar con Clip y Smart Hub nunca guarda los datos de tu tarjeta.",
  },
  {
    cat: "Pagos",
    p: "¿Puedo pedir factura?",
    r: FEATURES.facturacion
      ? "Sí. Desde el detalle de una reserva pagada, toca “Solicitar factura” y captura tus datos fiscales. El sistema te mostrará el estado de la solicitud."
      : "La facturación todavía no está habilitada en este despliegue. No verás un botón de factura hasta que el emisor/PAC esté configurado y probado.",
  },
  {
    cat: "Pagos",
    p: "¿Cómo uso un código de promoción?",
    r: FEATURES.promociones
      ? "En el paso de reserva, escríbelo en el campo “Código de promoción” y toca Aplicar. El descuento se refleja en el resumen antes de pagar."
      : "Los códigos de promoción no están habilitados en este despliegue.",
  },
  {
    cat: "Espacios",
    p: "¿Qué incluye la renta?",
    r: "Cada ficha muestra las amenidades registradas para esa oficina. Revisa la ficha antes de reservar; la app no da por incluidos servicios que no estén publicados en el catálogo.",
  },
  {
    cat: "Espacios",
    p: "¿Puedo llevar visitas o clientes?",
    r: "Respeta siempre la capacidad indicada en la ficha. Si necesitas llevar personas adicionales o tienes una necesidad especial, consulta con administración antes de reservar.",
  },
  {
    cat: "Espacios",
    p: "¿Hay estacionamiento?",
    r: "El plano muestra la cochera del inmueble, pero la disponibilidad o asignación de estacionamiento debe confirmarse en la ficha de la oficina o con administración.",
  },
  {
    cat: "Cuenta",
    p: "Olvidé mi contraseña, ¿qué hago?",
    r: AUTH.emailDeliveryEnabled
      ? "En la pantalla de inicio de sesión, toca “¿Olvidaste tu contraseña?”. Te enviamos un enlace por correo para crear una nueva. Si no lo ves, revisa la carpeta de spam."
      : "El correo de recuperación todavía no está habilitado en este despliegue. Contacta a administración para recuperar el acceso.",
  },
  {
    cat: "Cuenta",
    p: "¿Puedo entrar con Google o Apple?",
    r: AUTH.googleEnabled || AUTH.appleEnabled
      ? `Sí, con los proveedores que aparecen en la pantalla de inicio de sesión${AUTH.googleEnabled && AUTH.appleEnabled ? " (Google y Apple)" : AUTH.googleEnabled ? " (Google)" : " (Apple)"}.`
      : "Todavía no. En este despliegue el acceso social está desactivado hasta que el proveedor quede configurado y probado.",
  },
  {
    cat: "Cuenta",
    p: "¿Cómo elimino mi cuenta?",
    r: "En Configuración → Eliminar mi cuenta. Se borran tu perfil, favoritos y reseñas. Las reservas ya pagadas se conservan anonimizadas por obligaciones fiscales.",
  },
  {
    cat: "Aplicación",
    p: "¿Funciona sin internet?",
    r: "Sí, parcialmente. Puedes ver el catálogo, el mapa 3D y datos ya descargados. Para reservar, modificar, cancelar o pagar necesitas conexión: la app no inventa disponibilidad ni guarda una reserva como si estuviera confirmada.",
  },
  {
    cat: "Aplicación",
    p: "¿Cómo la instalo en mi teléfono?",
    r: "En Android/Chrome aparece el botón “Instalar” en Configuración o un aviso del navegador. En iPhone: toca el botón Compartir de Safari y elige “Agregar a pantalla de inicio”.",
  },
  {
    cat: "Aplicación",
    p: "El mapa 3D va lento, ¿puedo mejorarlo?",
    r: "Entra a Configuración → Calidad del mapa 3D y baja el nivel a Media o Baja. También ayuda cerrar otras pestañas del navegador.",
  },
];

export function render(contenedor) {
  const categorias = [...new Set(FAQ.map((f) => f.cat))];

  contenedor.innerHTML = html`
    <div class="vista-scroll">
      <div class="vista-contenido">

        <h1 class="sr-only">${t("ayuda.titulo")}</h1>

        <a class="tarjeta tarjeta-pad banner-mapa mb-6" href="#/nosotros">
          <span class="bm-txt">
            <strong>${t("nosotros.conocenos")}</strong>
            <span class="texto-sm">${t("nosotros.conocenosDesc")}</span>
          </span>
          <span class="bm-ico" aria-hidden="true">${raw(icono("info", { size: 26 }))}</span>
        </a>

        <section class="seccion">
          <h2 class="seccion-titulo">${t("ayuda.contacto")}</h2>
          <div class="grid-auto">
            ${FEATURES.chat ? raw(`<a class="tarjeta tarjeta-pad canal" href="#/chat">
              <span class="canal-ico" style="background:var(--marca-suave);color:var(--marca)">${icono("chat", { size: 20 })}</span>
              <strong>${esc(t("ayuda.chat"))}</strong>
              <span class="texto-sm texto-dim">Escribe a administración desde la app</span></a>`) : ""}
            ${FEATURES.asistenteIA ? raw(`<a class="tarjeta tarjeta-pad canal" href="#/asistente">
              <span class="canal-ico" style="background:var(--purple-suave);color:var(--purple)">${icono("robot", { size: 20 })}</span>
              <strong>${esc(t("ayuda.asistente"))}</strong>
              <span class="texto-sm texto-dim">Disponible 24/7</span></a>`) : ""}
            ${CONTACT.whatsapp ? raw(`<a class="tarjeta tarjeta-pad canal" href="https://wa.me/${esc(CONTACT.whatsapp)}" target="_blank" rel="noopener">
              <span class="canal-ico" style="background:#dcf8e6;color:#128c7e">${icono("whatsapp", { size: 20 })}</span>
              <strong>WhatsApp</strong>
              <span class="texto-sm texto-dim">${esc(CONTACT.telefonoVisible)}</span></a>`) : ""}
            ${CONTACT.telefono ? raw(`<a class="tarjeta tarjeta-pad canal" href="tel:${esc(CONTACT.telefono)}">
              <span class="canal-ico" style="background:var(--ok-suave);color:var(--ok)">${icono("telefono", { size: 20 })}</span>
              <strong>${esc(t("ayuda.llamar"))}</strong>
              <span class="texto-sm texto-dim">${esc(CONTACT.horarioAtencion)}</span></a>`) : ""}
            ${CONTACT.email ? raw(`<a class="tarjeta tarjeta-pad canal" href="mailto:${esc(CONTACT.email)}">
              <span class="canal-ico" style="background:var(--warm-suave);color:var(--warm)">${icono("correo", { size: 20 })}</span>
              <strong>${esc(t("ayuda.correo"))}</strong>
              <span class="texto-sm texto-dim">${esc(CONTACT.email)}</span></a>`) : ""}
          </div>
        </section>

        <section class="seccion">
          <div class="seccion-cab"><h2>${t("ayuda.faq")}</h2></div>
          <div class="buscador mb-4">
            ${raw(icono("buscar", { size: 18, clase: "ci" }))}
            <input id="faq-busq" type="search" placeholder="Busca una pregunta…">
          </div>
          <div class="cinta mb-4" id="faq-cats">
            <button type="button" class="chip" data-cat="" aria-pressed="true">${t("app.todos")}</button>
            ${categorias.map((c) => raw(`<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`))}
          </div>
          <div id="faq-lista" class="acordeon"></div>
        </section>

        ${CONTACT.direccion ? raw(`<section class="seccion">
          <div class="tarjeta tarjeta-pad">
            <strong>${esc(CONTACT.direccion)}</strong>
            <p class="texto-sm texto-dim">${esc(CONTACT.horarioAtencion)}</p>
            <a class="btn btn-contorno btn-sm mt-2" target="_blank" rel="noopener"
               href="https://maps.google.com/?q=${encodeURIComponent(CONTACT.direccion)}">
              ${icono("ubicacion", { size: 15 })} Cómo llegar</a>
          </div>
        </section>`) : ""}

        <p class="texto-xs texto-suave texto-centro">${APP.name} · v${APP.version}</p>
      </div>
    </div>`;

  let filtroCat = "", filtroTexto = "";
  pintarFaq(contenedor, filtroCat, filtroTexto);

  contenedor.querySelector("#faq-busq").addEventListener("input", debounce((e) => {
    filtroTexto = e.target.value.trim();
    pintarFaq(contenedor, filtroCat, filtroTexto);
  }, 180));

  contenedor.querySelector("#faq-cats").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-cat]");
    if (!chip) return;
    filtroCat = chip.dataset.cat;
    contenedor.querySelectorAll("#faq-cats .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    pintarFaq(contenedor, filtroCat, filtroTexto);
  });

  contenedor.querySelector("#faq-lista").addEventListener("click", (e) => {
    const cab = e.target.closest(".acordeon-cab");
    if (!cab) return;
    const item = cab.parentElement;
    const abierto = item.getAttribute("data-abierto") === "true";
    item.setAttribute("data-abierto", String(!abierto));
    cab.setAttribute("aria-expanded", String(!abierto));
  });
}

function pintarFaq(contenedor, cat, texto) {
  const q = normalizar(texto);
  const lista = FAQ.filter((f) =>
    (!cat || f.cat === cat)
    && (!q || normalizar(f.p).includes(q) || normalizar(f.r).includes(q))
  );

  const cont = contenedor.querySelector("#faq-lista");
  cont.innerHTML = lista.length
    ? lista.map((f, i) => html`
      <div class="acordeon-item" data-abierto="false">
        <button type="button" class="acordeon-cab" aria-expanded="false" id="faq-b-${i}">
          <span class="crece">${f.p}</span>
          ${raw(icono("chevronAbajo", { size: 18 }))}
        </button>
        <div class="acordeon-cuerpo"><p class="texto-sm">${f.r}</p></div>
      </div>`).join("")
    : `<p class="texto-sm texto-dim texto-centro" style="padding:24px">
         No encontramos esa pregunta. Escríbenos por <a href="#/chat">chat</a> y te ayudamos.</p>`;
}
