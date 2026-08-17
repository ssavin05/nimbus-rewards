/* AUTH-02c, 09, 10, 11 — Lo que sólo se ve en un navegador de verdad.
 *
 *   python3 -m http.server 8099        (en otra terminal)
 *   node tests/auth/navegador.mjs
 *
 * Con SUPABASE_SERVICE_ROLE_KEY se prueba además con una cuenta real;
 * sin ella se comprueban la validación del formulario y el manejo de
 * una sesión corrupta, que no necesitan cuenta.
 */
import {
  caso, grupo, HAY_SERVICIO, crearUsuarioListo, borrarUsuario, URL_BASE,
  OmitirPrueba, FalloPrueba,
} from "./_comun.mjs";

const BASE = process.env.BASE_PRUEBAS || "http://localhost:8099";
const EJECUTABLE = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium";
const resultados = [];
let navegador;

/* Los resultados se guardan aquí y luego cada caso registrado los
   reclama: así una misma comprobación sirve para el informe unificado
   y para la ejecución suelta de este archivo. */
const parte = new Map();
function anotar(id, nombre, veredicto, detalle = "") {
  parte.set(id, { veredicto, detalle });
  resultados.push({ id, nombre, veredicto, detalle });
}
function reclamar(id) {
  const r = parte.get(id);
  if (!r) throw new OmitirPrueba("no llegó a ejecutarse");
  if (r.veredicto === "OMITIDA") throw new OmitirPrueba(r.detalle);
  if (r.veredicto !== "PASA") throw new FalloPrueba(r.detalle);
  return r.detalle;
}

async function conPagina(fn, { almacenamiento = undefined } = {}) {
  const ctx = await navegador.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-MX",
    storageState: almacenamiento,
  });
  const pagina = await ctx.newPage();
  await pagina.addInitScript(() => localStorage.setItem("co.tutorial.visto", "1"));
  try { return await fn(pagina, ctx); } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------
async function auth02c() {
  // El formulario tiene que parar los correos malos ANTES de la red.
  await conPagina(async (pagina) => {
    const peticiones = [];
    pagina.on("request", (r) => {
      if (r.url().includes("/auth/v1/signup")) peticiones.push(r.url());
    });
    await pagina.goto(`${BASE}/#/login`, { waitUntil: "domcontentloaded" });
    await pagina.waitForTimeout(1200);

    const aRegistro = pagina.locator('[data-modo="registro"]').first();
    if (await aRegistro.count()) { await aRegistro.click(); await pagina.waitForTimeout(400); }

    const correo = pagina.locator('input[type="email"]').first();
    if (!(await correo.count())) return anotar("AUTH-02c", "Correo inválido (cliente)", "OMITIDA",
      "no se encontró el campo de correo");

    for (const malo of ["abc", "a@", "@b.com"]) {
      await correo.fill(malo);
      const pass = pagina.locator('input[type="password"]').first();
      if (await pass.count()) await pass.fill("ClaveDePrueba123");
      const enviar = pagina.locator('button[type="submit"]').first();
      if (await enviar.count()) await enviar.click();
      await pagina.waitForTimeout(500);
    }
    if (peticiones.length === 0) {
      anotar("AUTH-02c", "Correo inválido (cliente)", "PASA", "0 peticiones a /signup");
    } else {
      anotar("AUTH-02c", "Correo inválido (cliente)", "FALLA",
        `${peticiones.length} peticiones salieron con un correo inválido`);
    }
  });
}

