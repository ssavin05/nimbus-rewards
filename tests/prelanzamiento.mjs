/* Casos A–H del repaso de pre-lanzamiento.
 *
 *   python3 -m http.server 8099
 *   node tests/prelanzamiento.mjs
 *
 * Los casos de base de datos (B, C) viven en SQL y ya se comprueban en
 * la suite de caducidad; aquí van los del cliente.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8099";
const res = [];
const ok = (id, n, d = "") => res.push({ id, n, v: "PASA", d });
const mal = (id, n, d) => res.push({ id, n, v: "FALLA", d });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function pagina({ offline = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-MX" });
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem("co.tutorial.visto", "1"));
  // `offline: total` tumba Supabase entero (la app cae a modo local).
  // `offline: "rpc"` deja cargar la biblioteca y la sesión pero rompe
  // SÓLO la consulta de disponibilidad: ése es el caso que importa,
  // porque el backend SÍ está configurado y aun así falla.
  if (offline === true) await ctx.route("**/*.supabase.co/**", (r) => r.abort());
  if (offline === "rpc") {
    await ctx.route("**/rest/v1/rpc/disponibilidad_*", (r) => r.abort());
  }
  return { p, ctx };
}

/* -------- CASO A · base sin reservas → todo libre -------- */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const mock = await import("/js/data/mock.js");
    const hoy = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const esp = mock.espacios().filter((e) => e.reservable).slice(0, 6);
    let libres = 0, total = 0;
    for (const e of esp) {
      for (const bl of await mock.disponibilidad(e.id, hoy)) { total++; if (bl.libre) libres++; }
    }
    return { libres, total, muestra: esp.length };
  });
  if (r.total > 0 && r.libres === r.total) {
    ok("A", "Sin reservas, todos los bloques futuros libres", `${r.libres}/${r.total} en ${r.muestra} espacios`);
  } else {
    mal("A", "Sin reservas, todos los bloques futuros libres", `sólo ${r.libres}/${r.total} libres`);
  }
  await ctx.close();
}

/* -------- CASO A2 · el pasado sigue sin poder reservarse -------- */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(async () => {
    const mock = await import("/js/data/mock.js");
    const { isoFecha } = await import("/js/core/utils.js");
    // «Ayer» tiene que ser ayer EN EL EDIFICIO. Antes se calculaba con
    // toISOString(), que da la fecha UTC: a las 20:00 de Tijuana ya es el
    // día siguiente en UTC, así que restarle 24 h daba el día de HOY allí
    // —con su último bloque aún por llegar— y el caso fallaba señalando
    // un bug que no existía.
    const ayer = isoFecha(new Date(Date.now() - 86400000));
    const e = mock.espacios().find((x) => x.reservable);
    const d = await mock.disponibilidad(e.id, ayer);
    return { fecha: ayer, libres: d.filter((x) => x.libre).length, total: d.length };
  });
  if (r.libres === 0) ok("A2", "El pasado no se puede reservar", `0/${r.total} libres ayer`);
  else mal("A2", "El pasado no se puede reservar", `${r.libres} bloques de ayer figuran libres`);
  await ctx.close();
}

/* -------- CASO B · una reserva local ocupa SU bloque, y sólo ése -------- */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const mock = await import("/js/data/mock.js");
    const fecha = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const e = mock.espacios().find((x) => x.reservable);
    const antes = await mock.disponibilidad(e.id, fecha);
    const bloque = antes.find((x) => x.libre)?.bloque;
    await mock.crearReserva({ espacioId: e.id, fecha, bloque, asistentes: 1 });
    const despues = await mock.disponibilidad(e.id, fecha);
    return {
      bloque,
      ocupadoElSuyo: despues.find((x) => x.bloque === bloque)?.libre === false,
      otrosLibres: despues.filter((x) => x.bloque !== bloque).every((x) => x.libre),
    };
  });
  if (r.ocupadoElSuyo && r.otrosLibres) ok("B", "Una reserva ocupa sólo su bloque", r.bloque);
  else mal("B", "Una reserva ocupa sólo su bloque",
    `suyo ocupado=${r.ocupadoElSuyo} · resto libre=${r.otrosLibres}`);
  await ctx.close();
}

