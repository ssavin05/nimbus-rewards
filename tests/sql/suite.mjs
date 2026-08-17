/* ======================================================================
   suite.mjs — Pruebas SQL contra un PostgreSQL de verdad.

   Por qué esto existe
   -------------------
   Comprobar la seguridad leyendo los .sql no sirve: una policy puede
   estar escrita y no aplicarse, un grant puede sobrar, y RLS no se
   evalúa nunca para el superusuario. Aquí se conecta como PostgREST:

       set local role authenticated;
       set local request.jwt.claim.sub = '<uuid>';

   que es exactamente lo que hace Supabase con el JWT de cada petición.
   Todo lo que se prueba abajo se prueba SIN privilegios de superusuario.

   Uso:
     npm run test:sql
   o:
     PGURL=postgres://postgres@/app?host=/tmp&port=5433 node tests/sql/suite.mjs

   La base se monta con tests/sql/preparar.sh.
   ====================================================================== */
import pg from "pg";

const PGURL = process.env.PGURL || "postgres://postgres@localhost:5433/app";

const res = [];
const ok = (n, d = "") => { res.push({ n, v: "PASA", d }); };
const mal = (n, d = "") => { res.push({ n, v: "FALLA", d }); };
const chk = (cond, n, d = "") => (cond ? ok(n, d) : mal(n, d));

const admin = new pg.Client({ connectionString: PGURL });
await admin.connect();

/* ----------------------------------------------------------------------
   Fixtures. Dos personas distintas, para poder comprobar que una no ve
   ni toca lo de la otra.
   ---------------------------------------------------------------------- */
const ANA = "aaaaaaaa-0000-4000-8000-000000000001";
const BETO = "bbbbbbbb-0000-4000-8000-000000000002";

// Una sentencia por llamada: con parámetros, pg usa prepared statements
// y esos no admiten varias sentencias juntas.
await admin.query("delete from public.reservas where usuario_id in ($1, $2)", [ANA, BETO]);
await admin.query("delete from auth.users where id in ($1, $2)", [ANA, BETO]);
await admin.query(
  `insert into auth.users (id, email, raw_user_meta_data)
   values ($1, 'ana@prueba.local', '{"nombre":"Ana"}'::jsonb),
          ($2, 'beto@prueba.local', '{"nombre":"Beto"}'::jsonb)`, [ANA, BETO]);

// Tiene que ser una que se pueda reservar DE VERDAD: si el espacio está
// en 'proximamente' o inactivo, crear_reserva lo rechaza con razón y la
// prueba de concurrencia fallaría por el motivo equivocado. Por eso se
// filtra por estado en la propia consulta en vez de fijar un código.
const unaOficina = await admin.query(
  `select id, codigo, precio_hora from public.espacios
    where reservable and activo and estado = 'disponible' order by codigo limit 1`);
const noReservable = await admin.query(
  `select id, codigo from public.espacios where not reservable and codigo = 'OF-PRINCIPAL' limit 1`);
const ESPACIO = unaOficina.rows[0];
const CERRADO = noReservable.rows[0];

/** Una franja futura, en punto, que no choca con nada. */
function franja(diasAdelante, horaUtc = 17) {
  const d = new Date(Date.now() + diasAdelante * 86400000);
  d.setUTCHours(horaUtc, 0, 0, 0);
  return [d.toISOString(), new Date(d.getTime() + 2 * 3600000).toISOString()];
}

/**
 * Deja la sesión como la deja PostgREST al atender una petición.
 *
 * OJO con esto, que es donde una prueba de seguridad se vuelve inútil
 * sin que se note: además del `sub` hay que poner el claim `role`.
 * `rol_peticion()` cae a 'postgres' cuando no encuentra ninguno, y con
 * eso `escritura_confiable()` da true y los triggers se apartan creyendo
 * que la escritura viene del servidor. Una suite que sólo ponga el `sub`
 * pasa en verde mientras comprueba justamente lo contrario de lo que
 * dice comprobar.
 */
