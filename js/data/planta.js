/* ======================================================================
   planta.js — El plano real del edificio, en metros.

   Ésta es la ÚNICA fuente de la geometría: el mapa, el minimapa, el
   catálogo y el panel de administración leen de aquí. Las medidas salen
   directamente de las cotas del plano arquitectónico:

     • Envolvente         18.70 m de ancho × 29.95 m de fondo
     • Origen (0,0)       esquina superior izquierda del plano
     • x crece a la derecha, y crece hacia abajo (igual que el dibujo)

   Para cambiar el edificio se edita esta tabla y ya: no hay medidas
   sueltas por el resto del código.
   ====================================================================== */

import { aplicarMediosLocales } from "./medios-locales.js";

export const ENVOLVENTE = { ancho: 18.70, fondo: 29.95 };

/* ----------------------------------------------------------------------
   De dónde salen estos números

   Todo viene de las cotas escritas en el plano, no de medir la imagen a
   ojo. Dos cadenas cierran solas, que es la comprobación de que están
   bien leídas:

     Ancho  →  Espacio Abierto 5.80 + Oficina B 3.00 + Cocina 2.70
               + Baño 1.80 + Servicio 2.20 + Oficina A 3.20 = 18.70 m
     Fondo  →  Habitación 2.85 + Oficina Principal 5.35
               + Jardín Privado 4.25 + Espacio Abierto 17.50 = 29.95 m

   El baño de la Oficina Principal está DENTRO de ella (esquina suroeste),
   no debajo: por eso la oficina conserva sus 5.35 m completos y el baño
   se dibuja encima como un recorte.
   ---------------------------------------------------------------------- */

/* Colores por tipo de espacio. El plano se lee como bloques de color
   planos, no como una maqueta fotorrealista: es lo que pidió el cliente
   y además se entiende de un vistazo. */
export const COLOR_TIPO = {
  oficina:         0x2f6fed,   // azul
  sala_juntas:     0x8b5cf6,   // morado
  coworking:       0x0ea5a4,   // verde azulado
  comun:           0x64748b,   // gris azulado
  servicio:        0x94a3b8,   // gris claro
  estacionamiento: 0x475569,   // gris oscuro
  auditorio:       0xd97706,
};

/* Tipos que existen para rentarse. Los de abajo (común, servicio,
   estacionamiento) son partes del edificio y ya se pintan en gris. */
const TIPOS_EN_RENTA = new Set(["oficina", "sala_juntas", "coworking", "auditorio"]);

/* Un cuarto fuera de catálogo se apaga al gris de «parte del edificio».
   Si conservara el azul de oficina se vería idéntico a una que sí se
   renta, y la leyenda del mapa dice justo lo contrario: gris = no
   reservable. El minimapa ya los pintaba así; esto pone de acuerdo al
   plano grande con él. */
function colorDe(tipo, reservable) {
  if (!reservable && TIPOS_EN_RENTA.has(tipo)) return COLOR_TIPO.comun;
  return COLOR_TIPO[tipo] ?? COLOR_TIPO.comun;
}

/* Altura del bloque en el relieve, por tipo de espacio. Depende de qué
   ES el cuarto, no de si se renta: un espacio que se saca del catálogo
   sigue siendo el mismo volumen dentro del edificio. */
export const ALTURA_TIPO = {
  oficina:         0.85,
  sala_juntas:     0.85,
  coworking:       0.85,
  comun:           0.55,
  servicio:        0.55,
  estacionamiento: 0.55,
};

/* ----------------------------------------------------------------------
   Presentación del mapa 3D

   La base conserva los nombres comerciales de las oficinas porque son los
   que se usan en catálogo/checkout. El plano, en cambio, usa las etiquetas
   del dibujo arquitectónico para que quien conoce el edificio lo reconozca
   de inmediato. También se declaran aquí las puertas visibles de la maqueta
   (lado n/s/e/w, ancho y desplazamiento desde el centro del muro).
   ---------------------------------------------------------------------- */
