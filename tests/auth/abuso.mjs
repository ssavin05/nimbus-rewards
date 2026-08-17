/* AUTH-16 — Límites y abuso.
 *
 * Primero se MIDE qué trae Supabase de fábrica. Sólo si no frena nada
 * tiene sentido añadir algo por nuestra cuenta, y el CAPTCHA sería lo
 * último de la lista.
 *
 * ⚠️ AVISO SOBRE LA MEDICIÓN
 * El freno de Supabase es POR DIRECCIÓN IP. Si estas pruebas se corren
 * detrás de un proxy que reparte la salida entre varias IP —como pasa
 * en un entorno de agente o en una CI— cada petición puede parecerle a
 * Supabase que viene de un sitio distinto, y el límite no se activa
 * nunca. En ese caso, «no vi ningún 429» NO demuestra que no haya
 * protección: demuestra que desde aquí no se puede medir.
 *
 * Por eso estas pruebas informan del número de intentos y del veredicto
 * por separado, y sólo dan por bueno un resultado cuando ven el freno.
 */
import { caso, grupo, auth, entrar, exigir, correoDePrueba, OmitirPrueba } from "./_comun.mjs";

grupo("Abuso y límites");

const INTENTOS_LOGIN = Number(process.env.INTENTOS_LOGIN || 40);

caso("AUTH-16a", "Freno a la fuerza bruta en el login", "A", async () => {
  const email = correoDePrueba("-fuerzabruta");
  const codigos = [];
  for (let i = 0; i < INTENTOS_LOGIN; i++) {
    const r = await entrar(email, `intento-${i}`);
    codigos.push(r.estado);
    if (r.estado === 429) break;
  }
  const frenado = codigos.includes(429);
  if (frenado) return `frenado en el intento ${codigos.length}`;

  // Sin 429 no se puede afirmar nada en un sentido ni en el otro.
  throw new OmitirPrueba(
    `${codigos.length} intentos fallidos seguidos sin ningún 429 ` +
    `(códigos vistos: ${[...new Set(codigos)].join(", ")}). ` +
    `El límite de Supabase es por IP y aquí la salida puede ir por varias, ` +
    `así que esto NO prueba que falte la protección: hay que repetirlo desde ` +
    `una IP fija, o revisar Authentication → Attack Protection en el panel.`);
});

caso("AUTH-16b", "Pedir recuperación de un correo desconocido no manda nada", "A", async () => {
  // Ojo: para un correo que no existe, Supabase responde 200 y NO envía
  // nada. Eso es lo correcto (no delata quién está registrado) y explica
  // que no salte el límite de envío. Lo que se comprueba aquí es
  // justamente eso: que responde igual y sin gastar cupo de correo.
  const codigos = [];
  for (let i = 0; i < 6; i++) {
    const r = await auth("/recover", {
      metodo: "POST", cuerpo: { email: correoDePrueba("-desconocido") },
    });
    codigos.push(r.estado);
  }
  const unicos = [...new Set(codigos)];
  exigir(!codigos.includes(500), `hubo errores de servidor: ${unicos.join(", ")}`);
  exigir(unicos.length === 1,
    `la respuesta cambia entre peticiones (${unicos.join(", ")}): eso permite deducir información`);
  exigir(!codigos.includes(429),
    "un correo inexistente consume cupo de envío: eso permite agotar el buzón del proyecto desde fuera");
  return `6 peticiones, todas HTTP ${unicos[0]}, sin gastar cupo`;
});

caso("AUTH-16c", "El remitente de correo aguanta uso real", "A", async () => {
  // Supabase trae un remitente compartido con un cupo muy pequeño por
  // hora. Sirve para una demostración; con usuarios de verdad, el
  // segundo o tercer registro de la hora ya no recibe el enlace y la
  // cuenta se queda colgada sin poder confirmarse.
  const r = await auth("/signup", {
    metodo: "POST",
    cuerpo: { email: correoDePrueba("-cupo"), password: "ClaveDePrueba123" },
  });
  exigir(r.datos?.error_code !== "over_email_send_rate_limit",
    "el proyecto usa el remitente de fábrica y ya agotó su cupo por hora. " +
    "Con la confirmación de correo activada, los registros reales se quedan sin " +
    "el enlace y la cuenta no se puede activar. " +
    "Hay que configurar un SMTP propio en Authentication → Emails → SMTP Settings");
  return `signup respondió ${r.estado}`;
});
