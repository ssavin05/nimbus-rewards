/* ======================================================================
   asistente — Proxy hacia el modelo de IA con herramientas reales.

   El modelo puede consultar el catálogo y la disponibilidad para
   responder con datos verdaderos, nunca inventados. Si falta la llave,
   la función responde 501 y el navegador cae a su motor local.

   Secretos necesarios:
     ANTHROPIC_API_KEY
     ASISTENTE_MODELO   (opcional, por defecto claude-sonnet-5)
   ====================================================================== */
import { preflight, respuesta, error, clienteServicio, clienteUsuario } from "../_compartido/utiles.ts";

const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODELO = Deno.env.get("ASISTENTE_MODELO") ?? "claude-sonnet-5";

const HERRAMIENTAS = [
  {
    name: "buscar_espacios",
    description: "Busca oficinas y salas del centro por tipo, capacidad, amenidades o presupuesto. Devuelve precios y disponibilidad reales.",
    input_schema: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Texto libre de lo que busca la persona" },
        tipo: { type: "string", enum: ["oficina", "sala_juntas", "coworking", "auditorio"] },
        capacidad_minima: { type: "integer" },
        precio_maximo_hora: { type: "number" },
        fecha: { type: "string", description: "AAAA-MM-DD" },
      },
    },
  },
  {
    name: "consultar_disponibilidad",
    description: "Devuelve los bloques horarios libres de un espacio en una fecha.",
    input_schema: {
      type: "object",
      properties: { espacio_id: { type: "string" }, fecha: { type: "string" } },
      required: ["espacio_id", "fecha"],
    },
  },
  {
    name: "mis_reservas",
    description: "Lista las reservas próximas del usuario que está conversando.",
    input_schema: { type: "object", properties: {} },
  },
];

const SISTEMA = `Eres el asistente del Smart Hub, un centro de negocios en Ensenada, Baja California.

Reglas:
- Responde SIEMPRE en el idioma del usuario (normalmente español de México), en tono cercano y directo.
- Usa las herramientas para consultar datos reales. NUNCA inventes precios, horarios ni disponibilidad.
- Si no encuentras algo, dilo con claridad y ofrece alternativas concretas.
- Sé breve: dos o tres frases más una lista corta cuando aplique.
- Precios en pesos mexicanos, sin IVA (se agrega al reservar).
- Bloques reservables de 1 hora, de 08:00 a 19:00, todos los días.
- Cancelación: gratis con 24 h de anticipación; después se retiene el 50 %.
- Método de pago público de V1: Clip (tarjeta en la página segura de Clip). No prometas Stripe, PayPal, Mercado Pago, carteras ni transferencia si no están habilitados.
- No pidas ni repitas datos de tarjetas. Para pagar, dirige a la persona al flujo de reserva de la app.`;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (!API_KEY) {
    return respuesta({ error: "asistente_no_configurado", detalle: "Falta ANTHROPIC_API_KEY" }, 501);
  }

  try {
    const { mensaje, historial = [], contexto = {} } = await req.json();
    if (!mensaje) return error("falta el mensaje", 400);

    const db = clienteUsuario(req);
    const { data: auth } = await db.auth.getUser();
    const usuarioId = auth?.user?.id ?? null;

    const mensajes = [
      ...historial.slice(-10).map((m: { rol: string; texto: string }) => ({
        role: m.rol === "usuario" ? "user" : "assistant",
        content: m.texto,
      })),
      { role: "user", content: mensaje },
    ];

    const contextoTexto = `Contexto: hoy es ${contexto.fecha_hoy ?? new Date().toISOString().slice(0, 10)}.`
      + (contexto.nombre ? ` El usuario se llama ${contexto.nombre}.` : " El usuario no ha iniciado sesión.")
      + (contexto.reservas_activas ? ` Tiene ${contexto.reservas_activas} reserva(s) próxima(s).` : "");

    let respuestaModelo = await llamarModelo(mensajes, contextoTexto);
    const espaciosCitados: unknown[] = [];

    // Bucle de herramientas (máximo 4 vueltas para acotar coste y latencia)
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      const usos = respuestaModelo.content?.filter((c: { type: string }) => c.type === "tool_use") ?? [];
      if (!usos.length) break;

      const resultados = [];
      for (const uso of usos) {
        const salida = await ejecutar(uso.name, uso.input, usuarioId, espaciosCitados);
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: JSON.stringify(salida) });
      }

      mensajes.push({ role: "assistant", content: respuestaModelo.content });
      mensajes.push({ role: "user", content: resultados });
      respuestaModelo = await llamarModelo(mensajes, contextoTexto);
    }

    const texto = (respuestaModelo.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text: string }) => c.text)
      .join("\n").trim();

    return respuesta({
      texto: texto || "No conseguí procesar eso. ¿Puedes decírmelo de otra forma?",
      espacios: espaciosCitados.slice(0, 3),
      acciones: [],
    });
  } catch (e) {
    return error(e.message, 500);
  }
});

async function llamarModelo(mensajes: unknown[], contextoTexto: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 900,
      system: `${SISTEMA}\n\n${contextoTexto}`,
      tools: HERRAMIENTAS,
      messages: mensajes,
    }),
  });
  const datos = await res.json();
  if (!res.ok) throw new Error(datos?.error?.message || `El modelo devolvió ${res.status}`);
  return datos;
}

async function ejecutar(nombre: string, entrada: Record<string, unknown>, usuarioId: string | null, acumulador: unknown[]) {
  const admin = clienteServicio();

  if (nombre === "buscar_espacios") {
    let q = admin.from("espacios")
      .select("id, nombre, codigo, tipo, capacidad, precio_hora, precio_dia, amenidades, estado, calificacion, descripcion")
      .eq("activo", true).eq("reservable", true).eq("estado", "disponible").limit(8);
    if (entrada.tipo) q = q.eq("tipo", entrada.tipo);
    if (entrada.capacidad_minima) q = q.gte("capacidad", entrada.capacidad_minima);
    if (entrada.precio_maximo_hora) q = q.lte("precio_hora", entrada.precio_maximo_hora);

    const { data } = await q;
    const lista = data ?? [];
    acumulador.push(...lista.slice(0, 3));
    return lista;
  }

  if (nombre === "consultar_disponibilidad") {
    const { data } = await admin.rpc("disponibilidad_dia", {
      p_espacio: entrada.espacio_id, p_fecha: entrada.fecha,
    });
    return { fecha: entrada.fecha, bloques: data ?? [] };
  }

  if (nombre === "mis_reservas") {
    if (!usuarioId) return { error: "el usuario no ha iniciado sesión" };
    const { data } = await admin.from("reservas")
      .select("folio, inicio, fin, estado, total, espacios(nombre)")
      .eq("usuario_id", usuarioId).gte("inicio", new Date().toISOString())
      .order("inicio").limit(5);
    return data ?? [];
  }

  return { error: "herramienta desconocida" };
}
