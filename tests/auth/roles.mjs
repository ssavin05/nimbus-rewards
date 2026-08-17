/* AUTH-14 y AUTH-15 — Escalada de rol y aislamiento entre organizaciones.
 *
 * La diferencia con pruebas-seguridad.sql: allí el usuario se simula con
 * set_config(). Aquí el JWT lo emite GoTrue de verdad, que es lo que va a
 * pasar en producción. Si RLS dependiera de algo que la simulación pone y
 * el token real no, aquí se vería.
 */
import {
  caso, grupo, rest, entrar, exigir, exigirIgual,
  crearUsuarioListo, borrarUsuario, HAY_SERVICIO, OmitirPrueba,
} from "./_comun.mjs";

grupo("Roles y multiempresa");

async function sesionDeUsuarioNuevo(limpiar) {
  const u = await crearUsuarioListo();
  limpiar(() => borrarUsuario(u.id));
  const login = await entrar(u.email, u.password);
  exigirIgual(login.estado, 200, "entrar con la cuenta recién creada");
  return { ...u, token: login.datos.access_token };
}

caso("AUTH-14", "Escalada de rol desde una sesión real", "A+C", async ({ limpiar }) => {
  if (!HAY_SERVICIO) throw new OmitirPrueba("hace falta service_role para preparar la cuenta");
  const u = await sesionDeUsuarioNuevo(limpiar);

  // El ataque del enunciado: PATCH { "rol": "admin" } desde DevTools.
  await rest(`/usuarios?id=eq.${u.id}`, {
    metodo: "PATCH", token: u.token, cuerpo: { rol: "admin" },
    headers: { Prefer: "return=minimal" },
  });
  // Puede devolver 200: lo que importa es lo que quedó guardado.
  const tras = await rest(`/usuarios?id=eq.${u.id}&select=rol,organizacion_id`, { token: u.token });
  exigirIgual(tras.datos?.[0]?.rol, "usuario", "el rol después del PATCH");

  // Y el salto directo a superadmin.
  await rest(`/usuarios?id=eq.${u.id}`, {
    metodo: "PATCH", token: u.token, cuerpo: { rol: "superadmin" },
  });
  const tras2 = await rest(`/usuarios?id=eq.${u.id}&select=rol`, { token: u.token });
  exigirIgual(tras2.datos?.[0]?.rol, "usuario", "el rol tras intentar superadmin");

  // Y darse de alta a mano como admin de una organización.
  const orgs = await rest("/organizaciones?select=id&limit=1", { token: u.token });
  const org = orgs.datos?.[0]?.id;
  if (org) {
    await rest("/organizacion_usuarios", {
      metodo: "POST", token: u.token,
      cuerpo: { organizacion_id: org, usuario_id: u.id, rol: "admin" },
    });
    const membresias = await rest(
      `/organizacion_usuarios?usuario_id=eq.${u.id}&select=rol`, { servicio: true });
    const colados = (membresias.datos || []).filter((m) => m.rol !== "usuario");
    exigir(colados.length === 0,
      `se coló una membresía con rol ${colados.map((m) => m.rol).join(", ")}`);
  }
  return "el rol sigue siendo «usuario» tras tres intentos";
});

caso("AUTH-15", "No se puede tocar otra organización", "A+C", async ({ limpiar }) => {
  if (!HAY_SERVICIO) throw new OmitirPrueba("hace falta service_role para preparar la cuenta");
  const u = await sesionDeUsuarioNuevo(limpiar);

  // Un espacio real de la organización que ya existe (a la que este
  // usuario NO pertenece).
  const espacios = await rest("/espacios?select=id,organizacion_id,precio_hora&limit=1",
    { servicio: true });
  const esp = espacios.datos?.[0];
  if (!esp) throw new OmitirPrueba("no hay espacios en la base para atacar");

  // 1. Cambiarle el precio.
  await rest(`/espacios?id=eq.${esp.id}`, {
    metodo: "PATCH", token: u.token, cuerpo: { precio_hora: 1 },
  });
  const tras = await rest(`/espacios?id=eq.${esp.id}&select=precio_hora`, { servicio: true });
  exigirIgual(Number(tras.datos?.[0]?.precio_hora), Number(esp.precio_hora),
    "el precio del espacio ajeno cambió");

  // 2. Leer sus reservas.
  const reservas = await rest(
    `/reservas?espacio_id=eq.${esp.id}&select=id,total`, { token: u.token });
  exigirIgual(reservas.estado, 200, "consultar reservas ajenas");
  exigirIgual((reservas.datos || []).length, 0,
    `se leyeron ${(reservas.datos || []).length} reservas de otra organización`);

  // 3. Leer su facturación por la vista de métricas.
  const metricas = await rest("/v_metricas_diarias?select=ingresos&limit=5", { token: u.token });
  exigir(metricas.estado !== 200 || (metricas.datos || []).length === 0,
    `la vista de métricas filtró ${(metricas.datos || []).length} filas de otra empresa`);

  // 4. Leer los perfiles de sus usuarios.
  const usuarios = await rest("/usuarios?select=id,email", { token: u.token });
  const ajenos = (usuarios.datos || []).filter((x) => x.id !== u.id);
  exigirIgual(ajenos.length, 0, `se leyeron ${ajenos.length} perfiles ajenos`);

  return "precio intacto, 0 reservas, 0 métricas, 0 perfiles ajenos";
});
