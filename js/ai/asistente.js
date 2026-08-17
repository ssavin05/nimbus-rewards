/* ======================================================================
   asistente.js — Motor del asistente virtual.

   Dos modos, transparentes para la vista:

   1. Con servidor: llama a la Edge Function `asistente`, que habla con
      el modelo y puede ejecutar herramientas (buscar espacios, consultar
      disponibilidad, crear una reserva).

   2. Sin servidor: motor local de intenciones. Entiende las consultas
      habituales del negocio y resuelve la mayoría sin salir del
      navegador. No inventa datos: sólo responde con lo que hay en el
      catálogo y la disponibilidad reales.
   ====================================================================== */
import { AI, CONTACT, BOOKING, FEATURES } from "../core/config.js";
import { invocarFuncion } from "../data/db.js";
import api from "../data/api.js";
import store from "../core/store.js";
import { buscar, interpretar } from "./busqueda.js";
import { isoFecha, fechaLarga, formatMoneda, normalizar, sumarDias } from "../core/utils.js";

/* ---------------------------------------------------------------------
   Herramientas que el modelo (o el motor local) puede ejecutar
   --------------------------------------------------------------------- */
export const HERRAMIENTAS = {
  async buscar_espacios({ consulta = "", capacidad = null, tipo = null, fecha = null }) {
    const espacios = await api.getEspacios();
    const disponibilidad = await api.getDisponibilidadMapa(fecha || isoFecha()).catch(() => ({}));
    let resultados = await buscar(consulta || tipo || "espacio", espacios.filter((e) => api.esReservableV1(e)), disponibilidad);
    if (capacidad) resultados = resultados.filter((r) => Number(r.espacio.capacidad) >= capacidad);
    return resultados.slice(0, 5).map((r) => resumenEspacio(r.espacio, disponibilidad[r.espacio.id]));
  },

  async consultar_disponibilidad({ espacio_id, fecha }) {
    const bloques = await api.getDisponibilidad(espacio_id, fecha || isoFecha());
    return { fecha: fecha || isoFecha(), libres: bloques.filter((b) => b.libre).map((b) => b.bloque) };
  },

  async detalle_espacio({ espacio_id }) {
    const e = await api.getEspacio(espacio_id);
    return e ? resumenEspacio(e) : null;
  },

  async mis_reservas() {
    const reservas = await api.getMisReservas();
    return reservas.slice(0, 5).map((r) => ({
      folio: r.folio, espacio: r.espacios?.nombre, inicio: r.inicio, estado: r.estado, total: r.total,
    }));
  },
};

function resumenEspacio(e, disp = null) {
  return {
    id: e.id, nombre: e.nombre, codigo: e.codigo, tipo: e.tipo,
    capacidad: e.capacidad, precio_hora: Number(e.precio_hora || 0),
    amenidades: e.amenidades || [], estado: e.estado,
    calificacion: Number(e.calificacion || 0),
    libres_hoy: disp?.libres ?? null,
  };
}

/* ---------------------------------------------------------------------
   Punto de entrada
   --------------------------------------------------------------------- */

/**
 * Responde a un mensaje.
 * @returns {Promise<{texto:string, espacios?:Array, acciones?:Array, fuente:"servidor"|"local"}>}
 */
export async function responder(mensaje, historial = []) {
  if (AI.enabled && AI.endpoint) {
    try {
      const datos = await invocarFuncion("asistente", {
        mensaje,
        historial: historial.slice(-10).map((m) => ({ rol: m.rol, texto: m.texto })),
        contexto: contextoUsuario(),
      });
      if (datos?.texto) {
        return { texto: datos.texto, espacios: datos.espacios || [], acciones: datos.acciones || [], fuente: "servidor" };
      }
    } catch (e) {
      console.info("[asistente] sin servidor de IA, uso el motor local:", e?.message || e);
    }
  }
  return responderLocal(mensaje);
}

function contextoUsuario() {
  const { perfil, reservas, organizacion } = store.get();
  return {
    nombre: perfil?.nombre || null,
    organizacion: organizacion?.nombre || null,
    reservas_activas: (reservas || []).filter((r) => r.estado !== "cancelada" && new Date(r.inicio) > new Date()).length,
    fecha_hoy: isoFecha(),
    bloques: BOOKING.bloques,
  };
}

/* ---------------------------------------------------------------------
   Motor local de intenciones
   --------------------------------------------------------------------- */
