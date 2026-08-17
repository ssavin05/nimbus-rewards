/* ======================================================================
   coherencia.mjs — El repositorio no se contradice a sí mismo.

     node tests/coherencia.mjs

   No necesita navegador ni PostgreSQL: sólo lee archivos. Es la suite
   más barata de todas y cubre la clase de error que más veces ha
   mordido en este proyecto —dos sitios que dicen lo mismo y dejan de
   coincidir—:

     · el catálogo vivía en planta.js, en seed.sql y en la base, y los
       tres describían edificios distintos;
     · `caducidad.sql` faltaba en las secuencias de instalación de la
       documentación, así que quien seguía la guía montaba una base
       donde los apartados sin pagar NO caducan nunca;
     · las migraciones se iban acumulando y OWNER_ACTIONS.md seguía
       diciendo «hay tres».

   Ninguna de esas tres la habría atrapado una prueba de navegador ni
   una de base de datos: no son fallos de código, son fallos de verdad
   repetida. Por eso se comprueban aquí.
   ====================================================================== */
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { espaciosDelPlano } from "../js/data/planta.js";

const RAIZ = resolve(import.meta.dirname, "..");
const ESPACIOS = espaciosDelPlano();
const res = [];
const ok = (id, n, d = "") => res.push({ id, n, v: "PASA", d });
const mal = (id, n, d) => res.push({ id, n, v: "FALLA", d });

const leer = (rel) => readFile(join(RAIZ, rel), "utf8");

/* ---------------------------------------------------------------- A
   Toda secuencia de instalación documentada está completa.

   Se busca cualquier bloque de texto que mencione schema.sql y se exige
   que mencione también el resto. Un documento que enseña a montar la
   base a medias es peor que uno que no lo enseña: el resultado parece
   funcionar y falla semanas después.                                  */
const OBLIGATORIOS = [
  "schema.sql", "policies.sql", "seguridad.sql",
  "restricciones.sql", "caducidad.sql", "seed.sql",
];
const DOCS_CON_INSTALACION = [
  "README.md", "docs/CONFIGURACION.md", "docs/DATABASE.md",
];

/* Una guía menciona archivos .sql sueltos en prosa («las 69 restricciones
   están en supabase/restricciones.sql») y además trae la secuencia de
   instalación. Comparar el documento entero daría falsos positivos por
   esas menciones: lo que se revisa es la SECUENCIA, o sea el bloque
   donde los .sql aparecen seguidos. */
function secuenciaDeInstalacion(texto) {
  const lineas = texto.split("\n");
  const marcadas = [];
  lineas.forEach((l, i) => {
    const m = /supabase\/([a-z-]+\.sql)/.exec(l);
    if (m) marcadas.push({ i, archivo: m[1] });
  });
  const rachas = [];
  for (const m of marcadas) {
    const ultima = rachas.at(-1);
    if (ultima && m.i - ultima.at(-1).i <= 6) ultima.push(m);
    else rachas.push([m]);
  }
  return rachas.find((r) => r.some((m) => m.archivo === "schema.sql")) || [];
}

{
  const faltantes = [];
  for (const doc of DOCS_CON_INSTALACION) {
    const secuencia = secuenciaDeInstalacion(await leer(doc)).map((m) => m.archivo);
    if (!secuencia.length) { faltantes.push(`${doc} → no encontré la secuencia`); continue; }
    for (const f of OBLIGATORIOS) {
      if (!secuencia.includes(f)) faltantes.push(`${doc} → ${f}`);
    }
  }
  if (!faltantes.length) {
    ok("A", "Las guías de instalación listan los 6 .sql", DOCS_CON_INSTALACION.join(", "));
  } else {
    mal("A", "Las guías de instalación listan los 6 .sql", faltantes.join(" · "));
  }
}

/* ---------------------------------------------------------------- B
   El orden importa y está documentado en ese orden.
   restricciones.sql comprueba columnas que añade seguridad.sql; seed.sql
   inserta filas que esas restricciones validan.                        */
{
  const problemas = [];
  for (const doc of DOCS_CON_INSTALACION) {
    const secuencia = secuenciaDeInstalacion(await leer(doc)).map((m) => m.archivo);
    const esperado = OBLIGATORIOS.filter((f) => secuencia.includes(f));
    const real = secuencia.filter((f) => OBLIGATORIOS.includes(f));
    if (real.join(",") !== esperado.join(",")) problemas.push(`${doc}: ${real.join(" → ")}`);
  }
  if (!problemas.length) ok("B", "Y en el orden correcto", "schema → policies → seguridad → restricciones → caducidad → seed");
  else mal("B", "Y en el orden correcto", problemas.join(" · "));
}

