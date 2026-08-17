-- ======================================================================
-- migracion-05-idempotencia-de-pagos.sql
--
-- 🚨 CRÍTICA. Aplícala ANTES de aceptar un solo pago real.
--    Si instalas de cero, seguridad.sql ya trae el arreglo.
--
-- Qué está roto
-- -------------
-- El webhook de Stripe registra el cobro con un upsert:
--
--     .upsert({ … }, { onConflict: "proveedor_id" })
--
-- que PostgREST traduce a `INSERT … ON CONFLICT (proveedor_id) DO UPDATE`.
-- Para que eso funcione, PostgreSQL tiene que encontrar una restricción
-- única sobre esa columna. Había un índice único… pero PARCIAL:
--
--     create unique index uq_pagos_proveedor
--       on public.pagos (proveedor_id) where proveedor_id is not null;
--
-- PostgreSQL NO infiere un índice parcial en `ON CONFLICT (columna)`
-- salvo que la sentencia repita el mismo `WHERE`, y PostgREST no lo
-- repite. Resultado: cada upsert muere con
--
--     42P10: there is no unique or exclusion constraint
--            matching the ON CONFLICT specification
--
-- Y en confirmarPago() ese error hace `throw`, así que el webhook
-- devuelve 500 y Stripe reintenta… para volver a fallar, hasta agotar
-- los reintentos.
--
-- Qué significa para un cliente
-- -----------------------------
--   1. paga con tarjeta y Stripe le cobra de verdad;
--   2. el webhook llega y revienta;
--   3. el pago NO se registra en `pagos`;
--   4. la reserva NUNCA pasa a 'confirmada' — esa línea va después
--      del throw y no se ejecuta;
--   5. la persona se queda sin reserva y con el cargo hecho.
--
-- Es el peor fallo posible en esta aplicación: dinero cobrado, nada
-- entregado, y ni siquiera queda rastro en la base para reclamarlo.
--
-- El arreglo
-- ----------
-- Una restricción UNIQUE normal, sin predicado. No hace falta el
-- `WHERE`: en UNIQUE los NULL son distintos entre sí, así que siguen
-- cabiendo tantos pagos sin proveedor_id como haga falta (efectivo,
-- cortesía, transferencia pendiente). Comprobado.
--
-- Se puede ejecutar varias veces sin problema.
-- ======================================================================

begin;

-- 1. Aviso previo. Si por cualquier vía hubiera dos pagos con el mismo
--    identificador de Stripe, la restricción no podría crearse; mejor
--    verlos antes que recibir un error a medias.
do $$
declare v_dup int;
begin
  select count(*) into v_dup from (
    select proveedor_id from public.pagos
     where proveedor_id is not null
     group by proveedor_id having count(*) > 1
  ) d;

  if v_dup > 0 then
    raise exception using
      message = format('Hay %s identificador(es) de pago repetidos. Revísalos antes de continuar.', v_dup),
      hint = 'select proveedor_id, count(*) from public.pagos where proveedor_id is not null group by 1 having count(*) > 1;';
  end if;
end $$;

-- 2. Fuera el índice parcial, dentro la restricción de verdad.
alter table public.pagos drop constraint if exists uq_pagos_proveedor;
drop index if exists public.uq_pagos_proveedor;
alter table public.pagos add constraint uq_pagos_proveedor unique (proveedor_id);

commit;

-- ----------------------------------------------------------------------
-- Comprobación después de aplicar. Tiene que decir «UNIQUE (proveedor_id)»
-- SIN ningún WHERE:
--
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'uq_pagos_proveedor';
--
-- ----------------------------------------------------------------------
-- Y ESTO ES LO IMPORTANTE: busca cobros huérfanos.
--
-- Si ya estuviste aceptando pagos con el fallo activo, hay gente que
-- pagó y no tiene reserva confirmada. En la base no queda rastro del
-- cobro, así que la lista de verdad está en Stripe:
--
--   Stripe → Payments → filtra por «Succeeded»
--   Stripe → Developers → Webhooks → mira las entregas fallidas (500)
--
-- Cada PaymentIntent que exista en Stripe y NO aparezca aquí es un cobro
-- sin registrar:
--
--   select proveedor_id, monto, pagado_en from public.pagos
--    where metodo = 'stripe' order by pagado_en desc;
--
-- Y estas son las reservas que se quedaron a medias:
--
--   select r.id, r.folio, r.inicio, r.estado, u.email
--     from public.reservas r
--     left join public.usuarios u on u.id = r.usuario_id
--    where r.estado = 'pendiente'
--      and not exists (select 1 from public.pagos p where p.reserva_id = r.id)
--    order by r.creado_en desc;
--
-- Para cada una: confirma la reserva a mano o devuelve el dinero desde
-- Stripe, y avisa a esa persona.
-- ----------------------------------------------------------------------
