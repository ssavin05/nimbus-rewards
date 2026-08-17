/* ======================================================================
   correr.mjs — Lanza todas las suites y resume.

     npm test                 todas
     npm run test:e2e         sólo navegador
     npm run test:sql         sólo base de datos
     npm run test:security    sólo seguridad (cliente + base)

   Levanta el servidor estático él solo si no lo encuentra, y avisa —sin
   fallar— cuando una suite necesita algo que no está montado (PostgreSQL
   para las de SQL). Una suite que no se puede ejecutar se marca OMITIDA:
   nunca se cuenta como verde, que es como se cuelan los agujeros.

   NO incluye tests/auth/ a propósito. Esa tanda habla con el Supabase de
   VERDAD, no con la base local: dispara el freno a la fuerza bruta con
   ~31 intentos fallidos, gasta cupo del remitente de correo y crea
   cuentas de prueba. Correrla en cada cambio sería castigar producción.
   Va aparte, con intención:  npm run test:auth   (ver OWNER_ACTIONS §3)
   ====================================================================== */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");
const PUERTO = Number(process.env.PUERTO || 8099);
const BASE = `http://localhost:${PUERTO}`;
const PGURL = process.env.PGURL || "postgres://postgres@localhost:5433/app";

const argSolo = process.argv.indexOf("--solo");
const SOLO = argSolo > -1 ? process.argv[argSolo + 1] : null;

const SUITES = [
  // Barata y sin dependencias: la CSP autoriza cada script en línea por
  // hash. Si alguien edita uno y no regenera los hashes, el navegador lo
  // bloquea y la app no arranca EN PRODUCCIÓN, mientras que en local con
  // un servidor que no manda la cabecera puede pasar desapercibido.
  { id: "csp", grupos: ["e2e", "seguridad"], nombre: "Hashes de la CSP", cmd: ["node", "tools/csp.mjs", "--check"], necesita: "nada" },
  // También barata y sin dependencias. Vigila que el repositorio no se
  // contradiga: el catálogo vive en planta.js y en seed.sql, la lista de
  // migraciones en OWNER_ACTIONS, la secuencia de instalación en tres
  // guías. Cada vez que dos de esos sitios se separaron, el fallo llegó
  // a producción sin que ninguna prueba de código lo viera.
  { id: "coherencia", grupos: ["e2e", "seguridad"], nombre: "Coherencia del repositorio", cmd: ["node", "tests/coherencia.mjs"], necesita: "nada" },
  { id: "e2e", grupos: ["e2e", "seguridad"], nombre: "Pre-lanzamiento", cmd: ["node", "tests/prelanzamiento.mjs"], necesita: "web" },
  { id: "flujos", grupos: ["e2e"], nombre: "Flujos de usuario", cmd: ["node", "tools/prueba-flujos.mjs"], necesita: "web" },
  { id: "interaccion", grupos: ["e2e"], nombre: "Interacción y formularios", cmd: ["node", "tools/prueba-interaccion.mjs"], necesita: "web" },
  { id: "datos", grupos: ["e2e", "seguridad"], nombre: "Datos y validación", cmd: ["node", "tools/prueba-datos.mjs"], necesita: "web" },
  { id: "ataque", grupos: ["seguridad"], nombre: "Ataques desde el cliente", cmd: ["node", "tools/ataque-cliente.mjs"], necesita: "web" },
  { id: "a11y", grupos: ["e2e"], nombre: "Accesibilidad y responsive", cmd: ["node", "tests/a11y.mjs"], necesita: "web" },
  { id: "tz", grupos: ["e2e"], nombre: "Zona horaria del edificio", cmd: ["node", "tests/zona-horaria.mjs"], necesita: "web" },
  { id: "sql", grupos: ["sql", "seguridad"], nombre: "RLS, roles y concurrencia", cmd: ["node", "tests/sql/suite.mjs"], necesita: "pg" },
  { id: "sql-repo", grupos: ["sql", "seguridad"], nombre: "Restricciones, seguridad y caducidad", cmd: ["node", "tests/sql/pruebas-del-repo.mjs"], necesita: "pg" },
];

const elegidas = SUITES.filter((s) => !SOLO || s.grupos.includes(SOLO) || s.id === SOLO);
if (!elegidas.length) {
  console.error(`No hay ninguna suite para «${SOLO}». Usa: e2e, sql o seguridad.`);
  process.exit(2);
}

