-- Decision 8 (docs/privacy-launch/02-riesgos/decisiones-founder.md) -- no se
-- encontro ningun uso funcional de usuarios.hora_nacimiento (no aparece en
-- ningun prompt de IA, en el matching, en la compatibilidad, en ningun
-- filtro, en el panel admin ni en reportes). El codigo dejo de pedirla y
-- guardarla; esta migracion NO borra la columna ni los valores historicos
-- que ya existan -- solo la documenta como obsoleta directamente en el
-- esquema, para que quede visible sin depender de este repo.
COMMENT ON COLUMN usuarios.hora_nacimiento IS 'OBSOLETA (Decision 8, 2026-07-28): sin uso funcional comprobado (IA, matching, compatibilidad, filtros, admin, reportes). El codigo ya no la solicita ni la escribe. Valores historicos se conservan sin migrar todavia -- pendiente de una futura limpieza.';
