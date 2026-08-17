/* ======================================================================
   vida.js — Elementos animados que dan vida al edificio:
   personas caminando, puertas que se abren, elevador, coches, árboles
   y el indicador de ubicación.

   Todo es geometría ligera generada por código y se reduce (o desaparece)
   según el perfil de calidad del dispositivo.
   ====================================================================== */

let THREE = null;
let mat = null;

export function init(three, materiales) { THREE = three; mat = materiales; }

const caja = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cil = (r, h, m, seg = 12) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);

/* =====================================================================
   PERSONAS
   ===================================================================== */
const COLORES_ROPA = [0x2b6fb5, 0xc0554e, 0x3f7a4d, 0x6b5aa8, 0xd08a2c, 0x2f3b45];

/** Figura humana estilizada con brazos y piernas animables. */
export function crearPersona(colorRopa = null) {
  const g = new THREE.Group();
  const ropa = mat.ropa.clone();
  ropa.color = new THREE.Color(colorRopa ?? COLORES_ROPA[Math.floor(Math.random() * COLORES_ROPA.length)]);

  const cadera = new THREE.Group();
  cadera.position.y = 0.86;
  g.add(cadera);

  const torso = caja(0.34, 0.52, 0.2, ropa);
  torso.position.y = 0.26;
  cadera.add(torso);

  const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), mat.piel);
  cabeza.position.y = 0.64;
  cadera.add(cabeza);

  const pelo = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat.plastico);
  pelo.position.y = 0.665;
  cadera.add(pelo);

  const brazoIzq = extremidad(0.075, 0.46, ropa);
  brazoIzq.position.set(-0.23, 0.46, 0);
  cadera.add(brazoIzq);

  const brazoDer = extremidad(0.075, 0.46, ropa);
  brazoDer.position.set(0.23, 0.46, 0);
  cadera.add(brazoDer);

  const piernaIzq = extremidad(0.085, 0.82, mat.plastico);
  piernaIzq.position.set(-0.1, 0, 0);
  cadera.add(piernaIzq);

  const piernaDer = extremidad(0.085, 0.82, mat.plastico);
  piernaDer.position.set(0.1, 0, 0);
  cadera.add(piernaDer);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { brazoIzq, brazoDer, piernaIzq, piernaDer, fase: Math.random() * Math.PI * 2 };
  return g;
}

/** Extremidad con pivote arriba, para que oscile desde el hombro/cadera. */
function extremidad(radio, largo, material) {
  const pivote = new THREE.Group();
  const m = cil(radio, largo, material, 8);
  m.position.y = -largo / 2;
  pivote.add(m);
  return pivote;
}

/**
 * Persona que recorre un circuito de puntos. `puntos` son Vector3 en el
 * plano; la figura camina de uno a otro con las piernas balanceándose.
 */
export function crearCaminante(puntos, velocidad = 0.9) {
  const persona = crearPersona();
  persona.userData.ruta = puntos;
  persona.userData.indice = 0;
  persona.userData.t = Math.random();
  persona.userData.velocidad = velocidad * (0.8 + Math.random() * 0.4);
  persona.position.copy(puntos[0]);
  return persona;
}

export function animarCaminante(persona, dt) {
  const d = persona.userData;
  const ruta = d.ruta;
  if (!ruta || ruta.length < 2) return;

  const desde = ruta[d.indice];
  const hasta = ruta[(d.indice + 1) % ruta.length];
  const distancia = desde.distanceTo(hasta) || 1;

  d.t += (d.velocidad * dt) / distancia;
  if (d.t >= 1) { d.t = 0; d.indice = (d.indice + 1) % ruta.length; return; }

  persona.position.lerpVectors(desde, hasta, d.t);
  const dir = new THREE.Vector3().subVectors(hasta, desde);
  persona.rotation.y = Math.atan2(dir.x, dir.z);

  // Balanceo de brazos y piernas
  d.fase += dt * 7 * d.velocidad;
  const s = Math.sin(d.fase) * 0.55;
  d.piernaIzq.rotation.x = s;
  d.piernaDer.rotation.x = -s;
  d.brazoIzq.rotation.x = -s * 0.7;
  d.brazoDer.rotation.x = s * 0.7;
  persona.position.y = Math.abs(Math.sin(d.fase)) * 0.02;
}

/* =====================================================================
   PUERTAS
   ===================================================================== */

/** Abre o cierra suavemente una puerta creada por edificio.js. */
export function animarPuerta(puerta, dt) {
  if (!puerta?.userData) return;
  const d = puerta.userData;
  const objetivo = d.abierta ? d.rotacionAbierta : d.rotacionCerrada;
  const delta = objetivo - puerta.rotation.y;
  if (Math.abs(delta) < 0.002) { puerta.rotation.y = objetivo; return; }
  puerta.rotation.y += delta * Math.min(1, dt * 6);
}

