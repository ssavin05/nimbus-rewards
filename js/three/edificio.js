/* ======================================================================
   edificio.js — Construye la geometría del edificio a partir de los
   datos de la base: volúmenes de cada espacio, muros, puertas, pisos y
   mobiliario.

   Todas las medidas vienen en metros desde `espacios` (pos_x, pos_y,
   ancho, fondo). Aquí sólo se centran respecto al edificio y se
   convierten al sistema de coordenadas de Three.js (x, z en el plano).
   ====================================================================== */

import { ENVOLVENTE } from "../data/planta.js";

let THREE = null;
let mat = null;

export const COLOR_ESTADO = {
  disponible: null,          // lo decide el semáforo de disponibilidad
  reservada: 0xff6b6b,
  mantenimiento: 0x7f95ab,
  proximamente: 0x9b8cff,
  inactiva: 0x4a5563,
};

export const COLOR_SEMAFORO = {
  // Mapa de reservas: verde = todo libre, ámbar = parcialmente libre,
  // rojo = sin disponibilidad / no reservable. Gris = consulta pendiente.
  verde: 0x22c55e,
  amarillo: 0xf59e0b,
  rojo: 0xef4444,
  desconocido: 0x64748b,
};

const COLOR_MUDO = 0x1d2634;
const COLOR_MUDO_HOVER = 0x27344a;
const ALTURA_MURO = 2.6;
const GROSOR_MURO = 0.14;
const ALTURA_BORDILLO = 0.32;

// Proporciones específicas de la maqueta del mapa: muros cortados a
// media altura, sin techo, como en el render arquitectónico de referencia.
export const ALTURA_MURO_MAPA = 0.92;
const GROSOR_MURO_MAPA = 0.16;
const COLOR_BORDE_MAPA = 0x8d9298;
const COLOR_ESTADO_CARGANDO = 0x3b82f6;

function alturaMuroMapa(espacio) {
  const codigo = String(espacio?.codigo || "").toUpperCase();
  if (codigo === "JP-01") return 0.54;
  if (codigo === "EA-01") return 0.62;
  if (codigo === "PK-01") return 0.72;
  if (codigo === "PT-01" || codigo === "CM-01") return 0.84;
  return ALTURA_MURO_MAPA;
}

export function init(three, materiales) { THREE = three; mat = materiales; }

/* ---------------------------------------------------------------------
   Utilidades de geometría
   --------------------------------------------------------------------- */

/** Convierte un espacio de la base en un rectángulo centrado del mundo 3D. */
export function rectDe(espacio, centro) {
  const x = Number(espacio.pos_x) || 0;
  const y = Number(espacio.pos_y) || 0;
  const w = Number(espacio.ancho) || 1;
  const d = Number(espacio.fondo) || 1;
  return { x: x + w / 2 - centro.x, z: y + d / 2 - centro.y, w, d };
}

export function centroEdificio(edificio) {
  return {
    x: (Number(edificio?.ancho_m) || ENVOLVENTE.ancho) / 2,
    y: (Number(edificio?.fondo_m) || ENVOLVENTE.fondo) / 2,
  };
}

const caja = (w, h, d, material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);

/* ---------------------------------------------------------------------
   Volúmenes seleccionables
   --------------------------------------------------------------------- */

/**
 * Crea el volumen que representa un espacio en el mapa. Es lo que el
 * usuario toca: lleva `userData.espacioId` para el raycast.
 */