/* ---------------------------------------------------------------- C
   Cada migración del repositorio aparece en OWNER_ACTIONS.md.

   Una migración que nadie sabe que existe es una migración que no se
   aplica. Ya pasó con la 05, la que arregla que los cobros no se
   registraran.                                                        */
{
  const archivos = (await readdir(join(RAIZ, "supabase")))
    .filter((f) => /^migracion-\d+.*\.sql$/.test(f)).sort();
  const owner = await leer("OWNER_ACTIONS.md");
  const sinDocumentar = archivos.filter((f) => !owner.includes(f.replace(/\.sql$/, "")));
  if (!sinDocumentar.length) {
    ok("C", "Cada migración está en OWNER_ACTIONS", `${archivos.length} migraciones`);
  } else {
    mal("C", "Cada migración está en OWNER_ACTIONS", `sin documentar: ${sinDocumentar.join(", ")}`);
  }
}

/* ---------------------------------------------------------------- D
   planta.js y seed.sql describen el mismo edificio.

   La suite SQL ya compara planta.js contra la BASE, pero necesita
   PostgreSQL. Esta comparación es textual y corre siempre: si alguien
   toca uno de los dos archivos y no el otro, se entera aquí y no tres
   pasos más tarde.                                                    */
{
  const seed = await leer("supabase/seed.sql");
  const problemas = [];
  for (const e of ESPACIOS) {
    if (!new RegExp(`'${e.codigo}'`).test(seed)) problemas.push(`${e.codigo} no está en seed.sql`);
  }
  const codigosSeed = new Set([...seed.matchAll(/'([A-Z]{2,4}-[A-Z0-9]{1,3})','/g)].map((m) => m[1]));
  for (const c of codigosSeed) {
    if (!ESPACIOS.some((e) => e.codigo === c)) problemas.push(`${c} sobra en seed.sql`);
  }
  if (!problemas.length) ok("D", "planta.js y seed.sql: mismos códigos", `${ESPACIOS.length} espacios`);
  else mal("D", "planta.js y seed.sql: mismos códigos", problemas.join(" · "));
}

/* ---------------------------------------------------------------- E
   Y coinciden en cuáles se rentan.

   Éste es el que evita volver a vender la cochera: `reservable` tiene
   que decir lo mismo en los dos sitios.                               */
{
  const seed = await leer("supabase/seed.sql");
  const problemas = [];
  for (const e of ESPACIOS) {
    // En seed.sql la fila del espacio lleva  …,<aforo>, <reservable>, '<estado>',
    const fila = new RegExp(`'${e.codigo}','[^']*','[^']*','[^']*',\\s*'[^']*',\\s*\\d+,\\s*(true|false)`, "s");
    const m = fila.exec(seed);
    if (!m) { problemas.push(`${e.codigo}: no pude leer su reservable en seed.sql`); continue; }
    const enSeed = m[1] === "true";
    if (enSeed !== e.reservable) {
      problemas.push(`${e.codigo}: planta=${e.reservable} seed=${enSeed}`);
    }
  }
  const enRenta = ESPACIOS.filter((e) => e.reservable).map((e) => e.codigo);
  if (!problemas.length) ok("E", "planta.js y seed.sql: mismos espacios en renta", enRenta.join(", "));
  else mal("E", "planta.js y seed.sql: mismos espacios en renta", problemas.join(" · "));
}

/* ---------------------------------------------------------------- F
   Lo que NO se renta no tiene precio.

   Un espacio fuera de catálogo con precio es una recaída esperando:
   basta que alguien vuelva a poner reservable=true para empezar a
   cobrar un número que nadie revisó.                                  */
{
  const conPrecio = ESPACIOS.filter((e) => !e.reservable && Number(e.precioHora) > 0);
  if (!conPrecio.length) ok("F", "Fuera del catálogo ⇒ precio 0", `${ESPACIOS.filter((e) => !e.reservable).length} espacios`);
  else mal("F", "Fuera del catálogo ⇒ precio 0", conPrecio.map((e) => `${e.codigo}=${e.precioHora}`).join(" · "));
}

/* ---------------------------------------------------------------- G
   La versión es una sola.

   El service worker borra las cachés que no llevan su VERSION. Si la
   suya y la de la app se separan, el usuario se queda con una mezcla de
   dos versiones y el fallo es imposible de reproducir en local.       */
{
  const pkg = JSON.parse(await leer("package.json"));
  const config = await leer("js/core/config.js");
  const sw = await leer("sw.js");
  const vConfig = /version:\s*pick\("app\.version",\s*"([^"]+)"\)/.exec(config)?.[1];
  const vSw = /const VERSION\s*=\s*"v?([^"]+)"/.exec(sw)?.[1];
  if (pkg.version === vConfig && vConfig === vSw) {
    ok("G", "package.json, config.js y sw.js: misma versión", pkg.version);
  } else {
    mal("G", "package.json, config.js y sw.js: misma versión",
      `package=${pkg.version} config=${vConfig} sw=${vSw}`);
  }
}

