ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS consentimiento_fecha timestamptz;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS consentimiento_version text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS politica_privacidad_version text;
