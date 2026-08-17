/* ======================================================================
   escena.js — Orquesta el mapa 3D completo.

   Responsabilidades:
     • Renderizador, cámara, luces, entorno HDRI y sombras.
     • Construir el edificio desde los datos y pintar el semáforo de
       disponibilidad.
     • Interacción: girar, hacer zoom, tocar una sala, enfocarla.
     • Vida: personas, puertas, elevador, autos, vegetación.
     • Ruta hacia una oficina y marcador de ubicación.
     • Mini mapa 2D sincronizado.
     • Liberar toda la memoria de GPU al salir de la vista.
   ====================================================================== */
import { cargarThree, perfilActual, cargarHDRI, entornoGenerado, cargarModelo } from "./loader.js";
import * as materiales from "./materiales.js";
import * as edificio from "./edificio.js";
import * as vida from "./vida.js";
import { clamp, urlMedioSegura } from "../core/utils.js";
import { GRAPHICS } from "../core/config.js";
import { MESAS_COMUNITARIAS, CAJONES_CALLE } from "../data/planta.js";
import { vibrar } from "../core/haptics.js";
import { ENVOLVENTE } from "../data/planta.js";

/** Suavizado de las transiciones de cámara. */
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function crearEscena(lienzo, { edificioDatos, espacios, corredores = [], onSeleccion, onHover } = {}) {
  const THREE = await cargarThree();
  const perfil = perfilActual();

  /* Estilo "plano": el edificio se dibuja como un plano arquitectónico
     en relieve —bloques de color lisos, poca altura, sin decorado—.
     No es sólo estética: quitar muebles, gente, autos, vegetación e HDRI
     baja el número de objetos de la escena en más de un 90 %, así que el
     mapa abre casi al instante hasta en un teléfono modesto. */
  const PLANO = (GRAPHICS.estilo || "plano") !== "realista";

  /* Se declara aquí arriba, y no junto al bucle de render, porque hay
     cargas en segundo plano (el plano de fondo, el modelo GLB) que
     terminan después y tienen que poder comprobar si la vista sigue
     viva. Con la declaración a 700 líneas funcionaba de milagro: sólo
     porque ninguna de esas cargas resuelve de forma síncrona. */
  let corriendo = true;

  materiales.init(THREE);
  const mat = materiales.crearBiblioteca(perfil);
  edificio.init(THREE, mat);
  vida.init(THREE, mat);

  /* ---------------- renderizador ---------------- */
  const renderer = new THREE.WebGLRenderer({
    canvas: lienzo, antialias: perfil.antialias, alpha: false,
    powerPreference: perfil.nivel === "alto" ? "high-performance" : "default",
  });
  // En modo plano se dibujan bloques de color liso: subir a 2x el ratio
  // de píxeles cuadruplica los píxeles a rellenar y no se nota.
  //
  // No está medido en un teléfono real: aquí sólo hay Chromium sin GPU
  // (renderizado por software), donde devicePixelRatio ya es 1 y el
  // tope no cambia nada. En un móvil con pantalla 3x sí evita
  // multiplicar por nueve el trabajo de relleno.
  renderer.setPixelRatio(PLANO ? Math.min(perfil.pixelRatio, 1.5) : perfil.pixelRatio);
  renderer.setSize(lienzo.clientWidth || innerWidth, lienzo.clientHeight || innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = PLANO ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  if (perfil.sombras) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = perfil.nivel === "alto" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  }

  /* ---------------- escena ---------------- */
  const escena = new THREE.Scene();
  const FONDO = PLANO ? 0xf4f5f6 : 0x0a0f18;
  escena.background = new THREE.Color(FONDO);
  if (perfil.niebla && !PLANO) escena.fog = new THREE.Fog(FONDO, 46, 132);

  /* ---------------- iluminación ---------------- */
  const ambiente = new THREE.HemisphereLight(0xffffff, PLANO ? 0xb8bec6 : 0x6b7f99, PLANO ? 1.65 : 0.55);
  escena.add(ambiente);

  const sol = new THREE.DirectionalLight(0xffffff, PLANO ? 1.55 : 2.0);
  sol.position.set(-14, 34, 24);
  if (perfil.sombras) {
    sol.castShadow = true;
    sol.shadow.mapSize.set(perfil.sombraTam, perfil.sombraTam);
    sol.shadow.camera.near = 1;
    sol.shadow.camera.far = 90;
    const r = 24;
    Object.assign(sol.shadow.camera, { left: -r, right: r, top: r, bottom: -r });
    sol.shadow.bias = -0.0008;
    sol.shadow.normalBias = 0.02;
  }
  escena.add(sol);

  const relleno = new THREE.DirectionalLight(PLANO ? 0xdde8f2 : 0x8fd0ff, PLANO ? 0.62 : 0.45);
  relleno.position.set(16, 18, -18);
  escena.add(relleno);

  // Iluminación por imagen: HDRI real si está configurado, o generada.
  // En modo plano no se usa: los colores lisos no la necesitan y es la
  // descarga más pesada de todo el mapa.
  if (!PLANO && perfil.entorno) {
    const hdri = GRAPHICS.hdriUrl || edificioDatos?.hdri_url;
    const entorno = hdri
      ? await cargarHDRI(hdri, renderer, THREE)
      : await entornoGenerado(renderer, THREE);
    if (entorno) {
      escena.environment = entorno;
      if (hdri) { escena.background = entorno; escena.backgroundBlurriness = 0.6; }
    }
  }

  // Luz puntual que resalta la sala seleccionada.
  const focoSeleccion = new THREE.PointLight(0x4ade80, 0, 22, 2);
  focoSeleccion.position.set(0, 7, 0);
  escena.add(focoSeleccion);

  /* ---------------- suelo exterior ---------------- */
  const sueloGeo = new THREE.PlaneGeometry(180, 180);
  const suelo = new THREE.Mesh(sueloGeo, PLANO
    ? new THREE.MeshLambertMaterial({ color: 0xf4f5f6 })
    : materiales.materialPBR({
        mapa: materiales.texturaBlueprint(perfil.nivel === "bajo" ? 256 : 512), rugosidad: 1,
      }));
  suelo.rotation.x = -Math.PI / 2;
  suelo.position.y = -0.24;
  suelo.receiveShadow = true;
  escena.add(suelo);

  /* ---------------- edificio ---------------- */
  const centro = edificio.centroEdificio(edificioDatos);
  const grupoEdificio = new THREE.Group();
  escena.add(grupoEdificio);

  grupoEdificio.add(edificio.crearLosa(edificioDatos, { plano: PLANO }));
  if (PLANO) grupoEdificio.add(edificio.crearEstacionamientoExterior(CAJONES_CALLE, centro));
  if (corredores.length) grupoEdificio.add(edificio.crearCorredores(corredores, centro, { plano: PLANO }));

  const volumenes = [];
  const volumenPorId = new Map();
  const etiquetas = new Map();
  const mobiliarios = new Map();
  const puertas = [];

  // Si hay un modelo GLTF del edificio, se usa como decorado adicional.
  /* Modelo 3D del edificio (GLB/GLTF).
     Funciona en LOS DOS estilos: antes sólo se cargaba en la maqueta
     realista, así que quien dejaba un GLB en el proyecto y tenía el
     mapa en modo plano no veía nada y no sabía por qué.
     El archivo se busca en `edificio.modelo_3d_url` o, si no, en
     assets/edificio.glb — dejarlo ahí y recargar es todo lo que hace
     falta. Se escala solo para que quepa en la parcela. */
  const modeloUrl0 = urlMedioSegura(edificioDatos?.modelo_3d_url || GRAPHICS.modeloUrl || "");
  const montarModelo = async (modeloUrl) => {
    if (!modeloUrl) return;
    try {
      const gltf = await cargarModelo(modeloUrl, renderer);
      if (gltf?.scene) {
        const obj = gltf.scene;
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = !PLANO; o.receiveShadow = true; } });

        // Un modelo generado por IA llega en cualquier escala y
        // centrado en cualquier parte: se encaja en la envolvente real
        // del edificio en vez de confiar en sus unidades.
        const caja = new THREE.Box3().setFromObject(obj);
        const tam = caja.getSize(new THREE.Vector3());
        const anchoM = Number(edificioDatos?.ancho_m) || ENVOLVENTE.ancho;
        const fondoM = Number(edificioDatos?.fondo_m) || ENVOLVENTE.fondo;
        const escala = Math.min(anchoM / (tam.x || 1), fondoM / (tam.z || 1));
        if (Number.isFinite(escala) && escala > 0) obj.scale.setScalar(escala);

        const c = caja.getCenter(new THREE.Vector3()).multiplyScalar(escala);
        obj.position.set(-c.x, -caja.min.y * escala, -c.z);

        grupoEdificio.add(obj);

        // Con un modelo puesto, los bloques de color estorban: se dejan
        // translúcidos para que sigan siendo clicables sin taparlo.
        if (PLANO) {
          for (const v of volumenes) {
            v.material.transparent = true;
            v.material.opacity = 0.22;
            v.material.depthWrite = false;
          }
        }
      }
    } catch (e) {
      console.warn("[mapa] no se pudo cargar el modelo 3D:", modeloUrl, e?.message || e);
    }
  };

  // Se lanza SIN esperarlo. Un modelo opcional que tarda —o que no
  // llega porque su cargador vive en una CDN bloqueada— no puede dejar
  // el mapa en "Construyendo el edificio en 3D…" para siempre.
  montarModelo(modeloUrl0);

  for (const espacio of espacios) {
    grupoEdificio.add(edificio.crearPiso(espacio, centro, { plano: PLANO }));

    // En el mapa también se levantan muros: bajos, claros y sin techo.
    // Es la diferencia entre "rectángulos de colores" y una maqueta
    // arquitectónica reconocible.
    if (PLANO) {
      grupoEdificio.add(edificio.crearMurosMapa(espacio, centro));
    } else {
      const muros = edificio.crearMuros(espacio, centro);
      grupoEdificio.add(muros);
      if (muros.userData.puerta) puertas.push(muros.userData.puerta);
    }

    const volumen = edificio.crearVolumen(espacio, centro, { plano: PLANO });
    volumen.userData.espacio = espacio;

    // En el mapa de reservas el BLOQUE COMPLETO es el semáforo.
    // Nada de puntitos: verde = todo libre, ámbar = parcial, rojo = no
    // disponible/no reservable. Esto se entiende de un vistazo en móvil.
    grupoEdificio.add(volumen);
    volumenes.push(volumen);
    volumenPorId.set(String(espacio.id), volumen);

    const rrEtiqueta = edificio.rectDe(espacio, centro);
    const escalaEtiqueta = clamp(Math.min(rrEtiqueta.w, rrEtiqueta.d) / 2.55, 0.50, espacio.reservable ? 1.04 : 0.92);
    const etiqueta = edificio.crearEtiqueta(espacio.nombre_mapa || espacio.nombre, { escala: escalaEtiqueta, oscuro: true });
    etiqueta.position.set(volumen.position.x, 0.082, volumen.position.z);
    // En un plano, los nombres son la mitad de la información: se dejan
    // puestos en las salas que se pueden reservar en vez de esconderlos
    // hasta que pases el dedo por encima.
    etiqueta.visible = PLANO;
    grupoEdificio.add(etiqueta);
    etiquetas.set(String(espacio.id), etiqueta);

    const muebles = PLANO ? null : edificio.crearMobiliario(espacio, centro, perfil);
    if (muebles) {
      muebles.visible = false;                 // sólo al enfocar la sala
      grupoEdificio.add(muebles);
      mobiliarios.set(String(espacio.id), muebles);
    }
  }

  /* ---------------- el plano de verdad, debajo ----------------
     Si el edificio tiene una imagen del plano arquitectónico
     (`edificio.plano_url`, o assets/plano.png), se dibuja a escala 1:1
     bajo los bloques de color. Así el mapa deja de ser una
     reconstrucción "parecida" y pasa a ser EL plano, con los bloques
     encima marcando lo que se puede reservar.

     La imagen se estira a la envolvente del edificio, así que basta con
     recortarla justo por los muros exteriores para que cuadre. */
  if (PLANO) {
    // La ruta puede venir de la base de datos (la pone el staff) o de
    // los ajustes guardados. Se valida el esquema igual que cualquier
    // otra URL de datos: es exactamente para esto que existe urlSegura().
    const urlPlano = GRAPHICS.usarPlano === false
      ? ""
      : urlMedioSegura(edificioDatos?.plano_url || GRAPHICS.planoUrl || "");
    if (urlPlano) {
      /* SIN await: el plano es una mejora, no un requisito.
       *
       * Antes se esperaba aquí a que llegara la imagen, así que el mapa
       * no aparecía hasta que el servidor contestara —y si el archivo no
       * existe, hasta que contestara 404—. El edificio se dibuja
       * perfectamente sin ella: los bloques ya están puestos y la hoja
       * del plano va DEBAJO. Cargarla por detrás y añadirla cuando
       * llegue quita ese tiempo del arranque y hace que un plano que
       * falta no cueste nada.
       *
       * El fallo se traga a propósito: no tener plano es lo normal
       * hasta que el propietario suelte el suyo en assets/plano.png. */
      const montarPlano = async () => {
        const tex = await new Promise((res, rej) => {
          new THREE.TextureLoader().load(urlPlano, res, undefined, rej);
        });
        if (!corriendo) return;          // la vista se cerró mientras cargaba
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;

        const anchoM = Number(edificioDatos?.ancho_m) || ENVOLVENTE.ancho;
        const fondoM = Number(edificioDatos?.fondo_m) || ENVOLVENTE.fondo;
        const hoja = new THREE.Mesh(
          new THREE.PlaneGeometry(anchoM, fondoM),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9 })
        );
        hoja.rotation.x = -Math.PI / 2;
        // Justo encima de la losa y debajo de todos los bloques.
        hoja.position.set(0, 0.012, 0);
        hoja.renderOrder = -1;
        grupoEdificio.add(hoja);

        // Con el plano puesto, los bloques se hacen semitransparentes
        // para no taparlo: se ven las paredes y los nombres del dibujo.
        for (const v of volumenes) {
          v.material.transparent = true;
          v.material.opacity = 0.62;
          v.material.depthWrite = false;
        }
        invalidar();                     // hay algo nuevo que dibujar
      };

      montarPlano().catch(() => {
        // Sin plano no pasa nada: el edificio ya está dibujado.
        console.info("[mapa] sin plano de fondo (%s). El edificio se dibuja igual.", urlPlano);
      });
    }
  }

  /* ---------------- detalles del plano ----------------
     El estacionamiento exterior ya está construido como una sola pieza
     clara. No añadimos mesas ni otros adornos: la referencia pedida es
     una maqueta limpia para reservar, no una escena amueblada. */

  /* ---------------- vida ---------------- */
  const grupoVida = new THREE.Group();
  escena.add(grupoVida);

  const caminantes = [];
  if (!PLANO && perfil.personas > 0) {
    const rutas = rutasPeatonales(edificioDatos, centro, THREE);
    for (let i = 0; i < perfil.personas; i++) {
      const ruta = rutas[i % rutas.length];
      const p = vida.crearCaminante(ruta, 0.85);
      grupoVida.add(p);
      caminantes.push(p);
    }
  }

  const grupoVegetacion = new THREE.Group();
  escena.add(grupoVegetacion);
  if (!PLANO && perfil.vegetacion > 0) sembrarVegetacion(grupoVegetacion, edificioDatos, centro, perfil, THREE);

  const autos = [];
  if (PLANO) {
    // Un auto dentro de la cochera y cuatro al frente, tal como la
    // referencia visual. Todos en plata para no competir con el semáforo.
    const cochera = espacios.find((e) => String(e.codigo).toUpperCase() === "PK-01");
    if (cochera) {
      const r = edificio.rectDe(cochera, centro);
      const auto = vida.crearAuto(perfil, 0xe4e7ea);
      auto.scale.setScalar(0.92);
      auto.position.set(r.x, 0.02, r.z + 0.15);
      grupoVida.add(auto); autos.push(auto);
    }
    for (const idx of [0, 1, 3, 5]) {
      const c = CAJONES_CALLE[idx];
      if (!c) continue;
      const auto = vida.crearAuto(perfil, 0xe7e9eb);
      auto.scale.setScalar(0.88);
      auto.position.set(c.x + c.ancho / 2 - centro.x, 0.02, c.y + c.fondo / 2 - centro.y);
      grupoVida.add(auto); autos.push(auto);
    }
  } else if (perfil.autos > 0) {
    const cochera = espacios.find((e) => e.tipo === "estacionamiento");
    const base = cochera ? edificio.rectDe(cochera, centro) : { x: 0, z: 12, w: 5, d: 5 };
    const columnas = Math.max(1, Math.floor(base.w / 2.1));
    const filas = Math.max(1, Math.floor(base.d / 4.6));
    const total = Math.min(perfil.autos, columnas * filas);

    for (let i = 0; i < total; i++) {
      const col = i % columnas;
      const fila = Math.floor(i / columnas);
      const auto = vida.crearAuto(perfil);
      auto.position.set(
        base.x - base.w / 2 + (base.w / columnas) * (col + 0.5),
        0,
        base.z - base.d / 2 + (base.d / filas) * (fila + 0.5)
      );
      grupoVida.add(auto);
      autos.push(auto);
    }
  }

  const elevador = vida.crearElevador({ pisos: 1 });
  elevador.position.set(centro.x * 0.62, 0, -centro.y * 0.78);
  elevador.visible = !PLANO && perfil.nivel !== "bajo";
  escena.add(elevador);

  const marcadorUbicacion = vida.crearMarcador(0x38bdf8);
  marcadorUbicacion.visible = false;
  escena.add(marcadorUbicacion);

  let rutaActual = null;

  /* ---------------- cámara ---------------- */
  const camara = new THREE.PerspectiveCamera(PLANO ? 30 : 42, aspecto(), 0.1, 400);
  const VISTA_POS = PLANO ? new THREE.Vector3(5.5, 58, 34) : new THREE.Vector3(2, 46, 42);
  // El estacionamiento sobresale hacia el frente; mover el objetivo un
  // poco al sur centra edificio + cajones como en la referencia.
  const VISTA_OBJ = new THREE.Vector3(0, 0, PLANO ? 2.5 : -1);
  const objetivo = VISTA_OBJ.clone();
  camara.position.copy(VISTA_POS);
  camara.lookAt(objetivo);

  const DIR = VISTA_POS.clone().sub(VISTA_OBJ).normalize();
  let distanciaBase = distanciaAjuste();
  let zoom = 1;
  const desplazamiento = new THREE.Vector3();
  const LIMITE_X = (Number(edificioDatos?.ancho_m) || ENVOLVENTE.ancho) * 0.6;
  const LIMITE_Z = (Number(edificioDatos?.fondo_m) || ENVOLVENTE.fondo) * 0.6;
  let rotacion = 0;

  function aspecto() {
    const w = lienzo.clientWidth || innerWidth;
    const h = lienzo.clientHeight || innerHeight;
    return w / Math.max(1, h);
  }

  /**
   * Distancia a la que el edificio entra ENTERO en pantalla.
   *
   * La fórmula anterior estimaba la huella proyectada con
   * `fondo * sin(inclinación)`. Eso ignora que, con la cámara
   * inclinada, la esquina cercana está mucho más cerca que la lejana y
   * la perspectiva la agranda: el borde de abajo del edificio se salía
   * de la pantalla, sobre todo en un teléfono en horizontal.
   *
   * Ahora se mide de verdad: se proyectan las ocho esquinas de la caja
   * del edificio y se ajusta la distancia hasta que todas caben. Dos
   * iteraciones bastan para converger.
   */
  function distanciaAjuste() {
    const w = (Number(edificioDatos?.ancho_m) || ENVOLVENTE.ancho) / 2 + 1.1;
    const d = ((Number(edificioDatos?.fondo_m) || ENVOLVENTE.fondo) + (PLANO ? 6.0 : 0)) / 2 + 1.1;
    const alto = PLANO ? 1.25 : 2.2;

    const esquinas = [];
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
      esquinas.push(new THREE.Vector3(sx * w, sy * alto, VISTA_OBJ.z + sz * d));
    }

    const camaraPrueba = camara
      ? camara.clone()
      : new THREE.PerspectiveCamera(PLANO ? 30 : 42, aspecto(), 0.1, 400);
    camaraPrueba.aspect = aspecto();

    // Punto de partida: el radio de la caja. Siempre queda lejos de más
    // o de menos, y las iteraciones lo corrigen.
    let dist = Math.hypot(w, d) * 1.6;

    for (let i = 0; i < 4; i++) {
      camaraPrueba.position.copy(DIR).multiplyScalar(dist).add(VISTA_OBJ);
      camaraPrueba.lookAt(VISTA_OBJ);
      camaraPrueba.updateProjectionMatrix();
      camaraPrueba.updateMatrixWorld(true);

      let peor = 0;
      for (const e of esquinas) {
        const p = e.clone().project(camaraPrueba);
        peor = Math.max(peor, Math.abs(p.x), Math.abs(p.y));
      }
      if (!Number.isFinite(peor) || peor <= 0) break;
      // 0.88 deja un margen: el buscador y la tira de días tapan la
      // franja de arriba, y la leyenda un poco la de abajo.
      dist *= peor / 0.88;
    }
    return dist;
  }

  function actualizarVistaGeneral() {
    const dist = distanciaBase / zoom;
    const dir = DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotacion);
    const obj = VISTA_OBJ.clone().add(desplazamiento);
    camara.position.copy(obj).addScaledVector(dir, dist);
    objetivo.copy(obj);
    camara.lookAt(objetivo);
  }
  actualizarVistaGeneral();

  /* ---------------- animación de cámara ---------------- */
  let animando = false, animInicio = 0, animDur = 900;
  const desdePos = new THREE.Vector3(), haciaPos = new THREE.Vector3();
  const desdeObj = new THREE.Vector3(), haciaObj = new THREE.Vector3();

  function volarA(pos, obj, dur = 900) {
    desdePos.copy(camara.position); haciaPos.copy(pos);
    desdeObj.copy(objetivo); haciaObj.copy(obj);
    animInicio = performance.now(); animDur = dur; animando = true;
  }

  /* ---------------- selección ---------------- */
  let seleccionado = null;
  let sobre = null;

  function enfocar(espacioId, { dur = 900 } = {}) {
    const volumen = volumenPorId.get(String(espacioId));
    if (!volumen) return false;
    seleccionado = String(espacioId);

    const r = { w: volumen.geometry.parameters.width, d: volumen.geometry.parameters.depth };
    const radio = Math.max(r.w, r.d);
    const distancia = clamp(radio * 2.4 + 5, 8, 26);
    const pos = new THREE.Vector3(
      volumen.position.x + distancia * 0.42,
      distancia * 0.86,
      volumen.position.z + distancia * 0.78
    );
    volarA(pos, volumen.position.clone(), dur);

    // En modo bloques dejamos TODOS los nombres puestos: es un mapa, no
    // una maqueta. En modo realista sólo se enseña el nombre enfocado.
    for (const [id, m] of mobiliarios) m.visible = id === seleccionado;
    for (const [id, e] of etiquetas) e.visible = PLANO || id === seleccionado;

    // Abre su puerta
    for (const p of puertas) vida.abrirPuerta(p, false);
    const muros = grupoEdificio.children.find((c) => c.userData?.espacioId === String(espacioId) && c.userData.puerta);
    if (muros?.userData.puerta) vida.abrirPuerta(muros.userData.puerta, true);

    focoSeleccion.position.set(volumen.position.x, volumen.userData.alturaBase + 4, volumen.position.z);
    focoSeleccion.intensity = 14;
    return true;
  }

  function vistaGeneral({ dur = 800 } = {}) {
    seleccionado = null;
    for (const m of mobiliarios.values()) m.visible = false;
    for (const e of etiquetas.values()) e.visible = PLANO;
    for (const p of puertas) vida.abrirPuerta(p, false);
    focoSeleccion.intensity = 0;
    const dist = distanciaBase / zoom;
    const dir = DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotacion);
    const obj = VISTA_OBJ.clone().add(desplazamiento);
    volarA(obj.clone().addScaledVector(dir, dist), obj, dur);
  }

  /* ---------------- semáforo de disponibilidad ---------------- */
  function aplicarDisponibilidad(mapa = {}) {
    invalidar();
    for (const volumen of volumenes) {
      const espacio = volumen.userData.espacio;
      let color = edificio.COLOR_SEMAFORO.desconocido;
      let borde = 0x94a3b8;

      /*
       * El semáforo ya no pinta los cuartos completos. La arquitectura
       * siempre queda clara/neutra y el estado vive sólo en el contorno
       * superior de A/B/C/D, igual que en la referencia visual:
       *
       *   azul  = consultando
       *   verde = todo el día restante libre
       *   ámbar = algunos horarios libres
       *   rojo  = sin horarios libres
       *
       * Las áreas que nunca se rentan no llevan halo: siguen siendo parte
       * del edificio, no falsos "errores" rojos por toda la maqueta.
       */
      if (!volumen.userData.reservable || espacio.estado !== "disponible") {
        color = 0x9ca3af;
        borde = 0xaeb3b8;
      } else {
        const d = mapa[String(espacio.id)];
        if (!d || !Number.isFinite(Number(d.total))) {
          color = 0x3b82f6;
          borde = 0x3b82f6;
        } else if (Number(d.total) <= 0 || Number(d.libres) <= 0) {
          color = 0xdc2626;
          borde = 0xef4444;
        } else if (Number(d.libres) >= Number(d.total)) {
          color = 0x16a34a;
          borde = 0x22c55e;
        } else {
          color = 0xd97706;
          borde = 0xf59e0b;
        }
      }

      const cap = volumen.userData.statusCap;
      if (cap?.material?.color) {
        cap.material.color.setHex(color);
        cap.material.opacity = volumen.userData.reservable ? 0.075 : 0;
        volumen.userData.statusColorBase = cap.material.color.clone();
      } else {
        // Vista realista antigua: conserva compatibilidad.
        volumen.material.color.setHex(color);
        volumen.userData.colorBase = volumen.material.color.clone();
      }

      const bordeEstado = volumen.userData.statusBordes;
      bordeEstado?.material?.color?.setHex(borde);
      if (bordeEstado?.material) bordeEstado.material.opacity = volumen.userData.reservable ? 0.98 : 0;
    }
  }

  /* ---------------- ruta ---------------- */
  function mostrarRuta(espacioId) {
    quitarRuta();
    const volumen = volumenPorId.get(String(espacioId));
    if (!volumen) return;

    const entrada = espacios.find((e) => e.tipo === "comun" && /recepc/i.test(e.nombre))
      || espacios.find((e) => /recepc|lobby|acceso/i.test(e.nombre));
    const inicio = entrada
      ? (() => { const r = edificio.rectDe(entrada, centro); return new THREE.Vector3(r.x, 0, r.z); })()
      : new THREE.Vector3(0, 0, (Number(edificioDatos?.fondo_m) || ENVOLVENTE.fondo) / 2 - 1);

    const fin = volumen.position.clone();
    // Ruta en L por los pasillos: primero avanza en Z, luego en X.
    const intermedio = new THREE.Vector3(inicio.x, 0, fin.z);
    const puntos = [inicio, intermedio, fin].map((p) => new THREE.Vector3(p.x, 0.06, p.z));

    rutaActual = vida.crearRuta(puntos);
    if (rutaActual) escena.add(rutaActual);

    marcadorUbicacion.position.copy(inicio);
    marcadorUbicacion.visible = true;
  }

  function quitarRuta() {
    if (rutaActual) { escena.remove(rutaActual); desecharObjeto(rutaActual); rutaActual = null; }
    marcadorUbicacion.visible = false;
  }

  /* ---------------- interacción ---------------- */
  const raycaster = new THREE.Raycaster();
  const puntero = new THREE.Vector2();
  let arrastrando = false, movio = false;
  let ultimoX = 0, ultimoY = 0, distanciaPinza = 0;

  function coordenadas(e) {
    const rect = lienzo.getBoundingClientRect();
    const x = (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - rect.left;
    const y = (e.clientY ?? e.touches?.[0]?.clientY ?? 0) - rect.top;
    puntero.x = (x / rect.width) * 2 - 1;
    puntero.y = -(y / rect.height) * 2 + 1;
  }

  function intersectar() {
    raycaster.setFromCamera(puntero, camara);
    return raycaster.intersectObjects(volumenes, false)[0]?.object || null;
  }

  function alPresionar(e) {
    arrastrando = true; movio = false;
    ultimoX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    ultimoY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    if (e.touches?.length === 2) {
      distanciaPinza = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }

  function alMover(e) {
    if (e.touches?.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (distanciaPinza) {
        zoom = clamp(zoom * (d / distanciaPinza), 0.34, 2.2);
        if (!seleccionado) actualizarVistaGeneral();
      }
      distanciaPinza = d;
      movio = true;
      return;
    }

    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;

    if (arrastrando) {
      const dx = x - ultimoX, dy = y - ultimoY;
      if (Math.abs(dx) + Math.abs(dy) > 4) movio = true;
      ultimoX = x; ultimoY = y;

      if (e.shiftKey || e.touches?.length === 1) {
        rotacion -= dx * 0.005;
        desplazamiento.z = clamp(desplazamiento.z - dy * 0.05, -LIMITE_Z, LIMITE_Z);
      } else {
        desplazamiento.x = clamp(desplazamiento.x - dx * 0.05, -LIMITE_X, LIMITE_X);
        desplazamiento.z = clamp(desplazamiento.z - dy * 0.05, -LIMITE_Z, LIMITE_Z);
      }
      if (!seleccionado && !animando) actualizarVistaGeneral();
      return;
    }

    // Hover sólo con ratón
    if (e.pointerType === "touch") return;
    coordenadas(e);
    const objeto = intersectar();
    if (objeto !== sobre) {
      if (sobre) restaurarColor(sobre);
      sobre = objeto;
      if (sobre) {
        const cap = sobre.userData.statusCap;
        if (cap?.material?.color) cap.material.color.lerp(new THREE.Color(0xffffff), 0.18);
        else sobre.material.color.lerp(new THREE.Color(0xffffff), 0.22);
        lienzo.style.cursor = "pointer";
      } else {
        lienzo.style.cursor = "grab";
      }
      onHover?.(sobre?.userData.espacio || null, { x: e.clientX, y: e.clientY });
    }
  }

  function alSoltar(e) {
    if (arrastrando && !movio) {
      coordenadas(e.changedTouches?.[0] || e);
      const objeto = intersectar();
      if (objeto) {
        vibrar("seleccion");
        onSeleccion?.(objeto.userData.espacio);
      } else if (seleccionado) {
        onSeleccion?.(null);
      }
    }
    arrastrando = false;
    distanciaPinza = 0;
  }

  function alRodar(e) {
    e.preventDefault();
    zoom = clamp(zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.34, 2.2);
    if (!seleccionado) actualizarVistaGeneral();
  }

  function restaurarColor(objeto) {
    const cap = objeto.userData.statusCap;
    if (cap?.material?.color && objeto.userData.statusColorBase) {
      cap.material.color.copy(objeto.userData.statusColorBase);
      return;
    }
    if (objeto.userData.colorBase) objeto.material.color.copy(objeto.userData.colorBase);
  }

  // Cualquier gesto del usuario pide un redibujado: es la vía por la que
  // entran arrastre, pinza y rueda sin tener que instrumentar cada una.
  const conRedibujo = (fn) => (e) => { invalidar(); return fn(e); };
  const alPresionarR = conRedibujo(alPresionar);
  const alMoverR = conRedibujo(alMover);
  const alSoltarR = conRedibujo(alSoltar);
  const alRodarR = conRedibujo(alRodar);

  lienzo.addEventListener("pointerdown", alPresionarR);
  lienzo.addEventListener("pointermove", alMoverR);
  window.addEventListener("pointerup", alSoltarR);
  lienzo.addEventListener("touchstart", alPresionarR, { passive: true });
  lienzo.addEventListener("touchmove", alMoverR, { passive: true });
  lienzo.addEventListener("touchend", alSoltarR);
  lienzo.addEventListener("wheel", alRodarR, { passive: false });
  lienzo.style.cursor = "grab";
  lienzo.style.touchAction = "none";

  /* ---------------- bucle ----------------

     Render bajo demanda. Antes se llamaba a renderer.render() 60 veces
     por segundo pasara lo que pasara, y en el estilo «plano» —que es el
     de fábrica— la escena está quieta casi todo el tiempo: sin
     vegetación, sin gente andando, sin nada que se mueva. Eran sesenta
     dibujados idénticos por segundo, que en un móvil se notan en la
     batería y en lo caliente que se pone el teléfono.

     Ahora sólo se dibuja cuando hay algo que ver: una animación de
     cámara en curso, algo con vida propia, el latido del espacio
     seleccionado, o una invalidación explícita (girar, hacer zoom,
     arrastrar, cambiar la disponibilidad, redimensionar).

     RED DE SEGURIDAD: aunque nadie invalide, se dibuja igual una vez por
     segundo. Si algún día alguien añade una mutación y se olvida de
     llamar a `invalidar()`, el mapa se verá un segundo tarde — molesto,
     pero visible y depurable. Sin esta red, ese despiste dejaría la
     pantalla congelada para siempre y parecería un cuelgue. */
  let ultimoTiempo = performance.now();
  let cuadros = 0, ultimaMedicion = performance.now(), fps = 60;
  let onFrame = null;
  let ultimoDibujo = 0;
  let sucio = true;

  /** Marca que hay algo nuevo que dibujar. */
  function invalidar() { sucio = true; }

  /** ¿Hay algo moviéndose por su cuenta ahora mismo? */
  function hayMovimiento() {
    return animando
      || caminantes.length > 0
      || puertas.length > 0
      || elevador.visible
      || Boolean(rutaActual)
      || Boolean(seleccionado)                       // late al respirar
      || marcadorUbicacion.visible
      || (!PLANO && perfil.vegetacion);
  }

  function bucle(ahora) {
    if (!corriendo) return;
    requestAnimationFrame(bucle);

    const dt = Math.min(0.05, (ahora - ultimoTiempo) / 1000);
    ultimoTiempo = ahora;
    const tiempo = ahora / 1000;

    if (animando) {
      const t = clamp((ahora - animInicio) / animDur, 0, 1);
      const k = easeInOutCubic(t);
      camara.position.lerpVectors(desdePos, haciaPos, k);
      objetivo.lerpVectors(desdeObj, haciaObj, k);
      camara.lookAt(objetivo);
      if (t >= 1) animando = false;
    }

    for (const p of caminantes) vida.animarCaminante(p, dt);
    for (const p of puertas) vida.animarPuerta(p, dt);
    if (elevador.visible) vida.animarElevador(elevador, dt);
    if (!PLANO && perfil.vegetacion) vida.animarVegetacion(grupoVegetacion, tiempo);
    if (marcadorUbicacion.visible) vida.animarMarcador(marcadorUbicacion, dt, tiempo);
    if (rutaActual) vida.animarRuta(rutaActual, dt);

    // Latido suave del volumen seleccionado
    if (seleccionado) {
      const v = volumenPorId.get(seleccionado);
      if (v) v.material.emissiveIntensity = 0.16 + Math.sin(tiempo * 2.6) * 0.1;
    }

    // Sin nada que mostrar, no se dibuja. La red de seguridad de 1 s
    // evita que una invalidación olvidada congele el mapa del todo.
    if (!sucio && !hayMovimiento() && ahora - ultimoDibujo < 1000) {
      onFrame?.({ camara, objetivo, fps, seleccionado });
      return;
    }
    sucio = false;
    ultimoDibujo = ahora;
    renderer.render(escena, camara);

    cuadros++;
    if (ahora - ultimaMedicion > 1000) {
      fps = cuadros; cuadros = 0; ultimaMedicion = ahora;
      // Degradación automática: si el móvil sufre, apagamos sombras.
      if (fps < 26 && renderer.shadowMap.enabled) {
        renderer.shadowMap.enabled = false;
        console.info("[3d] sombras desactivadas para mantener la fluidez");
      }
    }
    onFrame?.({ camara, objetivo, fps, seleccionado });
  }
  requestAnimationFrame(bucle);

  /* ---------------- redimensionado ---------------- */
  function redimensionar() {
    const w = lienzo.clientWidth || innerWidth;
    const h = lienzo.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camara.aspect = w / Math.max(1, h);
    camara.updateProjectionMatrix();
    distanciaBase = distanciaAjuste();
    if (!seleccionado && !animando) actualizarVistaGeneral();
    invalidar();
  }
  const observador = new ResizeObserver(redimensionar);
  observador.observe(lienzo);
  window.addEventListener("resize", redimensionar);

  /* ---------------- limpieza ---------------- */
  function destruir() {
    corriendo = false;
    observador.disconnect();
    window.removeEventListener("resize", redimensionar);
    window.removeEventListener("pointerup", alSoltarR);
    lienzo.removeEventListener("pointerdown", alPresionarR);
    lienzo.removeEventListener("pointermove", alMoverR);
    lienzo.removeEventListener("touchstart", alPresionarR);
    lienzo.removeEventListener("touchmove", alMoverR);
    lienzo.removeEventListener("touchend", alSoltarR);
    lienzo.removeEventListener("wheel", alRodarR);

    escena.traverse(desecharObjeto);
    materiales.limpiarCache();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  function desecharObjeto(objeto) {
    if (objeto.geometry) objeto.geometry.dispose();
    const m = objeto.material;
    if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
    else m?.dispose?.();
    objeto.children?.forEach?.(desecharObjeto);
  }

  /* ---------------- API pública ---------------- */
  return {
    THREE, escena, camara, renderer, perfil, centro,
    enfocar, vistaGeneral, aplicarDisponibilidad, mostrarRuta, quitarRuta,
    destruir, redimensionar,
    get seleccionado() { return seleccionado; },
    get fps() { return fps; },
    posicionDe(espacioId) {
      const v = volumenPorId.get(String(espacioId));
      return v ? { x: v.position.x, z: v.position.z } : null;
    },
    setZoom(z) { zoom = clamp(z, 0.34, 2.2); if (!seleccionado) actualizarVistaGeneral(); invalidar(); },
    girar(radianes) { rotacion += radianes; if (!seleccionado) actualizarVistaGeneral(); invalidar(); },
    invalidar,
    onFrame(fn) { onFrame = fn; },
    limites: {
      ancho: Number(edificioDatos?.ancho_m) || 20,
      fondo: Number(edificioDatos?.fondo_m) || ENVOLVENTE.fondo,
    },
  };
}

/* =====================================================================
   Auxiliares
   ===================================================================== */

/** Circuitos por los que caminan las personas. */
function rutasPeatonales(edificioDatos, centro, THREE) {
  const w = (Number(edificioDatos?.ancho_m) || ENVOLVENTE.ancho) / 2;
  const d = (Number(edificioDatos?.fondo_m) || ENVOLVENTE.fondo) / 2;
  const p = (x, z) => new THREE.Vector3(x, 0, z);
  return [
    [p(-w + 2, d - 1.5), p(w - 2, d - 1.5), p(w - 2, 1), p(-w + 2, 1)],
    [p(0, d - 1), p(0, -d + 3), p(w - 3, -d + 3), p(w - 3, d - 1)],
    [p(-w + 1.5, -d + 4), p(-w + 1.5, d - 4), p(-2, d - 4), p(-2, -d + 4)],
    [p(w + 3, d), p(w + 3, -d), p(-w - 3, -d), p(-w - 3, d)],
  ];
}

/** Coloca árboles y arbustos alrededor y en los patios. */
function sembrarVegetacion(grupo, edificioDatos, centro, perfil, THREE) {
  const w = (Number(edificioDatos?.ancho_m) || ENVOLVENTE.ancho) / 2;
  const d = (Number(edificioDatos?.fondo_m) || ENVOLVENTE.fondo) / 2;
  const total = perfil.vegetacion;

  for (let i = 0; i < total; i++) {
    const perimetro = i < total * 0.6;
    let x, z;
    if (perimetro) {
      const lado = i % 4;
      const t = (Math.random() - 0.5) * 2;
      if (lado === 0) { x = t * (w + 6); z = -d - 3 - Math.random() * 4; }
      else if (lado === 1) { x = t * (w + 6); z = d + 3 + Math.random() * 4; }
      else if (lado === 2) { x = -w - 3 - Math.random() * 4; z = t * (d + 4); }
      else { x = w + 3 + Math.random() * 4; z = t * (d + 4); }
    } else {
      // Patios interiores
      x = (Math.random() - 0.3) * w * 0.9;
      z = -d * 0.55 + Math.random() * d * 0.5;
    }

    const arbol = Math.random() > 0.35
      ? vida.crearArbol(perfil, 0.9 + Math.random() * 0.7)
      : vida.crearArbusto(perfil, 0.9 + Math.random() * 0.6);
    arbol.position.set(x, 0, z);
    arbol.rotation.y = Math.random() * Math.PI * 2;
    grupo.add(arbol);
  }
}

export default { crearEscena };