export function abrirPuerta(puerta, abierta = true) {
  if (puerta?.userData) puerta.userData.abierta = abierta;
}

/* =====================================================================
   ELEVADOR
   ===================================================================== */

/**
 * Elevador con cabina, puertas correderas y luz de piso. Aunque el
 * edificio del plano es de una planta, queda listo para varios pisos.
 */
export function crearElevador({ ancho = 1.8, fondo = 1.8, alto = 2.4, pisos = 1 } = {}) {
  const g = new THREE.Group();

  const hueco = caja(ancho + 0.2, alto * pisos + 0.3, fondo + 0.2, mat.muro);
  hueco.position.y = (alto * pisos) / 2;
  hueco.material = mat.muro;
  g.add(hueco);

  const cabina = new THREE.Group();
  const suelo = caja(ancho - 0.1, 0.06, fondo - 0.1, mat.metal);
  cabina.add(suelo);
  const techo = caja(ancho - 0.1, 0.06, fondo - 0.1, mat.metal);
  techo.position.y = alto - 0.1;
  cabina.add(techo);
  const luz = new THREE.PointLight(0xfff3d6, 0.7, 4, 2);
  luz.position.y = alto - 0.2;
  cabina.add(luz);
  cabina.position.y = 0.03;
  g.add(cabina);

  const hojaIzq = caja(ancho / 2 - 0.04, alto - 0.16, 0.06, mat.metal);
  hojaIzq.position.set(-ancho / 4, (alto - 0.16) / 2, fondo / 2);
  const hojaDer = hojaIzq.clone();
  hojaDer.position.x = ancho / 4;
  g.add(hojaIzq, hojaDer);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = {
    cabina, hojaIzq, hojaDer, ancho, alto,
    abierto: false, fase: 0, pisoActual: 0, pisoDestino: 0, esperando: 0,
  };
  return g;
}

/** Ciclo automático: sube, abre puertas, espera, cierra y baja. */
export function animarElevador(elevador, dt) {
  const d = elevador.userData;
  if (!d) return;

  const apertura = d.abierto ? d.ancho / 2 - 0.06 : 0;
  d.hojaIzq.position.x += (-d.ancho / 4 - apertura - d.hojaIzq.position.x) * Math.min(1, dt * 4);
  d.hojaDer.position.x += (d.ancho / 4 + apertura - d.hojaDer.position.x) * Math.min(1, dt * 4);

  const alturaDestino = d.pisoDestino * d.alto;
  const delta = alturaDestino - d.cabina.position.y;

  if (Math.abs(delta) > 0.01) {
    d.abierto = false;
    d.cabina.position.y += delta * Math.min(1, dt * 1.2);
  } else {
    d.esperando += dt;
    if (d.esperando > 1 && d.esperando < 4.5) d.abierto = true;
    if (d.esperando >= 4.5) {
      d.abierto = false;
      d.esperando = 0;
      d.pisoDestino = d.pisoDestino === 0 ? Math.max(0, d.pisos - 1 || 0) : 0;
    }
  }
}

/* =====================================================================
   VEGETACIÓN
   ===================================================================== */
export function crearArbol(perfil, escala = 1) {
  const g = new THREE.Group();
  const tronco = cil(0.1 * escala, 1.1 * escala, mat.maceta, perfil.segmentos);
  tronco.position.y = 0.55 * escala;
  g.add(tronco);

  const capas = perfil.nivel === "bajo" ? 1 : 3;
  for (let i = 0; i < capas; i++) {
    const r = (0.62 - i * 0.14) * escala;
    const copa = new THREE.Mesh(new THREE.IcosahedronGeometry(r, perfil.nivel === "alto" ? 1 : 0), mat.planta);
    copa.position.y = (1.1 + i * 0.36) * escala;
    copa.rotation.y = Math.random() * Math.PI;
    g.add(copa);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.fase = Math.random() * Math.PI * 2;
  return g;
}

export function crearArbusto(perfil, escala = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26 * escala, perfil.nivel === "bajo" ? 0 : 1), mat.planta);
    b.position.set((Math.random() - 0.5) * 0.34, 0.22 * escala + Math.random() * 0.1, (Math.random() - 0.5) * 0.34);
    b.scale.setScalar(0.7 + Math.random() * 0.5);
    g.add(b);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** Ligero vaivén de las copas: suficiente para que no parezca congelado. */
export function animarVegetacion(grupo, tiempo) {
  for (const arbol of grupo.children) {
    const fase = arbol.userData.fase || 0;
    arbol.rotation.z = Math.sin(tiempo * 0.8 + fase) * 0.02;
    arbol.rotation.x = Math.cos(tiempo * 0.6 + fase) * 0.015;
  }
}

/* =====================================================================
   AUTOS
   ===================================================================== */