export function crearVolumen(espacio, centro, { plano = true } = {}) {
  const r = rectDe(espacio, centro);
  const reservable = Boolean(espacio.reservable) && espacio.estado !== "inactiva";

  if (plano) {
    /*
     * Hitbox invisible + semáforo fino.
     *
     * La maqueta visible la forman el piso y los muros abiertos. Este
     * objeto existe para el raycast y para dibujar el estado de reserva
     * sin convertir la habitación completa en un bloque verde/rojo.
     */
    const altoMuro = alturaMuroMapa(espacio);
    const hitMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const malla = caja(Math.max(0.18, r.w - 0.10), 0.045, Math.max(0.18, r.d - 0.10), hitMat);
    malla.position.set(r.x, 0.045, r.z);
    malla.userData = {
      espacioId: String(espacio.id),
      reservable,
      alturaBase: altoMuro,
      colorBase: new THREE.Color(0xffffff),
    };

    // Velo de color muy sutil sobre el piso. Se mantiene casi invisible
    // para conservar el look del render de referencia.
    const capMat = new THREE.MeshBasicMaterial({
      color: COLOR_ESTADO_CARGANDO,
      transparent: true,
      opacity: reservable ? 0.08 : 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const cap = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(0.12, r.w - 0.34), Math.max(0.12, r.d - 0.34)),
      capMat
    );
    cap.rotation.x = -Math.PI / 2;
    cap.position.set(0, 0.018, 0);
    cap.renderOrder = 7;
    malla.add(cap);

    // El color de disponibilidad vive en el borde superior de los muros:
    // azul mientras carga; verde, ámbar o rojo cuando llega el servidor.
    const hw = Math.max(0.08, (r.w - 0.06) / 2);
    const hd = Math.max(0.08, (r.d - 0.06) / 2);
    const puntos = [
      new THREE.Vector3(-hw, 0, -hd), new THREE.Vector3(hw, 0, -hd),
      new THREE.Vector3(hw, 0, -hd), new THREE.Vector3(hw, 0, hd),
      new THREE.Vector3(hw, 0, hd), new THREE.Vector3(-hw, 0, hd),
      new THREE.Vector3(-hw, 0, hd), new THREE.Vector3(-hw, 0, -hd),
    ];
    const bordeGeo = new THREE.BufferGeometry().setFromPoints(puntos);
    const bordeMat = new THREE.LineBasicMaterial({
      color: reservable ? COLOR_ESTADO_CARGANDO : 0xaeb3b8,
      transparent: true,
      opacity: reservable ? 0.95 : 0.14,
      toneMapped: false,
    });
    const bordeEstado = new THREE.LineSegments(bordeGeo, bordeMat);
    bordeEstado.position.y = altoMuro - malla.position.y + 0.025;
    bordeEstado.renderOrder = 12;
    malla.add(bordeEstado);

    malla.userData.statusCap = cap;
    malla.userData.statusBordes = bordeEstado;
    malla.userData.statusColorBase = capMat.color.clone();
    return malla;
  }

  const altura = Number(espacio.altura) || (reservable ? 1.35 : espacio.abierto ? ALTURA_BORDILLO : 0.9);
  const cuerpoMat = new THREE.MeshStandardMaterial({
    color: reservable ? 0x123249 : COLOR_MUDO,
    roughness: 0.72,
    metalness: 0.08,
    transparent: true,
    opacity: reservable ? 0.94 : 0.86,
  });
  const malla = caja(Math.max(0.18, r.w - 0.06), altura, Math.max(0.18, r.d - 0.06), cuerpoMat);
  malla.position.set(r.x, altura / 2, r.z);
  malla.castShadow = true;
  malla.receiveShadow = true;
  malla.userData = {
    espacioId: String(espacio.id),
    reservable,
    alturaBase: altura,
    colorBase: cuerpoMat.color.clone(),
  };

  const bordes = new THREE.LineSegments(
    new THREE.EdgesGeometry(malla.geometry),
    new THREE.LineBasicMaterial({
      color: reservable ? 0x5fd4ff : 0x36485f,
      transparent: true,
      opacity: 0.5,
    })
  );
  malla.add(bordes);
  malla.userData.bordes = bordes;
  return malla;
}

