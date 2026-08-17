/* ======================================================================
   loader.js — Carga diferida de Three.js y sus complementos.

   Nada de esto entra en el arranque de la app: sólo se descarga cuando
   el usuario abre el mapa 3D. Además decide el nivel de calidad según
   el dispositivo, para que un teléfono modesto no intente renderizar
   sombras suaves a 4K.
   ====================================================================== */
import { GRAPHICS, STORAGE_KEYS } from "../core/config.js";
import { esMovil, clamp } from "../core/utils.js";

let THREE = null;
let addons = {};

/** Carga el núcleo de Three.js una sola vez. */
export async function cargarThree() {
  if (THREE) return THREE;
  THREE = await import("three");
  return THREE;
}

/** Carga un complemento oficial bajo demanda. */
export async function cargarAddon(nombre) {
  if (addons[nombre]) return addons[nombre];
  const rutas = {
    GLTFLoader: "three/addons/loaders/GLTFLoader.js",
    DRACOLoader: "three/addons/loaders/DRACOLoader.js",
    KTX2Loader: "three/addons/loaders/KTX2Loader.js",
    RGBELoader: "three/addons/loaders/RGBELoader.js",
    EXRLoader: "three/addons/loaders/EXRLoader.js",
    RoomEnvironment: "three/addons/environments/RoomEnvironment.js",
    OrbitControls: "three/addons/controls/OrbitControls.js",
    MeshoptDecoder: "three/addons/libs/meshopt_decoder.module.js",
  };
  const ruta = rutas[nombre];
  if (!ruta) throw new Error(`Complemento desconocido: ${nombre}`);
  addons[nombre] = await import(/* @vite-ignore */ ruta);
  return addons[nombre];
}

/* ---------------------------------------------------------------------
   Perfiles de calidad
   --------------------------------------------------------------------- */
export const PERFILES = {
  bajo: {
    sombras: false, sombraTam: 512, pixelRatio: 1, antialias: false,
    entorno: false, reflejos: false, personas: 0, autos: 0, vegetacion: 6,
    segmentos: 8, mobiliario: false, niebla: false,
  },
  medio: {
    sombras: true, sombraTam: 1024, pixelRatio: 1.5, antialias: true,
    entorno: true, reflejos: false, personas: 4, autos: 2, vegetacion: 14,
    segmentos: 14, mobiliario: true, niebla: true,
  },
  alto: {
    sombras: true, sombraTam: 2048, pixelRatio: 2, antialias: true,
    entorno: true, reflejos: true, personas: 8, autos: 4, vegetacion: 26,
    segmentos: 24, mobiliario: true, niebla: true,
  },
};

/** Estima la capacidad del dispositivo y devuelve "bajo" | "medio" | "alto". */
export function detectarCalidad() {
  let forzado = GRAPHICS.quality;
  try {
    const guardado = localStorage.getItem(STORAGE_KEYS.calidad3d);
    if (guardado) forzado = guardado;
  } catch { /* ignora */ }
  if (forzado && forzado !== "auto" && PERFILES[forzado]) return forzado;

  const memoria = navigator.deviceMemory || (esMovil() ? 4 : 8);
  const nucleos = navigator.hardwareConcurrency || (esMovil() ? 4 : 8);
  const pixeles = (screen.width * screen.height * (devicePixelRatio || 1)) / 1e6;
  const ahorro = navigator.connection?.saveData === true;

  let puntaje = 0;
  puntaje += memoria >= 8 ? 2 : memoria >= 4 ? 1 : 0;
  puntaje += nucleos >= 8 ? 2 : nucleos >= 4 ? 1 : 0;
  puntaje += pixeles > 8 ? -1 : 0;
  puntaje += esMovil() ? -1 : 1;
  if (ahorro) puntaje -= 2;

  if (puntaje <= 0) return "bajo";
  if (puntaje <= 2) return "medio";
  return "alto";
}