const COLORES_AUTO = [0xc23b3b, 0x2f4e7a, 0xe0e4e8, 0x2b2f36, 0x3f7a4d, 0xd7a12c];

export function crearAuto(perfil, color = null) {
  const g = new THREE.Group();
  const carroceria = mat.carroceria.clone();
  carroceria.color = new THREE.Color(color ?? COLORES_AUTO[Math.floor(Math.random() * COLORES_AUTO.length)]);

  const cuerpo = caja(1.75, 0.52, 4.1, carroceria);
  cuerpo.position.y = 0.62;
  g.add(cuerpo);

  const cabina = caja(1.6, 0.5, 2.1, carroceria);
  cabina.position.set(0, 1.08, -0.15);
  g.add(cabina);

  const parabrisas = caja(1.52, 0.42, 0.06, mat.cristal);
  parabrisas.position.set(0, 1.1, 0.9);
  parabrisas.rotation.x = -0.32;
  g.add(parabrisas);

  const ventanaTrasera = parabrisas.clone();
  ventanaTrasera.position.z = -1.2;
  ventanaTrasera.rotation.x = 0.34;
  g.add(ventanaTrasera);

  for (const [x, z] of [[-0.86, 1.32], [0.86, 1.32], [-0.86, -1.32], [0.86, -1.32]]) {
    const rueda = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.22, perfil.segmentos), mat.llanta
    );
    rueda.rotation.z = Math.PI / 2;
    rueda.position.set(x, 0.34, z);
    g.add(rueda);
  }

  for (const x of [-0.55, 0.55]) {
    const faro = caja(0.28, 0.12, 0.06, mat.pantalla);
    faro.material = mat.metal;
    faro.position.set(x, 0.72, 2.06);
    g.add(faro);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/* =====================================================================
   INDICADOR DE UBICACIÓN Y RUTA
   ===================================================================== */

/** Marcador tipo "pin" con anillo pulsante. */
export function crearMarcador(color = 0x38bdf8) {
  const g = new THREE.Group();

  const material = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.65, roughness: 0.35, metalness: 0.1,
  });

  const cono = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 16), material);
  cono.position.y = 0.35;
  cono.rotation.x = Math.PI;
  g.add(cono);

  const esfera = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), material);
  esfera.position.y = 0.86;
  g.add(esfera);

  const anillo = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
  );
  anillo.rotation.x = -Math.PI / 2;
  anillo.position.y = 0.03;
  g.add(anillo);

  const luz = new THREE.PointLight(color, 1.2, 6, 2);
  luz.position.y = 1;
  g.add(luz);

  g.userData = { anillo, esfera, cono, luz, fase: 0 };
  return g;
}

export function animarMarcador(marcador, dt, tiempo) {
  const d = marcador.userData;
  if (!d) return;
  d.fase += dt;
  const pulso = (Math.sin(tiempo * 2.4) + 1) / 2;
  d.anillo.scale.setScalar(1 + pulso * 0.85);
  d.anillo.material.opacity = 0.55 * (1 - pulso);
  marcador.position.y = Math.sin(tiempo * 2) * 0.07;
  d.luz.intensity = 0.8 + pulso * 0.8;
}

/**
 * Línea de ruta animada entre puntos, con flechas que avanzan.
 * Se dibuja con un tubo para que se vea con grosor real.
 */
export function crearRuta(puntos, color = 0x38bdf8) {
  if (!puntos || puntos.length < 2) return null;
  const g = new THREE.Group();

  const curva = new THREE.CatmullRomCurve3(puntos, false, "catmullrom", 0.15);
  const geometria = new THREE.TubeGeometry(curva, Math.max(24, puntos.length * 12), 0.055, 8, false);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
  const tubo = new THREE.Mesh(geometria, material);
  tubo.position.y = 0.05;
  g.add(tubo);

  // Puntos móviles que recorren la ruta
  const marcas = [];
  for (let i = 0; i < 6; i++) {
    const punto = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    punto.userData.offset = i / 6;
    g.add(punto);
    marcas.push(punto);
  }

  g.userData = { curva, marcas, t: 0 };
  return g;
}

export function animarRuta(ruta, dt) {
  const d = ruta?.userData;
  if (!d) return;
  d.t = (d.t + dt * 0.22) % 1;
  for (const marca of d.marcas) {
    const t = (d.t + marca.userData.offset) % 1;
    const p = d.curva.getPointAt(t);
    marca.position.set(p.x, p.y + 0.16, p.z);
    marca.material.opacity = 0.35 + 0.55 * Math.sin(t * Math.PI);
  }
}

export default {
  init, crearPersona, crearCaminante, animarCaminante,
  animarPuerta, abrirPuerta, crearElevador, animarElevador,
  crearArbol, crearArbusto, animarVegetacion, crearAuto,
  crearMarcador, animarMarcador, crearRuta, animarRuta,
};
