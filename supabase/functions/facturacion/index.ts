/* ======================================================================
   facturacion — Timbrado de CFDI 4.0 a través de un PAC.

   Este archivo deja el flujo completo y validado; sólo hay que enchufar
   el PAC que uses (Facturama, SW Sapien, Finkok…). Cada uno tiene su
   propio formato de petición, así que la llamada concreta queda en
   `timbrarConPAC`.

   Secretos necesarios:
     PAC_URL, PAC_USUARIO, PAC_PASSWORD
     EMISOR_RFC, EMISOR_RAZON_SOCIAL, EMISOR_REGIMEN, EMISOR_CP
   ====================================================================== */
import { preflight, respuesta, error, clienteServicio, requiereUsuario } from "../_compartido/utiles.ts";

const PAC_URL = Deno.env.get("PAC_URL") ?? "";
const HABILITADA = (Deno.env.get("FACTURACION_HABILITADA") ?? "").toLowerCase() === "si";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (!HABILITADA) return error("facturacion_no_habilitada", 503);
    const { usuario } = await requiereUsuario(req);

    const { factura_id } = await req.json();
    if (!factura_id) return error("falta factura_id", 400);
    if (!PAC_URL) return error("pac_no_configurado", 503);

    const admin = clienteServicio();
    // Incluso con service_role, acotamos explícitamente al dueño que
    // presentó el JWT. Conocer un UUID ajeno nunca debe permitir timbrar
    // o alterar la factura de otra persona.
    const { data: factura } = await admin.from("facturas")
      .select("*, pagos(*), usuarios(nombre, email)")
      .eq("id", factura_id)
      .eq("usuario_id", usuario.id)
      .maybeSingle();
    if (!factura) return error("factura no encontrada", 404);

    const resultado = await timbrarConPAC(factura);

    await admin.from("facturas").update({
      estado: resultado.ok ? "timbrada" : "error",
      uuid_fiscal: resultado.uuid ?? null,
      xml_url: resultado.xmlUrl ?? null,
      pdf_url: resultado.pdfUrl ?? null,
    }).eq("id", factura_id);

    if (resultado.ok) {
      await admin.from("notificaciones").insert({
        usuario_id: factura.usuario_id,
        tipo: "pago",
        titulo: "Tu factura está lista",
        cuerpo: `CFDI ${resultado.uuid} por ${factura.total} ${factura.moneda ?? "MXN"}.`,
        enlace: "/pagos",
      });
    }

    return respuesta(resultado);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    if (mensaje === "no_autorizado") return error(mensaje, 401);
    return error(mensaje, 500);
  }
});

/**
 * Adaptador del PAC. Sustituye el cuerpo por el formato de tu proveedor;
 * la forma del valor devuelto es la que espera el resto del sistema.
 */
async function timbrarConPAC(factura: Record<string, unknown>) {
  const comprobante = {
    Serie: "A",
    Folio: String(factura.folio ?? "").split("-").pop(),
    Fecha: new Date().toISOString().slice(0, 19),
    FormaPago: "03",              // transferencia electrónica
    MetodoPago: "PUE",            // pago en una sola exhibición
    Moneda: "MXN",
    TipoDeComprobante: "I",
    LugarExpedicion: Deno.env.get("EMISOR_CP") ?? "22800",
    Emisor: {
      Rfc: Deno.env.get("EMISOR_RFC"),
      Nombre: Deno.env.get("EMISOR_RAZON_SOCIAL"),
      RegimenFiscal: Deno.env.get("EMISOR_REGIMEN") ?? "601",
    },
    Receptor: {
      Rfc: factura.rfc,
      Nombre: factura.razon_social,
      DomicilioFiscalReceptor: factura.codigo_postal,
      RegimenFiscalReceptor: factura.regimen_fiscal ?? "616",
      UsoCFDI: factura.uso_cfdi ?? "G03",
    },
    Conceptos: [{
      ClaveProdServ: "80131502",   // arrendamiento de inmuebles no residenciales
      Cantidad: 1,
      ClaveUnidad: "E48",          // unidad de servicio
      Descripcion: "Renta de espacio de oficina",
      ValorUnitario: Number(factura.subtotal),
      Importe: Number(factura.subtotal),
      ObjetoImp: "02",
      Impuestos: {
        Traslados: [{
          Base: Number(factura.subtotal), Impuesto: "002", TipoFactor: "Tasa",
          TasaOCuota: "0.160000", Importe: Number(factura.impuestos),
        }],
      },
    }],
  };

  const res = await fetch(PAC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + btoa(`${Deno.env.get("PAC_USUARIO")}:${Deno.env.get("PAC_PASSWORD")}`),
    },
    body: JSON.stringify(comprobante),
  });
  const datos = await res.json();

  return {
    ok: res.ok,
    uuid: datos?.Complement?.TaxStamp?.Uuid ?? datos?.uuid ?? null,
    xmlUrl: datos?.xmlUrl ?? null,
    pdfUrl: datos?.pdfUrl ?? null,
    detalle: datos?.Message ?? datos?.message ?? null,
  };
}