export const NOMBRE_MAPA = Object.freeze({
  "HAB-01": "HABITACIÓN",
  "OF-PRINCIPAL": "OFICINA PRINCIPAL",
  "WC-01": "BAÑO",
  "JP-01": "JARDÍN PRIVADO",
  "EA-01": "ESPACIO ABIERTO",
  "SJ-01": "SALA DE JUNTAS",
  "LB-01": "LOBBY",
  "WC-02": "BAÑO",
  "OF-B": "OFICINA B",
  "AR-01": "ARCHIVERO",
  "PT-01": "PATIO",
  "CM-01": "COMUNITARIO",
  "CO-01": "COCINA",
  "WC-03": "BAÑO",
  "SRV-01": "SERVICIO",
  "OF-A": "OFICINA A",
  "AL-01": "ALMACÉN",
  "OF-D": "OFICINA D",
  "WC-04": "BAÑO",
  "AL-02": "ALMACÉN",
  "PK-01": "COCHERA",
  "OF-01": "OFICINA",
  "RC-01": "RECEPCIÓN",
  "OF-C": "OFICINA C",
});

export const PUERTAS_MAPA = Object.freeze({
  "HAB-01":        { side: "e", width: 0.86, offset: 0.62 },
  "OF-PRINCIPAL": { side: "e", width: 0.92, offset: -1.05 },
  "WC-01":         { side: "e", width: 0.72, offset: 0.10 },
  "SJ-01":         { side: "w", width: 0.92, offset: 1.05 },
  "LB-01":         { side: "w", width: 0.90, offset: 0.30 },
  "WC-02":         { side: "e", width: 0.72, offset: 0.35 },
  "OF-B":          { side: "e", width: 0.88, offset: 1.25 },
  "AR-01":         { side: "e", width: 0.82, offset: 0.78 },
  "CO-01":         { side: "s", width: 0.88, offset: 0.52 },
  "WC-03":         { side: "s", width: 0.76, offset: 0.20 },
  "SRV-01":        { side: "s", width: 0.82, offset: -0.28 },
  "OF-A":          { side: "w", width: 0.90, offset: 1.05 },
  "OF-D":          { side: "w", width: 0.88, offset: -0.82 },
  "WC-04":         { side: "w", width: 0.70, offset: -0.22 },
  "AL-02":         { side: "w", width: 0.76, offset: -0.36 },
  "PK-01":         { side: "s", width: 3.45, offset: 0.00, sinHoja: true },
  "OF-01":         { side: "s", width: 0.88, offset: 0.28 },
  "RC-01":         { side: "s", width: 0.88, offset: 0.22 },
  "OF-C":          { side: "w", width: 0.90, offset: -1.08 },
});

/*  clave | nombre | tipo | icono | reservable | x | y | ancho | fondo |
    capacidad | precio_hora | precio_dia | abierto | amenidades | descripción

    `reservable: false` NO quiere decir «no existe»: el cuarto se dibuja
    igual en el mapa 3D y conserva sus medidas. Sólo significa que no
    sale en el catálogo ni se puede reservar. Los que están así por
    decisión comercial (no por ser un baño o un pasillo) van marcados
    abajo con «fuera de catálogo», y llevan precio 0 para que ninguna
    vista muestre una tarifa de algo que no se renta.
    ------------------------------------------------------------------- */
