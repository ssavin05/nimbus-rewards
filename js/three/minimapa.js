/* ======================================================================
import { ENVOLVENTE } from "../data/planta.js";
   minimapa.js — Mini mapa 2D del piso, dibujado en canvas.

   Muestra la planta completa, el semáforo de disponibilidad, la sala
   seleccionada, la ruta y hacia dónde mira la cámara. Tocarlo enfoca
   la sala correspondiente.
   ====================================================================== */

const COLOR = {
  fondo: "rgba(8,14,22,0.86)",
  borde: "rgba(95,212,255,0.28)",
  mudo: "#64748b",
  mudoBorde: "#33475f",
  texto: "#93a7bb",
  verde: "#22c55e",
  amarillo: "#f59e0b",
  rojo: "#ef4444",
  morado: "#9b8cff",
  gris: "#6b7d90",
  seleccion: "#5fd4ff",
  ruta: "#38bdf8",
};

export function crearMinimapa(lienzo, { espacios, edificio, centro, onSeleccion }) {
  const ctx = lienzo.getContext("2d");
  let disponibilidad = {};
  let seleccionado = null;
  let camara = null;
  let ruta = null;

  const anchoM = Number(edificio?.ancho_m) || ENVOLVENTE.ancho;
  const fondoM = Number(edificio?.fondo_m) || ENVOLVENTE.fondo;

  function dimensionar() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = lienzo.clientWidth || 150;
    const h = lienzo.clientHeight || 190;
    lienzo.width = Math.round(w * dpr);
    lienzo.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function escala(w, h) {
    const margen = 8;
    return Math.min((w - margen * 2) / anchoM, (h - margen * 2) / fondoM);
  }

  /** Metros del plano → píxeles del minimapa. */
  function aPixeles(x, y, w, h, k) {
    const offX = (w - anchoM * k) / 2;
    const offY = (h - fondoM * k) / 2;
    return { px: offX + x * k, py: offY + y * k };
  }

  function colorDe(espacio) {
    if (!espacio.reservable || espacio.estado !== "disponible") return COLOR.rojo;
    const d = disponibilidad[String(espacio.id)];
    if (!d || !Number.isFinite(Number(d.total))) return COLOR.mudo;
    if (Number(d.total) <= 0 || Number(d.libres) <= 0) return COLOR.rojo;
    if (Number(d.libres) >= Number(d.total)) return COLOR.verde;
    return COLOR.amarillo;
  }

  function dibujar() {
    const { w, h } = dimensionar();
    const k = escala(w, h);
    ctx.clearRect(0, 0, w, h);

    // Fondo
    ctx.fillStyle = COLOR.fondo;
    redondeado(ctx, 0, 0, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = COLOR.borde;
    ctx.lineWidth = 1;
    redondeado(ctx, 0.5, 0.5, w - 1, h - 1, 12);
    ctx.stroke();

    // Espacios
    for (const espacio of espacios) {
      const { px, py } = aPixeles(Number(espacio.pos_x), Number(espacio.pos_y), w, h, k);
      const pw = Math.max(2, Number(espacio.ancho) * k);
      const ph = Math.max(2, Number(espacio.fondo) * k);
      const activo = String(espacio.id) === seleccionado;

      ctx.fillStyle = colorDe(espacio);
      ctx.globalAlpha = activo ? 1 : 0.88;
      ctx.fillRect(px, py, pw - 0.6, ph - 0.6);
      ctx.globalAlpha = 1;

      if (activo) {
        ctx.strokeStyle = COLOR.seleccion;
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 1, py - 1, pw + 1, ph + 1);
      }
    }

    // Ruta
    if (ruta?.length > 1) {
      ctx.strokeStyle = COLOR.ruta;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ruta.forEach((p, i) => {
        const { px, py } = aPixeles(p.x + centro.x, p.z + centro.y, w, h, k);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Cono de visión de la cámara
    if (camara) {
      const { px, py } = aPixeles(camara.x + centro.x, camara.z + centro.y, w, h, k);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(camara.angulo);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
      grad.addColorStop(0, "rgba(95,212,255,0.42)");
      grad.addColorStop(1, "rgba(95,212,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 34, -0.55, 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = COLOR.seleccion;
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function redondeado(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* ---------- interacción ---------- */
  function alTocar(e) {
    const rect = lienzo.getBoundingClientRect();
    const x = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY ?? e.touches?.[0]?.clientY) - rect.top;
    const k = escala(rect.width, rect.height);
    const offX = (rect.width - anchoM * k) / 2;
    const offY = (rect.height - fondoM * k) / 2;
    const mx = (x - offX) / k;
    const my = (y - offY) / k;

    const encontrado = espacios.find((s) =>
      mx >= Number(s.pos_x) && mx <= Number(s.pos_x) + Number(s.ancho)
      && my >= Number(s.pos_y) && my <= Number(s.pos_y) + Number(s.fondo)
    );
    if (encontrado) onSeleccion?.(encontrado);
  }

  lienzo.addEventListener("click", alTocar);
  lienzo.style.cursor = "pointer";

  const observador = new ResizeObserver(dibujar);
  observador.observe(lienzo);
  dibujar();

  return {
    dibujar,
    setDisponibilidad(mapa) { disponibilidad = mapa || {}; dibujar(); },
    setSeleccion(id) { seleccionado = id ? String(id) : null; dibujar(); },
    setCamara(pos, angulo) { camara = { ...pos, angulo }; dibujar(); },
    setRuta(puntos) { ruta = puntos; dibujar(); },
    destruir() { observador.disconnect(); lienzo.removeEventListener("click", alTocar); },
  };
}

export default { crearMinimapa };
