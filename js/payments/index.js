/* ======================================================================
   payments/index.js — Registro de métodos de pago.

   Cada método es un módulo con la misma forma:
       { id, nombre, icono, disponible(), cobrar(ctx) }

   `cobrar` recibe { reserva, monto, moneda, descripcion, contenedor }
   y resuelve con { estado, metodo, proveedorId, ultimos4, marca, respuesta }.

   ⚠️ El cobro real SIEMPRE ocurre en el servidor (Edge Functions de
   Supabase). Aquí sólo vive lo que puede ser público: llaves
   publishable/client-id y la interfaz.
   ====================================================================== */
import { PAYMENTS } from "../core/config.js";
import { t } from "../core/i18n.js";

const MODULOS = {
  // V1 tiene una sola pasarela pública. Los adaptadores cliente antiguos
  // fueron retirados y esta allow-list impide que una configuración
  // remota invente o reactive otro método por accidente.
  clip: () => import("./clip.js"),
};

export const META = {
  clip: { nombre: () => "Clip", sub: "Pago seguro con tarjeta", emoji: "💳" },
};

/** Métodos que este dispositivo y esta configuración pueden usar. */
export async function metodosDisponibles() {
  const salida = [];
  const ocultos = [];
  for (const id of PAYMENTS.order) {
    if (!PAYMENTS[id]?.enabled) { ocultos.push(`${id}: enabled=false`); continue; }
    const cargador = MODULOS[id];
    if (!cargador) { ocultos.push(`${id}: sin módulo`); continue; }
    try {
      const mod = await cargador();
      const adaptador = mod.default || mod;
      const ok = await adaptador.disponible?.();
      if (ok) salida.push({ id, adaptador, ...META[id] });
      else ocultos.push(`${id}: ${motivo(id)}`);
    } catch (e) {
      ocultos.push(`${id}: ${e?.message || e}`);
    }
  }

  // Un método que desaparece sin decir nada cuesta una tarde de
  // depuración: la lista sale corta y no hay forma de saber por qué.
  // Esto no cambia lo que se muestra, sólo lo explica en la consola.
  if (ocultos.length) console.info("[pagos] métodos ocultos →", ocultos.join(" · "));
  if (!salida.length) console.warn("[pagos] no hay NINGÚN método de pago disponible.");
  return salida;
}

/** Por qué un método dice que no está disponible. */
function motivo(id) {
  if (id === "clip") return "PAYMENTS.clip.enabled=false, o la Edge Function pagos-clip no está lista";
  return "método fuera del catálogo público de V1";
}

export async function getAdaptador(id) {
  const cargador = MODULOS[id];
  if (!cargador) throw new Error(`Método de pago desconocido: ${id}`);
  const mod = await cargador();
  return mod.default || mod;
}

/** Carga un <script> externo una sola vez. */
const scriptsCargados = new Map();
export function cargarScript(src, { global = null } = {}) {
  if (global && window[global]) return Promise.resolve(window[global]);
  if (scriptsCargados.has(src)) return scriptsCargados.get(src);

  const promesa = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve(global ? window[global] : true);
    s.onerror = () => { scriptsCargados.delete(src); reject(new Error(`No se pudo cargar ${src}`)); };
    document.head.append(s);
  });
  scriptsCargados.set(src, promesa);
  return promesa;
}

export default { metodosDisponibles, getAdaptador, cargarScript, META };
