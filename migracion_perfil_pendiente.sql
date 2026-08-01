-- Ancla para saber hace cuanto quedo pendiente de confirmar la
-- representacion interpretativa (grupo1-4 + indice_disponibilidad +
-- no_negociables + negociables, ver lib/conclusionSoul.js), y dos guards
-- para no duplicar los recordatorios de 24h/72h (ver
-- lib/recordatorioPerfilPendiente.js). No reemplaza ni modifica
-- perfil_validado/perfil_validado_en/perfil_validado_snapshot, que ya
-- existen y siguen siendo la fuente de verdad de "esta confirmado o no".
--
-- perfil_pendiente_desde se fija cuando se genera la interpretacion por
-- primera vez (guardarPerfil, al cerrar la charla con Soul) y cuando se
-- invalida una confirmacion previa por un cambio en los campos del
-- snapshot (no_negociables/negociables via Mi Perfil, o "Quiero ajustar
-- algo"). No se borra al confirmar -- perfil_validado_en ya registra ese
-- momento.
--
-- Idempotente: IF NOT EXISTS hace que correr esto una segunda vez no rompa
-- nada. Correr sentencia por sentencia, no todas juntas.

ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS perfil_pendiente_desde timestamptz;

ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS recordatorio_pendiente_24h_enviado timestamptz;

ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS recordatorio_pendiente_72h_enviado timestamptz;
