/* FASE 02 — Tanda completa de pruebas de autenticación.
 *
 *   node tests/auth/index.mjs [--estricto] [--sin-navegador]
 *
 * Ejecuta TODO: las de API y las de navegador, en un solo informe. Las
 * de navegador necesitan Playwright y la aplicación servida; si falta
 * cualquiera de las dos, salen OMITIDA en vez de tumbar la tanda.
 *
 * Con la llave de servicio en el entorno se ejecuta la matriz entera:
 *   export SUPABASE_SERVICE_ROLE_KEY=...     (o un .env, ya ignorado)
 *   export CORREO_CONOCIDO=alguien@ya-registrado.com
 *
 * CÓDIGOS DE SALIDA (pensados para CI)
 *   0  todo lo ejecutado pasó
 *   1  hubo al menos un FALLA o ERROR
 *   2  modo --estricto y quedaron pruebas OMITIDAS
 *
 * Una prueba OMITIDA nunca cuenta como aprobada. En `--estricto` ni
 * siquiera se tolera: es el modo para decir «FASE 02 cerrada».
 */
import { writeFileSync } from "node:fs";
import { casos, ejecutar, barrerCuentasDePrueba, HAY_SERVICIO, URL_BASE, PREFIJO }
  from "./_comun.mjs";

import "./sin-llave.mjs";
import "./registro.mjs";
import "./login.mjs";
import "./recovery.mjs";
import "./roles.mjs";
import "./abuso.mjs";

const ESTRICTO = process.argv.includes("--estricto");
const SIN_NAVEGADOR = process.argv.includes("--sin-navegador");

// Las de navegador se registran en el MISMO catálogo, para que la matriz
// del informe sea la matriz de verdad y no le falten filas.
if (!SIN_NAVEGADOR) {
  try {
    const mod = await import("./navegador.mjs");
    await mod.registrarCasosNavegador();
  } catch (e) {
    const { caso, grupo, OmitirPrueba } = await import("./_comun.mjs");
    grupo("Navegador");
    const motivo = /Cannot find package 'playwright'/.test(e.message)
      ? "falta Playwright (npm i -D playwright)"
      : e.message.slice(0, 90);
    for (const [id, nombre] of [
      ["AUTH-02c", "Correo inválido (cliente)"],
      ["AUTH-09", "Persistencia de sesión"],
      ["AUTH-10", "Logout"],
      ["AUTH-11", "Sesión expirada"],
    ]) caso(id, nombre, "A", async () => { throw new OmitirPrueba(motivo); });
  }
}

const ICONO = { PASA: "✓", FALLA: "✗", ERROR: "✗", OMITIDA: "–" };
const ANCHO = 44;
const lineas = [];
const decir = (t = "") => { lineas.push(t); console.log(t); };

decir("========================================================");
decir(" FASE 02 — AUTENTICACIÓN");
decir("========================================================");
decir(` Proyecto          : ${URL_BASE.replace(/^https:\/\//, "")}`);
decir(` Llave de servicio : ${HAY_SERVICIO ? "presente" : "AUSENTE (habrá omitidas)"}`);
decir(` Modo              : ${ESTRICTO ? "estricto (omitida = fallo)" : "normal"}`);
decir(` Fecha             : ${new Date().toISOString()}`);

// Arrastres de una tanda anterior que se cortara a medias.
if (HAY_SERVICIO) {
  const barrido = await barrerCuentasDePrueba();
  if (barrido.barridas) decir(` Limpieza previa   : ${barrido.barridas} cuentas de prueba borradas`);
}
decir("");

const resultados = [];
let categoriaImpresa = null;
for (const c of casos()) {
  if (c.categoria !== categoriaImpresa) {
    categoriaImpresa = c.categoria;
    decir(`── ${c.categoria} ${"─".repeat(Math.max(0, 52 - c.categoria.length))}`);
  }
  const r = await ejecutar(c);
  resultados.push(r);
  const etiqueta = `${r.id} ${r.nombre}`.padEnd(ANCHO).slice(0, ANCHO);
  const cola = r.veredicto === "PASA" ? r.detalle : `${r.veredicto}: ${r.detalle}`;
  decir(`[${ICONO[r.veredicto] || "?"}] ${etiqueta} ${cola}`);
}

const cuenta = (v) => resultados.filter((r) => r.veredicto === v).length;
const pasan = cuenta("PASA");
const fallan = cuenta("FALLA") + cuenta("ERROR");
const omitidas = cuenta("OMITIDA");

// ------------------------------------------------------------ resumen
decir("");
decir("========================================================");
decir(" FASE 02 — AUTH");
decir("");
decir(` PASS: ${pasan}`);
decir(` FAIL: ${fallan}`);
decir(` SKIP: ${omitidas}`);
decir("");

const porCategoria = new Map();
for (const r of resultados) {
  const c = porCategoria.get(r.categoria) || { pasa: 0, falla: 0, omitida: 0 };
  if (r.veredicto === "PASA") c.pasa++;
  else if (r.veredicto === "OMITIDA") c.omitida++;
  else c.falla++;
  porCategoria.set(r.categoria, c);
}
for (const [nombre, c] of porCategoria) {
  const estado = c.falla ? `FAIL (${c.falla})`
               : c.omitida ? `PARCIAL (${c.pasa} de ${c.pasa + c.omitida})`
               : "PASS";
  decir(` ${(nombre + ":").padEnd(30)} ${estado}`);
}

decir("");
if (fallan === 0 && omitidas === 0) {
  decir(" ✅ La parte automática de la FASE 02 está cerrada.");
  decir("    Falta sólo la comprobación manual de entrega de correo.");
} else if (fallan === 0) {
  decir(` ⚠️  Sin fallos, pero ${omitidas} pruebas no se pudieron ejecutar.`);
  decir("    Una prueba omitida NO es una prueba aprobada.");
  if (!HAY_SERVICIO) {
    decir("    Pon SUPABASE_SERVICE_ROLE_KEY en el entorno para ejecutarlas.");
  }
} else {
  decir(` ❌ ${fallan} ${fallan === 1 ? "prueba falla" : "pruebas fallan"}.`);
}
decir("========================================================");

// Limpieza final y aviso si algo quedó vivo.
if (HAY_SERVICIO) {
  const barrido = await barrerCuentasDePrueba();
  if (barrido.restantes) {
    decir(`\n⚠️  Quedaron ${barrido.restantes} cuentas de prueba sin borrar.`);
    decir(`   delete from auth.users where email like '${PREFIJO}%';`);
  } else if (barrido.barridas) {
    decir(`\n🧹 ${barrido.barridas} cuentas de prueba borradas. La base queda como estaba.`);
  }
}

try {
  writeFileSync(new URL("../../docs/FASE-02-SALIDA.txt", import.meta.url), lineas.join("\n") + "\n");
} catch { /* si no se puede escribir, da igual: ya salió por pantalla */ }

if (fallan > 0) process.exit(1);
if (ESTRICTO && omitidas > 0) process.exit(2);
process.exit(0);
