/* ======================================================================
   legal.js — Textos legales de Smart Hub.

   IMPORTANTE, léelo antes de publicar
   -----------------------------------
   Esto es un BORRADOR TÉCNICO. Describe con exactitud lo que el sistema
   hace hoy —qué datos guarda, cuánto reembolsa, cómo se borra una
   cuenta— porque eso sí se puede verificar leyendo el código y la base
   de datos.

   Lo que NO puede salir de aquí es la parte jurídica de la empresa:
   razón social, domicilio fiscal, RFC, representante legal, autoridad
   competente. Esos huecos van marcados con PENDIENTE y se pintan
   resaltados en la página, precisamente para que nadie publique el
   documento creyendo que está terminado.

   Antes de abrir al público:
     1. rellena todo lo que diga PENDIENTE (ver OWNER_ACTIONS.md);
     2. que lo revise alguien de derecho — esto no es asesoría legal;
     3. confirma que los plazos y porcentajes de abajo son los que de
        verdad quieres ofrecer: hoy son los que el software aplica.
   ====================================================================== */
import { BOOKING, PAYMENTS, APP, AUTH } from "../core/config.js";

/** Marca un dato que sólo puede poner el propietario. */
export const PENDIENTE = (que) => ({ pendiente: que });

/* Porcentajes y plazos REALES, leídos de la configuración que aplica el
   motor de reservas. Si se cambian ahí, estos textos cambian solos: un
   documento legal que contradiga al software es peor que no tenerlo. */
const HORAS_GRATIS = BOOKING.horasCancelacionGratis;
const RETENCION = Math.round(BOOKING.penalizacionTardia * 100);
const IVA = Math.round(PAYMENTS.taxRate * 100);

export const IDENTIDAD = {
  marca: APP.name,
  razonSocial: PENDIENTE("Razón social completa, tal como aparece en el acta constitutiva"),
  rfc: PENDIENTE("RFC de la empresa"),
  domicilioFiscal: PENDIENTE("Domicilio fiscal completo con código postal"),
  representante: PENDIENTE("Nombre del representante legal"),
  correoContacto: PENDIENTE("Correo de contacto para asuntos legales y de privacidad"),
  telefono: PENDIENTE("Teléfono de atención"),
};