/** Etiqueta plana sobre el piso, como en un plano arquitectónico. */
export function crearEtiqueta(texto, { escala = 1, oscuro = true } = {}) {
  const canvas = document.createElement("canvas");
  const limpio = String(texto || "").trim().toUpperCase();
  const palabras = limpio.split(/\s+/);

  let lineas = [limpio];
  if (palabras.length > 1 && limpio.length > 12) {
    let a = "", b = "";
    const objetivo = Math.ceil(limpio.length / 2);
    for (const palabra of palabras) {
      if (!a || (a + " " + palabra).length <= objetivo + 2) a += (a ? " " : "") + palabra;
      else b += (b ? " " : "") + palabra;
    }
    if (b) lineas = [a, b];
  }

  const fuente = "800 54px Inter, Arial, sans-serif";
  const ctxMedida = canvas.getContext("2d");
  ctxMedida.font = fuente;
  const anchoTexto = Math.max(1, ...lineas.map((l) => ctxMedida.measureText(l).width));
  const padX = 24;
  const padY = 18;
  canvas.width = Math.ceil(anchoTexto + padX * 2);
  canvas.height = lineas.length === 2 ? 142 : 86;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = fuente;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  // Halo claro para que el texto siga legible encima de cualquier piso.
  ctx.strokeStyle = oscuro ? "rgba(255,255,255,.78)" : "rgba(0,0,0,.55)";
  ctx.fillStyle = oscuro ? "#25272a" : "#f8fafc";
  lineas.forEach((linea, i) => {
    const y = lineas.length === 2 ? 49 + i * 49 : canvas.height / 2;
    ctx.strokeText(linea, canvas.width / 2, y);
    ctx.fillText(linea, canvas.width / 2, y);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const altoMundo = 0.62 * escala * (lineas.length === 2 ? 1.28 : 1);
  const anchoMundo = Math.max(0.72, (canvas.width / canvas.height) * altoMundo);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(anchoMundo, altoMundo),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 16;
  mesh.userData.esEtiqueta = true;
  return mesh;
}

function redondeado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------------------------------------------------------------------
   Muros y puertas
   --------------------------------------------------------------------- */

/**
 * Levanta los cuatro muros de un espacio, dejando el hueco de la puerta.
 * Devuelve un grupo con los muros y, si tiene puerta, la hoja animable.
 */
export function crearMuros(espacio, centro) {
  const grupo = new THREE.Group();
  const r = rectDe(espacio, centro);
  const abierto = Boolean(espacio.abierto);
  const alto = abierto ? ALTURA_BORDILLO : ALTURA_MURO;
  const puerta = espacio.puerta || {};
  const ladoPuerta = abierto ? null : puerta.side;
  const anchoPuerta = Number(puerta.width) || 1.0;
  const offsetPuerta = Number(puerta.offset) || 0;

  const lados = [
    { id: "n", horizontal: true, z: r.z - r.d / 2, x: r.x, largo: r.w },
    { id: "s", horizontal: true, z: r.z + r.d / 2, x: r.x, largo: r.w },
    { id: "w", horizontal: false, x: r.x - r.w / 2, z: r.z, largo: r.d },
    { id: "e", horizontal: false, x: r.x + r.w / 2, z: r.z, largo: r.d },
  ];

  for (const lado of lados) {
    const conPuerta = lado.id === ladoPuerta;
    if (!conPuerta) {
      grupo.add(segmentoMuro(lado, lado.largo, 0, alto));
      continue;
    }
    // Dos tramos a los lados del hueco
    const inicioHueco = offsetPuerta - anchoPuerta / 2;
    const finHueco = offsetPuerta + anchoPuerta / 2;
    const izq = inicioHueco + lado.largo / 2;
    const der = lado.largo / 2 - finHueco;

    if (izq > 0.05) grupo.add(segmentoMuro(lado, izq, -(lado.largo / 2) + izq / 2, alto));
    if (der > 0.05) grupo.add(segmentoMuro(lado, der, (lado.largo / 2) - der / 2, alto));

    // Dintel sobre la puerta
    const dintel = segmentoMuro(lado, anchoPuerta, offsetPuerta, alto - 2.05);
    dintel.position.y = 2.05 + (alto - 2.05) / 2;
    if (alto > 2.05) grupo.add(dintel);

    // Hoja de la puerta (animable)
    const hoja = crearPuerta(lado, anchoPuerta, offsetPuerta);
    grupo.add(hoja);
    grupo.userData.puerta = hoja;
  }

  grupo.userData.espacioId = String(espacio.id);
  return grupo;
}

/**
 * Muros bajos para el mapa de reservas. Son una maqueta de corte:
 * paredes claras, techo abierto y puertas de madera entreabiertas.
 */
export function crearMurosMapa(espacio, centro) {
  const grupo = new THREE.Group();
  const r = rectDe(espacio, centro);
  const alto = alturaMuroMapa(espacio);
  const g = GROSOR_MURO_MAPA;
  const puerta = espacio.puerta || {};
  const ladoPuerta = puerta.side || null;
  const anchoPuerta = Math.min(Number(puerta.width) || 0.86, Math.max(0.5, Math.min(r.w, r.d) * 0.72));
  const offsetPuerta = Number(puerta.offset) || 0;

  // Los muros se meten media sección dentro de su propio cuarto. Así dos
  // habitaciones contiguas no ocupan exactamente el mismo plano (sin z-fight).
  const lados = [
    { id: "n", horizontal: true,  z: r.z - r.d / 2 + g / 2, x: r.x, largo: Math.max(0.2, r.w - g) },
    { id: "s", horizontal: true,  z: r.z + r.d / 2 - g / 2, x: r.x, largo: Math.max(0.2, r.w - g) },
    { id: "w", horizontal: false, x: r.x - r.w / 2 + g / 2, z: r.z, largo: Math.max(0.2, r.d - g) },
    { id: "e", horizontal: false, x: r.x + r.w / 2 - g / 2, z: r.z, largo: Math.max(0.2, r.d - g) },
  ];

  for (const lado of lados) {
    if (lado.id !== ladoPuerta) {
      grupo.add(segmentoMuroMapa(lado, lado.largo, 0, alto));
      continue;
    }

    const maxOffset = Math.max(0, lado.largo / 2 - anchoPuerta / 2 - 0.06);
    const off = Math.max(-maxOffset, Math.min(maxOffset, offsetPuerta));
    const inicio = off - anchoPuerta / 2;
    const fin = off + anchoPuerta / 2;
    const a = inicio + lado.largo / 2;
    const b = lado.largo / 2 - fin;
    if (a > 0.05) grupo.add(segmentoMuroMapa(lado, a, -lado.largo / 2 + a / 2, alto));
    if (b > 0.05) grupo.add(segmentoMuroMapa(lado, b, lado.largo / 2 - b / 2, alto));

    if (!puerta.sinHoja) grupo.add(crearPuertaMapa(lado, anchoPuerta, off, alto));
  }

  // Línea gris sobre el muro: da el mismo acabado de arista que el render.
  grupo.traverse((o) => {
    if (!o.isMesh || o.userData?.esPuertaMapa) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(o.geometry),
      new THREE.LineBasicMaterial({ color: COLOR_BORDE_MAPA, transparent: true, opacity: 0.52 })
    );
    edges.renderOrder = 8;
    o.add(edges);
  });

  grupo.userData.espacioId = String(espacio.id);
  return grupo;
}

function segmentoMuroMapa(lado, largo, desplazamiento, alto) {
  const malla = lado.horizontal
    ? caja(largo, alto, GROSOR_MURO_MAPA, mat.muro)
    : caja(GROSOR_MURO_MAPA, alto, largo, mat.muro);
  malla.position.set(
    lado.horizontal ? lado.x + desplazamiento : lado.x,
    alto / 2,
    lado.horizontal ? lado.z : lado.z + desplazamiento
  );
  return malla;
}

function crearPuertaMapa(lado, ancho, desplazamiento, altoMuro) {
  const pivote = new THREE.Group();
  const h = Math.min(0.76, altoMuro * 0.86);
  const hoja = caja(Math.max(0.42, ancho - 0.06), h, 0.055, mat.puerta);
  hoja.position.set((ancho - 0.06) / 2, h / 2, 0);
  hoja.castShadow = true;
  hoja.userData.esPuertaMapa = true;
  pivote.add(hoja);

  if (lado.horizontal) {
    pivote.position.set(lado.x + desplazamiento - ancho / 2, 0, lado.z);
    pivote.rotation.y = lado.id === "n" ? -Math.PI * 0.24 : Math.PI * 0.24;
  } else {
    pivote.position.set(lado.x, 0, lado.z + desplazamiento - ancho / 2);
    const base = Math.PI / 2;
    pivote.rotation.y = base + (lado.id === "w" ? Math.PI * 0.24 : -Math.PI * 0.24);
  }
  return pivote;
}

function segmentoMuro(lado, largo, desplazamiento, alto) {
  const material = mat.muro;
  const malla = lado.horizontal
    ? caja(largo, alto, GROSOR_MURO, material)
    : caja(GROSOR_MURO, alto, largo, material);
  malla.position.set(
    lado.horizontal ? lado.x + desplazamiento : lado.x,
    alto / 2,
    lado.horizontal ? lado.z : lado.z + desplazamiento
  );
  malla.castShadow = true;
  malla.receiveShadow = true;
  return malla;
}

/** Puerta con marco y bisagra: el pivote permite animarla. */
function crearPuerta(lado, ancho, desplazamiento) {
  const pivote = new THREE.Group();
  const altoPuerta = 2.05;

  const hoja = caja(ancho - 0.06, altoPuerta - 0.05, 0.045, mat.puerta);
  hoja.position.set((ancho - 0.06) / 2, (altoPuerta - 0.05) / 2, 0);
  hoja.castShadow = true;

  const manija = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat.metal);
  manija.position.set(ancho - 0.18, altoPuerta / 2, 0.05);
  hoja.add(manija);

  pivote.add(hoja);

  if (lado.horizontal) {
    pivote.position.set(lado.x + desplazamiento - ancho / 2, 0, lado.z);
  } else {
    pivote.position.set(lado.x, 0, lado.z + desplazamiento - ancho / 2);
    pivote.rotation.y = Math.PI / 2;
  }

  pivote.userData.esPuerta = true;
  pivote.userData.rotacionCerrada = pivote.rotation.y;
  pivote.userData.rotacionAbierta = pivote.rotation.y - Math.PI * 0.55;
  pivote.userData.abierta = false;
  return pivote;
}