/* ---------------------------------------------------------------- H
   Ningún secreto de pasarela viaja al navegador.

   Clip no tiene llave pública: sus DOS credenciales son secretas. Si
   alguna aparece en js/ es que alguien intentó cobrar desde el cliente.
   Se mira el nombre de la variable, no su valor: el valor todavía no
   existe y el error se comete antes de tenerlo.                       */
{
  const PROHIBIDOS = [
    "CLIP_API_KEY", "CLIP_SECRET_KEY", "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET", "MP_ACCESS_TOKEN", "PAYPAL_SECRET",
    "VAPID_PRIVATE_KEY", "SERVICE_ROLE", "service_role",
  ];
  const hallazgos = [];
  async function recorrer(dir) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const ruta = join(dir, ent.name);
      if (ent.isDirectory()) { await recorrer(ruta); continue; }
      if (!ent.name.endsWith(".js")) continue;
      const texto = await readFile(ruta, "utf8");
      // Las menciones en comentarios son explicaciones, no fugas: lo que
      // importa es que el nombre aparezca en código ejecutable.
      const codigo = texto
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const p of PROHIBIDOS) {
        if (codigo.includes(p)) hallazgos.push(`${ruta.slice(RAIZ.length + 1)} → ${p}`);
      }
    }
  }
  await recorrer(join(RAIZ, "js"));
  if (!hallazgos.length) ok("H", "Ningún secreto de pasarela en js/", `${PROHIBIDOS.length} nombres vigilados`);
  else mal("H", "Ningún secreto de pasarela en js/", hallazgos.join(" · "));
}

/* ---------------------------------------------------------------- I
   Cada método de pago del orden tiene módulo, y cada módulo, ficha.  */
{
  const idx = await leer("js/payments/index.js");
  const config = await leer("js/core/config.js");
  const orden = /order:\s*pick\("payments\.order",\s*\[([^\]]+)\]/.exec(config)?.[1] || "";
  const metodos = [...orden.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const problemas = [];
  for (const m of metodos) {
    if (!new RegExp(`^\\s*${m}:`, "m").test(idx)) problemas.push(`${m}: sin módulo en MODULOS`);
    if (!new RegExp(`^\\s*${m}:\\s*\\{\\s*nombre`, "m").test(idx)) problemas.push(`${m}: sin ficha en META`);
  }
  if (!metodos.length) problemas.push("no pude leer PAYMENTS.order");
  if (!problemas.length) ok("I", "Cada método de pago tiene módulo y ficha", metodos.join(", "));
  else mal("I", "Cada método de pago tiene módulo y ficha", problemas.join(" · "));
}

/* ---------------------------------------------------------------- J
   Ninguna credencial de pasarela queda embebida en el repositorio.

   V1 sólo ofrece Clip y sus credenciales son exclusivamente de servidor.
   Los adaptadores históricos pueden conservarse, pero no deben traer
   llaves reales ni de prueba pegadas en el código.                    */
{
  const PATRONES = [
    [/pk_live_[A-Za-z0-9]/, "llave publishable LIVE de Stripe"],
    [/pk_test_[A-Za-z0-9]/, "llave publishable TEST de Stripe embebida"],
    [/sk_live_[A-Za-z0-9]/, "llave SECRETA LIVE de Stripe"],
    [/sk_test_[A-Za-z0-9]/, "llave secreta de Stripe (aunque sea de pruebas, no va aquí)"],
    [/whsec_[A-Za-z0-9]/, "secreto de webhook de Stripe"],
    [/APP_USR-[A-Za-z0-9]/, "credencial de producción de Mercado Pago"],
  ];
  const hallazgos = [];
  async function recorrer(dir) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const ruta = join(dir, ent.name);
      if (ent.isDirectory()) { await recorrer(ruta); continue; }
      if (!/\.(js|mjs|ts|json|html)$/.test(ent.name)) continue;
      const texto = await readFile(ruta, "utf8");
      for (const [re, que] of PATRONES) {
        if (re.test(texto)) hallazgos.push(`${ruta.slice(RAIZ.length + 1)} → ${que}`);
      }
    }
  }
  await recorrer(RAIZ);
  if (!hallazgos.length) ok("J", "Ninguna credencial de pasarela embebida", "Clip guarda sus secretos sólo en Supabase");
  else mal("J", "Ninguna credencial de pasarela embebida", hallazgos.join(" · "));
}

