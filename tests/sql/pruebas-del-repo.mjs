/* ======================================================================
   pruebas-del-repo.mjs — Corre los .sql de prueba que ya vienen en
   supabase/ y traduce su salida a un resultado que el harness entienda.

   Por qué hacía falta
   -------------------
   El repositorio ya traía tres tandas de pruebas en SQL puro
   —restricciones, seguridad y caducidad— y no las ejecutaba nadie: no
   estaban en ningún script ni en ninguna instrucción. Un fichero de
   pruebas que nadie lanza es documentación, no una prueba.

   Al correrlas por primera vez, la de caducidad falló con
   «column expira_en does not exist»: resultó que supabase/caducidad.sql
   no estaba en la secuencia de instalación de ningún sitio, y la Edge
   Function de pagos lee esa columna. Con eso, el webhook de un cobro
   real habría reventado en una instalación nueva.

   Cada .sql corre dentro de su propia transacción y termina en ROLLBACK,
   así que no dejan nada detrás.
   ====================================================================== */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const ejecutar = promisify(execFile);
const RAIZ = resolve(import.meta.dirname, "../..");
const PGURL = process.env.PGURL || "postgres://postgres@localhost:5433/app";

const TANDAS = [
  ["restricciones", "supabase/pruebas-restricciones.sql"],
  ["seguridad", "supabase/pruebas-seguridad.sql"],
  ["caducidad", "supabase/pruebas-caducidad.sql"],
];

const res = [];

for (const [nombre, archivo] of TANDAS) {
  let salida = "";
  try {
    const r = await ejecutar("psql", [PGURL, "-f", `${RAIZ}/${archivo}`], { maxBuffer: 8 << 20 });
    salida = r.stdout + r.stderr;
  } catch (e) {
    salida = `${e.stdout || ""}${e.stderr || ""}`;
  }

  // Un ERROR de psql tumba la tanda entera: se mira siempre, aunque el
  // resumen final diga que todo pasó.
  const errores = salida.split("\n").filter((l) => /^psql:.*ERROR:/.test(l));
  const fallos = salida.split("\n").filter((l) => /\bFALLA\b/.test(l));
  const paso = /TODAS LAS PRUEBAS .* PASARON/.test(salida);
  const cuenta = /\((\d+)\/(\d+)\)/.exec(salida);

  if (errores.length) {
    res.push({ nombre, v: "FALLA", d: errores[0].replace(/^psql:[^:]*:\d+:\s*/, "").slice(0, 64) });
  } else if (fallos.length) {
    res.push({ nombre, v: "FALLA", d: `${fallos.length} caso(s): ${fallos[0].trim().slice(0, 48)}` });
  } else if (paso) {
    res.push({ nombre, v: "PASA", d: cuenta ? `${cuenta[1]}/${cuenta[2]}` : "todas" });
  } else {
    // Ni resumen de éxito ni errores: no se ejecutó lo que creíamos.
    res.push({ nombre, v: "FALLA", d: "sin resumen — ¿se ejecutó de verdad?" });
  }
}

console.log("========================================================");
console.log(" PRUEBAS SQL DEL REPOSITORIO");
console.log("========================================================");
for (const r of res) {
  console.log(`[${r.v === "PASA" ? "✓" : "✗"}] ${r.nombre.padEnd(52)} ${r.d}`);
}
const fallan = res.filter((r) => r.v !== "PASA").length;
console.log("");
console.log(` RESULTADO: ${res.length - fallan}/${res.length} PASA${fallan ? ` · ${fallan} FALLA` : ""}`);
console.log("========================================================");
process.exit(fallan ? 1 : 0);
