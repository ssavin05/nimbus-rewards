/* ======================================================================
   bus.js — Bus de eventos mínimo para comunicar módulos sin acoplarlos.
   ====================================================================== */

const oyentes = new Map();

/** Suscribe a un evento. Devuelve la función para cancelar la suscripción. */
export function on(evento, fn) {
  if (!oyentes.has(evento)) oyentes.set(evento, new Set());
  oyentes.get(evento).add(fn);
  return () => off(evento, fn);
}

export function once(evento, fn) {
  const cancelar = on(evento, (...args) => { cancelar(); fn(...args); });
  return cancelar;
}

export function off(evento, fn) {
  oyentes.get(evento)?.delete(fn);
}

export function emit(evento, payload) {
  const set = oyentes.get(evento);
  if (!set) return;
  // Copia: un oyente puede desuscribirse durante la emisión.
  for (const fn of [...set]) {
    try { fn(payload); }
    catch (e) { console.error(`[bus] error en oyente de "${evento}"`, e); }
  }
}

/** Nombres de eventos usados en toda la app (evita cadenas mágicas). */
export const EV = {
  AUTH_CAMBIO: "auth:cambio",
  SESION_INICIADA: "auth:inicio",
  SESION_CERRADA: "auth:cierre",
  RECUPERAR_PASSWORD: "auth:recuperar",
  PERFIL_ACTUALIZADO: "perfil:actualizado",

  RESERVA_CREADA: "reserva:creada",
  RESERVA_CANCELADA: "reserva:cancelada",
  PAGO_REEMBOLSADO: "pago:reembolsado",
  REEMBOLSO_PENDIENTE: "pago:reembolso-pendiente",
  RESERVA_MODIFICADA: "reserva:modificada",
  DISPONIBILIDAD_CAMBIO: "disponibilidad:cambio",

  FAVORITOS_CAMBIO: "favoritos:cambio",
  RESENA_PUBLICADA: "resena:publicada",
  ESPACIOS_CAMBIO: "espacios:cambio",
  NOTIFICACION: "notificacion",
  CHAT_MENSAJE: "chat:mensaje",

  RUTA_CAMBIO: "router:cambio",
  TEMA_CAMBIO: "tema:cambio",
  IDIOMA_CAMBIO: "idioma:cambio",
  SEDE_CAMBIO: "sede:cambio",

  CONEXION: "red:conexion",
  SYNC_PENDIENTE: "sync:pendiente",
  SYNC_COMPLETA: "sync:completa",
  APP_ACTUALIZABLE: "app:actualizable",
};

export default { on, once, off, emit, EV };
