/* ======================================================================
   generar.mjs — Construye las plantillas de correo de Smart Hub.

   Los archivos .html que hay al lado SE GENERAN con esto. Si hay que
   cambiar la cabecera, el pie o los colores, se cambia AQUÍ y se vuelve
   a ejecutar; si no, hay que tocar el mismo trozo nueve veces y a la
   tercera ya no coinciden.

       node supabase/plantillas/generar.mjs

   Reglas del correo, que no son las de la web:
     · CSS en línea. Gmail borra las etiquetas <style> del <head>.
     · Maquetación con <table>. Outlook usa el motor de Word y no
       entiende flexbox ni grid.
     · Ancho máximo 600 px, que es lo que cabe sin zoom en un móvil.
     · Colores explícitos en todo. Sin fondo declarado, el modo oscuro de
       algunos clientes pinta texto claro sobre fondo claro.
     · Nada de JavaScript, ni fuentes externas, ni imágenes remotas: casi
       todos los clientes las bloquean por defecto.
   ====================================================================== */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const AQUI = import.meta.dirname;

const MARCA = "Smart Hub";
const AZUL = "#2f6fed";
const TINTA = "#1a2233";
const SUAVE = "#5b6577";
const LINEA = "#e3e8f0";
const FONDO = "#f5f7fa";

/** Envoltorio común: cabecera, cuerpo y pie. */
const envolver = ({ asunto, previo, cuerpo, pie = "" }) => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${asunto}</title>
</head>
<body style="margin:0;padding:0;background:${FONDO};color:${TINTA};
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

<!-- Texto de vista previa: lo que se lee en la bandeja antes de abrir.
     Oculto dentro del correo. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${previo}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${FONDO};padding:24px 12px;">
  <tr><td align="center">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;
                  border:1px solid ${LINEA};overflow:hidden;">

      <!-- cabecera -->
      <tr><td style="padding:28px 32px 8px 32px;">
        <span style="font-size:19px;font-weight:700;color:${AZUL};letter-spacing:-0.2px;">${MARCA}</span>
      </td></tr>

      <!-- cuerpo -->
      <tr><td style="padding:8px 32px 32px 32px;font-size:15px;line-height:1.6;color:${TINTA};">
${cuerpo}
      </td></tr>

    </table>

    <!-- pie -->
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;">
      <tr><td style="padding:20px 32px;font-size:12px;line-height:1.5;color:${SUAVE};text-align:center;">
        ${pie ? `${pie}<br><br>` : ""}
        ${MARCA} · Ensenada, Baja California<br>
        <a href="{{SITIO}}/#/legal/privacidad" style="color:${SUAVE};">Aviso de privacidad</a> ·
        <a href="{{SITIO}}/#/legal/terminos" style="color:${SUAVE};">Términos</a>
      </td></tr>
    </table>

  </td></tr>
</table>
</body>
</html>
`;

const boton = (texto, url) => `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr><td style="background:${AZUL};border-radius:8px;">
            <a href="${url}" style="display:inline-block;padding:13px 26px;color:#ffffff;
               font-size:15px;font-weight:600;text-decoration:none;">${texto}</a>
          </td></tr>
        </table>`;

/** Ficha de datos de una reserva. */
const ficha = (filas) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin:20px 0;border:1px solid ${LINEA};border-radius:10px;">
${filas.map(([k, v], i) => `          <tr>
            <td style="padding:12px 16px;font-size:13px;color:${SUAVE};${i ? `border-top:1px solid ${LINEA};` : ""}">${k}</td>
            <td style="padding:12px 16px;font-size:14px;font-weight:600;text-align:right;${i ? `border-top:1px solid ${LINEA};` : ""}">${v}</td>
          </tr>`).join("\n")}
        </table>`;

const aviso = (texto) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin:20px 0;background:#fff8ed;border:1px solid #f5d9ae;border-radius:10px;">
          <tr><td style="padding:14px 16px;font-size:13px;line-height:1.55;color:#7a5518;">${texto}</td></tr>
        </table>`;

/* ======================================================================
   1. Correos de CUENTA — se pegan en Supabase
      Dashboard → Authentication → Email Templates
      Las variables {{ .Algo }} las rellena Supabase.
   ====================================================================== */
const CUENTA = {
  "cuenta-01-confirmar-registro": {
    asunto: "Confirma tu correo",
    previo: `Un clic y tu cuenta de ${MARCA} queda lista.`,
    cuerpo: `        <h1 style="margin:12px 0 8px;font-size:22px;">Confirma tu correo</h1>
        <p style="margin:0 0 4px;">Ya casi. Pulsa el botón para activar tu cuenta y empezar a reservar.</p>