/* ---------------------------------------------------------------------
   Pisos
   --------------------------------------------------------------------- */
export function crearPiso(espacio, centro, { plano = false } = {}) {
  const r = rectDe(espacio, centro);
  const codigo = String(espacio.codigo || "").toUpperCase();
  let material;

  if (plano) {
    // El render de referencia usa una paleta muy contenida: sólo el jardín
    // se vuelve verde. Patio, comunitario, oficinas y servicios comparten
    // una baldosa/concreto claro para que la forma mande sobre el color.
    material = codigo === "JP-01" ? mat.cesped : mat.pisoMapa;
  } else {
    material = mat.pisoMadera;
    if (espacio.tipo === "comun" && espacio.abierto) material = mat.cesped;
    else if (espacio.tipo === "estacionamiento") material = mat.pisoConcreto;
    else if (!espacio.reservable) material = mat.pisoConcreto;
  }

  const geo = new THREE.PlaneGeometry(r.w, r.d);
  const malla = new THREE.Mesh(geo, material);
  malla.rotation.x = -Math.PI / 2;
  malla.position.set(r.x, plano ? 0.012 : 0.012, r.z);
  malla.receiveShadow = true;
  return malla;
}

/** Losa general del edificio. */
export function crearLosa(edificio, { plano = false } = {}) {
  const w = (Number(edificio?.ancho_m) || ENVOLVENTE.ancho) + (plano ? 0.24 : 1.0);
  const d = (Number(edificio?.fondo_m) || ENVOLVENTE.fondo) + (plano ? 0.24 : 1.0);
  const material = plano
    ? mat.pisoMapaExterior
    : mat.pisoConcreto;
  const losa = caja(w, plano ? 0.13 : 0.22, d, material);
  losa.position.y = plano ? -0.07 : -0.11;
  losa.receiveShadow = true;
  losa.castShadow = plano;
  return losa;
}

