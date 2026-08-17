/* ======================================================================
   materiales.js — Materiales PBR y texturas generadas por código.

   Las texturas se dibujan en un <canvas> en tiempo de ejecución: sin
   descargas, sin archivos de 4K que tarden en cargar en móvil, y con
   resolución adaptable al perfil de calidad. Cuando existan texturas
   reales, basta con pasar sus URLs a `materialPBR`.
   ====================================================================== */

let THREE = null;
const cache = new Map();

export function init(three) { THREE = three; }

/* ---------------------------------------------------------------------
   Generación de texturas
   --------------------------------------------------------------------- */
function lienzo(tam) {
  const c = document.createElement("canvas");
  c.width = c.height = tam;
  return { c, ctx: c.getContext("2d") };
}

function aTextura(canvas, { repetir = 1, anisotropia = 4, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repetir, repetir);
  tex.anisotropy = anisotropia;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Piso de duela de madera con vetas y juntas. */
export function texturaMadera(tam = 512) {
  return memo(`madera-${tam}`, () => {
    const { c, ctx } = lienzo(tam);
    ctx.fillStyle = "#7a4f2b";
    ctx.fillRect(0, 0, tam, tam);

    const tablones = 6;
    const alto = tam / tablones;
    for (let i = 0; i < tablones; i++) {
      const y = i * alto;
      const tono = 34 + ((i * 37) % 26);
      ctx.fillStyle = `hsl(26 42% ${tono}%)`;
      ctx.fillRect(0, y, tam, alto - 1.5);

      // vetas
      ctx.strokeStyle = "rgba(40,22,10,0.16)";
      ctx.lineWidth = 1;
      for (let v = 0; v < 16; v++) {
        const vy = y + Math.random() * alto;
        ctx.beginPath();
        ctx.moveTo(0, vy);
        for (let x = 0; x <= tam; x += 16) {
          ctx.lineTo(x, vy + Math.sin((x + i * 40) * 0.045) * 2.2 + (Math.random() - 0.5));
        }
        ctx.stroke();
      }
      // junta
      ctx.fillStyle = "rgba(20,10,4,0.4)";
      ctx.fillRect(0, y + alto - 1.5, tam, 1.5);
      // junta transversal alternada
      const jx = (i % 2 ? 0.35 : 0.72) * tam;
      ctx.fillRect(jx, y, 1.5, alto);
    }
    return aTextura(c, { repetir: 4 });
  });
}

/** Mapa de rugosidad para la madera (más mate en las juntas). */
export function rugosidadMadera(tam = 256) {
  return memo(`rug-madera-${tam}`, () => {
    const { c, ctx } = lienzo(tam);
    ctx.fillStyle = "#9a9a9a";
    ctx.fillRect(0, 0, tam, tam);
    for (let i = 0; i < 900; i++) {
      const g = 130 + Math.random() * 70;
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(Math.random() * tam, Math.random() * tam, 2, 1);
    }
    return aTextura(c, { repetir: 4, srgb: false });
  });
}

/** Muro con textura fina de yeso. */
export function texturaMuro(tam = 256) {
  return memo(`muro-${tam}`, () => {
    const { c, ctx } = lienzo(tam);
    ctx.fillStyle = "#e7ecf2";
    ctx.fillRect(0, 0, tam, tam);
    for (let i = 0; i < 4000; i++) {
      const a = 0.02 + Math.random() * 0.05;
      ctx.fillStyle = Math.random() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      ctx.fillRect(Math.random() * tam, Math.random() * tam, 1.4, 1.4);
    }
    return aTextura(c, { repetir: 3 });
  });
}

/** Rejilla tipo plano arquitectónico para el suelo exterior. */
export function texturaBlueprint(tam = 512, { fondo = "#0b1220", linea = "#1e3a52", acento = "#2c5470" } = {}) {
  return memo(`blueprint-${tam}-${fondo}`, () => {
    const { c, ctx } = lienzo(tam);
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, tam, tam);
    const paso = tam / 16;
    ctx.strokeStyle = linea;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 16; i++) {
      ctx.beginPath(); ctx.moveTo(i * paso, 0); ctx.lineTo(i * paso, tam); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * paso); ctx.lineTo(tam, i * paso); ctx.stroke();
    }
    ctx.strokeStyle = acento;
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * paso * 4, 0); ctx.lineTo(i * paso * 4, tam); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * paso * 4); ctx.lineTo(tam, i * paso * 4); ctx.stroke();
    }
    return aTextura(c, { repetir: 10 });
  });
}

