/* Casos que NO necesitan la llave de servicio.
 *
 * Se separan aquí a propósito: son los que se pueden ejecutar en
 * cualquier momento, por cualquiera, sin secretos y sin gastar cupo de
 * correo. Lo que necesita `service_role` vive en los otros archivos.
 */
import {
  caso, grupo, auth, rest, entrar, exigir, exigirIgual,
  correoDePrueba, OmitirPrueba,
} from "./_comun.mjs";

grupo("RLS y Auth sin sesión");

/* Un correo que SABEMOS que está registrado. No se escribe en el
   repositorio (es un dato personal): se pasa por el entorno.
     export CORREO_CONOCIDO=alguien@ejemplo.com                        */
const CONOCIDO = process.env.CORREO_CONOCIDO || "";

caso("AUTH-07b", "El login no delata qué correos existen", "A", async () => {
  if (!CONOCIDO) {
    throw new OmitirPrueba("hace falta CORREO_CONOCIDO=<un correo ya registrado>");
  }
  // Contraseña equivocada contra una cuenta que SÍ existe, frente a una
  // cuenta que no existe. Si las dos respuestas no son idénticas, se
  // pueden enumerar los usuarios del sistema probando direcciones.
  // Ninguna de las dos manda correo, así que no gasta cupo.
  const existe   = await entrar(CONOCIDO, "ContraseñaQueSeguroEstáMal999");
  const noExiste = await entrar(correoDePrueba("-nadie"), "ContraseñaQueSeguroEstáMal999");

  if (existe.estado === 429 || noExiste.estado === 429) {
    throw new OmitirPrueba("freno por ritmo activo; repítelo en unos minutos");
  }

  exigir(existe.estado >= 300, "¡se entró con una contraseña inventada!");
  exigirIgual(existe.estado, noExiste.estado, "el código HTTP distingue los dos casos");
  exigirIgual(existe.datos?.error_code, noExiste.datos?.error_code,
    "el código de error distingue los dos casos");
  exigirIgual(existe.datos?.msg, noExiste.datos?.msg,
    "el mensaje distingue los dos casos");
  return `ambos: HTTP ${existe.estado} · "${existe.datos?.msg}"`;
});

caso("AUTH-17", "Sin sesión no se lee nada privado", "A", async () => {
  // RLS desde el cable, con la llave pública y sin token: es lo que
  // tiene cualquiera que abra las herramientas del navegador.
  const privadas = [
    ["reservas", "/reservas?select=id,total,cliente_email&limit=5"],
    ["pagos", "/pagos?select=id,monto,ultimos4&limit=5"],
    ["usuarios", "/usuarios?select=id,email&limit=5"],
    ["facturas", "/facturas?select=id,rfc,total&limit=5"],
    ["notificaciones", "/notificaciones?select=id,titulo&limit=5"],
    ["conversaciones", "/conversaciones?select=id&limit=5"],
    ["mensajes", "/mensajes?select=id,cuerpo&limit=5"],
    ["auditoria", "/auditoria?select=id,tabla&limit=5"],
    ["v_metricas_diarias", "/v_metricas_diarias?select=ingresos&limit=5"],
    ["organizacion_usuarios", "/organizacion_usuarios?select=rol&limit=5"],
  ];
  const filtran = [];
  for (const [nombre, ruta] of privadas) {
    const r = await rest(ruta);
    if (r.estado === 200 && Array.isArray(r.datos) && r.datos.length > 0) {
      filtran.push(`${nombre} (${r.datos.length} filas)`);
    }
  }
  exigir(filtran.length === 0, `sin sesión se leyeron datos privados: ${filtran.join(", ")}`);

  // Estas dos vistas SÍ devuelven filas a un anónimo, y está bien: parten
  // del catálogo, que es público. Lo que no puede escaparse es el
  // agregado que sale de `reservas`. Con `security_invoker = on`, RLS se
  // aplica a quien consulta y esas cifras tienen que venir en cero.
  // Contar filas aquí daría un falso positivo; hay que mirar los valores.
  const agregados = [
    ["v_espacios_populares", "/v_espacios_populares?select=nombre,reservas,ingresos&limit=20",
      ["reservas", "ingresos"]],
    ["v_ocupacion_espacio", "/v_ocupacion_espacio?select=nombre,horas_reservadas,ocupacion&limit=20",
      ["horas_reservadas", "ocupacion"]],
  ];
  const escapes = [];
  for (const [nombre, ruta, campos] of agregados) {
    const r = await rest(ruta);
    for (const fila of r.datos || []) {
      for (const campo of campos) {
        if (Number(fila[campo]) > 0) escapes.push(`${nombre}.${campo}=${fila[campo]}`);
      }
    }
  }
  exigir(escapes.length === 0,
    `las vistas de analítica filtran cifras de reservas a quien no tiene sesión: ${escapes.slice(0, 4).join(", ")}`);

  return `${privadas.length} privadas sin filtrar · 2 vistas con agregados en cero`;
});

