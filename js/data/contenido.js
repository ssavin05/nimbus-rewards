/* ======================================================================
   contenido.js — Contenido público de “Quiénes somos”.

   V1 sólo publica afirmaciones que salen del propio producto/catálogo.
   Nada de años de fundación, equipo, servicios presenciales, domicilio,
   accesibilidad, limpieza, fibra, paquetería o facturación hasta que el
   propietario los confirme. Los datos de contacto viven en config.js.
   ====================================================================== */
import { CONTACT, BOOKING } from "../core/config.js";
import { ENVOLVENTE } from "./planta.js";

export const NOSOTROS = {
  eyebrow: "Oficinas privadas en Ensenada",
  titulo: "Reserva una oficina sin adivinar qué estás eligiendo",
  entrada:
    "Smart Hub reúne el catálogo, el mapa 3D y la disponibilidad de las oficinas "
    + "en una sola experiencia para que puedas comparar el espacio antes de reservar.",
  imagenPortada: "",

  historia: {
    titulo: "Cómo funciona",
    parrafos: [
      "El catálogo comercial actual está formado por cuatro oficinas privadas. Cada ficha muestra su capacidad, precio, fotografías disponibles y ubicación dentro del edificio.",
      "La disponibilidad se consulta contra el servidor al elegir fecha y horario. Una reserva no se presenta como confirmada hasta que el flujo de pago correspondiente la valida.",
      "El mapa 3D conserva también las áreas del inmueble que no están a la venta, para que la persona pueda orientarse sin confundirlas con espacios reservables.",
    ],
  },

  cifras: [
    { valor: "4", etiqueta: "oficinas en renta", icono: "edificio" },
    { valor: "3D", etiqueta: "mapa del inmueble", icono: "cubo" },
    { valor: `${BOOKING.bloques?.length || 0}`, etiqueta: "bloques horarios configurados", icono: "reloj" },
    { valor: `${BOOKING.diasMaximos}`, etiqueta: "días máximos de anticipación", icono: "calendario" },
  ],

  servicios: [
    {
      icono: "🏢",
      titulo: "Oficinas privadas",
      texto: "Cuatro opciones con aforo y tarifa propios. El catálogo sólo muestra como reservable lo que realmente está habilitado para renta.",
    },
    {
      icono: "🗺️",
      titulo: "Recorrido antes de reservar",
      texto: "El plano 3D representa la distribución del inmueble y diferencia las oficinas rentables de las áreas informativas o de servicio.",
    },
  ],

  porQue: {
    titulo: "Qué cuida la app",
    puntos: [
      {
        titulo: "Catálogo sin espacios fantasma",
        texto: "Sólo las oficinas activas y reservables aparecen como opciones comerciales.",
      },
      {
        titulo: "Disponibilidad consultada al servidor",
        texto: "Los horarios no se dan por libres usando una copia vieja cuando el backend no responde.",
      },
      {
        titulo: "Precio visible antes de pagar",
        texto: "La tarifa y los impuestos se muestran en el resumen antes de salir a la pasarela de pago.",
      },
      {
        titulo: "Mapa y catálogo conectados",
        texto: "Puedes identificar la oficina en el edificio y volver a su ficha para consultar fotos, capacidad y horarios.",
      },
    ],
  },

  edificio: {
    titulo: "El inmueble en el mapa",
    texto:
      `El plano digital usa una envolvente de ${ENVOLVENTE.ancho} × ${ENVOLVENTE.fondo} metros y conserva oficinas, patio, jardín, cocina, baños, áreas comunes y cochera como referencias de orientación. No todas esas áreas son rentables.`,
    amenidades: [
      "Cuatro oficinas marcadas como reservables",
      "Áreas comunes y de servicio diferenciadas del catálogo",
      "Patio y jardín representados en el plano",
      "Cocina, baños y cochera visibles como referencias del inmueble",
    ],
  },

  // Se mantiene vacío hasta contar con nombres/cargos autorizados para
  // publicación. La vista oculta la sección cuando no hay personas.
  equipo: {
    titulo: "Equipo",
    texto: "",
    personas: [],
  },

  // Son bloques configurados por la app, no una promesa de horario de
  // atención física. La disponibilidad final la decide el servidor.
  horarios: [
    { dia: "Bloques de reserva", horas: (BOOKING.bloques || []).join(" · ") },
  ],

  get contacto() { return CONTACT; },
};

export default NOSOTROS;
