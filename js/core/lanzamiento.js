/* ======================================================================
   lanzamiento.js — Purga la disponibilidad vieja tras limpiar la base.

   El problema: `limpieza-lanzamiento-aplicar.sql` deja la base sin reservas,
   pero los equipos que ya abrieron la app siguen enseñando horarios
   ocupados. Esa ocupación vive en tres sitios distintos:

     · IndexedDB   claves `disp:*` y `mapa:*`, con TTL de minutos
     · Service Worker   respuestas REST guardadas en `co-datos-*`
     · localStorage     el estado del modo local (`mock`), que apunta
                        reservas hechas sin backend

   Subir la versión del Service Worker tira su caché, pero NO toca
   IndexedDB ni localStorage. Hace falta esto.

   CÓMO SE USA
     Al limpiar la base, se cambia `APP.epocaLanzamiento` en config.js
     por la fecha de hoy. Cada equipo compara esa marca con la que tiene
     guardada la primera vez que abre la app; si no coinciden, purga y
     la anota. Se hace una sola vez por equipo y por época.

   QUÉ NO TOCA
     La sesión. Ni el token de Supabase, ni las preferencias. La cola
     offline sólo contiene favoritos; las reservas nunca se difieren.
     Purgar la caché no puede echar a nadie de su cuenta.
   ====================================================================== */
import { APP } from "./config.js";
import cache from "../data/cache.js";

const CLAVE_EPOCA = "co.epoca";

/** Claves de localStorage que NO se tocan bajo ningún concepto. */
const INTOCABLES = [
  /^sb-.*-auth-token$/,      // sesión de Supabase
  /^co\.ajustes$/,           // configuración de la administración
  /^co\.tema$/, /^co\.idioma$/,
  /^co\.epoca$/,
];

const esIntocable = (k) => INTOCABLES.some((re) => re.test(k));

/**
 * Compara la época de lanzamiento y purga si cambió.
 * @returns {Promise<{purgado:boolean, epoca:string, motivo?:string}>}
 */
export async function revisarEpocaDeLanzamiento() {
  const epoca = String(APP.epocaLanzamiento || "");
  if (!epoca) return { purgado: false, epoca };

  let guardada = null;
  try { guardada = localStorage.getItem(CLAVE_EPOCA); } catch { /* sin storage */ }
  if (guardada === epoca) return { purgado: false, epoca };

  // `conPurga` cierra la puerta de lectura de la caché mientras dura.
  // Cualquier `cache.leer()` que ocurra ahora —de donde sea— espera a
  // que esto acabe, en vez de servir un dato que se está borrando.
  await cache.conPurga(() => purgarDatosCaducos());

  // La época sólo se da por hecha si la purga terminó. Si algo falló, no
  // se anota y se reintenta en el siguiente arranque.
  try { localStorage.setItem(CLAVE_EPOCA, epoca); } catch { /* da igual */ }
  console.info(`[lanzamiento] caché de disponibilidad purgada (época ${epoca}).`);
  return { purgado: true, epoca, motivo: guardada ? "época nueva" : "primera vez" };
}

/**
 * Borra lo que puede estar mintiendo sobre la disponibilidad. Se puede
 * llamar a mano desde la administración («Vaciar caché»).
 */
export async function purgarDatosCaducos() {
  // 1. IndexedDB: disponibilidad, semáforo del mapa y catálogo. El
  //    catálogo también, porque lleva `total_reservas` y la
  //    calificación, que la limpieza puso a cero.
  try {
    await cache.borrarPorPrefijo?.("disp:");
    await cache.borrarPorPrefijo?.("mapa:");
    await cache.borrarPorPrefijo?.("espacios:");
    await cache.vaciarAlmacen?.("espacios");
  } catch (e) { console.warn("[lanzamiento] IndexedDB:", e?.message || e); }

  // 2. Service Worker: las respuestas REST guardadas.
  try {
    if (typeof caches !== "undefined") {
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => /^co-datos-/.test(n)).map((n) => caches.delete(n)));
    }
  } catch (e) { console.warn("[lanzamiento] caches:", e?.message || e); }

  // 3. localStorage del modo local: reservas apuntadas sin backend.
  //    La sesión y las preferencias se quedan.
  try {
    const aBorrar = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || esIntocable(k)) continue;
      if (/^co\.(mock|demo|reservas|disponibilidad)/.test(k)) aBorrar.push(k);
    }
    for (const k of aBorrar) localStorage.removeItem(k);
    // El estado del modo local usa su propia clave, ya cubierta por el
    // patrón co.mock/co.demo de arriba.
  } catch (e) { console.warn("[lanzamiento] localStorage:", e?.message || e); }
}

export default { revisarEpocaDeLanzamiento, purgarDatosCaducos };