const INTENCIONES = [
  { id: "saludo", re: /^(hola|buenas|buenos dias|buenas tardes|hey|que tal|holi)\b/ },
  { id: "despedida", re: /\b(gracias|adios|hasta luego|bye|nos vemos)\b/ },
  { id: "precio", re: /\b(precio|cuesta|cuanto|tarifa|costo|vale)\b/ },
  { id: "cancelar", re: /\b(cancel|reembols|devoluc)/ },
  { id: "modificar", re: /\b(cambiar|mover|modific|reagend)/ },
  { id: "factura", re: /\b(factur|cfdi|rfc|fiscal)/ },
  { id: "pago", re: /\b(pag|tarjeta|paypal|mercado pago|oxxo|transferencia|spei)/ },
  { id: "horario", re: /\b(horario|abren|cierran|hora|abierto)\b/ },
  { id: "ubicacion", re: /\b(donde|direccion|ubicacion|llegar|estacion|mapa)\b/ },
  { id: "misReservas", re: /\b(mis reservas|mi reserva|que reserv|tengo reserv)\b/ },
  { id: "contacto", re: /\b(contact|telefono|whatsapp|hablar con|humano|persona|correo)\b/ },
  { id: "amenidad", re: /\b(wifi|internet|proyector|cafe|estacionamiento|aire|pizarron|impresora)\b/ },
  { id: "reservar", re: /\b(reserv|apart|quiero|necesito|busco|disponib|libre)\b/ },
];