async function sesionPostgrest(c, uid, rol) {
  await c.query(`set local role ${rol}`);
  const claims = JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol });
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
  await c.query(`select set_config('request.jwt.claim.role', $1, true)`, [rol]);
  if (uid) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
}

/** Ejecuta `fn` dentro de una transacción con el rol y el uid de PostgREST. */
async function comoUsuario(uid, fn, rol = "authenticated") {
  const c = new pg.Client({ connectionString: PGURL });
  await c.connect();
  try {
    await c.query("begin");
    await sesionPostgrest(c, uid, rol);
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}

const fallo = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

/* ======================================================================
   1. RLS — quién ve qué
   ====================================================================== */
{
  const r = await comoUsuario(null, (c) => c.query("select count(*)::int n from public.espacios"), "anon");
  chk(r.rows[0].n > 0, "anon puede leer el catálogo", `${r.rows[0].n} espacios`);
}
{
  const r = await comoUsuario(null, (c) => c.query("select count(*)::int n from public.usuarios"), "anon");
  chk(r.rows[0].n === 0, "anon NO puede leer usuarios", `vio ${r.rows[0].n}`);
}
{
  const r = await comoUsuario(null, (c) => c.query("select count(*)::int n from public.reservas"), "anon");
  chk(r.rows[0].n === 0, "anon NO puede leer reservas", `vio ${r.rows[0].n}`);
}
{
  const [ini, fin] = franja(3);
  const msg = await fallo(() => comoUsuario(null, (c) => c.query(
    `insert into public.reservas (organizacion_id, espacio_id, inicio, fin, estado)
     select organizacion_id, id, $1, $2, 'confirmada' from public.espacios where id = $3`,
    [ini, fin, ESPACIO.id]), "anon"));
  chk(Boolean(msg), "anon NO puede insertar una reserva", msg ? msg.slice(0, 60) : "¡la insertó!");
}

/* ======================================================================
   2. Aislamiento entre usuarios
   ====================================================================== */
{
  const [ini, fin] = franja(4);
  await admin.query(
    `insert into public.reservas (organizacion_id, espacio_id, usuario_id, inicio, fin, estado)
     select organizacion_id, id, $3, $1, $2, 'confirmada' from public.espacios where id = $4`,
    [ini, fin, ANA, ESPACIO.id]);

  const deAna = await comoUsuario(ANA, (c) => c.query("select count(*)::int n from public.reservas"));
  const deBeto = await comoUsuario(BETO, (c) => c.query("select count(*)::int n from public.reservas"));
  chk(deAna.rows[0].n === 1, "Ana ve su propia reserva", `${deAna.rows[0].n}`);
  chk(deBeto.rows[0].n === 0, "Beto NO ve la reserva de Ana", `vio ${deBeto.rows[0].n}`);

  const msg = await fallo(() => comoUsuario(BETO, (c) => c.query(
    `select public.cancelar_reserva(id) from public.reservas where usuario_id = $1`, [ANA])));
  const siguePie = await admin.query(
    `select estado from public.reservas where usuario_id = $1`, [ANA]);
  chk(siguePie.rows[0]?.estado === "confirmada",
    "Beto NO puede cancelar la reserva de Ana", msg ? msg.slice(0, 60) : `estado=${siguePie.rows[0]?.estado}`);

  await admin.query("delete from public.reservas where usuario_id = $1", [ANA]);
}

/* ======================================================================
   3. Escalada de privilegios
   ====================================================================== */
{
  const msg = await fallo(() => comoUsuario(ANA, (c) =>
    c.query("update public.usuarios set rol = 'admin' where id = $1", [ANA])));
  const rol = await admin.query("select rol from public.usuarios where id = $1", [ANA]);
  chk(rol.rows[0]?.rol !== "admin", "un usuario NO puede hacerse admin",
    msg ? msg.slice(0, 70) : `rol quedó en ${rol.rows[0]?.rol}`);
}

/* ======================================================================
   4. Catálogo — lo no reservable no se reserva ni por la puerta de atrás
   ====================================================================== */
{
  const r = await admin.query("select codigo from public.espacios where reservable order by codigo");
  const codigos = r.rows.map((x) => x.codigo).sort();
  const esperado = ["OF-A", "OF-B", "OF-C", "OF-D"].sort();
  chk(JSON.stringify(codigos) === JSON.stringify(esperado),
    "sólo 4 espacios reservables en la base", codigos.join(", "));
}

/* La base y el plano tienen que hablar del MISMO edificio.
 *
 * No lo hacían: seed.sql traía 23 espacios y planta.js 24 —faltaba la
 * Habitación entera—, la quinta oficina se llamaba OF-05 aquí y OF-01
 * allá, y la cocina era CO-01 en el plano y SRV-01 en la base. Peor: mi
 * propia prueba afirmaba «OF-05», así que bendecía la divergencia en vez
 * de cazarla.
 *
 * Esta comprobación es la que garantiza la fuente única: si alguien toca
 * uno de los dos y no el otro, sale roja.
 */
{
  const { espaciosDelPlano } = await import("../../js/data/planta.js");
  const delPlano = espaciosDelPlano({}).map((e) => e.codigo).sort();
  const r = await admin.query("select codigo from public.espacios order by codigo");
  const enBase = r.rows.map((x) => x.codigo).sort();

  const soloPlano = delPlano.filter((c) => !enBase.includes(c));
  const soloBase = enBase.filter((c) => !delPlano.includes(c));
  const detalle = soloPlano.length || soloBase.length
    ? `sólo en el plano: ${soloPlano.join(",") || "—"} · sólo en la base: ${soloBase.join(",") || "—"}`
    : `${delPlano.length} espacios, idénticos`;

  chk(soloPlano.length === 0 && soloBase.length === 0,
    "planta.js y la base describen el mismo edificio", detalle);
  chk(delPlano.length === 24, "el edificio tiene 24 espacios físicos", `${delPlano.length}`);
}
{
  const [ini, fin] = franja(5);
  const msg = await fallo(() => comoUsuario(ANA, (c) =>
    c.query("select public.crear_reserva($1, $2, $3)", [CERRADO.id, ini, fin])));
  chk(Boolean(msg), `crear_reserva rechaza ${CERRADO.codigo} (no reservable)`, msg ? msg.slice(0, 60) : "¡la creó!");
}
{
  // Y tampoco por INSERT directo saltándose la RPC.
  const [ini, fin] = franja(6);
  const msg = await fallo(() => comoUsuario(ANA, (c) => c.query(
    `insert into public.reservas (organizacion_id, espacio_id, usuario_id, inicio, fin, estado)
     select organizacion_id, id, $3, $1, $2, 'confirmada' from public.espacios where id = $4`,
    [ini, fin, ANA, CERRADO.id])));
  chk(Boolean(msg), `INSERT directo sobre ${CERRADO.codigo} también se bloquea`,
    msg ? msg.slice(0, 60) : "¡lo insertó!");
}

/* ======================================================================
   5. El precio lo pone el servidor
   ====================================================================== */
{
  const [ini, fin] = franja(7);
  const r = await comoUsuario(ANA, async (c) => {
    // El cliente miente: dice que la reserva cuesta 1 peso.
    await c.query(
      `insert into public.reservas (organizacion_id, espacio_id, usuario_id, inicio, fin, estado,
                                    subtotal, descuento, impuestos, total)
       select organizacion_id, id, $3, $1, $2, 'pendiente', 1, 0, 0, 1
         from public.espacios where id = $4`,
      [ini, fin, ANA, ESPACIO.id]);
    return c.query("select subtotal, impuestos, total from public.reservas where usuario_id = $1", [ANA]);
  });
  const fila = r.rows[0];
  const esperadoSub = Number(ESPACIO.precio_hora) * 2;
  chk(Number(fila.subtotal) === esperadoSub && Number(fila.total) > 1,
    "el servidor recalcula el precio y descarta el del cliente",
    `subtotal=${fila.subtotal} (esperado ${esperadoSub}) total=${fila.total}`);
}

/* ======================================================================
   6. Concurrencia — dos personas, el mismo hueco, a la vez
   ====================================================================== */
{
  const [ini, fin] = franja(8);

  /* Cada petición vive su propia transacción de principio a fin, igual
     que en PostgREST: begin → RPC → commit. Es importante que cada una
     confirme por su cuenta y no se espere a la otra; si las dos se
     quedan abiertas esperando, se bloquean mutuamente y no se prueba
     nada (la segunda queda colgada en la restricción de exclusión
     mientras la primera nunca llega a confirmar). */
  const peticion = async (uid) => {
    const c = new pg.Client({ connectionString: PGURL });
    await c.connect();
    try {
      await c.query("begin");
      await sesionPostgrest(c, uid, "authenticated");
      await c.query("select public.crear_reserva($1, $2, $3)", [ESPACIO.id, ini, fin]);
      await c.query("commit");
      return uid === ANA ? "Ana" : "Beto";
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      await c.end().catch(() => {});
    }
  };

  const resultados = await Promise.allSettled([peticion(ANA), peticion(BETO)]);
  const ganaron = resultados.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const perdio = resultados.find((r) => r.status === "rejected");

  const enBase = await admin.query(
    `select count(*)::int n from public.reservas
      where espacio_id = $1 and inicio = $2 and estado in ('pendiente','confirmada','en_curso')`,
    [ESPACIO.id, ini]);

  chk(enBase.rows[0].n === 1 && ganaron.length === 1,
    "doble reserva simultánea: sólo una gana",
    `ganó ${ganaron.join("+") || "nadie"} · en base: ${enBase.rows[0].n}`);
  // No basta con «falló»: tiene que fallar con el error de NEGOCIO.
  // Antes salía «deadlock detected», que es un error de motor,
  // reintentable, y que no dice a la persona qué pasó. Si vuelve a
  // aparecer un deadlock aquí, esta prueba se pone roja.
  const razon = perdio ? String(perdio.reason.message) : "";
  chk(Boolean(perdio) && /conflicto_horario|ya está ocupado/i.test(razon),
    "la que pierde recibe «horario ocupado», no un deadlock",
    razon.slice(0, 58) || "las dos creyeron ganar");

  await admin.query("delete from public.reservas where espacio_id = $1 and inicio = $2", [ESPACIO.id, ini]);
}

/* ======================================================================
   7. El webhook de pago se puede entregar dos veces
   ======================================================================
   Stripe entrega «al menos una vez»: el mismo evento puede llegar
   repetido. confirmarPago() lo resuelve con
   `upsert(..., { onConflict: "proveedor_id" })`, que PostgREST traduce a
   `INSERT ... ON CONFLICT (proveedor_id) DO UPDATE`.

   Eso EXIGE una restricción única inferible sobre esa columna. Había un
   índice único parcial —`where proveedor_id is not null`— y PostgreSQL
   no infiere índices parciales sin repetir el predicado, así que TODOS
   los upserts morían con 42P10. Como confirmarPago() hace throw, el
   webhook devolvía 500: el cliente pagaba, el cobro no se registraba y
   la reserva jamás pasaba a confirmada.

   Se prueba la sentencia REAL, no una parecida.
   ====================================================================== */
{
  const [ini, fin] = franja(9);
  const PI = `pi_prueba_${Date.now()}`;
  const r = await admin.query(
    `insert into public.reservas (organizacion_id, espacio_id, usuario_id, inicio, fin, estado,
                                  subtotal, descuento, impuestos, total)
     select organizacion_id, id, $3, $1, $2, 'pendiente', 520, 0, 83.20, 603.20
       from public.espacios where id = $4 returning id`,
    [ini, fin, ANA, ESPACIO.id]);
  const reservaId = r.rows[0].id;

  const entrega = () => admin.query(
    `insert into public.pagos (organizacion_id, reserva_id, usuario_id, metodo, estado,
                               monto, moneda, proveedor_id, pagado_en)
     select organizacion_id, id, $2, 'stripe', 'aprobado', 603.20, 'MXN', $3, now()
       from public.reservas where id = $1
     on conflict (proveedor_id) do update set estado = excluded.estado`,
    [reservaId, ANA, PI]);

  let fallo = null;
  try { await entrega(); await entrega(); } catch (e) { fallo = e.message; }

  const filas = await admin.query(
    "select count(*)::int n, coalesce(sum(monto),0)::float suma from public.pagos where proveedor_id = $1", [PI]);

  chk(!fallo && filas.rows[0].n === 1,
    "el webhook repetido deja UN solo pago, no falla ni duplica",
    fallo ? fallo.slice(0, 62) : `${filas.rows[0].n} fila(s) · ${filas.rows[0].suma}`);

  // Y los pagos sin identificador de pasarela (efectivo, cortesía)
  // tienen que poder convivir varios: en UNIQUE los NULL son distintos.
  let fallo2 = null;
  try {
    for (const m of ["efectivo", "cortesia"]) {
      await admin.query(
        `insert into public.pagos (organizacion_id, reserva_id, usuario_id, metodo, estado,
                                   monto, moneda, proveedor_id, pagado_en)
         select organizacion_id, id, $2, $3, 'aprobado', 10, 'MXN', null, now()
           from public.reservas where id = $1`, [reservaId, ANA, m]);
    }
  } catch (e) { fallo2 = e.message; }
  const sinId = await admin.query(
    "select count(*)::int n from public.pagos where reserva_id = $1 and proveedor_id is null", [reservaId]);
  chk(!fallo2 && sinId.rows[0].n === 2,
    "varios pagos sin identificador de pasarela conviven",
    fallo2 ? fallo2.slice(0, 62) : `${sinId.rows[0].n} filas`);

  await admin.query("delete from public.pagos where reserva_id = $1", [reservaId]);
  await admin.query("delete from public.reservas where id = $1", [reservaId]);
}

/* ======================================================================
   8. Guardia estructural contra el patrón que rompió los pagos
   ======================================================================
   El fallo de los cobros no fue «falta un índice»: el índice ESTABA, se
   veía bien y no servía porque era parcial. Esta comprobación no mira un
   upsert concreto, mira el patrón: cualquier índice único con WHERE es
   sospechoso, porque `ON CONFLICT (columna)` no lo va a inferir.

   Si algún día hace falta uno parcial de verdad, se añade aquí a la
   lista de excepciones justificándolo — que es justo la conversación que
   no se tuvo la primera vez.
   ====================================================================== */
{
  const PARCIALES_JUSTIFICADOS = [];   // ninguno, de momento

  const r = await admin.query(`
    select indexname, indexdef from pg_indexes
     where schemaname = 'public'
       and indexdef ilike '%unique%'
       and indexdef ilike '%where%'`);
  const sospechosos = r.rows.filter((x) => !PARCIALES_JUSTIFICADOS.includes(x.indexname));
  chk(sospechosos.length === 0,
    "ningún índice único parcial (ON CONFLICT no los infiere)",
    sospechosos.map((x) => x.indexname).join(", ") || "ninguno");

  // Y las columnas sobre las que la aplicación hace upsert tienen que
  // tener su restricción única, inferible y sin predicado.
  const OBJETIVOS = [
    ["pagos", "proveedor_id"],
    ["push_suscripciones", "endpoint"],
    ["resenas", "usuario_id, reserva_id"],
    ["lista_espera", "espacio_id, usuario_id, fecha, bloque"],
  ];
  const faltan = [];
  for (const [tabla, columnas] of OBJETIVOS) {
    const c = await admin.query(
      `select 1 from pg_constraint
        where conrelid = $1::regclass and contype = 'u'
          and pg_get_constraintdef(oid) = $2`,
      [`public.${tabla}`, `UNIQUE (${columnas})`]);
    if (!c.rowCount) faltan.push(`${tabla}(${columnas})`);
  }
  chk(faltan.length === 0,
    "cada upsert de la app tiene su restricción única inferible",
    faltan.join(" · ") || `${OBJETIVOS.length} comprobadas`);
}

/* ======================================================================
   9. Clip como método de pago — ESTRUCTURA, no cobro
   ======================================================================
   `pagos.metodo` es un enum, no texto libre. Registrar un cobro de Clip
   sin ampliarlo revienta con «invalid input value for enum», y como
   confirmarPago() hace throw, el webhook devolvería 500 con el cliente
   ya cobrado: el mismo desenlace que el fallo de la migración 05, por
   otra puerta.

   Lo que sigue comprueba la ESTRUCTURA alrededor del cobro: que la base
   acepte el método, que el intento se registre y que registrarlo NO
   confirme la reserva. No comprueba —ni puede— que un cobro de Clip
   funcione: Checkout Redireccionado no tiene sandbox, así que la única
   validación de punta a punta es un cargo real de importe mínimo, y ésa
   la hace el dueño (OWNER_ACTIONS §2). Confundir una cosa con la otra
   fue justo el error que se corrigió aquí.
   ====================================================================== */
{
  const r = await admin.query(
    `select 1 from pg_enum where enumtypid = 'public.metodo_pago'::regtype and enumlabel = 'clip'`);
  chk(r.rowCount === 1, "la base acepta 'clip' como método de pago",
    r.rowCount ? "en el enum metodo_pago" : "falta: aplica migracion-07");
}
{
  // Y que un pago de Clip se pueda guardar de verdad, no sólo que el
  // enum lo liste.
  const [ini, fin] = franja(11);
  const res = await admin.query(
    `insert into public.reservas (organizacion_id, espacio_id, usuario_id, inicio, fin, estado,
                                  subtotal, descuento, impuestos, total)
     select organizacion_id, id, $3, $1, $2, 'pendiente', 520, 0, 83.20, 603.20
       from public.espacios where id = $4 returning id`,
    [ini, fin, ANA, ESPACIO.id]);
  const reservaId = res.rows[0].id;
  const PI = `clip_${Date.now()}`;

  let fallo = null;
  try {
    await admin.query(
      `insert into public.pagos (organizacion_id, reserva_id, usuario_id, metodo, estado,
                                 monto, moneda, proveedor_id)
       select organizacion_id, id, $2, 'clip', 'pendiente', 603.20, 'MXN', $3
         from public.reservas where id = $1`, [reservaId, ANA, PI]);
  } catch (e) { fallo = e.message; }

  const estado = await admin.query(
    "select estado from public.reservas where id = $1", [reservaId]);
  chk(!fallo, "se puede registrar un pago con Clip", fallo ? fallo.slice(0, 60) : "ok");
  // Lo importante del flujo de Clip: apuntar el intento NO confirma nada.
  chk(estado.rows[0]?.estado === "pendiente",
    "crear el intento de pago deja la reserva PENDIENTE",
    `estado=${estado.rows[0]?.estado}`);

  await admin.query("delete from public.pagos where reserva_id = $1", [reservaId]);
  await admin.query("delete from public.reservas where id = $1", [reservaId]);
}

/* ======================================================================
   10. service_role nunca debería estar en el navegador
   ====================================================================== */
{
  const r = await admin.query(
    `select rolbypassrls from pg_roles where rolname = 'service_role'`);
  chk(r.rows[0]?.rolbypassrls === true,
    "service_role salta RLS (por eso jamás va en el frontend)");
}

/* ---------------------------------------------------------------------- */
await admin.query("delete from public.reservas where usuario_id in ($1,$2)", [ANA, BETO]);
await admin.query("delete from auth.users where id in ($1,$2)", [ANA, BETO]);
await admin.end();

console.log("========================================================");
console.log(" PRUEBAS SQL · RLS, roles y concurrencia");
console.log("========================================================");
for (const r of res) {
  console.log(`[${r.v === "PASA" ? "✓" : "✗"}] ${r.n.padEnd(52).slice(0, 52)} ${r.d}`);
}
const fallan = res.filter((r) => r.v !== "PASA").length;
console.log("");
console.log(` RESULTADO: ${res.length - fallan}/${res.length} PASA${fallan ? ` · ${fallan} FALLA` : ""}`);
console.log("========================================================");
process.exit(fallan ? 1 : 0);
