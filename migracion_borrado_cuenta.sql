ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS eliminacion_solicitada_en timestamptz;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cuenta_eliminada boolean NOT NULL DEFAULT false;