async function responderLocal(mensaje) {
  const q = normalizar(mensaje);
  const intencion = INTENCIONES.find((i) => i.re.test(q))?.id || "desconocido";
  const nombre = store.get().perfil?.nombre?.split(" ")[0];

  switch (intencion) {
    case "saludo":
      return texto(`¡Hola${nombre ? ` ${nombre}` : ""}! Puedo ayudarte a encontrar un espacio, revisar disponibilidad o resolver dudas sobre pagos y cancelaciones. ¿Qué necesitas?`,
        { acciones: [
          { texto: "Ver espacios libres hoy", enviar: "¿Qué hay libre hoy?" },
          { texto: "Oficina para 4 personas", enviar: "Necesito una oficina para 4 personas" },
        ] });

    case "despedida":
      return texto("¡Con gusto! Si necesitas algo más, aquí estoy. 👋");

    case "precio": {
      const espacios = (await api.getEspacios()).filter((e) => api.esReservableV1(e) && e.estado === "disponible");
      if (!espacios.length) return texto("Ahora mismo no tengo precios cargados. Intenta de nuevo en un momento.");
      const ordenados = [...espacios].sort((a, b) => Number(a.precio_hora) - Number(b.precio_hora));
      const lineas = ordenados.map((e) => `• ${e.nombre}: ${formatMoneda(e.precio_hora)}/h${e.precio_dia ? ` · ${formatMoneda(e.precio_dia)}/día` : ""}`);
      return texto(`Estos son los precios vigentes:\n\n${lineas.join("\n")}\n\nTodos los precios llevan IVA aparte y se muestra el total antes de pagar.`,
        { espacios: ordenados.slice(0, 3) });
    }

    case "cancelar":
      return texto(
        `La política es sencilla:\n\n• Cancelas con **24 h o más** de anticipación → reembolso del 100 %.\n`
        + `• Con **menos de 24 h** → se retiene el ${Math.round(BOOKING.penalizacionTardia * 100)} %.\n\n`
        + "Para cancelar: Mis reservas → abre la reserva → Cancelar reserva. El tiempo de acreditación depende de Clip y del banco y normalmente puede tardar varios días hábiles.",
        { acciones: [{ texto: "Ir a mis reservas", ruta: "/reservas" }] });

    case "modificar":
      return texto("Puedes cambiar fecha y hora sin costo mientras el nuevo horario esté libre: Mis reservas → abre la reserva → Modificar reserva.",
        { acciones: [{ texto: "Ir a mis reservas", ruta: "/reservas" }] });

    case "factura":
      if (!FEATURES.facturacion) {
        return texto("La facturación todavía no está habilitada en este despliegue. No quiero prometerte un CFDI hasta que el emisor y el PAC estén configurados y probados.");
      }
      return texto("Puedes solicitar factura desde el detalle de una reserva pagada. Captura tus datos fiscales y la app mostrará el estado de la solicitud.",
        { acciones: [{ texto: "Ver mis pagos", ruta: "/pagos" }] });

    case "pago": {
      // Se listan los métodos que ESTÁN configurados, no un catálogo de
      // deseos: prometer OXXO o PayPal y que en el checkout sólo haya
      // tarjeta es una promesa rota en el peor momento.
      const { metodosDisponibles } = await import("../payments/index.js");
      const metodos = await metodosDisponibles().catch(() => []);
      if (!metodos.length) {
        return texto("Ahora mismo no hay ningún método de pago activo en la app. Escríbenos y lo resolvemos por otra vía.",
          { acciones: [{ texto: "Abrir chat", ruta: "/chat" }] });
      }
      const nombres = metodos.map((m) => (typeof m.nombre === "function" ? m.nombre() : m.nombre) || m.id);
      const lista = nombres.length > 1
        ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`
        : nombres[0];
      return texto(`Aceptamos ${lista}. Los pagos con tarjeta pasan por una pasarela certificada: no guardamos tus datos bancarios.`);
    }

    case "horario":
      return texto(`Los bloques de reserva configurados actualmente son: ${BOOKING.bloques.join(", ")}. La disponibilidad real para cada fecha se consulta en el catálogo antes de reservar.`);

    case "ubicacion": {
      const acciones = [{ texto: "Ver mapa 3D", ruta: "/mapa" }];
      if (CONTACT.direccion) {
        acciones.push({ texto: "Abrir en Google Maps", url: `https://maps.google.com/?q=${encodeURIComponent(CONTACT.direccion)}` });
        return texto(`La dirección configurada es ${CONTACT.direccion}. También puedes ver la distribución del edificio en el mapa 3D.`, { acciones });
      }
      // Sin dirección confirmada no se inventa un pin ni instrucciones de llegada.
      return texto("La dirección pública todavía no está configurada en la app. Puedes ver la distribución interior en el mapa 3D.", { acciones });
    }

    case "misReservas": {
      if (!store.get().sesion) {
        return texto("Necesito que inicies sesión para ver tus reservas.", { acciones: [{ texto: "Iniciar sesión", ruta: "/login" }] });
      }
      const reservas = await api.getMisReservas();
      const proximas = reservas.filter((r) => r.estado !== "cancelada" && new Date(r.inicio) > new Date())
        .sort((a, b) => new Date(a.inicio) - new Date(b.inicio)).slice(0, 3);
      if (!proximas.length) return texto("No tienes reservas próximas. ¿Buscamos un espacio?", { acciones: [{ texto: "Ver espacios", ruta: "/espacios" }] });
      const lineas = proximas.map((r) => `• ${r.espacios?.nombre || "Espacio"} — ${fechaLarga(r.inicio)} a las ${new Date(r.inicio).toTimeString().slice(0, 5)} (${r.folio})`);
      return texto(`Tus próximas reservas:\n\n${lineas.join("\n")}`, { acciones: [{ texto: "Ver todas", ruta: "/reservas" }] });
    }

    case "contacto": {
      // Sólo se ofrecen los canales que existen de verdad.
      const canales = [];
      if (CONTACT.whatsapp) canales.push(`escribirnos por WhatsApp al ${CONTACT.telefonoVisible || CONTACT.whatsapp}`);
      if (CONTACT.telefono) canales.push(`llamarnos${CONTACT.horarioAtencion ? ` (${CONTACT.horarioAtencion})` : ""}`);
      if (CONTACT.email) canales.push(`mandarnos un correo a ${CONTACT.email}`);
      const acciones = [];
      if (FEATURES.chat) acciones.push({ texto: "Abrir chat", ruta: "/chat" });
      if (CONTACT.whatsapp) acciones.push({ texto: "WhatsApp", url: `https://wa.me/${CONTACT.whatsapp}` });
      const intro = canales.length
        ? `Puedes ${canales.join(", ")}.${FEATURES.chat ? " También está disponible el chat de la app." : ""}`
        : FEATURES.chat
          ? "Puedes escribir por el chat de la app."
          : "No hay un canal de contacto adicional configurado en este momento.";
      return texto(intro, { acciones });
    }

    case "amenidad":
    case "reservar":
    default: {
      const intencionBusqueda = interpretar(mensaje);
      const espacios = (await api.getEspacios()).filter((e) => api.esReservableV1(e));
      const fecha = intencionBusqueda.fecha || isoFecha();
      const disponibilidad = await api.getDisponibilidadMapa(fecha).catch(() => ({}));
      const resultados = await buscar(mensaje, espacios, disponibilidad);

      if (!resultados.length) {
        return texto("No encontré una oficina que encaje con eso. Puedo buscar por capacidad, amenidades, fecha o presupuesto. Por ejemplo: “oficina para 4 personas el jueves”.",
          { acciones: [{ texto: "Ver todo el catálogo", ruta: "/espacios" }] });
      }

      const top = resultados.slice(0, 3).map((r) => r.espacio);
      const detalles = top.map((e) => {
        const d = disponibilidad[e.id];
        const libres = d ? `${d.libres} de ${d.total} bloques libres` : "consulta disponibilidad";
        return `• **${e.nombre}** — ${formatMoneda(e.precio_hora)}/h, hasta ${e.capacidad} personas · ${libres}`;
      });

      const encabezado = intencionBusqueda.fecha
        ? `Esto es lo que tengo para el ${fechaLarga(fecha)}:`
        : "Esto es lo que mejor encaja:";

      return texto(`${encabezado}\n\n${detalles.join("\n")}`, {
        espacios: top,
        acciones: [{ texto: `Reservar ${top[0].nombre}`, ruta: `/espacios/${top[0].id}` }],
      });
    }
  }
}

function texto(t, extra = {}) {
  return { texto: t, espacios: [], acciones: [], fuente: "local", ...extra };
}

/** Sugerencias iniciales del chat. */
export const SUGERENCIAS = [
  "¿Qué hay libre hoy?",
  "Oficina para 4 personas",
  "¿Cuál es la oficina más económica?",
  "¿Cómo cancelo una reserva?",
  "Necesito factura",
];

export default { responder, HERRAMIENTAS, SUGERENCIAS };