/** Césped procedural para jardines. */
export function texturaCesped(tam = 256) {
  return memo(`cesped-${tam}`, () => {
    const { c, ctx } = lienzo(tam);
    ctx.fillStyle = "#3f7a4d";
    ctx.fillRect(0, 0, tam, tam);
    for (let i = 0; i < 2600; i++) {
      const l = 22 + Math.random() * 24;
      ctx.strokeStyle = `hsl(${106 + Math.random() * 22} 34% ${l}%)`;
      ctx.lineWidth = 1;
      const x = Math.random() * tam, y = Math.random() * tam;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 4);
      ctx.stroke();
    }
    return aTextura(c, { repetir: 6 });
  });
}

/** Baldosa clara y muy sutil para la maqueta arquitectónica del mapa. */
export function texturaBaldosaClara(tam = 256, { fondo = "#d8d4cc", junta = "#c7c2b9" } = {}) {
  return memo(`baldosa-clara-${tam}-${fondo}-${junta}`, () => {
    const { c, ctx } = lienzo(tam);
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, tam, tam);

    // grano fino tipo concreto pulido, casi imperceptible
    for (let i = 0; i < 1800; i++) {
      const a = 0.012 + Math.random() * 0.025;
      ctx.fillStyle = Math.random() > 0.5
        ? `rgba(255,255,255,${a})`
        : `rgba(70,64,56,${a})`;
      ctx.fillRect(Math.random() * tam, Math.random() * tam, 1.3, 1.3);
    }

    const paso = tam / 8;
    ctx.strokeStyle = junta;
    ctx.globalAlpha = 0.36;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * paso, 0); ctx.lineTo(i * paso, tam); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * paso); ctx.lineTo(tam, i * paso); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return aTextura(c, { repetir: 4 });
  });
}

/** Concreto para cochera y pasillos exteriores. */
export function texturaConcreto(tam = 256) {
  return memo(`concreto-${tam}`, () => {
    const { c, ctx } = lienzo(tam);
    ctx.fillStyle = "#5d6570";
    ctx.fillRect(0, 0, tam, tam);
    for (let i = 0; i < 3200; i++) {
      const g = 70 + Math.random() * 50;
      ctx.fillStyle = `rgba(${g},${g + 4},${g + 10},${0.15 + Math.random() * 0.25})`;
      ctx.fillRect(Math.random() * tam, Math.random() * tam, 2, 2);
    }
    ctx.strokeStyle = "rgba(20,24,30,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, tam / 2); ctx.lineTo(tam, tam / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tam / 2, 0); ctx.lineTo(tam / 2, tam); ctx.stroke();
    return aTextura(c, { repetir: 5 });
  });
}

