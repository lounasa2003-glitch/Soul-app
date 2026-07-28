ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS comunicaciones_producto_aceptadas boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS comunicaciones_producto_fecha timestamptz;
