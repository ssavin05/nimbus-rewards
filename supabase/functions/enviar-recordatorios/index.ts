/* ======================================================================
   enviar-recordatorios — Envía las notificaciones push programadas.

   Pensado para ejecutarse cada 5 minutos con pg_cron o el programador
   de Supabase:

     select cron.schedule(
       'recordatorios', '*/5 * * * *',
       $$ select net.http_post(
            url := 'https://TU-PROYECTO.supabase.co/functions/v1/enviar-recordatorios',
            headers := '{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb
          ) $$);

   Secretos necesarios:
     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…)
   ====================================================================== */
import webpush from "https://esm.sh/web-push@3.6.7";
import { preflight, respuesta, error, clienteServicio } from "../_compartido/utiles.ts";

const PUBLICA = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const PRIVADA = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
// VAPID_SUBJECT tiene que ser un mailto: o una URL REAL: es a quien
// avisa el servicio de push del navegador si algo va mal con los envíos.
// Sin valor configurado no se manda nada, en vez de firmar con un correo
// inventado que nadie lee.
const SUJETO = Deno.env.get("VAPID_SUBJECT") ?? "";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  // El sujeto es obligatorio para el estándar Web Push: `setVapidDetails`
  // lo rechaza si no es un mailto: o una URL, así que se comprueba junto
  // a las llaves en vez de dejar que reviente en cada envío.
  if (!PUBLICA || !PRIVADA || !SUJETO) {
    return respuesta({
      error: "push_no_configurado",
      detalle: "Faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT (mailto: o URL de contacto real)",
    }, 501);
  }
  webpush.setVapidDetails(SUJETO, PUBLICA, PRIVADA);

  const admin = clienteServicio();
  try {
    // Notificaciones cuya hora programada ya llegó y siguen sin enviarse.
    const { data: pendientes } = await admin.from("notificaciones")
      .select("*")
      .eq("enviada_push", false)
      .lte("programada_para", new Date().toISOString())
      .limit(200);

    let enviadas = 0, fallidas = 0;

    for (const notif of pendientes ?? []) {
      const { data: perfil } = await admin.from("usuarios")
        .select("notif_push, notif_recordatorios").eq("id", notif.usuario_id).maybeSingle();

      const permitido = perfil?.notif_push !== false
        && (notif.tipo !== "recordatorio" || perfil?.notif_recordatorios !== false);

      if (!permitido) {
        await admin.from("notificaciones").update({ enviada_push: true }).eq("id", notif.id);
        continue;
      }

      const { data: suscripciones } = await admin.from("push_suscripciones")
        .select("*").eq("usuario_id", notif.usuario_id);

      const carga = JSON.stringify({
        titulo: notif.titulo,
        cuerpo: notif.cuerpo,
        tipo: notif.tipo,
        enlace: notif.enlace ?? "#/",
        datos: notif.datos ?? {},
      });

      for (const s of suscripciones ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            carga,
          );
          enviadas++;
        } catch (e) {
          fallidas++;
          // 404/410 = suscripción caducada: se limpia.
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await admin.from("push_suscripciones").delete().eq("id", s.id);
          }
        }
      }

      await admin.from("notificaciones").update({ enviada_push: true }).eq("id", notif.id);
    }

    // Marca como completadas las reservas que ya terminaron.
    await admin.from("reservas")
      .update({ estado: "completada" })
      .in("estado", ["confirmada", "en_curso"])
      .lt("fin", new Date().toISOString());

    return respuesta({ procesadas: pendientes?.length ?? 0, enviadas, fallidas });
  } catch (e) {
    return error(e.message, 500);
  }
});