/* -------- CASO D · V1 sólo registra Clip -------- */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(800);
  const r = await p.evaluate(async () => {
    const cfg = await import("/js/core/config.js");
    const src = await fetch("/js/payments/index.js").then((x) => x.text());
    return {
      orden: cfg.PAYMENTS.order,
      tieneConfigRetirada: ["stripe", "paypal", "mercadopago", "transferencia", "googlepay", "applepay"]
        .some((id) => Object.prototype.hasOwnProperty.call(cfg.PAYMENTS, id)),
      registryClipOnly: /clip:\s*\(\)\s*=>\s*import\("\.\/clip\.js"\)/.test(src)
        && !/(stripe|paypal|mercadopago|transferencia|wallets)\.js/.test(src),
    };
  });
  if (r.orden.length === 1 && r.orden[0] === "clip" && !r.tieneConfigRetirada && r.registryClipOnly)
    ok("D", "V1 sólo registra y configura Clip");
  else mal("D", "V1 sólo registra y configura Clip", JSON.stringify(r));
  await ctx.close();
}

/* -------- CASO D2 · adaptadores cliente retirados ya no existen -------- */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  const retirados = await p.evaluate(async () => {
    const rutas = ["stripe", "tarjeta", "paypal", "mercadopago", "wallets", "transferencia"];
    const estados = await Promise.all(rutas.map(async (id) => [id, (await fetch(`/js/payments/${id}.js`)).status]));
    return estados.filter(([, status]) => status !== 404);
  });
  if (!retirados.length) ok("D2", "No quedan adaptadores cliente de pasarelas retiradas");
  else mal("D2", "No quedan adaptadores cliente de pasarelas retiradas", JSON.stringify(retirados));
  await ctx.close();
}

/* -------- CASO G · con backend caído NO se inventa disponibilidad -------- */
{
  const { p, ctx } = await pagina({ offline: "rpc" });
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(async () => {
    const api = await import("/js/data/api.js");
    const cfg = await import("/js/core/config.js");
    const configurado = cfg.isBackendConfigured();   // es función: hay que llamarla
    const fecha = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
    const esp = (await api.default.getEspacios().catch(() => []))[0];
    if (!esp) return { sinEspacios: true, configurado };
    const d = await api.default.getDisponibilidad(esp.id, fecha, { forzar: true }).catch(() => "error");
    return {
      configurado,
      demo: api.enModoDemo?.(),
      tipo: d === null ? "null" : Array.isArray(d) ? `array(${d.length})` : String(d),
    };
  });
  // Con el backend configurado, la única respuesta aceptable es `null`.
  // Y si la aplicación se fue a modo local, esta prueba NO está midiendo
  // lo que dice medir: eso también es un fallo, no un aprobado.
  if (r.sinEspacios) {
    mal("G", "Backend caído: no se inventa disponibilidad", "no se pudo leer el catálogo");
  } else if (!r.configurado) {
    mal("G", "Backend caído: no se inventa disponibilidad",
      "el backend no está configurado: la prueba no demuestra nada");
  } else if (r.demo) {
    mal("G", "Backend caído: no se inventa disponibilidad",
      "la app cayó a modo local; no se está probando el caso real");
  } else if (r.tipo !== "null") {
    mal("G", "Backend caído: no se inventa disponibilidad",
      `con backend configurado devolvió ${r.tipo} en vez de null`);
  } else {
    ok("G", "Backend caído: no se inventa disponibilidad", "devuelve null");
  }
  await ctx.close();
}

/* -------- CASO I · la rejilla distingue null / [] / datos --------
   `null` («no se sabe») no puede verse igual que «todavía cargando»:
   un esqueleto eterno le dice a la persona que espere algo que no va
   a llegar. Y tampoco igual que `[]`, que es «ese día no abre». */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(async () => {
    const { rejillaHorarios } = await import("/js/views/componentes.js");
    const fecha = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const texto = (h) => String(h).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return {
      nulo: texto(rejillaHorarios(null, { fecha })),
      indefinido: texto(rejillaHorarios(undefined, { fecha })),
      vacio: texto(rejillaHorarios([], { fecha })),
      conDatos: texto(rejillaHorarios([{ bloque: "08:00-09:00", libre: true }], { fecha })),
      nuloTieneBoton: /data-reintentar-disp/.test(String(rejillaHorarios(null, { fecha }))),
      indefTieneEsqueleto: /esqueleto/.test(String(rejillaHorarios(undefined, { fecha }))),
    };
  });
  const bien = /no pudimos consultar/i.test(r.nulo)
    && r.nuloTieneBoton
    && r.indefTieneEsqueleto
    && !/no pudimos consultar/i.test(r.vacio)
    && /09:00/.test(r.conDatos);
  if (bien) ok("I", "null ≠ cargando ≠ cerrado", `null → «${r.nulo.slice(0, 40)}…»`);
  else mal("I", "null ≠ cargando ≠ cerrado",
    `null=«${r.nulo.slice(0, 30)}» botón=${r.nuloTieneBoton} esqueleto=${r.indefTieneEsqueleto} vacío=«${r.vacio.slice(0, 30)}»`);
  await ctx.close();
}

