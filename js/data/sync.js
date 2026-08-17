/* ======================================================================
   sync.js — Vaciado de la bandeja de salida segura.

   V1 sólo permite encolar operaciones que pueden repetirse sin vender
   inventario ni mover dinero: favoritos. Reservar, modificar, cancelar,
   reseñar o cambiar el perfil requieren respuesta real del servidor.

   Además se purgan operaciones críticas que hayan quedado en IndexedDB
   desde versiones antiguas. Reenviar una reserva vieja al recuperar red
   podría ocupar un horario que la persona ya no espera tener.
   ====================================================================== */
import cache from "./cache.js";
import { getDB } from "./db.js";
import store from "../core/store.js";
import { emit, EV, on } from "../core/bus.js";

const MAX_INTENTOS = 5;
const TIPOS_SEGUROS = new Set(["fav_add", "fav_del"]);
let sincronizando = false;

/** Reenvía lo pendiente. Devuelve { enviadas, fallidas, descartadas }. */
export async function sincronizar() {
  if (sincronizando) return { enviadas: 0, fallidas: 0, descartadas: 0 };
  if (!store.get().conectado) return { enviadas: 0, fallidas: 0, descartadas: 0 };

  const db = await getDB();
  if (!db) return { enviadas: 0, fallidas: 0, descartadas: 0 };

  const cola = await cache.listarCola();
  if (!cola.length) {
    store.set({ pendientesSync: 0 }, "sync");
    return { enviadas: 0, fallidas: 0, descartadas: 0 };
  }

  sincronizando = true;
  let enviadas = 0, fallidas = 0, descartadas = 0;

  try {
    for (const op of cola) {
      // Compatibilidad defensiva: versiones anteriores encolaban reservas,
      // cancelaciones, reseñas y cambios de perfil. Ya no se ejecutan.
      if (!TIPOS_SEGUROS.has(op?.tipo)) {
        console.warn("[sync] operación antigua/arriesgada descartada:", op?.tipo);
        await cache.quitarDeCola(op.id);
        descartadas++;
        continue;
      }

      try {
        await ejecutar(db, op);
        await cache.quitarDeCola(op.id);
        enviadas++;
      } catch (e) {
        const intentos = (op.intentos || 0) + 1;
        if (intentos >= MAX_INTENTOS) {
          console.warn("[sync] operación descartada tras varios intentos", op, e);
          await cache.quitarDeCola(op.id);
          descartadas++;
        } else {
          await cache.actualizarEnCola({ ...op, intentos, ultimoError: String(e?.message || e) });
        }
        fallidas++;
      }
    }

    const restantes = await cache.listarCola();
    store.set({ pendientesSync: restantes.length }, "sync");

    if (enviadas) emit(EV.SYNC_COMPLETA, { enviadas, fallidas, descartadas });
    return { enviadas, fallidas, descartadas };
  } finally {
    sincronizando = false;
  }
}

async function ejecutar(db, op) {
  const { usuario } = store.get();
  if (!usuario?.id) throw new Error("No hay sesión para sincronizar favoritos.");

  switch (op.tipo) {
    case "fav_add": {
      const { error } = await db.from("favoritos").upsert({ usuario_id: usuario.id, espacio_id: op.payload.espacioId });
      if (error) throw error;
      return;
    }
    case "fav_del": {
      const { error } = await db.from("favoritos").delete()
        .eq("usuario_id", usuario.id).eq("espacio_id", op.payload.espacioId);
      if (error) throw error;
      return;
    }
    default:
      // Nunca debería llegar aquí por TIPOS_SEGUROS.
      throw new Error(`Tipo de sincronización no permitido: ${op.tipo}`);
  }
}

/** Arranca el vaciado automático: al recuperar red y cada 2 minutos. */
export function iniciarSync() {
  on(EV.CONEXION, (conectado) => { if (conectado) setTimeout(sincronizar, 1200); });
  setInterval(() => { if (store.get().conectado) sincronizar(); }, 120000);

  // Pide al service worker un Background Sync si el navegador lo soporta.
  navigator.serviceWorker?.ready?.then((reg) => {
    reg.sync?.register("sincronizar-operaciones-seguras").catch(() => {});
  }).catch(() => {});

  cache.listarCola().then((cola) => {
    store.set({ pendientesSync: cola.length }, "sync");
    if (cola.length && store.get().conectado) sincronizar();
  });
}

export default { sincronizar, iniciarSync };
