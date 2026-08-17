/* ======================================================================
   _compartido/utiles.ts — Piezas comunes a todas las Edge Functions.

   Aquí viven las llaves SECRETAS (leídas de variables de entorno). Nunca
   se exponen al navegador: el cliente sólo llama a estas funciones con
   su JWT y el servidor decide qué puede hacer.

   Configurar con:
     supabase secrets set STRIPE_SECRET_KEY=sk_live_... MP_ACCESS_TOKEN=...
   ====================================================================== */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ORIGEN_PERMITIDO") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function respuesta(datos: unknown, status = 200) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function error(mensaje: string, status = 400, extra: Record<string, unknown> = {}) {
  console.error(`[${status}] ${mensaje}`, extra);
  return respuesta({ error: mensaje, ...extra }, status);
}

export const preflight = (req: Request) =>
  req.method === "OPTIONS" ? new Response("ok", { headers: CORS }) : null;

/** Cliente con los permisos del usuario que llama (respeta RLS). */
export function clienteUsuario(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
}

/** Cliente con permisos totales. Úsalo sólo después de validar al usuario. */
export function clienteServicio(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/** Devuelve el usuario autenticado o lanza si no hay sesión válida. */
export async function requiereUsuario(req: Request) {
  const db = clienteUsuario(req);
  const { data, error: e } = await db.auth.getUser();
  if (e || !data?.user) throw new Error("no_autorizado");
  return { usuario: data.user, db };
}

/** Comprueba que la reserva sea del usuario y devuelve su importe real.
 *  Nunca se confía en el monto que manda el navegador. */
export async function reservaDelUsuario(reservaId: string, usuarioId: string) {
  const admin = clienteServicio();
  const { data, error: e } = await admin
    .from("reservas")
    .select("*, espacios(nombre, codigo), organizaciones:organizacion_id(moneda)")
    .eq("id", reservaId)
    .maybeSingle();
  if (e || !data) throw new Error("reserva_no_encontrada");
  if (data.usuario_id !== usuarioId) throw new Error("no_autorizado");
  if (data.estado === "cancelada") throw new Error("reserva_cancelada");
  return data;
}

/**
 * Igual que `reservaDelUsuario`, pero SÍ admite una reserva cancelada.
 *
 * Se separa a propósito: para cobrar hay que rechazar lo cancelado,
 * pero para devolver el dinero hay que aceptarlo — si no, el reembolso
 * es imposible por definición, porque cancelar es justo lo que dispara
 * el reembolso. Con el helper de cobro, `cancelarReserva()` cancelaba y
 * acto seguido la Edge Function respondía «reserva_cancelada»: el
 * dinero se quedaba en Stripe.
 *
 * Se sigue comprobando el dueño: nadie reembolsa la reserva de otro.
 */
export async function reservaParaReembolso(reservaId: string, usuarioId: string) {
  const admin = clienteServicio();
  const { data, error: e } = await admin
    .from("reservas")
    .select("*, espacios(nombre, codigo), organizaciones:organizacion_id(moneda)")
    .eq("id", reservaId)
    .maybeSingle();
  if (e || !data) throw new Error("reserva_no_encontrada");
  if (data.usuario_id !== usuarioId) throw new Error("no_autorizado");
  return data;
}

/** Marca la reserva como confirmada y registra/actualiza el pago. */
export async function confirmarPago(opciones: {
  reservaId: string;
  usuarioId: string;
  metodo: string;
  estado: string;
  monto: number;
  moneda?: string;
  proveedorId?: string;
  respuesta?: Record<string, unknown>;
  ultimos4?: string;
  marca?: string;
}) {
  const admin = clienteServicio();
  const { data: reserva, error: errLectura } = await admin
    .from("reservas")
    .select("organizacion_id, estado, expira_en")
    .eq("id", opciones.reservaId).maybeSingle();
  if (errLectura) throw errLectura;
  if (!reserva) throw new Error(`reserva ${opciones.reservaId} no existe`);

  // El apartado pudo vencer mientras la persona pagaba, y para entonces
  // otra puede tener ya ese horario. Una reserva caducada NO revive: se
  // avisa a quien llama para que devuelva el dinero.
  const caducada = reserva.estado === "cancelada"
    || (reserva.estado === "pendiente" && reserva.expira_en
        && new Date(reserva.expira_en) < new Date());

  const { error: errPago } = await admin.from("pagos").upsert({
    organizacion_id: reserva.organizacion_id,
    reserva_id: opciones.reservaId,
    usuario_id: opciones.usuarioId,
    metodo: opciones.metodo,
    estado: opciones.estado,
    monto: opciones.monto,
    moneda: opciones.moneda ?? "MXN",
    proveedor_id: opciones.proveedorId ?? null,
    ultimos4: opciones.ultimos4 ?? null,
    marca_tarjeta: opciones.marca ?? null,
    respuesta: opciones.respuesta ?? {},
    pagado_en: opciones.estado === "aprobado" ? new Date().toISOString() : null,
  }, { onConflict: "proveedor_id" });
  // Si esto falla y devolvemos 200, Stripe da el evento por procesado y
  // no lo reintenta: el cobro existe y en la base no consta. Que reviente.
  if (errPago) throw errPago;

  if (opciones.estado === "aprobado") {
    if (caducada) {
      // No se confirma. Se devuelve la señal para reembolsar.
      return { confirmada: false, caducada: true, organizacionId: reserva.organizacion_id };
    }
    const { error: errReserva } = await admin
      .from("reservas").update({ estado: "confirmada" }).eq("id", opciones.reservaId);
    if (errReserva) throw errReserva;
    return { confirmada: true, caducada: false, organizacionId: reserva.organizacion_id };
  }

  return { confirmada: false, caducada, organizacionId: reserva.organizacion_id };
}

export const centavos = (monto: number) => Math.round(Number(monto) * 100);