/* -------- CASO J · el botón de reintentar existe en cada vista que
   puede enseñarlo. Un botón muerto es peor que no tenerlo. -------- */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(async () => {
    const vistas = ["espacio", "reserva-detalle", "mapa", "reservar"];
    const sinCablear = [];
    for (const v of vistas) {
      const src = await fetch(`/js/views/${v}.js`).then((x) => x.text());
      // La rejilla la pinta `rejillaHorarios`; quien la use tiene que
      // atender el clic del botón que esa rejilla puede sacar.
      const usa = /rejillaHorarios/.test(src);
      const cablea = /data-reintentar-disp/.test(src);
      if (usa && !cablea) sinCablear.push(v);
    }
    return { sinCablear };
  });
  if (!r.sinCablear.length) ok("J", "El botón de reintentar está cableado en todas las vistas");
  else mal("J", "El botón de reintentar está cableado en todas las vistas",
    `sin cablear: ${r.sinCablear.join(", ")}`);
  await ctx.close();
}

/* -------- CASO K · Clip no carga un SDK de cobro en el cliente -------- */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  const r = await p.evaluate(async () => {
    const src = await fetch("/js/payments/clip.js").then((x) => x.text());
    return {
      llamaServidor: /invocarFuncion\("pagos-clip"/.test(src),
      sinSdkExterno: !/https?:\/\//.test(src.replace(/https?:\/\/[^\s]*Clip/gi, "")),
      sinPan: !/(cc-number|cvv|cvc|numero.*tarjeta|número.*tarjeta)/i.test(src),
    };
  });
  if (r.llamaServidor && r.sinPan) ok("K", "Clip delega el cobro al servidor y no captura PAN/CVV");
  else mal("K", "Clip delega el cobro al servidor y no captura PAN/CVV", JSON.stringify(r));
  await ctx.close();
}

/* -------- CASO L · caché vieja de disponibilidad NO se sirve --------
   El caso concreto que pidió la revisión:
     1. se guarda en caché un horario como libre
     2. el backend está configurado
     3. la RPC falla
     4. tiene que salir `null`, no lo que había guardado          */
{
  const { p, ctx } = await pagina({ offline: "rpc" });
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(async () => {
    const api = await import("/js/data/api.js");
    const cache = (await import("/js/data/cache.js")).default;
    const cfg = await import("/js/core/config.js");
    const fecha = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    const esp = (await api.default.getEspacios().catch(() => []))[0];
    if (!esp) return { sinEspacios: true };

    // 1. Una caché "buena" y bien reciente, del formato exacto que
    //    guardaba la versión anterior.
    const mentira = [{ bloque: "08:00-09:00", libre: true },
                     { bloque: "09:00-10:00", libre: true }];
    await cache.guardar(`disp:${esp.id}:${fecha}`, mentira, 10 * 60 * 1000);
    const seGuardo = Boolean(await cache.leer(`disp:${esp.id}:${fecha}`));

    // 3. La RPC está abortada por la ruta del contexto.
    const d = await api.default.getDisponibilidad(esp.id, fecha);
    return {
      configurado: cfg.isBackendConfigured(),
      demo: api.enModoDemo?.(),
      seGuardo,
      resultado: d === null ? "null" : Array.isArray(d) ? `array(${d.length})` : String(d),
      sirvioLaCache: Array.isArray(d) && d.some((x) => x.bloque === "08:00-09:00" && x.libre),
    };
  });
  if (r.sinEspacios) mal("L", "Caché vieja no se sirve como disponibilidad", "sin catálogo");
  else if (r.demo || !r.configurado) mal("L", "Caché vieja no se sirve como disponibilidad", "el backend no está configurado; la prueba no vale");
  else if (!r.seGuardo) mal("L", "Caché vieja no se sirve como disponibilidad", "no se pudo sembrar la caché");
  else if (r.sirvioLaCache) mal("L", "Caché vieja no se sirve como disponibilidad", "¡devolvió el valor guardado!");
  else if (r.resultado !== "null") mal("L", "Caché vieja no se sirve como disponibilidad", `devolvió ${r.resultado}`);
  else ok("L", "Caché vieja no se sirve como disponibilidad", "sembrada y aun así devuelve null");
  await ctx.close();
}

