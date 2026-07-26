ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS auth_id uuid;

-- Backfill para las cuentas que ya existen (confirmado antes de correr esto:
-- las 33 filas reales de usuarios tienen exactamente un auth.users con el
-- mismo email, y ningun caso raro de 0 o mas de 1 match). Las cuentas nuevas
-- ya llegan con auth_id seteado desde api/guardar.js.
UPDATE usuarios u
SET auth_id = a.id
FROM auth.users a
WHERE lower(a.email) = lower(u.email)
  AND u.auth_id IS NULL;

-- Unico (no NOT NULL todavia -- las cuentas de prueba sinteticas del panel
-- admin, ver sembrarPreview en api/admin/matches.js, no tienen auth.users
-- real detras y quedan con auth_id null a proposito).
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_auth_id_key ON usuarios (auth_id) WHERE auth_id IS NOT NULL;
