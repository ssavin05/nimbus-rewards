/* ======================================================================
   realtime.js — Sincronización en tiempo real vía websockets.

   Escucha tres cosas:
     • reservas       → repinta el semáforo del mapa al instante cuando
                        alguien más reserva o cancela.
     • espacios       → precios, estados y fotos cambiados desde el panel
                        de administración se reflejan sin recargar.
     • notificaciones → recordatorios y avisos de lista de espera.
     • mensajes       → chat con administración.
   ====================================================================== */
import { getDB } from "./db.js";
import { emit, EV } from "../core/bus.js";
import store from "../core/store.js";
import { invalidarDisponibilidad, getEspacios, getNotificaciones } from "./api.js";
import { throttle } from "../core/utils.js";

let canales = [];
let activo = false;
let arranque = null;   // promesa del arranque en curso

/** Repintar el mapa como mucho una vez por segundo aunque lleguen ráfagas. */
const avisarDisponibilidad = throttle((payload) => {
  emit(EV.DISPONIBILIDAD_CAMBIO, payload);
}, 900);

export async function iniciarRealtime() {
  // Sin esta promesa compartida había una carrera: entre el `if (activo)`
  // y el `activo = true` hay un `await`, así que dos llamadas seguidas
  // (arranque + cambio de sesión) pasaban las dos y se abrían los canales
  // POR DUPLICADO. Resultado: cada notificación llegaba dos veces.
  if (activo) return;
  if (arranque) return arranque;
  arranque = (async () => {
    const db = await getDB();
    if (!db) return;
    const { organizacion, usuario } = store.get();
    activo = true;

  /* ---------- reservas: disponibilidad en vivo ---------- */
  const canalReservas = db.channel("rt-reservas")
    .on("postgres_changes", { event: "*", schema: "public", table: "reservas" }, async (msg) => {
      const fila = msg.new || msg.old;
      if (!fila) return;
      await invalidarDisponibilidad(fila.espacio_id);
      avisarDisponibilidad({ espacioId: fila.espacio_id, evento: msg.eventType });

      // Si la reserva es mía, refresco mi lista sin pedir todo de nuevo.
      if (usuario && fila.usuario_id === usuario.id) {
        const actuales = store.get().reservas;
        if (msg.eventType === "INSERT") {
          if (!actuales.some((r) => r.id === fila.id)) store.set({ reservas: [msg.new, ...actuales] }, "reservas");
        } else if (msg.eventType === "UPDATE") {
          store.set({ reservas: actuales.map((r) => (r.id === fila.id ? { ...r, ...msg.new } : r)) }, "reservas");
        } else if (msg.eventType === "DELETE") {
          store.set({ reservas: actuales.filter((r) => r.id !== fila.id) }, "reservas");
        }
      }
    })
    .subscribe();
  canales.push(canalReservas);

  /* ---------- espacios: cambios del panel de administración ---------- */
  const canalEspacios = db.channel("rt-espacios")
    .on("postgres_changes", { event: "*", schema: "public", table: "espacios" }, throttle(async () => {
      await getEspacios({ forzar: true });
    }, 1500))
    .subscribe();
  canales.push(canalEspacios);

  /* ---------- notificaciones personales ---------- */
  if (usuario) {
    const canalNotif = db.channel("rt-notificaciones")
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notificaciones",
        filter: `usuario_id=eq.${usuario.id}`,
      }, (msg) => {
        const n = msg.new;
        if (n.programada_para && new Date(n.programada_para) > new Date()) return;
        // Si ya la teníamos (la trajo el fetch inicial, o el websocket
        // reenvió el evento al reconectar), no se vuelve a anunciar.
        if (store.get().notificaciones.some((x) => String(x.id) === String(n.id))) return;
        store.setNotificaciones([n, ...store.get().notificaciones]);
        emit(EV.NOTIFICACION, n);
      })
      .subscribe();
    canales.push(canalNotif);

    const canalChat = db.channel("rt-mensajes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes" }, (msg) => {
        emit(EV.CHAT_MENSAJE, msg.new);
      })
      .subscribe();
    canales.push(canalChat);

    getNotificaciones().catch(() => {});
  }

    if (organizacion?.id) console.info("[realtime] escuchando organización", organizacion.id);
  })();

  try { await arranque; } finally { arranque = null; }
}

export async function detenerRealtime() {
  arranque = null;
  const db = await getDB();
  for (const c of canales) { try { await db?.removeChannel(c); } catch { /* ignora */ } }
  canales = [];
  activo = false;
}

/** Reinicia los canales (por ejemplo tras iniciar o cerrar sesión). */
export async function reiniciarRealtime() {
  await detenerRealtime();
  await iniciarRealtime();
}

/** Presencia: cuántas personas están mirando el mismo espacio ahora. */
export async function presenciaEspacio(espacioId, alCambiar) {
  const db = await getDB();
  if (!db) return () => {};
  const { usuario } = store.get();
  const canal = db.channel(`presencia-${espacioId}`, {
    config: { presence: { key: usuario?.id || `anon-${Math.random().toString(36).slice(2)}` } },
  });
  canal.on("presence", { event: "sync" }, () => {
    alCambiar?.(Object.keys(canal.presenceState()).length);
  });
  await canal.subscribe(async (estado) => {
    if (estado === "SUBSCRIBED") await canal.track({ en: new Date().toISOString() });
  });
  return async () => { try { await db.removeChannel(canal); } catch { /* ignora */ } };
}

export default { iniciarRealtime, detenerRealtime, reiniciarRealtime, presenciaEspacio };