/* -------- CASO M · lo mismo para el semáforo del mapa -------- */
{
  const { p, ctx } = await pagina({ offline: "rpc" });
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(async () => {
    const api = await import("/js/data/api.js");
    const cache = (await import("/js/data/cache.js")).default;
    const fecha = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    const org = await api.default.getOrganizacion().catch(() => null);
    const esp = (await api.default.getEspacios().catch(() => []))[0];
    if (!esp) return { sinEspacios: true };

    const mentira = { [esp.id]: { libres: 6, total: 6 } };
    await cache.guardar(`mapa:${org?.id}:${fecha}`, mentira, 10 * 60 * 1000);
    const seGuardo = Boolean(await cache.leer(`mapa:${org?.id}:${fecha}`));

    const m = await api.default.getDisponibilidadMapa(fecha);
    return {
      demo: api.enModoDemo?.(),
      seGuardo,
      resultado: m === null ? "null" : typeof m === "object" ? `objeto(${Object.keys(m).length})` : String(m),
      sirvioLaCache: Boolean(m && m[esp.id]?.libres === 6),
    };
  });
  if (r.sinEspacios) mal("M", "El semáforo del mapa tampoco sirve caché", "sin catálogo");
  else if (r.demo) mal("M", "El semáforo del mapa tampoco sirve caché", "modo local; la prueba no vale");
  else if (!r.seGuardo) mal("M", "El semáforo del mapa tampoco sirve caché", "no se pudo sembrar la caché");
  else if (r.sirvioLaCache) mal("M", "El semáforo del mapa tampoco sirve caché", "¡devolvió el valor guardado!");
  else if (r.resultado !== "null") mal("M", "El semáforo del mapa tampoco sirve caché", `devolvió ${r.resultado}`);
  else ok("M", "El semáforo del mapa tampoco sirve caché", "sembrado y aun así devuelve null");
  await ctx.close();
}

/* -------- CASO N · durante la purga de época no se lee nada viejo --------
   Se siembra la caché, se cambia la época y se lanza la purga a la vez
   que veinte lecturas. Ninguna puede ver el dato viejo. */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const cache = (await import("/js/data/cache.js")).default;
    const lanz = await import("/js/core/lanzamiento.js");
    const { APP } = await import("/js/core/config.js");

    // Caché de la época anterior: disponibilidad y catálogo.
    await cache.guardar("disp:x:2026-01-01", [{ bloque: "08:00-09:00", libre: true }], 60 * 60 * 1000);
    await cache.guardar("mapa:o:2026-01-01", { x: { libres: 9, total: 9 } }, 60 * 60 * 1000);
    await cache.guardar("espacios:lista", [{ id: "x", total_reservas: 87 }], 60 * 60 * 1000);
    const sembrado = [
      await cache.leer("disp:x:2026-01-01"),
      await cache.leer("mapa:o:2026-01-01"),
      await cache.leer("espacios:lista"),
    ].filter(Boolean).length;

    // Forzar «época nueva».
    localStorage.setItem("co.epoca", "epoca-anterior-de-mentira");

    // La purga arranca y, SIN esperarla, se disparan las lecturas: es
    // exactamente la carrera del arranque.
    const purga = lanz.revisarEpocaDeLanzamiento();
    const lecturas = [];
    for (let i = 0; i < 20; i++) {
      lecturas.push(cache.leer("disp:x:2026-01-01"));
      lecturas.push(cache.leer("mapa:o:2026-01-01"));
      lecturas.push(cache.leer("espacios:lista"));
    }
    const durante = await Promise.all(lecturas);
    const resultado = await purga;

    return {
      sembrado,
      purgado: resultado?.purgado === true,
      epocaGuardada: localStorage.getItem("co.epoca") === String(APP.epocaLanzamiento),
      viejasLeidas: durante.filter((v) => v != null).length,
      totalLecturas: durante.length,
      // Y la sesión no se toca.
      sesionIntacta: Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k))
                     || !Object.keys(localStorage).some((k) => /^sb-/.test(k)),
    };
  });
  if (r.sembrado !== 3) {
    mal("N", "Durante la purga no se lee caché vieja", `sólo se sembraron ${r.sembrado}/3`);
  } else if (!r.purgado) {
    mal("N", "Durante la purga no se lee caché vieja", "la purga no llegó a ejecutarse");
  } else if (r.viejasLeidas > 0) {
    mal("N", "Durante la purga no se lee caché vieja",
      `${r.viejasLeidas} de ${r.totalLecturas} lecturas vieron el dato viejo`);
  } else {
    ok("N", "Durante la purga no se lee caché vieja",
      `${r.totalLecturas} lecturas concurrentes, 0 vieron lo viejo`);
  }
  if (r.epocaGuardada) ok("N2", "La época queda anotada tras purgar");
  else mal("N2", "La época queda anotada tras purgar", "no se guardó co.epoca");
  await ctx.close();
}

