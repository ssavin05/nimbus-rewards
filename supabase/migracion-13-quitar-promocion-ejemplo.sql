-- ======================================================================
-- migracion-13-quitar-promocion-ejemplo.sql
--
-- El seed histórico creaba BIENVENIDO (15 %) como dato de demostración.
-- En una base real eso es una oferta económica activa aunque la interfaz
-- oculte promociones: quien conozca/acuse el código puede llamar la RPC.
-- Sólo desactiva la fila con la huella exacta del ejemplo; no toca una
-- promoción BIENVENIDO que el negocio haya personalizado.
-- Idempotente.
-- ======================================================================

begin;

update public.promociones
   set activa = false
 where upper(codigo) = 'BIENVENIDO'
   and titulo = '15 % en tu primera reserva'
   and tipo = 'porcentaje'
   and valor = 15
   and minimo_compra = 0;

commit;