/** Pasillos de circulación. */
export function crearCorredores(rects, centro, { plano = false } = {}) {
  const grupo = new THREE.Group();
  const material = plano ? mat.pisoMapa : mat.pisoConcreto;
  for (const c of rects) {
    const r = rectDe({ pos_x: c.pos_x ?? c.x, pos_y: c.pos_y ?? c.y, ancho: c.ancho, fondo: c.fondo }, centro);
    const malla = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), material);
    malla.rotation.x = -Math.PI / 2;
    malla.position.set(r.x, 0.014, r.z);
    malla.receiveShadow = true;
    grupo.add(malla);
  }
  return grupo;
}

/**
 * Franja de estacionamiento exterior del frente. Los cajones se toman de
 * `CAJONES_CALLE`; aquí sólo se dibuja la plataforma y las líneas blancas.
 */
export function crearEstacionamientoExterior(cajones, centro) {
  const grupo = new THREE.Group();
  if (!Array.isArray(cajones) || !cajones.length) return grupo;

  const minX = Math.min(...cajones.map((c) => c.x));
  const maxX = Math.max(...cajones.map((c) => c.x + c.ancho));
  const minY = Math.min(...cajones.map((c) => c.y));
  const maxY = Math.max(...cajones.map((c) => c.y + c.fondo));
  const margen = 0.38;
  const w = maxX - minX + margen * 2;
  const d = maxY - minY + margen * 2;
  const base = caja(w, 0.09, d, mat.pisoMapaExterior);
  base.position.set((minX + maxX) / 2 - centro.x, -0.055, (minY + maxY) / 2 - centro.y);
  base.receiveShadow = true;
  grupo.add(base);

  const lineaMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.74 });
  for (const c of cajones) {
    const x0 = c.x - centro.x;
    const x1 = c.x + c.ancho - centro.x;
    const z0 = c.y - centro.y;
    const z1 = c.y + c.fondo - centro.y;
    const pts = [
      new THREE.Vector3(x0, 0.01, z0), new THREE.Vector3(x0, 0.01, z1),
      new THREE.Vector3(x1, 0.01, z0), new THREE.Vector3(x1, 0.01, z1),
      new THREE.Vector3(x0, 0.01, z1), new THREE.Vector3(x1, 0.01, z1),
    ];
    grupo.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineaMat));
  }

  return grupo;
}