/* -------- CASO Ñ · el arranque ESPERA la purga -------- */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(async () => {
    const src = await fetch("/js/main.js").then((x) => x.text());
    const api = await fetch("/js/data/api.js").then((x) => x.text());
    return {
      // El patrón viejo: llamada con .catch y sin esperarla.
      sueltaSinEsperar: /^\s*revisarEpocaDeLanzamiento\(\)\s*\.catch/m.test(src),
      esperada: /await[\s\S]{0,500}revisarEpocaDeLanzamiento\(\)/.test(src),
      // Sólo el cuerpo de getDisponibilidad: otras funciones sí usan
      // caché, y con razón. Aquí lo que no puede haber es una lectura.
      apiLeeCacheDisp: (() => {
        const i = api.indexOf("export async function getDisponibilidad(");
        const j = api.indexOf("export async function getDisponibilidadMapa(");
        const k = api.indexOf("export function invalidarDisponibilidad(");
        if (i < 0 || j < 0 || k < 0) return true;   // cambió la forma: mejor fallar
        return /cache\.leer\(/.test(api.slice(i, k));
      })(),
      // Y tampoco puede escribirla: si el dato existe, alguien lo leerá.
      apiEscribeCacheDisp: (() => {
        const i = api.indexOf("export async function getDisponibilidad(");
        const k = api.indexOf("export function invalidarDisponibilidad(");
        if (i < 0 || k < 0) return true;
        return /cache\.guardar\(/.test(api.slice(i, k));
      })(),
    };
  });
  const bien = !r.sueltaSinEsperar && r.esperada
    && !r.apiLeeCacheDisp && !r.apiEscribeCacheDisp;
  if (bien) ok("Ñ", "Arranque espera la purga · disponibilidad sin caché alguna");
  else mal("Ñ", "Arranque espera la purga · disponibilidad sin caché alguna",
    `suelta=${r.sueltaSinEsperar} esperada=${r.esperada} lee=${r.apiLeeCacheDisp} escribe=${r.apiEscribeCacheDisp}`);
  await ctx.close();
}

/* -------- CASO H · overrides no pueden resucitar pasarelas retiradas -------- */
{
  const { p, ctx } = await pagina();
  await p.addInitScript(() => {
    window.__APP_CONFIG__ = {
      payments: {
        order: ["stripe", "paypal", "transferencia", "mercadopago", "clip"],
        stripe: { enabled: true, publishableKey: "valor-publico-ignorado" },
        paypal: { enabled: true, clientId: "fake" },
        transferencia: { enabled: true, banco: "X", beneficiario: "Y", clabe: "012345678901234567" },
        mercadopago: { enabled: true, publicKey: "fake" },
        clip: { enabled: true },
      },
    };
  });
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(600);
  const ids = await p.evaluate(async () => {
    const pagos = await import("/js/payments/index.js");
    return (await pagos.metodosDisponibles()).map((m) => m.id);
  });
  if (ids.length === 1 && ids[0] === "clip") ok("H", "Un override hostil no resucita pasarelas retiradas");
  else mal("H", "Un override hostil no resucita pasarelas retiradas", ids.join(", "));
  await ctx.close();
}

/* -------- CASO Q · ninguna llamada del catálogo deja la pantalla en blanco
 *
 * El principio del archivo api.js es que la primera pantalla NUNCA se
 * espera a la red: cada consulta compite contra un cronómetro de 600 ms
 * y, si pierde, se pinta con el plano local. `getEdificios()` era la
 * única que no lo hacía —ni caché, ni tope en la consulta, ni carrera— y
 * el mapa 3D depende de ella para saber las medidas del edificio: con el
 * backend inalcanzable tardaba 3,5 s en vez de 0,6 s.
 *
 * Aquí el backend NO es alcanzable, que es justo el caso a medir.
 */
{
  const { p, ctx } = await pagina();
  // Una vista estática y con recarga: en la portada el router sigue
  // navegando y tumba el contexto a mitad de la medición.
  await p.goto(`${BASE}/index.html#/nosotros`, { waitUntil: "domcontentloaded" });
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    const api = (await import("/js/data/api.js")).default;
    const cron = async (fn) => {
      const t = performance.now();
      try { await fn(); } catch { /* da igual: se mide lo que tarda en rendirse */ }
      return Math.round(performance.now() - t);
    };
    return {
      espacios: await cron(() => api.getEspacios({ forzar: true })),
      edificios: await cron(() => api.getEdificios()),
      sedes: await cron(() => api.getSedes?.()),
    };
  });
  // 1,5 s de margen sobre los 600 ms de diseño: sobra para el arranque
  // del módulo y sigue detectando una espera de varios segundos.
  const TOPE = 1500;
  const lentas = Object.entries(r).filter(([, ms]) => ms > TOPE);
  const detalle = Object.entries(r).map(([k, v]) => `${k} ${v}ms`).join(" · ");
  if (!lentas.length) ok("Q", "Ninguna consulta del catálogo bloquea la pantalla", detalle);
  else mal("Q", "Ninguna consulta del catálogo bloquea la pantalla", `${detalle} — tope ${TOPE}ms`);
  await ctx.close();
}

