/* ======================================================================
   iconos.js — Iconos SVG en línea (sin dependencias ni peticiones).
   Uso: icono("mapa", { size: 22, clase: "x" })
   ====================================================================== */

const D = {
  inicio: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  mapa: '<path d="m9 3-6 3v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
  cubo: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5"/><path d="M12 12v10"/>',
  calendario: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  corazon: '<path d="M20.8 6.6a5 5 0 0 0-7.1 0L12 8.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 22l8.8-8.3a5 5 0 0 0 0-7.1z"/>',
  corazonLleno: '<path d="M20.8 6.6a5 5 0 0 0-7.1 0L12 8.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 22l8.8-8.3a5 5 0 0 0 0-7.1z" fill="currentColor" stroke="none"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  cerrar: '<path d="M18 6 6 18M6 6l12 12"/>',
  atras: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  adelante: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  chevronAbajo: '<path d="m6 9 6 6 6-6"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  filtro: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  campana: '<path d="M18 8a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  ajustes: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.54 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.54h.08A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.46 9v.08a1.7 1.7 0 0 0 1.54 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  ubicacion: '<path d="M20 10.5c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0z"/><circle cx="12" cy="10.5" r="3"/>',
  personas: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  tarjeta: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>',
  recibo: '<path d="M5 3v18l2.5-1.6L10 21l2-1.6L14 21l2.5-1.6L19 21V3z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  estrella: '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.5-4.5A8.4 8.4 0 0 1 3.6 11.5a8.4 8.4 0 0 1 8.4-8.4h.5A8.4 8.4 0 0 1 21 11z"/>',
  ayuda: '<circle cx="12" cy="12" r="9.2"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 2-2.8 2.8-2.8 2.8"/><path d="M12 17.2h.01"/>',
  edificio: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M14 9h4a2 2 0 0 1 2 2v10"/><path d="M7 7h3M7 11h3M7 15h3M17 13h1M17 17h1"/><path d="M2 21h20"/>',
  panel: '<rect x="3" y="3" width="7.5" height="8.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.6"/><rect x="13.5" y="11" width="7.5" height="10" rx="1.6"/><rect x="3" y="14.5" width="7.5" height="6.5" rx="1.6"/>',
  grafica: '<path d="M3 3v18h18"/><path d="m7 14 3.5-4 3 3L20 6"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  lapiz: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  basura: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  camara: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  imagen: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="m21 15-5-5L5 21"/>',
  video: '<path d="m23 7-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2.5"/>',
  vista360: '<ellipse cx="12" cy="12" rx="10" ry="4.6"/><path d="M12 2a4.6 10 0 1 0 0 20 4.6 10 0 1 0 0-20"/><path d="M2 12h20"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  checkCirculo: '<circle cx="12" cy="12" r="9.2"/><path d="m8 12.4 2.8 2.8L16 9.6"/>',
  alerta: '<path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9.2"/><path d="M12 16v-4.5M12 8h.01"/>',
  candado: '<rect x="4" y="10.5" width="16" height="11" rx="2.4"/><path d="M8 10.5V7a4 4 0 1 1 8 0v3.5"/>',
  correo: '<rect x="2" y="4.5" width="20" height="15" rx="2.4"/><path d="m3 6 9 6.5L21 6"/>',
  telefono: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  whatsapp: '<path d="M20.5 11.6A8.4 8.4 0 0 1 7.9 19l-4.4 1.2 1.2-4.3A8.4 8.4 0 1 1 20.5 11.6z"/><path d="M9 8.6c.3-.1.6 0 .8.3l.8 1.3c.1.3.1.6-.1.8l-.5.6c.6 1.1 1.4 1.9 2.5 2.4l.6-.5c.2-.2.5-.2.8-.1l1.3.8c.3.2.4.5.3.8-.3.9-1.2 1.4-2.1 1.2-2.7-.5-4.9-2.7-5.5-5.4-.2-.9.3-1.9 1.1-2.2z"/>',
  descargar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M12 15V3"/>',
  compartir: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  copiar: '<rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refrescar: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M2 9a15 15 0 0 1 20 0"/><path d="M12 19.5h.01"/>',
  sol: '<circle cx="12" cy="12" r="4.2"/><path d="M12 1.5v2.5M12 20v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M1.5 12H4M20 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  luna: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  idioma: '<circle cx="12" cy="12" r="9.2"/><path d="M2.8 12h18.4"/><path d="M12 2.8a14 14 0 0 1 0 18.4 14 14 0 0 1 0-18.4z"/>',
  promo: '<path d="M20.6 13.3 13.3 20.6a2 2 0 0 1-2.8 0l-7.4-7.4A2 2 0 0 1 2.5 12V4.5a2 2 0 0 1 2-2H12a2 2 0 0 1 1.2.5l7.4 7.4a2 2 0 0 1 0 2.9z"/><path d="M7 7h.01"/>',
  historial: '<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/><path d="M12 7.5V12l3.5 2"/>',
  elevador: '<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="m9 9 1.7-2L12.4 9"/><path d="m14.6 15-1.7 2-1.7-2"/><path d="M12 2.5v19"/>',
  puerta: '<path d="M4 21h16"/><path d="M6 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17"/><circle cx="13" cy="12.5" r="1"/>',
  robot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4.5V8"/><circle cx="12" cy="3.4" r="1.4"/><path d="M9 13.5h.01M15 13.5h.01"/><path d="M9.5 17h5"/>',
  wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1"/><rect x="3" y="7.5" width="18" height="12.5" rx="2.4"/><circle cx="16.5" cy="14" r="1.3"/>',
  nube: '<path d="M17.5 19a4.5 4.5 0 0 0 .8-8.9 6.5 6.5 0 0 0-12.5 1.6A4 4 0 0 0 6.5 19z"/>',
  offline: '<path d="M2 2l20 20"/><path d="M8.9 8.9A15 15 0 0 0 2 9"/><path d="M5 12.5a10 10 0 0 1 3.2-2.1"/><path d="M12 19.5h.01"/><path d="M16.8 13.2A5 5 0 0 0 12 11"/><path d="M22 9a15 15 0 0 0-4.6-3"/>',
};

/** Devuelve el SVG del icono como cadena. */
export function icono(nombre, { size = 20, clase = "", stroke = 1.9, relleno = "none" } = {}) {
  const d = D[nombre];
  if (!d) return "";
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${relleno}" stroke="currentColor" `
    + `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`
    + `${clase ? ` class="${clase}"` : ""}>${d}</svg>`;
}

export const hayIcono = (nombre) => Boolean(D[nombre]);
export default icono;