// ---------------------------------------------------------------------
async function auth09y10() {
  if (!HAY_SERVICIO) {
    anotar("AUTH-09", "Persistencia de sesión", "OMITIDA", "hace falta service_role");
    anotar("AUTH-10", "Logout", "OMITIDA", "hace falta service_role");
    return;
  }
  const u = await crearUsuarioListo();
  try {
    // --- entrar y guardar el estado del navegador
    const estado = await conPagina(async (pagina, ctx) => {
      await pagina.goto(`${BASE}/#/login`, { waitUntil: "domcontentloaded" });
      await pagina.waitForTimeout(1200);
      await pagina.locator('input[type="email"]').first().fill(u.email);
      await pagina.locator('input[type="password"]').first().fill(u.password);
      await pagina.locator('button[type="submit"]').first().click();
      await pagina.waitForTimeout(3000);
      const hayToken = await pagina.evaluate(() =>
        Object.keys(localStorage).some((k) => /auth-token|supabase/i.test(k)));
      if (!hayToken) throw new Error("no se guardó ningún token tras entrar");
      return ctx.storageState();
    });

    // --- AUTH-09: navegador nuevo con el mismo almacenamiento
    await conPagina(async (pagina) => {
      await pagina.goto(`${BASE}/#/perfil`, { waitUntil: "domcontentloaded" });
      await pagina.waitForTimeout(3000);
      const texto = (await pagina.locator("#vista").innerText().catch(() => "")) || "";
      const enLogin = /iniciar sesión|crear cuenta/i.test(texto) && !/cerrar sesión/i.test(texto);
      if (enLogin) anotar("AUTH-09", "Persistencia de sesión", "FALLA",
        "al reabrir pide iniciar sesión otra vez");
      else anotar("AUTH-09", "Persistencia de sesión", "PASA", "la sesión sobrevive al reinicio");
    }, { almacenamiento: estado });

    // --- AUTH-10: salir, y comprobar que no vuelve
    const trasSalir = await conPagina(async (pagina, ctx) => {
      await pagina.goto(`${BASE}/#/ajustes`, { waitUntil: "domcontentloaded" });
      await pagina.waitForTimeout(2500);
      const salir = pagina.getByText(/cerrar sesión/i).first();
      if (await salir.count()) {
        await salir.click();
        await pagina.waitForTimeout(500);
        const confirmar = pagina.getByRole("button", { name: /cerrar sesión|sí|confirmar/i }).last();
        if (await confirmar.count()) await confirmar.click().catch(() => {});
        await pagina.waitForTimeout(2500);
      } else {
        await pagina.evaluate(() => window.location.hash = "#/salir");
        await pagina.waitForTimeout(2500);
      }
      return ctx.storageState();
    }, { almacenamiento: estado });

    await conPagina(async (pagina) => {
      await pagina.goto(`${BASE}/#/perfil`, { waitUntil: "domcontentloaded" });
      await pagina.waitForTimeout(2500);
      const quedaToken = await pagina.evaluate(() =>
        Object.keys(localStorage).filter((k) => /auth-token/i.test(k))
          .some((k) => (localStorage.getItem(k) || "").includes("access_token")));
      if (quedaToken) anotar("AUTH-10", "Logout", "FALLA", "el token sigue en localStorage");
      else anotar("AUTH-10", "Logout", "PASA", "sin token tras salir y reabrir");
    }, { almacenamiento: trasSalir });
  } finally {
    await borrarUsuario(u.id);
  }
}

