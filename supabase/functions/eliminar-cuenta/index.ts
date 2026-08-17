/* ======================================================================
   eliminar-cuenta — Borra la cuenta de quien la solicita.

   Criterio: se borra TODO lo que identifica a la persona. Sólo se
   conserva, y anonimizado, lo que la ley obliga a guardar (comprobantes
   de operaciones cobradas).

   Se borra por completo
   ---------------------
   favoritos · reseñas · lista de espera · notificaciones ·
   suscripciones push · conversaciones y sus mensajes · usos de
   promociones · membresías de organización · avatar en Storage ·
   la cuenta de acceso (auth.users)

   Se conserva anonimizado
   -----------------------
   reservas, pagos y facturas ya cobrados. Pierden el vínculo con la
   persona (`usuario_id` queda en NULL) y el nombre y el correo copiados
   en el registro se sustituyen por un marcador.

   Requiere haber aplicado schema.sql actualizado o
   migracion-01-borrado-cuenta.sql: sin eso las llaves foráneas con
   ON DELETE RESTRICT impiden el borrado.
   ====================================================================== */
import { preflight, respuesta, error, requiereUsuario, clienteServicio } from "../_compartido/utiles.ts";

const ANONIMO = "Cuenta eliminada";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  let usuarioId = "";
  try {
    const { usuario } = await requiereUsuario(req);
    usuarioId = usuario.id;
    const admin = clienteServicio();
    const detalle: Record<string, number | string> = {};

    /* ---------- 1. Reservas futuras: se cancelan y liberan el horario ---------- */
    const { data: canceladas } = await admin.from("reservas")
      .update({
        estado: "cancelada",
        cancelada_en: new Date().toISOString(),
        motivo_cancelacion: "Cuenta eliminada por la persona usuaria",
      })
      .eq("usuario_id", usuarioId)
      .in("estado", ["pendiente", "confirmada", "en_curso"])
      .gt("inicio", new Date().toISOString())
      .select("id");
    detalle.reservas_canceladas = canceladas?.length ?? 0;

    /* ---------- 2. Datos personales: se borran ---------- */
    const aBorrar = [
      "favoritos",
      "resenas",
      "lista_espera",
      "notificaciones",
      "push_suscripciones",
      "promocion_usos",
      "organizacion_usuarios",
      "conversaciones",      // arrastra `mensajes` por ON DELETE CASCADE
    ];

    for (const tabla of aBorrar) {
      const { error: e, count } = await admin
        .from(tabla).delete({ count: "exact" }).eq("usuario_id", usuarioId);
      if (e) {
        console.warn(`[eliminar-cuenta] ${tabla}: ${e.message}`);
        detalle[tabla] = `error: ${e.message}`;
      } else {
        detalle[tabla] = count ?? 0;
      }
    }

    // Los mensajes que escribió en conversaciones de otras personas
    // (por ejemplo si era staff) pierden el autor pero no el hilo.
    await admin.from("mensajes").update({ autor_id: null }).eq("autor_id", usuarioId);

    /* ---------- 3. Avatar en Storage ---------- */
    detalle.avatares = await borrarCarpeta(admin, "avatares", usuarioId);

    /* ---------- 4. Comprobantes: se anonimizan, no se borran ---------- */
    for (const tabla of ["reservas", "pagos"]) {
      const { error: e } = await admin.from(tabla)
        .update({ usuario_id: null, cliente_nombre: ANONIMO, cliente_email: null })
        .eq("usuario_id", usuarioId);
      if (e) console.warn(`[eliminar-cuenta] anonimizar ${tabla}: ${e.message}`);
    }
    // En las facturas el RFC y la razón social son el dato fiscal: se
    // conservan tal cual, pero se corta el vínculo y el correo de envío.
    await admin.from("facturas").update({ usuario_id: null, email: null }).eq("usuario_id", usuarioId);

    /* ---------- 5. Perfil ---------- */
    const { error: ePerfil } = await admin.from("usuarios").delete().eq("id", usuarioId);
    if (ePerfil) {
      // Si algo sigue apuntando al perfil, al menos se vacía de datos.
      console.warn("[eliminar-cuenta] no se pudo borrar el perfil, se anonimiza:", ePerfil.message);
      await admin.from("usuarios").update({
        nombre: ANONIMO, email: null, telefono: null, avatar_url: null,
        empresa: null, rfc: null, datos_facturacion: {},
        notif_push: false, notif_email: false, notif_recordatorios: false,
      }).eq("id", usuarioId);
      detalle.perfil = "anonimizado";
    } else {
      detalle.perfil = "borrado";
    }

    /* ---------- 6. Cuenta de acceso ---------- */
    const { error: eAuth } = await admin.auth.admin.deleteUser(usuarioId);
    if (eAuth) {
      // Sin poder borrar la cuenta, la persona todavía podría entrar.
      // Es un fallo real: se reporta en vez de fingir que salió bien.
      return error(
        "Se borraron tus datos, pero la cuenta de acceso no pudo eliminarse. "
        + "Escríbenos y la quitamos a mano.",
        500,
        { detalle, motivo: eAuth.message },
      );
    }

    console.info("[eliminar-cuenta] completado", usuarioId, detalle);
    return respuesta({ eliminada: true, detalle });

  } catch (e) {
    const status = e.message === "no_autorizado" ? 401 : 500;
    return error(e.message, status, { usuario: usuarioId || undefined });
  }
});

/** Borra todos los archivos de una carpeta de Storage. */
async function borrarCarpeta(admin: ReturnType<typeof clienteServicio>, bucket: string, carpeta: string) {
  try {
    const { data, error: e } = await admin.storage.from(bucket).list(carpeta, { limit: 100 });
    if (e || !data?.length) return 0;
    const rutas = data.map((f) => `${carpeta}/${f.name}`);
    const { error: eBorrado } = await admin.storage.from(bucket).remove(rutas);
    if (eBorrado) { console.warn(`[eliminar-cuenta] storage ${bucket}: ${eBorrado.message}`); return 0; }
    return rutas.length;
  } catch (err) {
    console.warn(`[eliminar-cuenta] storage ${bucket}:`, err);
    return 0;
  }
}
