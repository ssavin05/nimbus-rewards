-- =====================================================================
-- migracion-09-nombres-comerciales.sql
-- Alinea los cuatro espacios rentables con nombres y aforo del catálogo canónico.
-- No toca IDs, precios, reservas, geometría ni códigos.
-- Idempotente.
-- =====================================================================

update public.espacios
set nombre = case codigo
  when 'OF-A' then 'Ejecutiva Plus'
  when 'OF-B' then 'Ejecutiva Compact'
  when 'OF-C' then 'Premium Patio View'
  when 'OF-D' then 'Ejecutiva Lounge'
  else nombre
end,
capacidad = case codigo
  when 'OF-A' then 5
  when 'OF-B' then 4
  when 'OF-C' then 4
  when 'OF-D' then 3
  else capacidad
end,
actualizado_en = now()
where codigo in ('OF-A', 'OF-B', 'OF-C', 'OF-D')
  and (
    nombre is distinct from case codigo
      when 'OF-A' then 'Ejecutiva Plus'
      when 'OF-B' then 'Ejecutiva Compact'
      when 'OF-C' then 'Premium Patio View'
      when 'OF-D' then 'Ejecutiva Lounge'
      else nombre
    end
    or capacidad is distinct from case codigo
      when 'OF-A' then 5
      when 'OF-B' then 4
      when 'OF-C' then 4
      when 'OF-D' then 3
      else capacidad
    end
  );