/* ---------------------------------------------------------------------
   Mobiliario
   --------------------------------------------------------------------- */

/** Amuebla un espacio según su tipo. Devuelve un grupo o null. */
export function crearMobiliario(espacio, centro, perfil) {
  if (!perfil.mobiliario || !espacio.reservable) return null;
  const r = rectDe(espacio, centro);
  const grupo = new THREE.Group();
  grupo.position.set(r.x, 0, r.z);

  switch (espacio.tipo) {
    case "sala_juntas": salaJuntas(grupo, r, perfil); break;
    case "coworking": coworking(grupo, r, perfil); break;
    case "oficina":
    default: oficina(grupo, r, espacio, perfil); break;
  }

  grupo.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grupo;
}

function escritorio(ancho = 1.5, fondo = 0.7, alto = 0.74) {
  const g = new THREE.Group();
  const tablero = caja(ancho, 0.045, fondo, mat.escritorio);
  tablero.position.y = alto;
  g.add(tablero);
  const patas = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [sx, sz] of patas) {
    const pata = caja(0.05, alto, 0.05, mat.plastico);
    pata.position.set(sx * (ancho / 2 - 0.08), alto / 2, sz * (fondo / 2 - 0.08));
    g.add(pata);
  }
  return g;
}

function silla(perfil) {
  const g = new THREE.Group();
  const asiento = caja(0.46, 0.07, 0.46, mat.tela);
  asiento.position.y = 0.45;
  g.add(asiento);
  const respaldo = caja(0.46, 0.5, 0.06, mat.tela);
  respaldo.position.set(0, 0.72, -0.2);
  g.add(respaldo);
  const columna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, perfil.segmentos), mat.metal);
  columna.position.y = 0.22;
  g.add(columna);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.03, perfil.segmentos), mat.metal);
  base.position.y = 0.02;
  g.add(base);
  return g;
}

function monitor(ancho = 0.55) {
  const g = new THREE.Group();
  const pantalla = caja(ancho, ancho * 0.6, 0.02, mat.pantalla);
  pantalla.position.y = 0.32;
  g.add(pantalla);
  const cuello = caja(0.05, 0.16, 0.05, mat.plastico);
  cuello.position.y = 0.1;
  g.add(cuello);
  const pie = caja(0.24, 0.02, 0.16, mat.plastico);
  pie.position.y = 0.01;
  g.add(pie);
  return g;
}

function planta(perfil, escala = 1) {
  const g = new THREE.Group();
  const maceta = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * escala, 0.12 * escala, 0.26 * escala, perfil.segmentos), mat.maceta);
  maceta.position.y = 0.13 * escala;
  g.add(maceta);
  for (let i = 0; i < 7; i++) {
    const hoja = new THREE.Mesh(new THREE.SphereGeometry(0.13 * escala, 8, 6), mat.planta);
    hoja.scale.set(1, 1.5, 0.55);
    hoja.position.set(
      Math.cos((i / 7) * Math.PI * 2) * 0.11 * escala,
      (0.34 + Math.random() * 0.24) * escala,
      Math.sin((i / 7) * Math.PI * 2) * 0.11 * escala
    );
    hoja.rotation.set(Math.random() * 0.5 - 0.25, Math.random() * Math.PI, Math.random() * 0.5 - 0.25);
    g.add(hoja);
  }
  return g;
}

