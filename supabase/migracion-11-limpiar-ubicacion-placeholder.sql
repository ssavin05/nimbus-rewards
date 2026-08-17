-- ======================================================================
-- migracion-11-limpiar-ubicacion-placeholder.sql
-- Quita del despliegue existente las coordenadas genéricas del centro de
-- Ensenada. No eran la ubicación confirmada de la oficina y no deben
-- convertirse accidentalmente en un pin público. Idempotente.
-- ======================================================================

update public.sedes
   set lat = null,
       lng = null,
       nombre = case when nombre = 'Sede Ensenada Centro' then 'Sede Ensenada' else nombre end
 where lat = 31.8667
   and lng = -116.5964;