/* ---------------- servidor estático, si hace falta ---------------- */
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".glb": "model/gltf-binary",
  ".txt": "text/plain; charset=utf-8", ".sql": "text/plain; charset=utf-8",
};

async function servidorVivo() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1500);
    const r = await fetch(`${BASE}/index.html`, { signal: c.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

function levantarServidor() {
  const srv = createServer(async (req, res) => {
    try {
      const limpio = decodeURIComponent(req.url.split("?")[0]);
      // Sin salir de la raíz del proyecto.
      const ruta = join(RAIZ, limpio === "/" ? "index.html" : limpio);
      if (!ruta.startsWith(RAIZ)) { res.writeHead(403).end(); return; }
      const info = await stat(ruta);
      const archivo = info.isDirectory() ? join(ruta, "index.html") : ruta;
      const cuerpo = await readFile(archivo);
      res.writeHead(200, { "content-type": TIPOS[extname(archivo)] || "application/octet-stream" });
      res.end(cuerpo);
    } catch { res.writeHead(404).end("no está"); }
  });
  return new Promise((ok) => srv.listen(PUERTO, () => ok(srv)));
}

/* ---------------- ¿hay PostgreSQL montado? ---------------- */
async function pgVivo() {
  try {
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: PGURL, connectionTimeoutMillis: 2500 });
    await c.connect();
    await c.query("select 1 from public.espacios limit 1");
    await c.end();
    return true;
  } catch { return false; }
}

function ejecutar(cmd) {
  return new Promise((ok) => {
    const p = spawn(cmd[0], cmd.slice(1), {
      cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BASE, PGURL },
    });
    let salida = "";
    p.stdout.on("data", (d) => { salida += d; });
    p.stderr.on("data", (d) => { salida += d; });
    p.on("close", (codigo) => ok({ codigo, salida }));
  });
}

/* ---------------- a correr ---------------- */
let servidor = null;
if (elegidas.some((s) => s.necesita === "web") && !(await servidorVivo())) {
  servidor = await levantarServidor();
}
const hayPg = elegidas.some((s) => s.necesita === "pg") ? await pgVivo() : false;

const resultados = [];
for (const s of elegidas) {
  if (s.necesita === "pg" && !hayPg) {
    resultados.push({ ...s, estado: "OMITIDA", nota: "sin PostgreSQL — corre: npm run db:preparar" });
    console.log(`\n⏭  ${s.nombre} — OMITIDA (sin PostgreSQL en ${PGURL})`);
    continue;
  }
  console.log(`\n▶  ${s.nombre}`);
  const { codigo, salida } = await ejecutar(s.cmd);
  process.stdout.write(salida);
  // Las suites viejas terminan en 0 aunque encuentren cosas: se mira el
  // texto además del código de salida.
  const hallazgos = /🐛\s*(\d+)\s*hallazgo/.exec(salida);
  const fallos = /·\s*(\d+)\s*FALLA/.exec(salida);
  const mal = codigo !== 0 || (hallazgos && Number(hallazgos[1]) > 0) || (fallos && Number(fallos[1]) > 0);
  resultados.push({
    ...s,
    estado: mal ? "FALLA" : "PASA",
    nota: fallos ? `${fallos[1]} fallan` : hallazgos ? `${hallazgos[1]} hallazgos` : "",
  });
}

if (servidor) servidor.close();

console.log("\n════════════════════════════════════════════════════════");
console.log(" RESUMEN");
console.log("════════════════════════════════════════════════════════");
for (const r of resultados) {
  const icono = r.estado === "PASA" ? "✓" : r.estado === "OMITIDA" ? "–" : "✗";
  console.log(`[${icono}] ${r.nombre.padEnd(34)} ${r.estado.padEnd(8)} ${r.nota}`);
}
const fallan = resultados.filter((r) => r.estado === "FALLA").length;
const omitidas = resultados.filter((r) => r.estado === "OMITIDA").length;
console.log("");
console.log(` ${resultados.length - fallan - omitidas}/${resultados.length} suites en verde`
  + (omitidas ? ` · ${omitidas} omitida(s)` : "")
  + (fallan ? ` · ${fallan} FALLA` : ""));
console.log("════════════════════════════════════════════════════════");
process.exit(fallan ? 1 : 0);