export const DOCUMENTOS = {
  /* ---------------------------------------------------------------- */
  privacidad: {
    slug: "privacidad",
    titulo: "Aviso de Privacidad",
    resumen: "Qué datos tuyos guardamos, para qué, y cómo pedir que los borremos.",
    secciones: [
      {
        h: "Quién es responsable de tus datos",
        p: [
          `El responsable del tratamiento de tus datos personales es ${APP.name}, ` +
          "operado por RAZON_SOCIAL, con domicilio en DOMICILIO_FISCAL.",
          "Para cualquier asunto relacionado con este aviso puedes escribir a CORREO_LEGAL.",
        ],
        pendientes: ["RAZON_SOCIAL", "DOMICILIO_FISCAL", "CORREO_LEGAL"],
      },
      {
        h: "Qué datos recogemos",
        lista: [
          "Nombre y correo electrónico: para crear tu cuenta e identificarte.",
          "Teléfono (opcional): sólo si lo escribes tú, para avisarte de tus reservas.",
          "Tus reservas: espacio, fecha, hora, número de asistentes y notas que escribas.",
          "Pagos: importe, moneda, método y el identificador que devuelve la pasarela. " +
          "El número de tarjeta NO pasa por nuestros servidores ni se guarda: lo captura " +
          "directamente Clip en su página segura de pago.",
          "Datos técnicos mínimos para que la app funcione: preferencia de tema e idioma, " +
          "y la sesión, guardados en tu propio dispositivo.",
        ],
      },
      {
        h: "Lo que NO recogemos",
        p: [
          "No pedimos ni usamos tu ubicación GPS. La app muestra la dirección fija del " +
          "edificio y un plano del inmueble; eso no es lo mismo que saber dónde estás tú.",
          "No hay publicidad ni rastreadores de terceros. No vendemos ni cedemos tus datos.",
        ],
      },
      {
        h: "Para qué los usamos",
        lista: [
          "Gestionar tu cuenta y tus reservas.",
          "Cobrar y emitir comprobantes.",
          "Avisarte de tus propias reservas (confirmación, recordatorio, cancelación).",
          "Cumplir obligaciones fiscales y contables.",
        ],
      },
      {
        h: "Cuánto tiempo los guardamos",
        p: [
          "Tu cuenta y sus datos, mientras la tengas abierta.",
          "Los comprobantes de pago y las facturas se conservan el tiempo que exige la " +
          "legislación fiscal, incluso si borras tu cuenta: en ese caso quedan " +
          "desvinculados de tu persona (sin tu identificador de usuario).",
        ],
      },
      {
        h: "Tus derechos (ARCO)",
        p: [
          "Puedes acceder, rectificar, cancelar u oponerte al tratamiento de tus datos.",
          "Acceso y rectificación los tienes dentro de la app, en tu perfil.",
          "La eliminación de la cuenta también: Configuración → Eliminar mi cuenta. " +
          "Se borra tu perfil, tus reservas futuras se cancelan y tus datos personales " +
          "se desvinculan de los comprobantes que la ley obliga a conservar.",
          "Si prefieres hacerlo por escrito, escribe a CORREO_LEGAL.",
        ],
        pendientes: ["CORREO_LEGAL"],
      },
      {
        h: "Dónde se guardan",
        p: [
          "La base de datos y los archivos están alojados en Supabase. Los cobros con " +
          "tarjeta los procesa Clip. Ambos son proveedores externos con sus propias " +
          "políticas de privacidad, y ambos pueden tratar datos fuera de México.",
        ],
      },
      {
        h: "Cambios a este aviso",
        p: ["Si cambiamos este aviso lo publicaremos aquí con su nueva fecha."],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  terminos: {
    slug: "terminos",
    titulo: "Términos y Condiciones",
    resumen: "Las reglas de uso del servicio y de los espacios.",
    secciones: [
      {
        h: "Quién presta el servicio",
        p: [`${APP.name}, operado por RAZON_SOCIAL, RFC RFC_EMPRESA, con domicilio en DOMICILIO_FISCAL.`],
        pendientes: ["RAZON_SOCIAL", "RFC_EMPRESA", "DOMICILIO_FISCAL"],
      },
      {
        h: "Tu cuenta",
        lista: [
          "Necesitas una cuenta para reservar. Los datos que registres deben ser verdaderos.",
          "Eres responsable de lo que se haga desde tu cuenta. No la compartas.",
          "Podemos suspender una cuenta que incumpla estas condiciones o que se use para dañar el servicio.",
        ],
      },
      {
        h: "Reservas",
        lista: [
          `Los bloques son de ${BOOKING.bloques?.[0]?.includes("-") ? "dos horas" : "duración fija"}, dentro del horario de operación del edificio.`,
          `Se puede reservar hasta con ${BOOKING.diasMaximos} días de anticipación.`,
          `Puedes tener hasta ${BOOKING.maxReservasActivas} reservas activas a la vez.`,
          "Una reserva queda apartada al confirmarse el pago. Si el pago no se completa, el horario se libera.",
          "Si dos personas reservan el mismo horario a la vez, la reserva es de quien la complete primero: " +
          "es la base de datos la que decide, no el orden en que se vio la pantalla.",
        ],
      },
      {
        h: "Precios y pago",
        lista: [
          `Los precios se muestran por hora y se calculan en el servidor. El IVA (${IVA} %) se desglosa antes de cobrar.`,
          "El precio que se cobra es siempre el que calcula el servidor a partir de la tarifa vigente del espacio.",
          "El pago con tarjeta lo procesa Clip. No almacenamos números de tarjeta.",
        ],
      },
      {
        h: "Uso de los espacios",
        lista: [
          "Prohibido fumar dentro del edificio.",
          "Se pide dejar el espacio ordenado al terminar.",
          "No se puede exceder el aforo indicado de cada espacio.",
          "Los daños causados al mobiliario o al inmueble corren por cuenta de quien reservó.",
          "REGLAS_ADICIONALES",
        ],
        pendientes: ["REGLAS_ADICIONALES"],
      },
      {
        h: "Responsabilidad",
        p: [
          "El servicio se presta tal cual. Hacemos lo razonable por mantenerlo disponible, " +
          "pero no garantizamos disponibilidad ininterrumpida.",
          "LIMITE_RESPONSABILIDAD",
        ],
        pendientes: ["LIMITE_RESPONSABILIDAD"],
      },
      {
        h: "Ley aplicable",
        p: ["Estas condiciones se rigen por las leyes de LEY_APLICABLE, con jurisdicción en JURISDICCION."],
        pendientes: ["LEY_APLICABLE", "JURISDICCION"],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  cancelacion: {
    slug: "cancelacion",
    titulo: "Política de Cancelación",
    resumen: `Hasta ${HORAS_GRATIS} horas antes, sin costo.`,
    secciones: [
      {
        h: "Cómo cancelar",
        p: [
          "Desde la app: Mis reservas → la reserva → Cancelar. No hace falta llamar ni escribir.",
        ],
      },
      {
        h: "Plazos",
        lista: [
          `Con más de ${HORAS_GRATIS} horas de anticipación: se devuelve el 100 %.`,
          `Con menos de ${HORAS_GRATIS} horas: se retiene el ${RETENCION} % y se devuelve el resto.`,
          "Si no te presentas y no cancelaste, la reserva se marca como «no asistió» y no genera devolución.",
        ],
      },
      {
        h: "Sobre estos porcentajes",
        p: [
          `Estos plazos y porcentajes son exactamente los que aplica el sistema hoy ` +
          `(${HORAS_GRATIS} h y ${RETENCION} %). El cálculo se hace sobre la fecha original de la reserva, ` +
          "no sobre la fecha a la que se haya movido.",
          "CONFIRMACION_PORCENTAJES",
        ],
        pendientes: ["CONFIRMACION_PORCENTAJES"],
      },
      {
        h: "Cancelaciones por nuestra parte",
        p: [
          "Si tenemos que cancelar una reserva (avería, mantenimiento, fuerza mayor), " +
          (AUTH.emailDeliveryEnabled
            ? "se devuelve el 100 % del importe y te avisamos por la app y por correo."
            : "se devuelve el 100 % del importe y te avisamos por la app."),
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  reembolso: {
    slug: "reembolso",
    titulo: "Política de Reembolso",
    resumen: "Cómo y cuándo vuelve el dinero.",
    secciones: [
      {
        h: "Por dónde vuelve",
        p: [
          "El reembolso se hace siempre por el mismo medio con el que pagaste. " +
          "No se entrega en efectivo ni por otra vía.",
        ],
      },
      {
        h: "Cuánto tarda",
        p: [
          "Nosotros ordenamos la devolución al confirmar la cancelación. " +
          "El tiempo que tarda en aparecer en tu estado de cuenta lo decide tu banco " +
          "o la pasarela; la app no garantiza un plazo exacto de acreditación.",
          "PLAZO_REEMBOLSO_COMPROMETIDO",
        ],
        pendientes: ["PLAZO_REEMBOLSO_COMPROMETIDO"],
      },
      {
        h: "Cuánto",
        p: [
          "El importe sale de la Política de Cancelación: depende de con cuánta " +
          "anticipación se canceló.",
          "Los reembolsos parciales devuelven el importe correspondiente incluyendo la " +
          "parte proporcional del IVA.",
        ],
      },
      {
        h: "Si algo sale mal",
        p: [
          "Si el espacio no estaba en condiciones de usarse, escríbenos y lo revisamos " +
          "caso por caso.",
          "CRITERIO_INCIDENCIAS",
        ],
        pendientes: ["CRITERIO_INCIDENCIAS"],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  cuenta: {
    slug: "cuenta",
    titulo: "Eliminación de Cuenta",
    resumen: "Cómo borrar tu cuenta y qué pasa con tus datos.",
    secciones: [
      {
        h: "Cómo se borra",
        p: [
          "En la app: Configuración → Eliminar mi cuenta. Se pide confirmación porque no tiene vuelta atrás.",
        ],
      },
      {
        h: "Qué se borra",
        lista: [
          "Tu perfil: nombre, correo, teléfono y foto.",
          "Tus favoritos, reseñas y mensajes.",
          "Tus reservas futuras se cancelan.",
        ],
      },
      {
        h: "Qué se conserva, y por qué",
        p: [
          "Los comprobantes de pago y las facturas ya emitidas se conservan el tiempo " +
          "que exige la legislación fiscal. No se pueden borrar sin incumplir la ley.",
          "Eso sí: dejan de apuntar a tu persona. El nombre y el correo quedan copiados " +
          "dentro del propio comprobante para que el histórico contable siga siendo " +
          "legible, y el registro deja de estar ligado a tu cuenta.",
        ],
      },
      {
        h: "Reservas en curso",
        p: [
          "Si tienes una reserva ya pagada y sin disfrutar, cancélala antes de borrar la " +
          "cuenta para que el reembolso siga la política normal.",
        ],
      },
    ],
  },
};

export const ORDEN = ["privacidad", "terminos", "cancelacion", "reembolso", "cuenta"];

/** Todos los huecos que el propietario tiene que rellenar. */
export function pendientes() {
  const out = [];
  for (const clave of ORDEN) {
    for (const s of DOCUMENTOS[clave].secciones) {
      for (const p of s.pendientes || []) out.push({ documento: clave, seccion: s.h, marca: p });
    }
  }
  return out;
}

export default { DOCUMENTOS, ORDEN, IDENTIDAD, pendientes };