const P = [
  /* ---------- Columna poniente ---------- */
  ["HAB-01", "Habitación", "oficina", "🛏", false,   // fuera de catálogo
    0.00, 0.00, 5.15, 2.85, 2, 0, null, false,
    ["wifi", "ac"],
    "Cuarto privado en la esquina noroeste, junto a la Oficina Principal."],

  ["OF-PRINCIPAL", "Oficina Principal", "oficina", "🏢", false,   // fuera de catálogo
    0.00, 2.85, 5.15, 5.35, 10, 0, null, false,
    ["wifi", "ac", "proyector", "accesible", "estacionamiento", "videollamada"],
    "La oficina más grande del edificio: 5.15 × 5.35 m, con baño propio en la esquina y salida al jardín privado."],

  ["WC-01", "Baño", "servicio", "🚻", false,
    0.00, 6.80, 1.80, 1.40, 0, 0, null, false, [],
    "Baño privado, dentro de la Oficina Principal."],

  ["JP-01", "Jardín Privado", "comun", "🌿", false,
    0.00, 8.20, 5.15, 4.25, 0, 0, null, true, [],
    "Jardín exterior contiguo a la Oficina Principal."],

  ["EA-01", "Espacio Abierto", "coworking", "🧑‍💻", false,   // fuera de catálogo
    0.00, 12.45, 5.80, 17.50, 18, 0, null, true,
    ["wifi", "ac", "accesible", "cafe", "impresora", "lockers"],
    "Planta libre de coworking: 5.80 × 17.50 m, la superficie más grande del edificio."],

  /* ---------- Franja central-poniente ---------- */
  ["SJ-01", "Sala de Juntas", "sala_juntas", "📊", false,   // fuera de catálogo
    5.90, 0.30, 4.60, 4.00, 10, 0, null, false,
    ["wifi", "ac", "proyector", "pizarron", "accesible", "cafe", "videollamada"],
    "Sala ejecutiva de 4.60 × 4.00 m con mesa para diez personas, arriba del lobby."],

  ["LB-01", "Lobby", "comun", "🛋", false,
    5.90, 4.60, 2.20, 2.10, 0, 0, null, false, [],
    "Vestíbulo de entrada, debajo de la Sala de Juntas."],

  ["WC-02", "Baño", "servicio", "🚻", false,
    5.90, 7.10, 1.55, 2.00, 0, 0, null, false, [],
    "Baño de servicio junto al lobby."],

  ["OF-B", "Ejecutiva Compact", "oficina", "🏢", true,
    5.80, 12.90, 3.00, 4.80, 4, 180, 1150, false,
    ["wifi", "ac"],
    "Oficina de 3.00 × 4.80 m, entre el muro poniente y la cocina. Baja más que la fila de servicios."],

  ["AR-01", "Archivero", "servicio", "🗄", false,
    5.80, 19.60, 2.70, 3.00, 0, 0, null, false, [],
    "Archivo y almacenamiento documental, debajo de la Oficina B."],

  /* ---------- Patio y área comunitaria (12.90 m de fondo) ---------- */
  ["PT-01", "Patio", "comun", "🌳", false,
    10.70, 0.00, 4.20, 12.90, 0, 0, null, true, [],
    "Patio interior con pendiente al poniente. Da luz y ventilación al centro del edificio."],

  ["CM-01", "Comunitario", "comun", "☕", false,
    14.90, 0.00, 3.80, 12.90, 0, 0, null, true, [],
    "Área común al aire libre con una mesa redonda de 2.50 m y dos de 1.20 m."],

  /* ---------- Fila de servicios (2.60 m de fondo) ---------- */
  ["CO-01", "Cocina", "servicio", "🍳", false,
    8.80, 12.90, 2.70, 2.60, 0, 0, null, false, [],
    "Cocina compartida con cafetera, microondas y refrigerador."],

  ["WC-03", "Baño", "servicio", "🚻", false,
    11.50, 12.90, 1.80, 2.60, 0, 0, null, false, [],
    "Baño de uso común junto a la cocina."],

  ["SRV-01", "Servicio", "servicio", "🧹", false,
    13.30, 12.90, 2.20, 2.60, 0, 0, null, false, [],
    "Cuarto de servicio y limpieza."],

  ["OF-A", "Ejecutiva Plus", "oficina", "🏢", true,
    15.50, 12.90, 3.20, 4.10, 5, 260, 1700, false,
    ["wifi", "ac", "proyector", "accesible"],
    "Oficina de 3.20 × 4.10 m en el ala oriente, al final de la fila de servicios."],

  /* ---------- Almacén y ala oriente ---------- */
  ["AL-01", "Almacén", "servicio", "📦", false,
    8.50, 18.50, 6.90, 4.60, 0, 0, null, false, [],
    "Bodega general de 6.90 × 4.60 m, en el centro de la planta."],

  ["OF-D", "Ejecutiva Lounge", "oficina", "🏢", true,
    15.50, 18.50, 3.20, 3.60, 3, 220, 1450, false,
    ["wifi", "ac"],
    "Oficina de 3.20 × 3.60 m en el ala oriente, junto al almacén."],

  ["WC-04", "Baño", "servicio", "🚻", false,
    17.10, 22.30, 1.60, 1.40, 0, 0, null, false, [],
    "Baño de uso común del ala oriente."],

  ["AL-02", "Almacén", "servicio", "📦", false,
    17.10, 23.70, 1.60, 1.90, 0, 0, null, false, [],
    "Bodega pequeña, arriba de la Oficina C."],

  /* ---------- Planta sur: acceso desde la calle ---------- */
  ["PK-01", "Cochera", "estacionamiento", "🚗", false,
    5.90, 23.75, 5.00, 6.20, 0, 0, null, true, [],
    "Cochera techada de 5.00 × 6.20 m con acceso directo desde la calle."],

  ["OF-01", "Oficina", "oficina", "🏢", false,   // fuera de catálogo
    11.00, 24.85, 2.00, 5.10, 4, 0, null, false,
    ["wifi", "ac", "recepcion"],
    "Oficina de 5.10 m de fondo, pegada a la recepción."],

  ["RC-01", "Recepción", "comun", "🛎", false,
    13.10, 24.85, 1.90, 5.10, 0, 0, null, false, [],
    "Recepción principal del edificio, en el acceso desde la calle."],

  ["OF-C", "Premium Patio View", "oficina", "🏢", true,
    15.10, 25.65, 3.60, 4.30, 4, 240, 1550, false,
    ["wifi", "ac", "accesible", "estacionamiento", "recepcion"],
    "Oficina esquinera del sureste, 3.60 × 4.30 m, pegada a la recepción."],
];

