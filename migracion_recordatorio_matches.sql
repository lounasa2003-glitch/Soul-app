ALTER TABLE matches ADD COLUMN IF NOT EXISTS recordatorio_eleccion_enviado_a timestamptz;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS recordatorio_eleccion_enviado_b timestamptz;
ALTER TABLE citas ADD COLUMN IF NOT EXISTS recordatorio_sin_mensaje_enviado_a timestamptz;
ALTER TABLE citas ADD COLUMN IF NOT EXISTS recordatorio_sin_mensaje_enviado_b timestamptz;