// ---------------------------------------------------------------------
async function auth11() {
  // No hace falta cuenta: se falsifica un token caducado y se mira que
  // la aplicación reaccione en vez de quedarse colgada.
  await conPagina(async (pagina) => {
    const errores = [];
    pagina.on("pageerror", (e) => errores.push(e.message));

    await pagina.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
    await pagina.waitForTimeout(1500);

    await pagina.evaluate((url) => {
      const proyecto = new URL(url).hostname.split(".")[0];
      const falso = {
        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.caducado.firma-invalida",
        refresh_token: "caducado",
        expires_at: Math.floor(Date.now() / 1000) - 3600,
        token_type: "bearer",
        user: { id: "00000000-0000-0000-0000-000000000000", email: "caducado@ejemplo.mx" },
      };
      localStorage.setItem(`sb-${proyecto}-auth-token`, JSON.stringify(falso));
    }, URL_BASE);

    await pagina.goto(`${BASE}/#/mis-reservas`, { waitUntil: "domcontentloaded" });
    await pagina.waitForTimeout(4000);

    const texto = (await pagina.locator("#vista").innerText().catch(() => "")) || "";
    const colgada = texto.trim().length < 20 || /^cargando/i.test(texto.trim());
    const errorCrudo = /JWT|invalid claim|401|Unauthorized|\{"code"/i.test(texto);

    if (errores.length) {
      anotar("AUTH-11", "Sesión expirada", "FALLA", `excepción sin capturar: ${errores[0].slice(0, 70)}`);
    } else if (colgada) {
      anotar("AUTH-11", "Sesión expirada", "FALLA", "la pantalla se queda colgada");
    } else if (errorCrudo) {
      anotar("AUTH-11", "Sesión expirada", "FALLA", `se muestra el error crudo: ${texto.slice(0, 70)}`);
    } else {
      anotar("AUTH-11", "Sesión expirada", "PASA", "detectada y recuperada sin error crudo");
    }
  });
}

// ---------------------------------------------------------------------
/** ¿Está la aplicación servida en BASE? */
async function appDisponible() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

/** Corre las comprobaciones una sola vez y registra los cuatro casos. */
export async function registrarCasosNavegador() {
  const { chromium } = await import("playwright");
  grupo("Navegador");

  let yaCorrio = false;
  const correrUnaVez = async () => {
    if (yaCorrio) return;
    yaCorrio = true;
    if (!(await appDisponible())) {
      for (const [id, n] of [["AUTH-02c", ""], ["AUTH-09", ""], ["AUTH-10", ""], ["AUTH-11", ""]]) {
        anotar(id, n, "OMITIDA", `la aplicación no responde en ${BASE} (python3 -m http.server 8099)`);
      }
      return;
    }
    navegador = await chromium.launch({ executablePath: EJECUTABLE });
    try { await auth02c(); await auth09y10(); await auth11(); }
    finally { await navegador.close(); }
  };

  caso("AUTH-02c", "Correo inválido (cliente)", "A",
    async () => { await correrUnaVez(); return reclamar("AUTH-02c"); });
  caso("AUTH-09", "Persistencia de sesión", "A",
    async () => { await correrUnaVez(); return reclamar("AUTH-09"); });
  caso("AUTH-10", "Logout", "A",
    async () => { await correrUnaVez(); return reclamar("AUTH-10"); });
  caso("AUTH-11", "Sesión expirada", "A",
    async () => { await correrUnaVez(); return reclamar("AUTH-11"); });
}

/* Ejecución suelta:  node tests/auth/navegador.mjs
   (el informe completo sale de tests/auth/index.mjs) */
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(" FASE 02 — AUTENTICACIÓN (navegador)");
  console.log(` Aplicación : ${BASE}`);
  const { chromium } = await import("playwright");
  if (!(await appDisponible())) {
    console.log(`\n La aplicación no responde en ${BASE}.`);
    console.log(" Levántala con:  python3 -m http.server 8099");
    process.exit(2);
  }
  navegador = await chromium.launch({ executablePath: EJECUTABLE });
  try { await auth02c(); await auth09y10(); await auth11(); }
  finally { await navegador.close(); }
  for (const r of resultados) {
    const icono = { PASA: "✓", FALLA: "✗", OMITIDA: "–" }[r.veredicto] || "?";
    console.log(`[${icono}] ${`${r.id}  ${r.nombre}`.padEnd(46).slice(0, 46)} ` +
      (r.veredicto === "PASA" ? r.detalle : `${r.veredicto}: ${r.detalle}`));
  }
  const fallan = resultados.filter((r) => r.veredicto === "FALLA").length;
  console.log(` RESULTADO: ${resultados.filter((r) => r.veredicto === "PASA").length}/${resultados.length} PASA`);
  process.exit(fallan > 0 ? 1 : 0);
}
