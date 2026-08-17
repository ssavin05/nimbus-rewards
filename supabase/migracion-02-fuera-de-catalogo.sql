-- ======================================================================
-- migracion-02-fuera-de-catalogo.sql
--
-- Aplica SÓLO si ya tienes una base sembrada con la versión anterior de
-- seed.sql. Si vas a instalar de cero, seed.sql ya trae estos espacios
-- fuera de catálogo y no hace falta ejecutar este archivo.
--
-- Qué hace
-- --------
-- Saca del catálogo la Oficina Principal, la Sala de Juntas y el
-- Espacio Abierto. Dejan de ser reservables y se les pone precio 0,
-- pero NO se borran: siguen en la tabla con sus medidas para que el
-- mapa 3D dibuje el edificio completo. En el plano se ven como lo que
-- son ahora, cuartos del edificio que no se rentan.
--
-- Por qué hace falta el archivo
-- -----------------------------
-- El `on conflict` de seed.sql sólo sincroniza geometría y textos
-- (nombre, descripción, posición, medidas). Eso es a propósito: así una
-- re-siembra no pisa los precios que el administrador haya cambiado
-- desde el panel. El efecto secundario es que volver a correr seed.sql
-- tampoco cambia `reservable` ni los precios, así que este cambio se
-- aplica aquí.
--
-- Se puede ejecutar varias veces sin problema.
-- ======================================================================

begin;

-- 1. Aviso previo: reservas futuras sobre estos espacios.
--    Sacar un espacio del catálogo NO cancela lo que ya estaba
--    reservado, y es mejor enterarse antes que después.
do $$
declare
  v_futuras int;
begin
  select count(*) into v_futuras
    from public.reservas r
    join public.espacios e on e.id = r.espacio_id
   where e.codigo in ('OF-PRINCIPAL', 'SJ-01', 'EA-01')
     and r.estado in ('pendiente', 'confirmada', 'en_curso')
     and r.fin > now();

  if v_futuras > 0 then
    raise warning 'Hay % reserva(s) futura(s) en Oficina Principal / Sala de Juntas / Espacio Abierto. Siguen vivas: el espacio deja de reservarse de aquí en adelante, pero lo ya vendido no se toca. Revísalas y avisa a esas personas si toca cancelarlas.', v_futuras;
  else
    raise notice 'Sin reservas futuras en los espacios que salen del catálogo.';
  end if;
end $$;

-- 2. Fuera del catálogo.
--    `reservable = false` es lo que ya usaban baños, lobby y jardín:
--    el espacio existe en el plano pero no se lista ni se reserva.
--    El precio se pone a 0 para que ninguna vista muestre una tarifa de
--    algo que no está en renta, y se vacían los servicios incluidos
--    (sólo aplican a lo que se renta). Las amenidades se conservan:
--    son características del cuarto, no de la oferta comercial.
update public.espacios
   set reservable  = false,
       precio_hora = 0,
       precio_dia  = null,
       precio_mes  = null,
       servicios   = '{}'
 where codigo in ('OF-PRINCIPAL', 'SJ-01', 'EA-01')
   and reservable;

-- 3. La promoción de coworking se queda sin espacio donde canjearse.
--    Se desactiva en vez de borrarse, para no perder el histórico de
--    usos que ya tuviera.
update public.promociones
   set activa = false
 where codigo = 'COWORK2X1'
   and activa;

commit;

-- ======================================================================
-- Para deshacerlo (volver a ponerlos en renta con sus precios de antes):
--
--   update public.espacios set reservable = true, precio_hora = 320,
--          precio_dia = 2100 where codigo = 'OF-PRINCIPAL';
--   update public.espacios set reservable = true, precio_hora = 350,
--          precio_dia = 2200 where codigo = 'SJ-01';
--   update public.espacios set reservable = true, precio_hora = 150,
--          precio_dia = 950  where codigo = 'EA-01';
--   update public.promociones set activa = true where codigo = 'COWORK2X1';
-- ======================================================================