export function perfilActual() {
  const nivel = detectarCalidad();
  const perfil = { ...PERFILES[nivel], nivel };
  perfil.pixelRatio = clamp(Math.min(devicePixelRatio || 1, perfil.pixelRatio), 1, GRAPHICS.maxPixelRatio);
  return perfil;
}

/* ---------------------------------------------------------------------
   Cargadores de modelos
   --------------------------------------------------------------------- */
let gltfLoader = null;

/** GLTFLoader con Draco y Meshopt listos (compresión de geometría). */
export async function getGLTFLoader(renderer) {
  if (gltfLoader) return gltfLoader;
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
    cargarAddon("GLTFLoader"), cargarAddon("DRACOLoader"),
  ]);
  gltfLoader = new GLTFLoader();

  const draco = new DRACOLoader();
  draco.setDecoderPath(GRAPHICS.dracoDecoderPath);
  draco.setDecoderConfig({ type: "js" });
  gltfLoader.setDRACOLoader(draco);

  try {
    const { MeshoptDecoder } = await cargarAddon("MeshoptDecoder");
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  } catch { /* opcional */ }

  if (renderer) {
    try {
      const { KTX2Loader } = await cargarAddon("KTX2Loader");
      const ktx2 = new KTX2Loader()
        .setTranscoderPath("https://unpkg.com/three@0.160.0/examples/jsm/libs/basis/")
        .detectSupport(renderer);
      gltfLoader.setKTX2Loader(ktx2);
    } catch { /* opcional */ }
  }
  return gltfLoader;
}

/**
 * Carga un modelo GLTF/GLB. Devuelve null si falla, para que la escena
 * siga funcionando con la geometría generada por código.
 */
/**
 * Carga un GLTF/GLB. Nunca se queda colgado.
 *
 * El GLTFLoader vive en `three/addons/`, que apunta a una CDN. Si esa
 * CDN no responde —red mala, cortafuegos de oficina—, el `await` se
 * quedaba esperando para siempre y el mapa entero no llegaba a
 * dibujarse: "Construyendo el edificio en 3D…" eterno. Un adorno
 * opcional no puede impedir que se vea el edificio.
 */
export async function cargarModelo(url, renderer, { onProgress, tiempoMaximo = 20000 } = {}) {
  if (!url) return null;
  let reloj;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error("el modelo 3D tardó demasiado")), tiempoMaximo);
  });
  try {
    return await Promise.race([
      (async () => {
        const loader = await getGLTFLoader(renderer);
        return new Promise((resolve, reject) => loader.load(url, resolve, onProgress, reject));
      })(),
      limite,
    ]);
  } catch (e) {
    console.warn("[3d] no se pudo cargar el modelo", url, e?.message || e);
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/** Carga un HDRI (.hdr) y lo convierte en mapa de entorno PMREM. */
export async function cargarHDRI(url, renderer, three) {
  if (!url) return null;
  try {
    const { RGBELoader } = await cargarAddon("RGBELoader");
    const textura = await new Promise((resolve, reject) => new RGBELoader().load(url, resolve, undefined, reject));
    const pmrem = new three.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const entorno = pmrem.fromEquirectangular(textura).texture;
    textura.dispose();
    pmrem.dispose();
    return entorno;
  } catch (e) {
    console.warn("[3d] HDRI no disponible, uso entorno generado", e);
    return null;
  }
}

/** Entorno generado por código: iluminación suave de interior, sin descargas. */
export async function entornoGenerado(renderer, three) {
  try {
    const { RoomEnvironment } = await cargarAddon("RoomEnvironment");
    const pmrem = new three.PMREMGenerator(renderer);
    const entorno = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();
    return entorno;
  } catch (e) {
    console.warn("[3d] no se pudo generar el entorno", e);
    return null;
  }
}

export default { cargarThree, cargarAddon, perfilActual, detectarCalidad, cargarModelo, cargarHDRI, entornoGenerado, getGLTFLoader, PERFILES };
