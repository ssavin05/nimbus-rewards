# Plantillas de correo — Smart Hub

Nueve correos listos para usar, con la marca puesta. Se generan con
`node supabase/plantillas/generar.mjs`: si hay que cambiar colores,
cabecera o pie, se cambia **ahí** y se vuelve a ejecutar. Editar los
`.html` a mano funciona una vez y se pierde a la siguiente.

> **No hay servidor de correo configurado.** Estas plantillas no se
> envían solas. Hace falta un SMTP — ver `OWNER_ACTIONS.md §7`.

---

## 1. Correos de cuenta (los manda Supabase)

Se pegan en **Dashboard → Authentication → Email Templates**.

| Archivo | Plantilla de Supabase |
|---|---|
| `cuenta-01-confirmar-registro.html` | Confirm signup |
| `cuenta-02-recuperar-password.html` | Reset password |
| `cuenta-03-cambio-de-correo.html` | Change email address |

Llevan las variables de Supabase (`{{ .ConfirmationURL }}`,
`{{ .Email }}`), que se rellenan solas. **No las cambies de nombre.**

Queda una por sustituir a mano: `{{SITIO}}` en los enlaces del pie.
Ponle la URL de tu dominio, sin barra final.

---

## 2. Correos transaccionales (los mandas tú)

Estos los envía tu propio código —una Edge Function— cuando pasa algo.
Usan variables en MAYÚSCULAS que hay que sustituir antes de enviar.

| Archivo | Cuándo se manda |
|---|---|
| `aviso-01-bienvenida.html` | al confirmar la cuenta |
| `aviso-02-reserva-confirmada.html` | al completarse el pago |
| `aviso-03-recordatorio.html` | 24 h y 1 h antes |
| `aviso-04-pago-recibido.html` | al cobrar |
| `aviso-05-reserva-cancelada.html` | al cancelar |
| `aviso-06-reembolso-emitido.html` | al ordenar la devolución |

### Variables

| Variable | Qué es |
|---|---|
| `{{SITIO}}` | URL de tu dominio, sin barra final |
| `{{NOMBRE}}` | nombre de la persona |
| `{{ESPACIO}}` | nombre de la oficina |
| `{{FECHA}}` `{{HORA}}` | **en hora del edificio**, ver aviso abajo |
| `{{CUANDO}}` | «mañana» o «en una hora» |
| `{{FOLIO}}` | folio de la reserva |
| `{{ASISTENTES}}` | número de personas |
| `{{SUBTOTAL}}` `{{IMPUESTOS}}` `{{TOTAL}}` | importes ya formateados |
| `{{METODO}}` | método de pago |
| `{{REEMBOLSO}}` | importe devuelto |
| `{{HORAS_GRATIS}}` | horas para cancelar sin costo (hoy: 24) |

> ⚠️ **La hora del correo tiene que ser la del edificio.** Los
> `timestamptz` de la base van en UTC. Al formatear, pasa siempre
> `timeZone: 'America/Tijuana'`; si no, el correo dirá una hora y la app
> otra. Esto ya falló una vez en el cliente — ver `tests/zona-horaria.mjs`.

---

## 3. Por qué el HTML es así de anticuado

El correo no es la web:

- **CSS en línea.** Gmail borra las etiquetas `<style>` del `<head>`.
- **Maquetación con `<table>`.** Outlook renderiza con el motor de Word:
  ni flexbox ni grid.
- **600 px de ancho máximo**, que es lo que cabe sin zoom en un móvil.
- **Colores explícitos en todo.** Sin fondo declarado, el modo oscuro de
  algunos clientes pinta texto claro sobre fondo claro y no se lee nada.
- **Sin imágenes remotas ni fuentes externas**: la mayoría de clientes
  las bloquean por defecto, así que el correo tiene que verse bien sin
  cargar nada.
- **Texto de vista previa** oculto al principio: es lo que se lee en la
  bandeja de entrada antes de abrir.

---

## 4. Antes de darlos por buenos

- [ ] Sustituir `{{SITIO}}` por tu dominio real
- [ ] Enviar uno de prueba a Gmail, Outlook y Apple Mail
- [ ] Mirarlos en el móvil, no sólo en el escritorio
- [ ] Probarlos en modo oscuro
- [ ] Comprobar que no caen en spam (SPF, DKIM y DMARC — `OWNER_ACTIONS.md §7`)
- [ ] Que los enlaces del pie lleven a las páginas legales de verdad
