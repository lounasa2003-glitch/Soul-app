-- Soporte de Mercado Pago (Suscripciones/preapproval) para Soul Pro, en
-- paralelo a Google Play Billing (migracion_suscripciones.sql). No agrega
-- tabla nueva -- todo sigue viviendo en 'usuarios', igual que 'plan' y
-- 'plan_origen'. Reusa plan_vencimiento, plan_auto_renueva y
-- plan_actualizado_en (ya existen) porque se derivan igual de bien del lado
-- de Mercado Pago que del lado de Google -- no hace falta duplicarlos.
--
-- plan_origen='mercadopago' es el valor nuevo que distingue un Pro pagado
-- via Mercado Pago de uno via Google Play ('suscripcion') o cortesia
-- ('manual'). SOLO cuando plan_origen='mercadopago' el backend puede bajar
-- el plan a 'free' de forma automatica -- ver lib/suscripcionesMercadoPago.js.
--
-- Correr las sentencias de a una (no todas pegadas juntas).

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mp_preapproval_id text;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mp_status text;

-- Un mismo preapproval_id nunca deberia repetirse en dos filas -- es como el
-- webhook (topic 'payment'/'subscription_authorized_payment') encuentra a
-- que usuario le corresponde cada aviso cuando no tiene el preapproval_id de
-- forma directa (ver resolverEvento en api/webhooks/mercadopago.js). Parcial
-- (WHERE NOT NULL) para no romper con las filas Free/manuales, que quedan en
-- NULL.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_mp_preapproval_id_idx ON usuarios(mp_preapproval_id) WHERE mp_preapproval_id IS NOT NULL;
