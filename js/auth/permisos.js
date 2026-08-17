/* ======================================================================
   permisos.js — Control de permisos en el cliente.

   ⚠️ Esto es sólo para la interfaz: esconder botones que el usuario no
   puede usar. La verdad la impone la base de datos con RLS (ver
   supabase/policies.sql). Nunca confíes en esta capa para seguridad.
   ====================================================================== */
import store from "../core/store.js";

export const ROLES = ["invitado", "usuario", "staff", "admin", "superadmin"];

const NIVEL = { invitado: 0, usuario: 1, staff: 2, admin: 3, superadmin: 4 };

/** Permisos por nivel mínimo requerido. */
const REGLAS = {
  "reserva.crear": "usuario",
  "reserva.cancelar": "usuario",
  "reserva.modificar": "usuario",
  "favorito.usar": "usuario",
  "resena.publicar": "usuario",
  "chat.escribir": "usuario",
  "perfil.editar": "usuario",

  "reservas.verTodas": "staff",
  "reserva.cancelarAjena": "staff",
  "espacio.cambiarEstado": "staff",
  "bloqueo.crear": "staff",
  "resena.responder": "staff",
  "chat.responder": "staff",
  "usuarios.ver": "staff",

  "espacio.crear": "admin",
  "espacio.editar": "admin",
  "espacio.eliminar": "admin",
  "espacio.precios": "admin",
  "espacio.fotos": "admin",
  "horarios.editar": "admin",
  "promocion.gestionar": "admin",
  "analitica.ver": "admin",
  "edificio.gestionar": "admin",
  "sede.gestionar": "admin",
  "usuarios.cambiarRol": "admin",
  "facturacion.gestionar": "admin",

  "organizacion.gestionar": "superadmin",
  "auditoria.ver": "superadmin",
};

export function rolActual() { return store.get().rol || "invitado"; }

export function nivel(rol = rolActual()) { return NIVEL[rol] ?? 0; }

/** puede("espacio.editar") -> boolean */
export function puede(permiso) {
  const requerido = REGLAS[permiso];
  if (!requerido) return false;
  return nivel() >= NIVEL[requerido];
}

export const esInvitado = () => rolActual() === "invitado";
export const esUsuario = () => nivel() >= NIVEL.usuario;
export const esStaff = () => nivel() >= NIVEL.staff;
export const esAdmin = () => nivel() >= NIVEL.admin;
export const esSuperadmin = () => nivel() >= NIVEL.superadmin;

export const ETIQUETA_ROL = {
  invitado: "Invitado",
  usuario: "Usuario",
  staff: "Staff",
  admin: "Administrador",
  superadmin: "Super administrador",
};

/** Oculta un elemento del DOM si falta el permiso. */
export function aplicarPermisos(raiz = document) {
  raiz.querySelectorAll("[data-permiso]").forEach((el) => {
    el.hidden = !puede(el.dataset.permiso);
  });
}

export default { puede, esStaff, esAdmin, esSuperadmin, rolActual, aplicarPermisos, ETIQUETA_ROL, ROLES };
