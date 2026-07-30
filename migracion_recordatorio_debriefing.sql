-- Correr sentencia por sentencia en el editor SQL de Supabase, no todas juntas.

ALTER TABLE citas ADD COLUMN IF NOT EXISTS recordatorio_debriefing_enviado_a timestamptz;

ALTER TABLE citas ADD COLUMN IF NOT EXISTS recordatorio_debriefing_enviado_b timestamptz;