${boton("Confirmar mi correo", "{{ .ConfirmationURL }}")}
        <p style="margin:0;font-size:13px;color:${SUAVE};">
          Si el botón no funciona, copia esta dirección en tu navegador:<br>
          <span style="word-break:break-all;">{{ .ConfirmationURL }}</span>
        </p>`,
    pie: "Si no creaste ninguna cuenta, ignora este mensaje: no se activará nada.",
  },

  "cuenta-02-recuperar-password": {
    asunto: "Restablece tu contraseña",
    previo: "Enlace para elegir una contraseña nueva.",
    cuerpo: `        <h1 style="margin:12px 0 8px;font-size:22px;">Restablece tu contraseña</h1>
        <p style="margin:0 0 4px;">Pulsa el botón y elige una nueva. El enlace caduca en una hora.</p>
${boton("Elegir contraseña nueva", "{{ .ConfirmationURL }}")}
        <p style="margin:0;font-size:13px;color:${SUAVE};">
          Si el botón no funciona, copia esta dirección en tu navegador:<br>
          <span style="word-break:break-all;">{{ .ConfirmationURL }}</span>
        </p>`,
    pie: "Si no pediste cambiarla, ignora este mensaje. Tu contraseña actual sigue funcionando.",
  },

  "cuenta-03-cambio-de-correo": {
    asunto: "Confirma tu nuevo correo",
    previo: "Confirma el cambio de dirección de tu cuenta.",
    cuerpo: `        <h1 style="margin:12px 0 8px;font-size:22px;">Confirma tu nuevo correo</h1>
        <p style="margin:0 0 4px;">
          Pediste cambiar la dirección de tu cuenta a <strong>{{ .Email }}</strong>.
          Confírmalo para que el cambio surta efecto.
        </p>
${boton("Confirmar el cambio", "{{ .ConfirmationURL }}")}`,
    pie: "Si no fuiste tú, no pulses nada y avísanos: alguien pudo entrar en tu cuenta.",
  },
};

/* ======================================================================
   2. Correos TRANSACCIONALES — los manda tu Edge Function
      Variables {{NOMBRE}} en MAYÚSCULAS: se sustituyen en el servidor.
   ====================================================================== */
const TRANSACCIONALES = {
  "aviso-01-bienvenida": {
    asunto: `Bienvenido a ${MARCA}`,
    previo: "Tu cuenta está lista. Así se reserva.",
    cuerpo: `        <h1 style="margin:12px 0 8px;font-size:22px;">Hola, {{NOMBRE}}</h1>
        <p style="margin:0 0 12px;">Tu cuenta ya está activa. Reservar una oficina lleva menos de un minuto:</p>
        <ol style="margin:0 0 4px;padding-left:20px;color:${TINTA};">
          <li style="margin-bottom:6px;">Elige la oficina en el catálogo o en el mapa 3D del edificio.</li>
          <li style="margin-bottom:6px;">Escoge el día y el bloque de dos horas.</li>
          <li>Paga y listo: te llega la confirmación al momento.</li>
        </ol>
${boton("Ver las oficinas", "{{SITIO}}/#/espacios")}`,
  },

  "aviso-02-reserva-confirmada": {
    asunto: "Reserva confirmada · {{ESPACIO}}",
    previo: "{{ESPACIO}} · {{FECHA}} a las {{HORA}}",
    cuerpo: `        <h1 style="margin:12px 0 8px;font-size:22px;">Reserva confirmada</h1>
        <p style="margin:0;">Todo listo, {{NOMBRE}}. Te esperamos.</p>
${ficha([
  ["Espacio", "{{ESPACIO}}"],
  ["Día", "{{FECHA}}"],
  ["Hora", "{{HORA}}"],
  ["Personas", "{{ASISTENTES}}"],
  ["Folio", "{{FOLIO}}"],
  ["Total pagado", "{{TOTAL}}"],
])}
        <p style="margin:0 0 4px;font-size:13px;color:${SUAVE};">
          Puedes cancelar sin costo hasta {{HORAS_GRATIS}} horas antes.
        </p>
