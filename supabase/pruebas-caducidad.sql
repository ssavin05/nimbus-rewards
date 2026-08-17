-- ======================================================================
--  PRUEBAS DE CADUCIDAD DE APARTADOS
--
--  Comprueba el caso C del repaso de pre-lanzamiento —«a los 15 minutos
--  el apartado caduca y el horario vuelve a estar libre»— y las carreras
--  que lo rodean, que son donde de verdad se rompen estas cosas.
--
--    psql "$DATABASE_URL" -f supabase/pruebas-caducidad.sql
--
--  No deja rastro: todo ocurre dentro de una transacción que termina en
--  ROLLBACK. Se puede correr contra una base con datos.
--
--  Requiere que `caducidad.sql` esté aplicado.
-- ======================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_org      uuid;
  v_espacio  uuid;
  v_u1       uuid;
  v_u2       uuid;
  v_r1       public.reservas;
  v_r2       public.reservas;
  v_ini      timestamptz;
  v_fin      timestamptz;
  v_ok       int := 0;
  v_mal      int := 0;
  v_n        int;
  v_libre    boolean;
  v_msg      text;
begin
  -- ------------------------------------------------------------------
  -- Preparación: una organización, un espacio y dos usuarios de prueba.
  -- ------------------------------------------------------------------
  select id into v_org from public.organizaciones order by creado_en limit 1;
  if v_org is null then raise exception 'no hay ninguna organización'; end if;

  select id into v_espacio from public.espacios
   where organizacion_id = v_org and reservable order by creado_en limit 1;
  if v_espacio is null then raise exception 'no hay ningún espacio reservable'; end if;

  -- El perfil lo crea el disparador de auth; aquí sólo se completa.
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'caducidad1@prueba.local') returning id into v_u1;
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'caducidad2@prueba.local') returning id into v_u2;
  update public.usuarios set organizacion_id = v_org, nombre = 'Caducidad'
   where id in (v_u1, v_u2);

  -- Un horario lejano, para no chocar con nada que exista.
  v_ini := date_trunc('hour', now()) + interval '40 days';
  v_fin := v_ini + interval '2 hours';

  raise notice '';
  raise notice '════ CADUCIDAD DE APARTADOS ═════════════════════════';
  raise notice '  espacio %  ·  horario %', v_espacio, v_ini;
  raise notice '';

  -- ==================================================================
  -- 1. Un apartado recién creado SÍ ocupa el horario
  -- ==================================================================
  insert into public.reservas
    (organizacion_id, espacio_id, usuario_id, inicio, fin, subtotal, impuestos, total,
     estado, expira_en)
  values (v_org, v_espacio, v_u1, v_ini, v_fin, 1000.00, 160.00, 1160.00,
          'pendiente', now() + interval '15 minutes')
  returning * into v_r1;

  v_libre := public.esta_disponible(v_espacio, v_ini, v_fin);
  if v_libre = false then
    v_ok := v_ok + 1; raise notice '  OK   1. el apartado vivo ocupa su horario';
  else
    v_mal := v_mal + 1; raise warning '  MAL  1. el apartado vivo NO ocupa (esta_disponible dio true)';
  end if;

  -- ==================================================================
  -- 2. Vencido, deja de ocupar aunque nadie haya pasado a limpiarlo
  --
  --    Ésta es la red de seguridad: si el cron se cae, el horario no
  --    puede quedarse bloqueado para siempre.
  -- ==================================================================
  update public.reservas set expira_en = now() - interval '1 minute' where id = v_r1.id;

  v_libre := public.esta_disponible(v_espacio, v_ini, v_fin);
  if v_libre = true then
    v_ok := v_ok + 1; raise notice '  OK   2. vencido, el horario vuelve a estar libre (sin cron)';
  else
    v_mal := v_mal + 1; raise warning '  MAL  2. vencido y sigue ocupando';
  end if;

  -- ==================================================================
  -- 3. `expirar_reservas_pendientes()` lo cancela de verdad
  -- ==================================================================
  perform public.expirar_reservas_pendientes();
  select estado into v_msg from public.reservas where id = v_r1.id;
  if v_msg = 'cancelada' then
    v_ok := v_ok + 1; raise notice '  OK   3. expirar_reservas_pendientes() lo canceló';
  else
    v_mal := v_mal + 1; raise warning '  MAL  3. quedó en «%» en vez de cancelada', v_msg;
  end if;

  -- ==================================================================
  -- 4. Otro usuario puede reservar ese hueco
  --
  --    El sentido de todo esto: que el horario se pueda volver a vender.
  -- ==================================================================
  begin
    insert into public.reservas
      (organizacion_id, espacio_id, usuario_id, inicio, fin, subtotal, impuestos, total,
       estado, expira_en)
    values (v_org, v_espacio, v_u2, v_ini, v_fin, 1000.00, 160.00, 1160.00,
            'pendiente', now() + interval '15 minutes')
    returning * into v_r2;
    v_ok := v_ok + 1; raise notice '  OK   4. otro usuario reserva el hueco liberado';
  exception when others then
    v_mal := v_mal + 1; raise warning '  MAL  4. no se pudo reservar el hueco: %', sqlerrm;
  end;

  -- ==================================================================
  -- 5. Y ahora ese SÍ bloquea: no se puede reservar dos veces
  --
  --    La exclusión GiST es la única autoridad aquí. Sin ella, dos
  --    personas pagarían el mismo despacho.
  -- ==================================================================
  begin
    insert into public.reservas
      (organizacion_id, espacio_id, usuario_id, inicio, fin, subtotal, impuestos, total,
       estado, expira_en)
    values (v_org, v_espacio, v_u1, v_ini, v_fin, 1000.00, 160.00, 1160.00,
            'pendiente', now() + interval '15 minutes');
    v_mal := v_mal + 1; raise warning '  MAL  5. se aceptó una segunda reserva del mismo horario';
  exception
    when exclusion_violation then
      v_ok := v_ok + 1; raise notice '  OK   5. la exclusión impide la doble reserva';
    when others then
      v_ok := v_ok + 1; raise notice '  OK   5. rechazada la doble reserva (%)', sqlerrm;
  end;

  -- ==================================================================
  -- 6. Un apartado vencido NO se cancela si ya tiene un pago en marcha
  --
  --    Este es el caso peligroso: el cliente terminó de pagar justo
  --    cuando venció el apartado. Cancelarlo dejaría un cobro sin
  --    reserva. Tiene que sobrevivir.
  -- ==================================================================
  update public.reservas
     set expira_en = now() - interval '1 minute'
   where id = v_r2.id;
  insert into public.pagos (organizacion_id, reserva_id, usuario_id, monto, estado, metodo)
  values (v_org, v_r2.id, v_u2, 1160.00, 'procesando', 'stripe');

  perform public.expirar_reservas_pendientes();
  select estado into v_msg from public.reservas where id = v_r2.id;
  if v_msg = 'pendiente' then
    v_ok := v_ok + 1; raise notice '  OK   6. con un pago en marcha, el apartado NO se cancela';
  else
    v_mal := v_mal + 1; raise warning '  MAL  6. se canceló una reserva que estaba cobrándose (quedó «%»)', v_msg;
  end if;

  -- ==================================================================
  -- 7. El disparador libera vencidos al insertar
  --
  --    Sin esto, la exclusión GiST rechazaría la reserva nueva antes de
  --    que nadie hubiera limpiado la vieja: el horario se vería libre en
  --    la pantalla y fallaría al confirmar.
  -- ==================================================================
  declare
    v_ini2 timestamptz := v_ini + interval '1 day';
    v_fin2 timestamptz := v_fin + interval '1 day';
    v_r3   uuid;
  begin
    insert into public.reservas
      (organizacion_id, espacio_id, usuario_id, inicio, fin, subtotal, impuestos, total,
       estado, expira_en)
    values (v_org, v_espacio, v_u1, v_ini2, v_fin2, 1000.00, 160.00, 1160.00,
            'pendiente', now() - interval '1 minute')
    returning id into v_r3;

    -- Otro usuario llega al mismo horario. El disparador tiene que
    -- cancelar el apartado muerto ANTES de que la exclusión se queje.
    begin
      insert into public.reservas
        (organizacion_id, espacio_id, usuario_id, inicio, fin, subtotal, impuestos, total,
         estado, expira_en)
      values (v_org, v_espacio, v_u2, v_ini2, v_fin2, 1000.00, 160.00, 1160.00,
              'pendiente', now() + interval '15 minutes');
      v_ok := v_ok + 1; raise notice '  OK   7. el disparador libera el vencido al insertar';
    exception when others then
      v_mal := v_mal + 1; raise warning '  MAL  7. el vencido bloqueó la reserva nueva: %', sqlerrm;
    end;

    select estado into v_msg from public.reservas where id = v_r3;
    if v_msg = 'cancelada' then
      v_ok := v_ok + 1; raise notice '  OK   8. el vencido quedó cancelado, no colgado';
    else
      v_mal := v_mal + 1; raise warning '  MAL  8. el vencido quedó en «%»', v_msg;
    end if;
  end;

  -- ==================================================================
  -- Resumen
  -- ==================================================================
  raise notice '';
  raise notice '══════════════════════════════════════════════════════';
  if v_mal = 0 then
    raise notice '  TODAS LAS PRUEBAS DE CADUCIDAD PASARON  (%/%)', v_ok, v_ok + v_mal;
  else
    raise exception 'CADUCIDAD: % fallo(s) de %', v_mal, v_ok + v_mal;
  end if;
  raise notice '══════════════════════════════════════════════════════';
end $$;

rollback;