/** Cuadro decorativo abstracto para las paredes. */
export function texturaCuadro(tam = 128) {
  return memo(`cuadro-${tam}`, () => {
    const { c, ctx } = lienzo(tam);
    const g = ctx.createLinearGradient(0, 0, tam, tam);
    g.addColorStop(0, "#1d4e6b"); g.addColorStop(0.5, "#3d8ba8"); g.addColorStop(1, "#e5d2b0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, tam, tam);
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `hsl(${180 + i * 24} 44% ${40 + i * 6}%)`;
      ctx.beginPath();
      ctx.ellipse(tam * (0.2 + Math.random() * 0.6), tam * (0.2 + Math.random() * 0.6),
        tam * 0.1, tam * 0.22, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return aTextura(c, { repetir: 1 });
  });
}

/** Mapa de normales simple a partir de una textura de rugosidad. */
export function normalPlano(intensidad = 0.4, tam = 64) {
  return memo(`normal-${intensidad}-${tam}`, () => {
    const { c, ctx } = lienzo(tam);
    const img = ctx.createImageData(tam, tam);
    for (let i = 0; i < img.data.length; i += 4) {
      const ruido = (Math.random() - 0.5) * intensidad * 255;
      img.data[i] = 128 + ruido;
      img.data[i + 1] = 128 + ruido;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return aTextura(c, { repetir: 4, srgb: false });
  });
}

function memo(clave, fn) {
  if (!cache.has(clave)) cache.set(clave, fn());
  return cache.get(clave);
}

/* ---------------------------------------------------------------------
   Materiales PBR
   --------------------------------------------------------------------- */

/**
 * Material físico configurable. Acepta URLs de texturas reales o usa las
 * generadas por código.
 */
export function materialPBR({
  color = 0xffffff, mapa = null, rugosidad = 0.8, metalico = 0.0,
  normal = null, mapaRugosidad = null, emisivo = null, intensidadEmisiva = 1,
  transparente = false, opacidad = 1, ladoDoble = false, reflejos = false,
} = {}) {
  const params = {
    color, roughness: rugosidad, metalness: metalico,
    transparent: transparente, opacity: opacidad,
    side: ladoDoble ? THREE.DoubleSide : THREE.FrontSide,
  };
  if (mapa) params.map = mapa;
  if (normal) { params.normalMap = normal; params.normalScale = new THREE.Vector2(0.5, 0.5); }
  if (mapaRugosidad) params.roughnessMap = mapaRugosidad;
  if (emisivo != null) { params.emissive = new THREE.Color(emisivo); params.emissiveIntensity = intensidadEmisiva; }

  if (reflejos) {
    return new THREE.MeshPhysicalMaterial({
      ...params, clearcoat: 0.35, clearcoatRoughness: 0.25, reflectivity: 0.5,
    });
  }
  return new THREE.MeshStandardMaterial(params);
}

/** Cristal con reflejos y transparencia. */
export function materialCristal({ tinte = 0xbfe0ea, opacidad = 0.28 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: tinte, roughness: 0.05, metalness: 0, transmission: 0.85,
    thickness: 0.4, transparent: true, opacity: opacidad,
    clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.45, side: THREE.DoubleSide,
  });
}

/** Conjunto de materiales base del edificio. */
export function crearBiblioteca(perfil) {
  const detalle = perfil.nivel === "bajo" ? 128 : perfil.nivel === "medio" ? 256 : 512;
  const usarNormal = perfil.nivel !== "bajo";

  return {
    muro: materialPBR({
      color: 0xdfe6ee, mapa: texturaMuro(detalle), rugosidad: 0.92, metalico: 0.02,
      normal: usarNormal ? normalPlano(0.22, 64) : null,
    }),
    muroInterior: materialPBR({ color: 0xeef2f7, rugosidad: 0.95 }),
    pisoMadera: materialPBR({
      color: 0xffffff, mapa: texturaMadera(detalle), rugosidad: 0.62, metalico: 0.02,
      mapaRugosidad: usarNormal ? rugosidadMadera(detalle / 2) : null,
      normal: usarNormal ? normalPlano(0.16, 64) : null,
      reflejos: perfil.reflejos,
    }),
    pisoConcreto: materialPBR({ color: 0xffffff, mapa: texturaConcreto(detalle), rugosidad: 0.95 }),
    pisoMapa: materialPBR({ color: 0xffffff, mapa: texturaBaldosaClara(detalle), rugosidad: 0.98 }),
    pisoMapaExterior: materialPBR({ color: 0xd7d8d6, rugosidad: 1 }),
    cesped: materialPBR({ color: 0xffffff, mapa: texturaCesped(detalle), rugosidad: 1 }),
    puerta: materialPBR({ color: 0x8a6a45, rugosidad: 0.55, metalico: 0.06 }),
    marco: materialPBR({ color: 0x3a2716, rugosidad: 0.7 }),
    cristal: materialCristal(),
    metal: materialPBR({ color: 0x9aa2ac, rugosidad: 0.28, metalico: 0.86, reflejos: perfil.reflejos }),
    escritorio: materialPBR({ color: 0x4a2f18, rugosidad: 0.45, metalico: 0.05 }),
    tela: materialPBR({ color: 0xe9ddc9, rugosidad: 0.88 }),
    plastico: materialPBR({ color: 0x1f242c, rugosidad: 0.42 }),
    pantalla: materialPBR({ color: 0x0b0f14, rugosidad: 0.18, metalico: 0.4, emisivo: 0x1b4a63, intensidadEmisiva: 0.35 }),
    planta: materialPBR({ color: 0x3f7a4d, rugosidad: 0.72 }),
    maceta: materialPBR({ color: 0x8a5a3a, rugosidad: 0.86 }),
    cuadro: materialPBR({ mapa: texturaCuadro(128), rugosidad: 0.9 }),
    piel: materialPBR({ color: 0xe0ac82, rugosidad: 0.72 }),
    ropa: materialPBR({ color: 0x2b6fb5, rugosidad: 0.85 }),
    carroceria: materialPBR({ color: 0xc23b3b, rugosidad: 0.28, metalico: 0.7, reflejos: perfil.reflejos }),
    llanta: materialPBR({ color: 0x14171b, rugosidad: 0.94 }),
  };
}

/** Libera la memoria de GPU de una textura o material. */
export function liberar(objeto) {
  if (!objeto) return;
  if (objeto.dispose) { objeto.dispose(); return; }
}

export function limpiarCache() {
  for (const tex of cache.values()) tex?.dispose?.();
  cache.clear();
}

export default {
  init, crearBiblioteca, materialPBR, materialCristal,
  texturaMadera, texturaMuro, texturaBlueprint, texturaBaldosaClara, texturaCesped, texturaConcreto, texturaCuadro,
  limpiarCache,
  liberar, normalPlano, rugosidadMadera,
};