${boton("Ver mi reserva", "{{SITIO}}/#/reservas")}`,
  },

  "aviso-03-recordatorio": {
    asunto: "Mañana: {{ESPACIO}} a las {{HORA}}",
    previo: "Recordatorio de tu reserva.",
    cuerpo: `        <h1 style="margin:12px 0 8px;font-size:22px;">Tu reserva es {{CUANDO}}</h1>
${ficha([
  ["Espacio", "{{ESPACIO}}"],
  ["Día", "{{FECHA}}"],
  ["Hora", "{{HORA}}"],
  ["Folio", "{{FOLIO}}"],
])}
        <p style="margin:0;">El acceso es por recepción. Si vas con retraso, avísanos por el chat de la app.</p>
${boton("Ver mi reserva", "{{SITIO}}/#/reservas")}`,
  },

  "aviso-04-pago-recibido": {
    asunto: "Recibimos tu pago · {{FOLIO}}",
    previo: "Comprobante de pago de {{TOTAL}}.",
    cuerpo: `        <h1 style="margin:12px 0 8px;font-size:22px;">Pago recibido</h1>
        <p style="margin:0;">Gracias, {{NOMBRE}}. Éste es tu comprobante.</p>
${ficha([
  ["Folio", "{{FOLIO}}"],
  ["Espacio", "{{ESPACIO}}"],
  ["Subtotal", "{{SUBTOTAL}}"],
  ["IVA", "{{IMPUESTOS}}"],
  ["Total", "{{TOTAL}}"],
  ["Método", "{{METODO}}"],
])}
        <p style="margin:0;font-size:13px;color:${SUAVE};">
          ¿Necesitas factura? Pídela desde la app en Historial de pagos.
        </p>`,
  },

  "aviso-05-reserva-cancelada": {
    asunto: "Reserva cancelada · {{FOLIO}}",
    previo: "Tu reserva quedó cancelada.",
    cuerpo: `        <h1 style="margin:12px 0 8px;font-size:22px;">Reserva cancelada</h1>
        <p style="margin:0;">Cancelamos tu reserva. Aquí van los datos por si los necesitas.</p>
${ficha([
  ["Espacio", "{{ESPACIO}}"],
  ["Era el", "{{FECHA}} a las {{HORA}}"],
  ["Folio", "{{FOLIO}}"],
  ["Se te devuelve", "{{REEMBOLSO}}"],
])}
${aviso("El importe vuelve por el mismo medio con el que pagaste. Tu banco suele tardar entre 5 y 10 días hábiles en reflejarlo.")}
${boton("Reservar otra vez", "{{SITIO}}/#/espacios")}`,
  },

  "aviso-06-reembolso-emitido": {
    asunto: "Reembolso en camino · {{REEMBOLSO}}",
    previo: "Ya ordenamos la devolución.",
    cuerpo: `        <h1 style="margin:12px 0 8px;font-size:22px;">Reembolso en camino</h1>
        <p style="margin:0;">Ordenamos la devolución de {{REEMBOLSO}} por el folio {{FOLIO}}.</p>
${ficha([
  ["Importe", "{{REEMBOLSO}}"],
  ["Vuelve a", "{{METODO}}"],
  ["Folio", "{{FOLIO}}"],
])}
${aviso("A partir de aquí depende de tu banco: normalmente entre 5 y 10 días hábiles. Si pasado ese plazo no aparece, escríbenos con el folio y lo revisamos.")}`,
  },
};

/* ---------------------------------------------------------------------- */
let n = 0;
for (const [grupo, plantillas] of [["cuenta", CUENTA], ["transaccional", TRANSACCIONALES]]) {
  for (const [nombre, def] of Object.entries(plantillas)) {
    await writeFile(join(AQUI, `${nombre}.html`), envolver(def), "utf8");
    n++;
    console.log(`  ✅ ${nombre}.html  (${grupo})  —  asunto: ${def.asunto}`);
  }
}
console.log(`\n${n} plantillas generadas en supabase/plantillas/`);
