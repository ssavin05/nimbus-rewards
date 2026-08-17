/* AUTH-05 a AUTH-08 — Confirmación y login */
import {
  caso, grupo, auth, rest, entrar, exigir, exigirIgual, correoDePrueba,
  crearUsuarioListo, crearUsuarioSinConfirmar, generarEnlace, admin,
  borrarUsuario, HAY_SERVICIO, OmitirPrueba,
} from "./_comun.mjs";

grupo("Confirmación y login");

caso("AUTH-05", "Confirmación de correo", "B", async ({ limpiar }) => {
  if (!HAY_SERVICIO) throw new OmitirPrueba("hace falta service_role para generar el enlace");
  const u = await crearUsuarioSinConfirmar();
  limpiar(() => borrarUsuario(u.id));

  // 1. Sin confirmar, no se entra.
  const antes = await entrar(u.email, u.password);
  exigir(antes.estado >= 300, "se pudo entrar SIN haber confirmado el correo");
  exigir(/not confirmed|email_not_confirmed/i.test(antes.texto),
    `rechazado, pero no por falta de confirmación: ${antes.texto.slice(0, 100)}`);

  // 2. El enlace que normalmente llegaría por correo.
  const enlace = await generarEnlace("signup", u.email, { password: u.password });
  exigir(enlace.action_link, "generate_link no devolvió el enlace");

  // Antes de pulsar, en la propia identidad NO puede constar confirmado.
  const fichaAntes = await admin(`/users/${u.id}`);
  exigir(!fichaAntes.datos?.email_confirmed_at,
    "la cuenta ya constaba confirmada antes de pulsar el enlace");

  // 3. Seguirlo, igual que haría el navegador.
  const verificado = await fetch(enlace.action_link, { redirect: "manual" });
  exigir(verificado.status < 500, `el enlace devolvió ${verificado.status}`);

  // 4. El EFECTO, no que la URL se generase: `email_confirmed_at` tiene
  //    que haber cambiado en auth.users. (Antes esto leía
  //    public.usuarios y sólo comprobaba que la fila existiera, que no
  //    demuestra nada sobre la confirmación.)
  const fichaDespues = await admin(`/users/${u.id}`);
  exigir(fichaDespues.datos?.email_confirmed_at,
    "se siguió el enlace pero email_confirmed_at sigue vacío");

  // 5. Y el efecto observable para la persona: ahora entra.
  const despues = await entrar(u.email, u.password);
  exigirIgual(despues.estado, 200, "entrar después de confirmar");
  exigir(despues.datos?.access_token, "no llegó el token tras confirmar");

  // 6. El enlace no puede servir dos veces.
  const reintento = await fetch(enlace.action_link, { redirect: "manual" });
  const destino = reintento.headers.get("location") || "";
  exigir(/error/i.test(destino) || reintento.status >= 400,
    "el enlace de confirmación se puede reutilizar");

  return `confirmado en ${fichaDespues.datos.email_confirmed_at}; enlace no reutilizable`;
});

caso("AUTH-06", "Login válido", "A", async ({ limpiar }) => {
  if (!HAY_SERVICIO) throw new OmitirPrueba("hace falta service_role para preparar la cuenta");
  const u = await crearUsuarioListo();
  limpiar(() => borrarUsuario(u.id));

  const r = await entrar(u.email, u.password);
  exigirIgual(r.estado, 200, "entrar con credenciales correctas");
  exigir(r.datos?.access_token, "no llegó access_token");
  exigir(r.datos?.refresh_token, "no llegó refresh_token");

  // Y con ese token se tiene que poder leer el propio perfil.
  const perfil = await rest("/usuarios?select=id,rol&limit=1", { token: r.datos.access_token });
  exigirIgual(perfil.estado, 200, "leer el perfil con el token recién emitido");
  return `token emitido, expira en ${r.datos.expires_in}s`;
});

caso("AUTH-07", "Login incorrecto: mismo mensaje siempre", "A", async ({ limpiar }) => {
  if (!HAY_SERVICIO) throw new OmitirPrueba("hace falta service_role para preparar la cuenta");
  const u = await crearUsuarioListo();
  limpiar(() => borrarUsuario(u.id));

  const malaClave   = await entrar(u.email, "ClaveEquivocada999");
  const noExiste    = await entrar(correoDePrueba("-fantasma"), "ClaveEquivocada999");

  exigir(malaClave.estado >= 300, "entró con la contraseña equivocada");
  exigir(noExiste.estado >= 300, "entró con un correo que no existe");

  // Que no se pueda distinguir «existe pero la clave está mal» de
  // «no existe»: si se distingue, se pueden enumerar cuentas.
  exigirIgual(malaClave.estado, noExiste.estado, "el código HTTP distingue los dos casos");
  exigirIgual(malaClave.datos?.error_code, noExiste.datos?.error_code,
    "el código de error distingue los dos casos");
  exigirIgual(malaClave.datos?.msg, noExiste.datos?.msg,
    "el mensaje distingue los dos casos");

  exigir(!malaClave.datos?.access_token && !noExiste.datos?.access_token,
    "se emitió un token pese al rechazo");
  return `ambos: HTTP ${malaClave.estado} · "${malaClave.datos?.msg}"`;
});

caso("AUTH-08", "Usuario sin confirmar no entra", "A", async ({ limpiar }) => {
  if (!HAY_SERVICIO) throw new OmitirPrueba("hace falta service_role para preparar la cuenta");
  const u = await crearUsuarioSinConfirmar();
  limpiar(() => borrarUsuario(u.id));

  const r = await entrar(u.email, u.password);
  exigir(r.estado >= 300, "una cuenta sin confirmar pudo iniciar sesión");
  exigir(!r.datos?.access_token, "se emitió token a una cuenta sin confirmar");
  exigir(/not confirmed|email_not_confirmed/i.test(r.texto),
    `el motivo del rechazo no menciona la confirmación: ${r.texto.slice(0, 110)}`);
  return `rechazo con ${r.datos?.error_code || r.estado}`;
});
