/* AUTH-12 y AUTH-13 — Recuperación de contraseña */
import {
  caso, grupo, auth, entrar, exigir, exigirIgual, correoDePrueba,
  crearUsuarioListo, generarEnlace, borrarUsuario, HAY_SERVICIO, OmitirPrueba,
} from "./_comun.mjs";

grupo("Recuperación de contraseña");

/** Sigue el enlace de recuperación y devuelve la sesión que deja. */
async function canjearEnlace(actionLink) {
  const r = await fetch(actionLink, { redirect: "manual" });
  const destino = r.headers.get("location") || "";
  // GoTrue redirige con la sesión en el fragmento (#access_token=...)
  // o, en PKCE, con ?code=...
  const frag = destino.includes("#") ? destino.slice(destino.indexOf("#") + 1) : "";
  const params = new URLSearchParams(frag);
  return {
    estado: r.status,
    destino,
    accessToken: params.get("access_token"),
    error: params.get("error_description") || params.get("error"),
  };
}

caso("AUTH-12", "Recuperar contraseña", "B", async ({ limpiar }) => {
  if (!HAY_SERVICIO) throw new OmitirPrueba("hace falta service_role para generar el enlace");
  const u = await crearUsuarioListo();
  limpiar(() => borrarUsuario(u.id));

  const enlace = await generarEnlace("recovery", u.email);
  exigir(enlace.action_link, "generate_link(recovery) no devolvió enlace");

  const canje = await canjearEnlace(enlace.action_link);
  exigir(!canje.error, `el enlace de recuperación falló: ${canje.error}`);
  exigir(canje.accessToken,
    `el enlace no dejó sesión para cambiar la contraseña (destino: ${canje.destino.slice(0, 90)})`);

  const nueva = "ClaveNuevaDePrueba456";
  const cambio = await auth("/user", {
    metodo: "PUT", token: canje.accessToken, cuerpo: { password: nueva },
  });
  exigirIgual(cambio.estado, 200, "cambiar la contraseña con el token de recuperación");

  const login = await entrar(u.email, nueva);
  exigirIgual(login.estado, 200, "entrar con la contraseña nueva");

  return "enlace canjeado y contraseña cambiada";
});

caso("AUTH-13", "La contraseña vieja deja de servir", "B", async ({ limpiar }) => {
  if (!HAY_SERVICIO) throw new OmitirPrueba("hace falta service_role");
  // Se rehace el flujo entero para no depender del orden de ejecución.
  const u = await crearUsuarioListo();
  limpiar(() => borrarUsuario(u.id));
  const vieja = u.password;

  // Una sesión abierta ANTES del cambio, para comprobar que se cae.
  const previa = await entrar(u.email, vieja);
  const sesionPrevia = previa.datos?.refresh_token || null;

  const enlace = await generarEnlace("recovery", u.email);
  const canje = await canjearEnlace(enlace.action_link);
  exigir(canje.accessToken, "el enlace de recuperación no dejó sesión");

  const nueva = "OtraClaveNueva789";
  const cambio = await auth("/user", {
    metodo: "PUT", token: canje.accessToken, cuerpo: { password: nueva },
  });
  exigirIgual(cambio.estado, 200, "cambiar la contraseña");

  const conVieja = await entrar(u.email, vieja);
  exigir(conVieja.estado >= 300, "¡la contraseña ANTIGUA sigue funcionando!");
  exigir(!conVieja.datos?.access_token, "se emitió token con la contraseña antigua");

  const conNueva = await entrar(u.email, nueva);
  exigirIgual(conNueva.estado, 200, "entrar con la nueva");

  // Cambiar la contraseña tiene que tumbar las sesiones que ya había:
  // si no, quien la robó sigue dentro aunque la víctima la cambie.
  if (sesionPrevia) {
    const refresco = await auth("/token?grant_type=refresh_token", {
      metodo: "POST", cuerpo: { refresh_token: sesionPrevia },
    });
    exigir(refresco.estado >= 300,
      "la sesión anterior sigue viva tras cambiar la contraseña");
  }
  return `la vieja da ${conVieja.estado}, la nueva entra, la sesión previa cae`;
});

caso("AUTH-12b", "Pedir recuperación no revela si el correo existe", "A", async ({ limpiar }) => {
  let existente = null;
  if (HAY_SERVICIO) {
    const u = await crearUsuarioListo();
    limpiar(() => borrarUsuario(u.id));
    existente = u.email;
  } else {
    throw new OmitirPrueba("hace falta service_role para tener una cuenta conocida");
  }

  const conCuenta = await auth("/recover", { metodo: "POST", cuerpo: { email: existente } });
  const sinCuenta = await auth("/recover", {
    metodo: "POST", cuerpo: { email: correoDePrueba("-nadie") },
  });

  if (conCuenta.estado === 429 || sinCuenta.estado === 429) {
    throw new OmitirPrueba("límite de envío de correo alcanzado");
  }
  exigirIgual(conCuenta.estado, sinCuenta.estado,
    "el código HTTP delata si el correo está registrado");
  exigirIgual(JSON.stringify(conCuenta.datos), JSON.stringify(sinCuenta.datos),
    "el cuerpo de la respuesta delata si el correo está registrado");
  return `ambas: HTTP ${conCuenta.estado}`;
});