function oficina(grupo, r, espacio, perfil) {
  const puestos = Math.min(4, Math.max(1, Math.floor(Number(espacio.capacidad) / 2) || 1));
  const anchoUtil = r.w - 1.0;
  for (let i = 0; i < puestos; i++) {
    const px = -anchoUtil / 2 + (anchoUtil / Math.max(1, puestos)) * (i + 0.5);
    const mesa = escritorio(Math.min(1.5, anchoUtil / puestos - 0.2), 0.7);
    mesa.position.set(px, 0, -r.d / 2 + 0.75);
    grupo.add(mesa);

    const m = monitor(0.5);
    m.position.set(px, 0.78, -r.d / 2 + 0.62);
    grupo.add(m);

    const s = silla(perfil);
    s.position.set(px, 0, -r.d / 2 + 1.5);
    s.rotation.y = Math.PI;
    grupo.add(s);
  }
  if (r.w > 2.4 && r.d > 2.4) {
    const p = planta(perfil);
    p.position.set(r.w / 2 - 0.5, 0, r.d / 2 - 0.5);
    grupo.add(p);
  }
  // Cuadro en el muro norte
  if (r.w > 2) {
    const cuadro = caja(Math.min(1.2, r.w * 0.45), 0.7, 0.04, mat.cuadro);
    cuadro.position.set(0, 1.6, -r.d / 2 + 0.09);
    grupo.add(cuadro);
  }
}

function salaJuntas(grupo, r, perfil) {
  const largo = Math.min(r.w - 1.2, 3.2);
  const ancho = Math.min(r.d - 1.4, 1.3);
  const mesa = new THREE.Group();
  const tablero = caja(largo, 0.06, ancho, mat.escritorio);
  tablero.position.y = 0.75;
  mesa.add(tablero);
  const base1 = caja(0.12, 0.72, ancho * 0.6, mat.metal);
  base1.position.set(-largo / 2 + 0.4, 0.36, 0);
  const base2 = base1.clone();
  base2.position.x = largo / 2 - 0.4;
  mesa.add(base1, base2);
  grupo.add(mesa);

  const porLado = Math.max(2, Math.floor(largo / 0.8));
  for (let i = 0; i < porLado; i++) {
    const x = -largo / 2 + (largo / porLado) * (i + 0.5);
    const s1 = silla(perfil); s1.position.set(x, 0, ancho / 2 + 0.45); s1.rotation.y = Math.PI;
    const s2 = silla(perfil); s2.position.set(x, 0, -ancho / 2 - 0.45);
    grupo.add(s1, s2);
  }

  // Pantalla de presentación
  const pantalla = caja(Math.min(1.6, r.w * 0.5), 0.9, 0.05, mat.pantalla);
  pantalla.position.set(0, 1.5, -r.d / 2 + 0.1);
  grupo.add(pantalla);

  const p = planta(perfil, 1.2);
  p.position.set(r.w / 2 - 0.55, 0, -r.d / 2 + 0.55);
  grupo.add(p);
}

function coworking(grupo, r, perfil) {
  const filas = Math.max(1, Math.floor((r.d - 2) / 2.2));
  const columnas = Math.max(1, Math.floor((r.w - 1.4) / 1.7));
  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < columnas; c++) {
      const x = -r.w / 2 + 0.9 + c * 1.7;
      const z = -r.d / 2 + 1.2 + f * 2.2;
      const mesa = escritorio(1.4, 0.68);
      mesa.position.set(x, 0, z);
      grupo.add(mesa);
      const s = silla(perfil);
      s.position.set(x, 0, z + 0.72);
      s.rotation.y = Math.PI;
      grupo.add(s);
      if ((f + c) % 2 === 0) {
        const m = monitor(0.45);
        m.position.set(x, 0.78, z - 0.16);
        grupo.add(m);
      }
    }
  }
  for (let i = 0; i < Math.min(4, Math.floor(r.d / 4)); i++) {
    const p = planta(perfil, 1.1);
    p.position.set(r.w / 2 - 0.5, 0, -r.d / 2 + 1.5 + i * 3.2);
    grupo.add(p);
  }
}

export default {
  init, crearVolumen, crearEtiqueta, crearMuros, crearMurosMapa, crearPiso, crearLosa,
  crearCorredores, crearEstacionamientoExterior, crearMobiliario, rectDe, centroEdificio,
  COLOR_ESTADO, COLOR_SEMAFORO,
};