/** Pasillos de circulación: se pintan como suelo, sin muros. */
export const CORREDORES = [
  { x: 5.80, y: 9.20, ancho: 3.00, fondo: 3.60 },    // lobby → oficina B
  { x: 8.80, y: 15.60, ancho: 6.90, fondo: 2.80 },   // frente al almacén
  { x: 5.80, y: 22.70, ancho: 12.90, fondo: 1.00 },  // pasillo sur
  { x: 8.80, y: 4.40, ancho: 1.80, fondo: 8.50 },    // paso al patio
];

/** Mesas redondas del área comunitaria (Ø en metros, como en el plano). */
export const MESAS_COMUNITARIAS = [
  { x: 16.20, y: 4.60, diametro: 2.50 },
  { x: 18.00, y: 2.30, diametro: 1.20 },
  { x: 18.00, y: 6.90, diametro: 1.20 },
];

/** Cajones de estacionamiento en la calle, al sur del edificio. */
export const CAJONES_CALLE = [
  { x: 0.40, y: 30.90, ancho: 2.30, fondo: 4.80 },
  { x: 2.90, y: 30.90, ancho: 2.30, fondo: 4.80 },
  { x: 7.60, y: 30.90, ancho: 2.30, fondo: 4.80 },
  { x: 10.10, y: 30.90, ancho: 2.30, fondo: 4.80 },
  { x: 14.00, y: 30.90, ancho: 2.30, fondo: 4.80 },
  { x: 16.50, y: 30.90, ancho: 2.30, fondo: 4.80 },
];

/**
 * Devuelve el plano como una lista de espacios, con el mismo formato que
 * la tabla `espacios` de la base de datos.
 */
export function espaciosDelPlano({ organizacionId, sedeId, edificioId, pisoId, prefijo = "" } = {}) {
  return P.map(([codigo, nombre, tipo, icono, reservable, x, y, ancho, fondo,
                 capacidad, precioHora, precioDia, abierto, amenidades, descripcion]) => aplicarMediosLocales({
    id: `${prefijo}${codigo.toLowerCase()}`,
    organizacion_id: organizacionId, sede_id: sedeId,
    edificio_id: edificioId, piso_id: pisoId,
    codigo, nombre, nombre_mapa: NOMBRE_MAPA[codigo] || nombre, tipo, icono, descripcion,
    capacidad, reservable, estado: "disponible", activo: true,
    precio_hora: precioHora, precio_dia: precioDia,
    precioHora, precioDia,
    amenidades,
    servicios: reservable ? ["Limpieza diaria", "Recepción de paquetería"] : [],
    reglamento: reservable
      ? "Prohibido fumar dentro del edificio. Se pide dejar el espacio ordenado al terminar."
      : null,
    pos_x: x, pos_y: y, ancho, fondo,
    // Alturas bajas a propósito: es un plano en relieve, no una maqueta.
    // Salen del tipo de cuarto, no de si se renta, para que sacar un
    // espacio del catálogo no le cambie el volumen en el mapa 3D.
    altura: abierto ? 0.12 : (ALTURA_TIPO[tipo] ?? 0.55),
    abierto, puerta: PUERTAS_MAPA[codigo] || null,
    color: colorDe(tipo, reservable),
    fotos: [], portada: null, panoramas: [],
    calificacion: 0, total_resenas: 0, total_reservas: 0,
  }));
}

export const CODIGOS = P.map((f) => f[0]);
export default { ENVOLVENTE, CORREDORES, MESAS_COMUNITARIAS, CAJONES_CALLE, COLOR_TIPO, ALTURA_TIPO, NOMBRE_MAPA, PUERTAS_MAPA, espaciosDelPlano, CODIGOS };
