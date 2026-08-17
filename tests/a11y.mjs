/* ======================================================================
   a11y.mjs — Accesibilidad y responsive, medidos.

   No sustituye a probar con un lector de pantalla de verdad, pero caza
   lo que se rompe solo y en silencio: una imagen sin alt, un botón que
   sólo es un icono y no dice nada, un <select> que el lector anuncia
   como «cuadro combinado» sin más, una vista sin <h1> —quien navega
   saltando de encabezado en encabezado se queda sin ancla— y el
   desbordamiento horizontal en pantallas pequeñas.

   Las siete vistas se miran en una pantalla de referencia; el
   desbordamiento, en seis tamaños desde un iPhone SE hasta un escritorio.
   ====================================================================== */
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const VISTAS = ["/", "/espacios", "/mapa", "/registro", "/legal/privacidad", "/ayuda", "/nosotros"];
const PANTALLAS = [
  ["iPhone SE", 375, 667], ["iPhone 15", 393, 852], ["Android chico", 360, 740],
  ["Tablet", 768, 1024], ["Laptop", 1366, 768], ["Desktop", 1920, 1080],
];

const problemas = [];

// ---- A11y sobre una pantalla de referencia ----
{
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, locale: "es-MX" });
  await p.addInitScript(() => localStorage.setItem("co.tutorial.visto", "1"));
  for (const v of VISTAS) {
    await p.goto(`http://localhost:8099/index.html#${v}`, { waitUntil: "domcontentloaded" });
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForTimeout(v === "/mapa" ? 7000 : 2200);
    const r = await p.evaluate(() => {
      const vis = (e) => e.offsetParent !== null || e.getClientRects().length;
      const nombre = (e) => (e.getAttribute("aria-label") || e.getAttribute("title") ||
        e.textContent.trim() || e.querySelector("img[alt]")?.alt || "").trim();
      const imgs = [...document.querySelectorAll("img")].filter(vis).filter(i => i.getAttribute("alt") === null);
      const btns = [...document.querySelectorAll("button, a[href]")].filter(vis).filter(e => !nombre(e));
      const inputs = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(vis)
        .filter(i => !i.labels?.length && !i.getAttribute("aria-label") && !i.getAttribute("aria-labelledby") && !i.getAttribute("placeholder"));
      const h1 = document.querySelectorAll("h1").length;
      return {
        imgSinAlt: imgs.length,
        ctrlSinNombre: btns.length,
        ejemploCtrl: btns.slice(0,2).map(e => e.outerHTML.slice(0,70)),
        inputSinEtiqueta: inputs.length,
        h1,
      };
    });
    const lineas = [];
    if (r.imgSinAlt) lineas.push(`${r.imgSinAlt} img sin alt`);
    if (r.ctrlSinNombre) lineas.push(`${r.ctrlSinNombre} controles sin nombre`);
    if (r.inputSinEtiqueta) lineas.push(`${r.inputSinEtiqueta} campos sin etiqueta`);
    if (r.h1 !== 1) lineas.push(`${r.h1} <h1>`);
    console.log(`  ${v.padEnd(20)} ${lineas.length ? "⚠  " + lineas.join(" · ") : "✅ limpio"}`);
    if (r.ejemploCtrl?.length) r.ejemploCtrl.forEach(x => console.log(`       ↳ ${x}`));
    if (lineas.length) problemas.push(`${v}: ${lineas.join(", ")}`);
  }
  await p.close();
}

// ---- Desbordamiento horizontal ----
console.log("\n── desbordamiento horizontal ──");
for (const [nombre, w, h] of PANTALLAS) {
  const p = await b.newPage({ viewport: { width: w, height: h }, locale: "es-MX" });
  await p.addInitScript(() => localStorage.setItem("co.tutorial.visto", "1"));
  const malas = [];
  for (const v of ["/", "/espacios", "/registro", "/legal/terminos"]) {
    await p.goto(`http://localhost:8099/index.html#${v}`, { waitUntil: "domcontentloaded" });
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForTimeout(1500);
    const desborda = await p.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (desborda) malas.push(v);
  }
  console.log(`  ${nombre.padEnd(15)} ${w}×${h}  ${malas.length ? "⚠  desborda en " + malas.join(", ") : "✅"}`);
  if (malas.length) problemas.push(`${nombre}: desborda en ${malas.join(", ")}`);
  await p.close();
}

console.log("\n" + "═".repeat(50));
console.log(problemas.length
  ? ` RESULTADO: ${problemas.length} FALLA\n   - ` + problemas.join("\n   - ")
  : " RESULTADO: sin problemas de accesibilidad ni de desbordamiento");
console.log("═".repeat(50));
await b.close();
process.exit(problemas.length ? 1 : 0);