/* -------- CASO P · la versión del service worker acompaña a la app ----
 *
 * El fallo silencioso más caro de una PWA: se despliega código nuevo, no
 * se toca VERSION en sw.js, y todo el que ya tenía la app instalada
 * sigue ejecutando el JS viejo desde la caché del shell. No hay error,
 * no hay pantalla en blanco: simplemente los arreglos no llegan y nadie
 * entiende por qué. Atar las dos versiones convierte ese despiste en una
 * prueba roja.
 */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(800);
  const r = await p.evaluate(async () => {
    const { APP } = await import("/js/core/config.js");
    const sw = await (await fetch("/sw.js")).text();
    const m = /const VERSION = "v?([\d.]+)"/.exec(sw);
    return { app: APP.version, sw: m?.[1] || null };
  });
  if (r.sw && r.app === r.sw) ok("P", "sw.js y APP.version van a la par", `v${r.app}`);
  else mal("P", "sw.js y APP.version van a la par",
    `app=${r.app} sw=${r.sw ?? "no encontrada"} — sube VERSION en sw.js`);
  await ctx.close();
}

/* -------- CASO S · Clip: sin credenciales en el navegador --------
 *
 * Clip no tiene llave pública: su API se autentica con
 * Basic API_KEY:SECRET, y las dos son secretas. Eso significa que un
 * despiste —«lo pongo en config.js para probar»— no es una llave
 * publicable expuesta de más, es la llave con la que se cobra y se
 * reembolsa, servida en un archivo estático a cualquiera que abra el
 * navegador.
 *
 * Se comprueba lo que de verdad importa: que el módulo de Clip no
 * exporte ni contenga credencial alguna, y que la configuración pública
 * sólo tenga la bandera de encendido.
 */
{
  const { p, ctx } = await pagina();
  await p.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(async () => {
    const cfg = await import("/js/core/config.js");
    const fuente = await (await fetch("/js/payments/clip.js")).text();
    const configFuente = await (await fetch("/js/core/config.js")).text();
    // Cualquier cosa con pinta de llave o secreto de Clip.
    const sospechoso = /CLIP_(API|SECRET)_KEY\s*[:=]\s*["'][^"']+["']|secret[_-]?key\s*[:=]\s*["'][^"']{8,}/i;
    return {
      clavesEnConfig: Object.keys(cfg.PAYMENTS.clip ?? {}),
      credencialEnModulo: sospechoso.test(fuente),
      credencialEnConfig: sospechoso.test(configFuente),
      llamaAlServidor: /invocarFuncion\(\s*["']pagos-clip/.test(fuente),
    };
  });
  const soloBandera = r.clavesEnConfig.length === 1 && r.clavesEnConfig[0] === "enabled";
  if (soloBandera && !r.credencialEnModulo && !r.credencialEnConfig && r.llamaAlServidor) {
    ok("S", "Clip no expone credenciales en el navegador", "sólo la bandera 'enabled'");
  } else {
    mal("S", "Clip no expone credenciales en el navegador",
      `config=${r.clavesEnConfig.join("|")} moduloSucio=${r.credencialEnModulo} configSucio=${r.credencialEnConfig} llamaServidor=${r.llamaAlServidor}`);
  }
  await ctx.close();
}

/* -------- CASO S2 · Clip aparece sólo cuando se enciende -------- */
{
  const apagado = await idsDePago({ payments: { clip: { enabled: false } } });
  const encendido = await idsDePago({ payments: { clip: { enabled: true } } });
  if (!apagado.includes("clip") && encendido.includes("clip")) {
    ok("S2", "Clip se ofrece sólo con enabled=true", `apagado: ${apagado.join(", ")} · encendido: ${encendido.join(", ")}`);
  } else {
    mal("S2", "Clip se ofrece sólo con enabled=true",
      `apagado: ${apagado.join(", ")} · encendido: ${encendido.join(", ")}`);
  }
}

/* -------- CASO R · la primera visita no se recarga sola --------
 *
 * `controllerchange` no significa sólo «hay versión nueva»: también
 * salta la PRIMERA vez que un service worker reclama una página que no
 * tenía ninguno, y el sw.js hace skipWaiting + clients.claim. Recargar
 * ahí hace que la app arranque, se descarte y vuelva a arrancar.
 *
 * No da ningún error, así que se cuela con facilidad: sólo se nota como
 * un parpadeo y el doble de descarga en cada visita nueva. Y si pasa
 * mientras alguien escribe o paga, se lleva su estado por delante.
 * Además tumbaba esta misma suite: el evaluate de otro caso moría con
 * «Execution context was destroyed» cuando la recarga le caía encima.
 */
{
  const ctx = await b.newContext({ viewport: { width: 900, height: 800 }, locale: "es-MX" });
  const p = await ctx.newPage();
  // Un contador que sobrevive a location.reload().
  await p.addInitScript(() => {
    localStorage.setItem("co.tutorial.visto", "1");
    sessionStorage.setItem("__cargas", String(Number(sessionStorage.getItem("__cargas") || 0) + 1));
  });
  await p.goto(`${BASE}/index.html#/`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(7000);
  const r = await p.evaluate(() => ({
    cargas: Number(sessionStorage.getItem("__cargas") || 0),
    controlada: Boolean(navigator.serviceWorker.controller),
  }));
  if (r.cargas === 1 && r.controlada) {
    ok("R", "La primera visita no se recarga sola", "1 ejecución · SW activo");
  } else if (!r.controlada) {
    mal("R", "La primera visita no se recarga sola", "el service worker no llegó a tomar el control");
  } else {
    mal("R", "La primera visita no se recarga sola", `el documento se ejecutó ${r.cargas} veces`);
  }
  await ctx.close();
}

await b.close();

console.log("========================================================");
console.log(" PRE-LANZAMIENTO");
console.log("========================================================");
for (const r of res) {
  console.log(`[${r.v === "PASA" ? "✓" : "✗"}] ${`${r.id}  ${r.n}`.padEnd(50).slice(0, 50)} ${r.d}`);
}
const fallan = res.filter((r) => r.v !== "PASA").length;
console.log("");
console.log(` RESULTADO: ${res.length - fallan}/${res.length} PASA${fallan ? ` · ${fallan} FALLA` : ""}`);
console.log("========================================================");
process.exit(fallan ? 1 : 0);
