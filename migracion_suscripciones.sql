-- Soporte de Google Play Billing para Soul Pro. No agrega tabla nueva --
-- todo vive en 'usuarios', igual que el 'plan' que ya existe (ver
-- migracion_plan_free_pro.sql). plan_origen es lo que distingue un Pro
-- pagado (via Play) de un Pro dado a mano desde el panel admin (cortesia) --
-- SOLO cuando plan_origen='suscripcion' el backend puede bajar el plan a
-- 'free' de forma automatica (renovacion fallida, cancelacion vencida,
-- reembolso, etc). Un Pro manual nunca se toca solo.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plan_origen text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plan_purchase_token text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plan_producto_id text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plan_vencimiento timestamptz;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plan_auto_renueva boolean;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plan_estado_suscripcion text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plan_actualizado_en timestamptz;

-- Un mismo purchase token nunca deberia repetirse en dos filas -- es como
-- RTDN y el cron de respaldo encuentran a que usuario le corresponde cada
-- notificacion/renovacion de Google (ver lib/suscripciones.js). Parcial
-- (WHERE NOT NULL) para no romper con multiples filas en NULL, que es el
-- default de todas las cuentas Free/manuales.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_plan_purchase_token_idx ON usuarios(plan_purchase_token) WHERE plan_purchase_token IS NOT NULL;
