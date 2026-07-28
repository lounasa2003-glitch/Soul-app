-- Decision 6 (propuesta-retencion.md) -- la unica columna que necesita un
-- cambio de esquema es feedback_piloto.usuario_id: al eliminar una cuenta,
-- el cron ahora lo anonimiza (PATCH usuario_id -> null) en vez de borrar la
-- fila entera, para conservar el aprendizaje del piloto sin el vinculo a la
-- persona. Si la columna tuviera NOT NULL, ese PATCH fallaria siempre.
-- DROP NOT NULL es seguro de correr aunque la columna ya sea nullable (no
-- tira error si no habia constraint que sacar).
ALTER TABLE feedback_piloto ALTER COLUMN usuario_id DROP NOT NULL;

-- El resto de las reglas de retencion aprobadas (cita_reflexiones,
-- cita_ayudas, solicitudes_revision_perfil sumadas a la purga de 30 dias;
-- reportes_tecnicos/errores_silenciosos/diagnosticos_diarios purgados por
-- antiguedad) no requieren cambios de esquema -- usan columnas que ya
-- existen (usuario_id, creado_en) y logica nueva en
-- api/cron/diagnostico-diario.js. No hay nada mas que correr aca.