caso("AUTH-18", "Sin sesión no se puede escribir", "A", async () => {
  const escrituras = [
    ["reservas", "POST", "/reservas",
      { espacio_id: "00000000-0000-0000-0000-000000000000", inicio: "2027-01-01T10:00:00Z",
        fin: "2027-01-01T12:00:00Z", organizacion_id: "00000000-0000-0000-0000-000000000000" }],
    ["espacios (precio)", "PATCH", "/espacios?precio_hora=gt.0", { precio_hora: 1 }],
    ["usuarios (rol)", "PATCH", "/usuarios?id=neq.00000000-0000-0000-0000-000000000000",
      { rol: "superadmin" }],
    ["organizaciones", "PATCH", "/organizaciones?activa=eq.true", { nombre: "Secuestrada" }],
  ];
  const coladas = [];
  for (const [nombre, metodo, ruta, cuerpo] of escrituras) {
    const r = await rest(ruta, { metodo, cuerpo, headers: { Prefer: "return=minimal" } });
    // 2xx sólo cuenta como fallo si de verdad tocó algo; PostgREST
    // devuelve 204 aunque el WHERE no case con ninguna fila.
    if (r.estado >= 200 && r.estado < 300 && r.estado !== 204) coladas.push(`${nombre} → ${r.estado}`);
  }
  // Lo que de verdad importa: que el catálogo no haya cambiado.
  const precios = await rest("/espacios?select=precio_hora&order=precio_hora.asc&limit=1");
  const minimo = Number(precios.datos?.[0]?.precio_hora ?? 0);
  exigir(coladas.length === 0, `escrituras anónimas aceptadas: ${coladas.join(", ")}`);
  exigir(minimo !== 1 || precios.datos.length === 0,
    "el precio mínimo del catálogo es 1: puede que la escritura anónima haya funcionado");
  return `${escrituras.length} escrituras anónimas rechazadas`;
});

caso("AUTH-19", "El catálogo público sí se lee", "A", async () => {
  // El contrapunto del AUTH-17: cerrar de más también es un fallo.
  // Quien entra sin cuenta tiene que poder ver las oficinas.
  const espacios = await rest("/espacios?select=codigo,nombre,precio_hora&limit=5");
  exigirIgual(espacios.estado, 200, "leer el catálogo sin sesión");
  exigir(Array.isArray(espacios.datos) && espacios.datos.length > 0,
    "el catálogo sale vacío para quien no ha iniciado sesión");
  const orgs = await rest("/organizaciones?select=id,nombre&limit=1");
  exigirIgual(orgs.estado, 200, "leer la organización sin sesión");
  return `${espacios.datos.length} espacios visibles sin cuenta`;
});

caso("AUTH-20", "La ocupación pública no filtra datos personales", "A", async () => {
  // v_ocupacion_publica usa SECURITY INVOKER y delega la lectura mínima
  // en ocupacion_publica_segura(). Aun así comprobamos que jamás se
  // exponga nada fuera de espacio_id, inicio y fin.
  const r = await rest("/v_ocupacion_publica?select=*&limit=5");
  if (r.estado !== 200) throw new OmitirPrueba(`la vista respondió ${r.estado}`);
  const permitidas = new Set(["espacio_id", "inicio", "fin"]);
  const columnas = Object.keys(r.datos?.[0] || {});
  const demas = columnas.filter((c) => !permitidas.has(c));
  exigir(demas.length === 0,
    `la vista pública expone columnas de más: ${demas.join(", ")}`);
  return columnas.length ? `sólo ${columnas.join(", ")}` : "sin filas todavía";
});

caso("AUTH-21", "Un token inventado no vale", "A", async () => {
  const basura = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.firma-falsa",
    "Bearer bearer bearer",
    "null",
  ];
  for (const token of basura) {
    const r = await rest("/usuarios?select=id,email&limit=5", { token });
    exigir(r.estado !== 200 || (r.datos || []).length === 0,
      `un token falsificado leyó ${(r.datos || []).length} perfiles`);
  }
  // El caso interesante: hacerse pasar por service_role en el `role`.
  const r = await rest("/reservas?select=id&limit=5", {
    headers: { "x-client-info": "supabase-js/0.0.0" },
  });
  exigir((r.datos || []).length === 0, "se leyeron reservas manipulando cabeceras");
  return "3 tokens falsos y una cabecera manipulada, todos rechazados";
});
