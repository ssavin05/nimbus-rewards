/* AUTH-01 a AUTH-04 — Registro */
import {
  caso, grupo, auth, rest, exigir, exigirIgual, correoDePrueba,
  crearUsuarioListo, borrarUsuario, HAY_SERVICIO, OmitirPrueba,
} from "./_comun.mjs";

grupo("Registro");

caso("AUTH-01", "Registro válido", "A", async ({ limpiar }) => {
  if (!HAY_SERVICIO) {
    // Sin llave de servicio habría que registrarse de verdad, y eso
    // dispara un correo: con el remitente de fábrica de Supabase se
    // agota a los dos envíos por hora (ver AUTH-16).
    throw new OmitirPrueba("registrarse manda correo; hace falta service_role");
  }
  const u = await crearUsuarioListo();
  limpiar(() => borrarUsuario(u.id));

  // El disparador trg_nuevo_usuario tiene que haber creado el perfil.
  // Si esto falla, la cuenta existe pero la persona no tiene perfil:
  // el registro "funciona" y la app se rompe después.
  const perfil = await rest(`/usuarios?id=eq.${u.id}&select=id,email,rol`, {
    servicio: true,
  });
  exigirIgual(perfil.estado, 200, "leer el perfil");
  exigir(Array.isArray(perfil.datos) && perfil.datos.length === 1,
    "no se creó la fila en public.usuarios (¿falla trg_nuevo_usuario?)");
  exigirIgual(perfil.datos[0].rol, "usuario", "el rol de una cuenta nueva");
  return `perfil creado con rol ${perfil.datos[0].rol}`;
});

caso("AUTH-02", "Correo inválido (servidor)", "A", async () => {
  const malos = ["abc", "a@", "@b.com", "a b@c.com", "a@b", "x".repeat(300) + "@b.com"];
  const aceptados = [];
  for (const email of malos) {
    const r = await auth("/signup", {
      metodo: "POST",
      cuerpo: { email, password: "ClaveDePrueba123" },
    });
    // 429 = el límite de envío de correo, no una aceptación.
    if (r.estado === 429) continue;
    if (r.estado < 300) aceptados.push(email);
  }
  exigir(aceptados.length === 0, `el servidor aceptó correos inválidos: ${aceptados.join(", ")}`);
  return `${malos.length} formatos rechazados`;
});

caso("AUTH-03", "Contraseña débil", "A", async () => {
  const debiles = ["123", "1234567", "", "abc"];
  const aceptadas = [];
  for (const password of debiles) {
    const r = await auth("/signup", {
      metodo: "POST",
      cuerpo: { email: correoDePrueba("-debil"), password },
    });
    if (r.estado === 429) continue;
    if (r.estado < 300) aceptadas.push(JSON.stringify(password));
  }
  exigir(aceptadas.length === 0, `se aceptaron contraseñas débiles: ${aceptadas.join(", ")}`);
  return "rechazadas las contraseñas cortas";
});

caso("AUTH-03b", "Contraseña filtrada (HaveIBeenPwned)", "A", async () => {
  // «password» y «12345678» cumplen la longitud mínima: sólo caen si la
  // protección contra contraseñas filtradas está encendida en el panel.
  // Este caso, por tanto, verifica también la configuración de 02.1.
  const r = await auth("/signup", {
    metodo: "POST",
    cuerpo: { email: correoDePrueba("-filtrada"), password: "password123" },
  });
  if (r.estado === 429) throw new OmitirPrueba("límite de envío de correo alcanzado");
  const codigo = r.datos?.error_code || r.datos?.msg || "";
  exigir(r.estado >= 300, "se aceptó «password123», una contraseña que está en todas las filtraciones");
  exigir(/pwned|leaked|weak/i.test(String(codigo)),
    `rechazada, pero no por estar filtrada (${String(codigo).slice(0, 80)}) — revisa Attack Protection`);
  return "la protección contra contraseñas filtradas está activa";
});

caso("AUTH-04", "Correo duplicado: sin enumerar usuarios", "A", async ({ limpiar }) => {
  if (!HAY_SERVICIO) throw new OmitirPrueba("hace falta service_role para preparar la cuenta");
  const u = await crearUsuarioListo();
  limpiar(() => borrarUsuario(u.id));

  const existente = await auth("/signup", {
    metodo: "POST", cuerpo: { email: u.email, password: "OtraClaveLarga456" },
  });
  const nuevo = await auth("/signup", {
    metodo: "POST", cuerpo: { email: correoDePrueba("-nuevo"), password: "OtraClaveLarga456" },
  });

  if (existente.estado === 429 || nuevo.estado === 429) {
    throw new OmitirPrueba("límite de envío de correo alcanzado");
  }
  exigir(existente.estado !== 500, "un correo duplicado devolvió 500");

  // Las dos respuestas tienen que ser indistinguibles desde fuera.
  exigirIgual(existente.estado, nuevo.estado,
    "el código HTTP delata si el correo ya existe");

  const huella = (d) => {
    if (!d || typeof d !== "object") return String(d);
    // Se comparan las CLAVES y el aspecto, no los valores (id y fechas cambian).
    return Object.keys(d).sort().join(",");
  };
  exigirIgual(huella(existente.datos), huella(nuevo.datos),
    "la forma de la respuesta delata si el correo ya existe");

  const cuerpo = JSON.stringify(existente.datos || "");
  exigir(!/already|exists|registered|duplicad|ya existe/i.test(cuerpo),
    `la respuesta dice explícitamente que la cuenta existe: ${cuerpo.slice(0, 120)}`);

  return `ambas respuestas: HTTP ${existente.estado}, misma forma`;
});
