/* ======================================================================
   zona-horaria.mjs — Las horas son las del EDIFICIO, no las del móvil.

   Smart Hub opera en America/Tijuana, que cambia de horario dos veces al
   año. Los bloques (08:00–19:00) son horas del edificio: reservar «las
   ocho» tiene que guardar el mismo instante real venga la petición de
   donde venga.

   Esto ya falló una vez: combinarFechaHora() usaba setHours(), que
   interpreta la hora en la zona del dispositivo. Desde Madrid, reservar
   «08:00» guardaba una hora distinta según el dispositivo.
   ====================================================================== */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8099";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const res = [];
const chk = (ok, n, d = "") => res.push({ n, v: ok ? "PASA" : "FALLA", d });

/** Calcula un rango de bloque dentro del navegador, con esa zona puesta. */
async function enDispositivo(tz, fecha, bloque) {
  const p = await b.newPage({ timezoneId: tz, locale: "es-MX" });
  try {
    await p.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(900);
    return await p.evaluate(async ([f, bl]) => {
      const { rangoBloque } = await import("/js/core/utils.js");
      const { inicio, fin } = rangoBloque(f, bl);
      return { inicio: inicio.toISOString(), fin: fin.toISOString() };
    }, [fecha, bloque]);
  } finally { await p.close(); }
}

/** Qué hora marca el reloj de Tijuana en ese instante. */
const horaEnTijuana = (iso) => new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Tijuana", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(iso));

const ZONAS = ["America/Tijuana", "America/Mexico_City", "Europe/Madrid", "Asia/Tokyo", "UTC"];

/* ---- 1. El mismo bloque desde cualquier dispositivo ---- */
{
  const salidas = [];
  for (const tz of ZONAS) salidas.push((await enDispositivo(tz, "2026-09-15", "08:00-09:00")).inicio);
  const iguales = new Set(salidas).size === 1;
  chk(iguales, "misma reserva desde 5 zonas → el mismo instante",
    iguales ? salidas[0] : salidas.join(" ≠ "));
  chk(horaEnTijuana(salidas[0]) === "08:00",
    "y ese instante son las 08:00 en el edificio", horaEnTijuana(salidas[0]));
}

/* ---- 2. Horario de verano (abril–octubre) ---- */
{
  // 15 de julio: Baja California está en horario de verano (UTC−7).
  const verano = await enDispositivo("UTC", "2026-07-15", "08:00-09:00");
  chk(horaEnTijuana(verano.inicio) === "08:00",
    "en horario de verano siguen siendo las 08:00", `${verano.inicio} → ${horaEnTijuana(verano.inicio)}`);

  // 15 de enero: horario estándar (UTC−8).
  const invierno = await enDispositivo("UTC", "2026-01-15", "08:00-09:00");
  chk(horaEnTijuana(invierno.inicio) === "08:00",
    "en horario estándar también son las 08:00", `${invierno.inicio} → ${horaEnTijuana(invierno.inicio)}`);

  // Y el desfase entre ambos tiene que ser justo de una hora.
  const dif = Math.abs(
    (new Date(verano.inicio).getUTCHours()) - (new Date(invierno.inicio).getUTCHours()));
  chk(dif === 1, "el cambio de horario mueve el instante UTC exactamente 1 h", `${dif} h`);
}

/* ---- 3. Los días del cambio de horario ---- */
for (const [fecha, etiqueta] of [
  ["2026-04-05", "el día que entra el horario de verano"],
  ["2026-10-25", "el día que sale el horario de verano"],
]) {
  const r = await enDispositivo("UTC", fecha, "08:00-09:00");
  const unaHora = (new Date(r.fin) - new Date(r.inicio)) === 3600000;
  chk(horaEnTijuana(r.inicio) === "08:00" && unaHora,
    `${etiqueta}: 08:00 y dura 1 h`,
    `${horaEnTijuana(r.inicio)} · ${(new Date(r.fin) - new Date(r.inicio)) / 3600000} h`);
}

/* ---- 4. «Hoy» es hoy en el edificio ----
 *
 * De poco sirve anclar las HORAS si el DÍA lo pone el teléfono: a las 10
 * de la mañana en Tokio son las 18:00 del día anterior en Tijuana, así
 * que el calendario abría en un día que en el edificio aún no había
 * llegado, y la rejilla mostraba disponibilidad de otra fecha. */
{
  const dias = [];
  for (const tz of ZONAS) {
    const p = await b.newPage({ timezoneId: tz, locale: "es-MX" });
    await p.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(900);
    dias.push(await p.evaluate(async () => (await import("/js/core/utils.js")).isoFecha()));
    await p.close();
  }
  const enElEdificio = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const todosIguales = new Set(dias).size === 1;
  chk(todosIguales && dias[0] === enElEdificio,
    "«hoy» es el mismo día desde las 5 zonas, y es el del edificio",
    todosIguales ? dias[0] : dias.join(" ≠ "));
}

/* ---- 5. La tira de días empieza en el día del edificio ----
 *
 * hoy0() daba la medianoche del DISPOSITIVO. Con un aparato por detrás
 * del huso del edificio y ya de noche —Hawái a las 23:30, que en Tijuana
 * son las 02:30 del día siguiente— la tira abría un día tarde. Y la suma
 * se hacía en horas, no en días de calendario: 24 h el día del cambio de
 * horario son 23 o 25, así que la tira podía repetir o saltarse un día. */
{
  const p = await b.newPage({ timezoneId: "Pacific/Honolulu", locale: "es-MX" });
  await p.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(900);
  const dias = await p.evaluate(async () => {
    const { rangoDias, isoFecha } = await import("/js/core/utils.js");
    return rangoDias(7).map((d) => isoFecha(d));
  });
  await p.close();

  const hoyEdificio = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  // Siete días distintos, consecutivos, empezando por hoy en el edificio.
  const consecutivos = dias.every((d, i) => {
    if (i === 0) return true;
    const previo = new Date(`${dias[i - 1]}T00:00:00Z`);
    return d === new Date(previo.getTime() + 86400000).toISOString().slice(0, 10);
  });
  chk(dias[0] === hoyEdificio && new Set(dias).size === 7 && consecutivos,
    "la tira de días abre en hoy del edificio y no repite ni salta",
    `${dias[0]} … ${dias.at(-1)}`);
}

/* ---- 6. El último bloque del día no se va al día siguiente ---- */
{
  const r = await enDispositivo("Asia/Tokyo", "2026-09-15", "18:00-19:00");
  const dia = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(r.inicio));
  chk(dia === "2026-09-15" && horaEnTijuana(r.inicio) === "18:00",
    "el último bloque sigue cayendo el mismo día", `${dia} ${horaEnTijuana(r.inicio)}`);
}

await b.close();

console.log("========================================================");
console.log(" ZONA HORARIA · America/Tijuana");
console.log("========================================================");
for (const r of res) {
  console.log(`[${r.v === "PASA" ? "✓" : "✗"}] ${r.n.padEnd(50).slice(0, 50)} ${r.d}`);
}
const fallan = res.filter((r) => r.v !== "PASA").length;
console.log("");
console.log(` RESULTADO: ${res.length - fallan}/${res.length} PASA${fallan ? ` · ${fallan} FALLA` : ""}`);
console.log("========================================================");
process.exit(fallan ? 1 : 0);