/* ---------------------------------------------------------------- K
   Clip: ni el código ni la documentación prometen un sandbox.

   Lo prometían. `CLIP_ENTORNO=pruebas` daba a entender que existía un
   entorno de pruebas para Checkout Redireccionado; no existe —el modo de
   prueba de Clip cubre Checkout Transparente, reembolsos y el SDK, y su
   documentación cierra la lista— y todas las llamadas seguían yendo al
   mismo `api.payclip.com`. Encima se guardaba `entorno: "pruebas"` en
   cada fila de `pagos`: cargos reales etiquetados como pruebas.

   Esta comprobación existe para que no vuelva a colarse.               */
{
  const fn = await leer("supabase/functions/pagos-clip/index.ts");
  const cliente = await leer("js/payments/clip.js");
  const problemas = [];
  /* Los comentarios de esta función explican precisamente el error que
     se corrigió, y citan lo que ya no se hace. Contarlos como hallazgo
     castigaría documentar la corrección: se mira el código. */
  const soloCodigo = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const codigo = soloCodigo(fn);

  if (/CLIP_ENTORNO/.test(codigo) || /CLIP_ENTORNO/.test(soloCodigo(cliente))) {
    problemas.push("CLIP_ENTORNO ha vuelto: no distingue nada, sólo miente");
  }
  // Un único host. Si aparece un segundo, alguien inventó un sandbox.
  const hosts = new Set([...codigo.matchAll(/https:\/\/[a-z0-9.-]*payclip\.com/g)].map((m) => m[0]));
  if (hosts.size > 1) problemas.push(`más de un host de Clip: ${[...hosts].join(", ")}`);
  // Y no se etiqueta como pruebas lo que se cobra de verdad.
  if (/entorno:\s*ENTORNO|entorno:\s*["']pruebas["']/.test(codigo)) {
    problemas.push("se guarda «entorno: pruebas» en un cobro real");
  }
  if (!problemas.length) ok("K", "Clip no promete un sandbox que no existe", [...hosts].join("") || "un solo host");
  else mal("K", "Clip no promete un sandbox que no existe", problemas.join(" · "));
}

/* ---------------------------------------------------------------- L
   Las rutas de Clip son las que Clip publica.

     POST https://api.payclip.com/v2/checkout
     GET  https://api.payclip.com/v2/checkout/{payment_request_id}
     POST https://api.payclip.com/refunds          ← sin /v2, a propósito

   La de consulta estuvo escrita sin `/v2`. Eso es un 404 permanente: el
   cliente paga, Clip cobra y la reserva no se confirma jamás, porque la
   verificación —que es la única cosa que confirma— nunca encuentra el
   checkout. No lo veía ninguna prueba porque ninguna llama a Clip.      */
{
  const fn = await leer("supabase/functions/pagos-clip/index.ts");
  const problemas = [];
  if (!/const CHECKOUT = "\/v2\/checkout"/.test(fn)) problemas.push("la ruta de checkout no es /v2/checkout");
  if (!/const REEMBOLSOS = "\/refunds"/.test(fn)) problemas.push("la ruta de reembolsos no es /refunds");
  // Ninguna llamada con la ruta escrita a mano: todas por la constante.
  const aMano = [...fn.matchAll(/clip\(\s*[`"']\/(?!\/)[^`"'$]*/g)]
    .map((m) => m[0].replace(/clip\(\s*[`"']/, ""))
    .filter((r) => r !== "/refunds");
  if (aMano.length) problemas.push(`rutas escritas a mano: ${aMano.join(", ")}`);
  // La verificación cuelga de CHECKOUT, no de una ruta suelta.
  if (!/clip\(`\$\{CHECKOUT\}\/\$\{encodeURIComponent/.test(fn)) {
    problemas.push("la verificación no consulta ${CHECKOUT}/{id}");
  }
  if (!problemas.length) ok("L", "Las rutas de Clip son las documentadas", "/v2/checkout · /v2/checkout/{id} · /refunds");
  else mal("L", "Las rutas de Clip son las documentadas", problemas.join(" · "));
}

/* ---------------------------------------------------------------- M
   Crear un cobro está frenado, y el freno va ANTES de llamar a Clip.

   Como no hay forma de cobrar «de mentira», el freno es lo único que
   separa un despliegue de pruebas de un cargo real a un cliente.       */
{
  const fn = await leer("supabase/functions/pagos-clip/index.ts");
  const problemas = [];
  if (!/CLIP_COBROS_REALES/.test(fn)) problemas.push("no existe el freno CLIP_COBROS_REALES");
  if (!/credencialDePruebas\s*\(\)/.test(fn)) problemas.push("no se detectan las credenciales test_");

  const posFreno = fn.indexOf("cobrosPermitidos()", fn.indexOf("CREAR CHECKOUT"));
  const posLlamada = fn.indexOf("clip(CHECKOUT");
  if (posFreno === -1) problemas.push("el freno no se comprueba en la ruta de crear checkout");
  else if (posLlamada > -1 && posFreno > posLlamada) problemas.push("el freno va DESPUÉS de llamar a Clip");

  if (!problemas.length) ok("M", "Cobrar exige encender el freno a mano", "CLIP_COBROS_REALES + credenciales reales");
  else mal("M", "Cobrar exige encender el freno a mano", problemas.join(" · "));
}

/* ---------------------------------------------------------------- N
   La documentación lo dice con todas las letras.

   Que el código sea honesto no sirve de nada si la guía que lee el dueño
   sigue diciéndole que pruebe «en modo pruebas».                       */
{
  const problemas = [];
  for (const doc of ["OWNER_ACTIONS.md", "docs/CONFIGURACION.md", "RELEASE_CHECKLIST.md", "SECURITY.md"]) {
    const texto = await leer(doc);
    if (/CLIP_ENTORNO/.test(texto) && !/ya no existe|Ya no existe/.test(texto)) {
      problemas.push(`${doc}: sigue documentando CLIP_ENTORNO`);
    }
    if (!/no tiene sandbox|sin sandbox|NO HAY SANDBOX|no hay sandbox/i.test(texto)) {
      problemas.push(`${doc}: no advierte de que no hay sandbox`);
    }
  }
  const owner = await leer("OWNER_ACTIONS.md");
  if (!/cargo real de importe mínimo|cobro real de importe mínimo/i.test(owner)) {
    problemas.push("OWNER_ACTIONS: no describe la prueba real de importe mínimo");
  }
  if (!problemas.length) ok("N", "La documentación advierte de que no hay sandbox", "4 documentos");
  else mal("N", "La documentación advierte de que no hay sandbox", problemas.join(" · "));
}


/* ---------------------------------------------------------------- O
   El runtime público de pagos es Clip y nada más. */
{
  const idx = await leer("js/payments/index.js");
  const config = await leer("js/core/config.js");
  const problemas = [];
  if (!/order:\s*pick\("payments\.order",\s*\["clip"\]\)/.test(config)) problemas.push("PAYMENTS.order no es sólo clip");
  for (const viejo of ["tarjeta", "stripe", "mercadopago", "paypal", "googlepay", "applepay", "transferencia"]) {
    if (new RegExp(`^\s*${viejo}:\s*\(\)\s*=>`, "m").test(idx)) problemas.push(`${viejo} sigue registrado en runtime`);
  }
  if (!problemas.length) ok("O", "V1 sólo puede ofrecer Clip", "registro runtime cerrado");
  else mal("O", "V1 sólo puede ofrecer Clip", problemas.join(" · "));
}

/* ---------------------------------------------------------------- P
   Volver de Clip realmente dispara la verificación; antes el código
   guardaba el payment_request_id pero nadie lo consumía. */
{
  const detalle = await leer("js/views/reserva-detalle.js");
  const problemas = [];
  if (!/pendienteGuardado/.test(detalle)) problemas.push("no lee el checkout pendiente");
  if (!/clip\.verificar\(pendiente\.payment_request_id\)/.test(detalle)) problemas.push("no verifica contra el servidor");
  if (!/olvidarPendiente/.test(detalle)) problemas.push("no limpia checkouts terminados");
  if (!problemas.length) ok("P", "El regreso de Clip se verifica", "reserva-detalle consume sessionStorage");
  else mal("P", "El regreso de Clip se verifica", problemas.join(" · "));
}

/* ---------------------------------------------------------------- Q
   Dos regresiones caras: teléfono vacío y reembolso controlado por el
   cliente. Ambas deben permanecer cerradas. */
{
  const schema = await leer("supabase/schema.sql");
  const clip = await leer("supabase/functions/pagos-clip/index.ts");
  const problemas = [];
  if (!/nullif\(btrim\(new\.raw_user_meta_data->>'telefono'\), ''\)/.test(schema)) problemas.push("teléfono vacío no se convierte a NULL");
  const reembolso = clip.slice(clip.indexOf('if (url.pathname.endsWith("/reembolso"))'), clip.indexOf('/* ======================================================================', clip.indexOf('if (url.pathname.endsWith("/reembolso"))')));
  if (/const\s*\{[^}]*monto[^}]*\}\s*=\s*await req\.json/.test(reembolso)) problemas.push("el cliente vuelve a controlar monto de reembolso");
  if (!/reserva\.monto_reembolso/.test(reembolso)) problemas.push("el reembolso no usa el monto autorizado por la base");
  if (/type:\s*["']transaction["']/.test(reembolso)) problemas.push("Clip refunds usa un reference.type no documentado: transaction");
  if (!/type:\s*["']payment["']/.test(reembolso) || !/type:\s*["']receipt["']/.test(reembolso)) problemas.push("falta fallback payment/receipt para reembolsos Clip");
  if (!/idempotency-key/.test(reembolso)) problemas.push("el reembolso Clip no manda idempotency-key");
  if (!problemas.length) ok("Q", "Auth y reembolsos mantienen sus guardas", "NULL + monto servidor + referencia Clip válida + idempotencia");
  else mal("Q", "Auth y reembolsos mantienen sus guardas", problemas.join(" · "));
}

/* ---------------------------------------------------------------- R
   El seed de una instalación NUEVA usa la misma geometría y metadatos
   comerciales que planta.js. Tener los mismos códigos no basta: ya hubo
   una versión con 24 códigos correctos y coordenadas/aforos viejos. */
{
  const seed = await leer("supabase/seed.sql");
  const problemas = [];
  const n = (v) => v == null ? "null" : String(v);
  const q = (v) => `'${String(v ?? "").replaceAll("'", "''")}'`;
  for (const e of ESPACIOS) {
    const prefijo = `(${q(e.codigo)}, ${q(e.nombre)}, ${q(e.tipo)}, ${q(e.icono)}, ${q(e.descripcion)}, ${e.capacidad}, ${e.reservable ? "true" : "false"}, ${n(e.precio_hora)}, ${n(e.precio_dia)}, ${n(e.pos_x)}, ${n(e.pos_y)}, ${n(e.ancho)}, ${n(e.fondo)}, ${n(e.altura)}, ${e.abierto ? "true" : "false"},`;
    if (!seed.includes(prefijo)) problemas.push(`${e.codigo}: canon ausente o distinto en seed.sql`);
  }
  if (!problemas.length) ok("R", "Seed nuevo = canon completo de planta.js", `${ESPACIOS.length} espacios · geometría + aforo + precio`);
  else mal("R", "Seed nuevo = canon completo de planta.js", problemas.join(" · "));
}

/* ---------------------------------------------------------------- S
   La cola offline no puede ejecutar reservas viejas. V1 sólo admite
   favoritos: una operación crítica diferida puede vender un horario
   minutos después de que la persona creyó que había fallado. */
{
  const sync = await leer("js/data/sync.js");
  const api = await leer("js/data/api.js");
  const problemas = [];
  if (!/TIPOS_SEGUROS\s*=\s*new Set\(\["fav_add", "fav_del"\]\)/.test(sync)) problemas.push("sync no limita la cola a favoritos");
  for (const peligroso of ["crear_reserva", "cancelar_reserva", "modificar_reserva", "resena", "perfil"]) {
    if (new RegExp(`case ["']${peligroso}["']`).test(sync)) problemas.push(`${peligroso} todavía se ejecuta desde la cola`);
  }
  const encoladas = [...api.matchAll(/cache\.encolar\(\{\s*tipo:\s*([^,}]+)/g)].map((m) => m[1]);
  if (encoladas.some((x) => !/fav_add|fav_del|activo/.test(x))) problemas.push(`api encola algo inesperado: ${encoladas.join(", ")}`);
  if (!problemas.length) ok("S", "Offline no vende ni mueve reservas a destiempo", "cola = favoritos solamente");
  else mal("S", "Offline no vende ni mueve reservas a destiempo", problemas.join(" · "));
}

/* ---------------------------------------------------------------- T
   Funciones externas incompletas no deben anunciarse en la interfaz. */
{
  const config = await leer("js/core/config.js");
  const login = await leer("js/views/login.js");
  const problemas = [];
  if (!/emailDeliveryEnabled:\s*pick\("auth\.emailDeliveryEnabled", false\)/.test(config)) problemas.push("correo no está cerrado por defecto");
  if (!/googleEnabled:\s*pick\("auth\.googleEnabled", false\)/.test(config)) problemas.push("Google no está cerrado por defecto");
  if (!/appleEnabled:\s*pick\("auth\.appleEnabled", false\)/.test(config)) problemas.push("Apple no está cerrado por defecto");
  if (!/AUTH\.emailDeliveryEnabled/.test(login)) problemas.push("login no respeta el estado del correo");
  if (!/AUTH\.googleEnabled/.test(login) || !/AUTH\.appleEnabled/.test(login)) problemas.push("login no respeta proveedores sociales");
  if (!problemas.length) ok("T", "Auth no enseña integraciones sin configurar", "SMTP/OAuth opt-in explícito");
  else mal("T", "Auth no enseña integraciones sin configurar", problemas.join(" · "));
}

/* ---------------------------------------------------------------- U
   V1 no acepta pagos ni solicitudes de factura creados a mano desde el
   navegador. Clip y los procesos administrativos escriben del servidor. */
{
  const policies = await leer("supabase/policies.sql");
  const seguridad = await leer("supabase/seguridad.sql");
  const migracion = await leer("supabase/migracion-10-cerrar-escrituras-pospuestas.sql");
  const config = await leer("js/core/config.js");
  const api = await leer("js/data/api.js");
  const facturacion = await leer("supabase/functions/facturacion/index.ts");
  const problemas = [];
  if (!/create policy "pagos_insert"[\s\S]*?with check \(public\.es_staff\(organizacion_id\)\)/.test(policies)) problemas.push("pagos_insert sigue abierto al dueño");
  if (!/create policy "facturas_insert"[\s\S]*?with check \(public\.es_staff\(organizacion_id\)\)/.test(policies)) problemas.push("facturas_insert sigue abierto al cliente");
  if (!/Los pagos se registran únicamente desde el servidor/.test(seguridad)) problemas.push("guardia_pago todavía permite pagos offline");
  if (!/drop policy if exists "pagos_insert"/.test(migracion) || !/drop policy if exists "facturas_insert"/.test(migracion)) problemas.push("migración 10 incompleta");
  if (!/facturacion:\s*false/.test(config)) problemas.push("facturación V1 puede reactivarse por override");
  if (/from\(["']facturas["']\)\.insert/.test(api)) problemas.push("el navegador todavía crea facturas directamente");
  if (!/FACTURACION_HABILITADA/.test(facturacion) || !/requiereUsuario\(req\)/.test(facturacion)) problemas.push("Edge Function de facturación no tiene freno + autenticación");
  const fs = await readdir(join(RAIZ, "js/payments"));
  for (const viejo of ["stripe.js", "tarjeta.js", "paypal.js", "mercadopago.js", "wallets.js", "transferencia.js"]) {
    if (fs.includes(viejo)) problemas.push(`${viejo} sigue en el cliente`);
  }
  if (!problemas.length) ok("U", "Pagos/facturas pospuestos cerrados al navegador", "RLS + trigger + adaptadores retirados");
  else mal("U", "Pagos/facturas pospuestos cerrados al navegador", problemas.join(" · "));
}

/* ---------------------------------------------------------------- V
   Un dato aproximado de ciudad no es una dirección. El centro de
   Ensenada se usó como placeholder y jamás debe volver a publicarse
   como si fuera el pin real del inmueble. */
{
  const seed = await leer("supabase/seed.sql");
  const mock = await leer("js/data/mock.js");
  const migracion = await leer("supabase/migracion-11-limpiar-ubicacion-placeholder.sql");
  const problemas = [];
  for (const [archivo, texto] of [["seed.sql", seed], ["mock.js", mock]]) {
    if (/31\.8667|-116\.5964|Sede Ensenada Centro/.test(texto)) problemas.push(`${archivo}: conserva ubicación placeholder`);
  }
  if (!/31\.8667/.test(migracion) || !/-116\.5964/.test(migracion)) problemas.push("migración 11 no limpia el placeholder conocido");
  if (!problemas.length) ok("V", "La app no publica un pin inventado", "seed/mock sin coordenadas placeholder");
  else mal("V", "La app no publica un pin inventado", problemas.join(" · "));
}

/* ---------------------------------------------------------------- W
   La portada y la ficha pública no pueden prometer un catálogo más
   grande que el real ni publicar el viejo texto de ejemplo del negocio. */
{
  const manifest = await leer("manifest.webmanifest");
  const index = await leer("index.html");
  const inicio = await leer("js/views/inicio.js");
  const contenido = await leer("js/data/contenido.js");
  const problemas = [];
  if (/salas de juntas y coworking/i.test(manifest) || /salas de juntas y coworking/i.test(index)) problemas.push("marketing todavía anuncia salas/coworking rentables");
  if (/data-filtro=["'](?:sala_juntas|coworking)["']/.test(inicio)) problemas.push("inicio conserva filtros comerciales vacíos");
  for (const fantasma of ["Nombre Apellido", "Domicilio fiscal y recepción", "CFDI 4.0 con tus datos", "WiFi de fibra en todo el edificio"]) {
    if (contenido.includes(fantasma)) problemas.push(`contenido público conserva placeholder: ${fantasma}`);
  }
  if (!problemas.length) ok("W", "Marketing público = catálogo real", "4 oficinas · sin biografía/servicios inventados");
  else mal("W", "Marketing público = catálogo real", problemas.join(" · "));
}

/* ---------------------------------------------------------------- X
   Una caída temporal de Supabase no puede convertir producción en demo
   ni mandar IDs `demo-*` a columnas UUID. */
{
  const api = await leer("js/data/api.js");
  const problemas = [];
  const activar = api.slice(api.indexOf("function activarDemo"), api.indexOf("/* ---------------------------------------------------------------------", api.indexOf("function activarDemo")));
  if (!/if \(BACKEND_ESPERADO\)/.test(activar)) problemas.push("activarDemo todavía puede fijar modo local en producción");
  const resolver = api.slice(api.indexOf("async function resolverOrganizacion"), api.indexOf("async function refrescarOrganizacion"));
  if (!/if \(BACKEND_ESPERADO\) return refrescarOrganizacion\(\)/.test(resolver)) problemas.push("organización real todavía compite contra demo-org");
  const espacios = api.slice(api.indexOf("export async function getEspacios"), api.indexOf("function sinOcultos"));
  if (!/BACKEND_ESPERADO && !UUID_RE\.test/.test(espacios)) problemas.push("getEspacios no bloquea organización demo/no UUID");
  if (!problemas.length) ok("X", "Una caída de red no mezcla producción con demo", "sin demo-org → UUID · escrituras cerradas");
  else mal("X", "Una caída de red no mezcla producción con demo", problemas.join(" · "));
}

/* ---------------------------------------------------------------- Y
   Si SMTP está apagado, ninguna ruta secundaria debe seguir prometiendo
   correos ni enseñar un interruptor que no puede funcionar. */
{
  const config = await leer("js/core/config.js");
  const settings = await leer("js/views/configuracion.js");
  const recovery = await leer("js/views/nueva-password.js");
  const legal = await leer("js/data/legal.js");
  const problemas = [];
  if (!/emailDeliveryEnabled:\s*pick\("auth\.emailDeliveryEnabled", false\)/.test(config)) problemas.push("SMTP no está cerrado por defecto");
  if (!/AUTH\.emailDeliveryEnabled[\s\S]*?cfg-email/.test(settings)) problemas.push("Configuración enseña correo sin gate de AUTH");
  if (!/if \(!AUTH\.emailDeliveryEnabled\)/.test(recovery)) problemas.push("/nueva-password puede pedir correos aunque SMTP esté apagado");
  if (!/AUTH\.emailDeliveryEnabled/.test(legal)) problemas.push("política de cancelación promete correo sin respetar el despliegue");
  if (!problemas.length) ok("Y", "SMTP apagado no deja botones/promesas fantasma", "settings + recovery + legal respetan AUTH");
  else mal("Y", "SMTP apagado no deja botones/promesas fantasma", problemas.join(" · "));
}

/* ---------------------------------------------------------------- Z
   El backend debe vender las mismas franjas que la interfaz y el seed no
   puede instalar descuentos de demostración que cuestan dinero real. */
{
  const config = await leer("js/core/config.js");
  const seguridad = await leer("supabase/seguridad.sql");
  const caducidad = await leer("supabase/caducidad.sql");
  const schema = await leer("supabase/schema.sql");
  const m12 = await leer("supabase/migracion-12-franjas-y-zona-horaria.sql");
  const m13 = await leer("supabase/migracion-13-quitar-promocion-ejemplo.sql");
  const seed = await leer("supabase/seed.sql");
  const mock = await leer("js/data/mock.js");
  const reservar = await leer("js/views/reservar.js");
  const problemas = [];
  if (!/bloques:\s*Object\.freeze/.test(config) || !/diasMaximos:\s*90/.test(config)) problemas.push("reglas V1 siguen sobreescribibles sólo en cliente");
  if (!/franja_reservable_v1/.test(seguridad) || !/interval '90 days'/.test(seguridad)) problemas.push("seguridad.sql no valida franja/90 días");
  if (!/franja_reservable_v1/.test(caducidad)) problemas.push("caducidad pisa esta_disponible sin horario");
  if (!/at time zone v_zona/.test(schema) || !/at time zone cfg\.zona_horaria/.test(schema)) problemas.push("disponibilidad de instalación nueva todavía depende de UTC del servidor");
  if (!/franja_reservable_v1/.test(m12) || !/disponibilidad_mapa/.test(m12)) problemas.push("migración 12 incompleta");
  if (/BIENVENIDO|15 % en tu primera reserva/.test(seed) || /demo-promo-1/.test(mock)) problemas.push("seed/demo todavía instala promoción de ejemplo");
  if (!/update public\.promociones/.test(m13) || !/activa = false/.test(m13)) problemas.push("migración 13 no apaga la promo histórica");
  if (!/FEATURES\.promociones/.test(reservar) || /placeholder="BIENVENIDO"/.test(reservar)) problemas.push("reserva sigue mostrando cupón fantasma/de ejemplo");
  if (!problemas.length) ok("Z", "Franjas/horarios/promos no se pueden saltar por API", "zona Tijuana · 90 días · sin descuento demo");
  else mal("Z", "Franjas/horarios/promos no se pueden saltar por API", problemas.join(" · "));
}

/* ---------------------------------------------------------------- */
console.log("========================================================");
console.log(" COHERENCIA DEL REPOSITORIO");
console.log("========================================================");
for (const r of res) {
  console.log(`[${r.v === "PASA" ? "✓" : "✗"}] ${`${r.id}  ${r.n}`.padEnd(50).slice(0, 50)} ${r.d}`);
}
const fallan = res.filter((r) => r.v !== "PASA").length;
console.log("");
console.log(` RESULTADO: ${res.length - fallan}/${res.length} PASA${fallan ? ` · ${fallan} FALLA` : ""}`);
console.log("========================================================");
process.exit(fallan ? 1 : 0);
