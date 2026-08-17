/* Diagnóstico: confirma que V1 sólo conoce Clip y explica por qué puede
   estar oculto. No inspecciona ni imprime secretos.

     python3 -m http.server 8099
     node tests/diag-pagos.mjs
*/
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8099";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage();
const errs = [];
const consola = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => { if (/\[pagos\]/.test(m.text())) consola.push(m.text()); });

await p.goto(BASE + "/#/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1800);

const r = await p.evaluate(async () => {
  const cfg = await import("/js/core/config.js");
  const pagos = await import("/js/payments/index.js");
  const metodos = await pagos.metodosDisponibles();
  return {
    clipEnabled: cfg.PAYMENTS.clip?.enabled,
    orden: cfg.PAYMENTS.order,
    ajustes: Object.keys(cfg.getAjustes() || {}),
    hosting: Boolean(window.__APP_CONFIG__),
    visibles: metodos.map((m) => m.id),
  };
});

console.log(`  clip.enabled   : ${r.clipEnabled}`);
console.log(`  orden V1       : ${r.orden.join(", ")}`);
console.log(`  ajustes locales: ${r.ajustes.length ? r.ajustes.join(", ") : "ninguno"}`);
console.log(`  override hosting: ${r.hosting}`);
console.log(`  VISIBLES       : ${r.visibles.join(", ") || "(ninguno)"}`);
consola.forEach((c) => console.log("  " + c));
console.log(`  errores JS     : ${errs.length ? errs.slice(0, 2).join(" | ") : "ninguno"}`);

await b.close();
process.exit(errs.length ? 1 : 0);
