-- NO CORRER TODAVIA -- primero hay que deployar el codigo que reenvia el
-- token propio (lib/authUtil.js, api/leer.js, api/guardar.js) y confirmar
-- que conversaciones sigue funcionando igual con RLS todavia apagado. Recien
-- despues de esa prueba corresponde correr esto.
ALTER TABLE conversaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversaciones_propio ON conversaciones
  FOR ALL
  USING (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()))
  WITH CHECK (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()));

-- Rollback si algo se rompe despues de correr lo de arriba:
-- DROP POLICY conversaciones_propio ON conversaciones;
-- ALTER TABLE conversaciones DISABLE ROW LEVEL SECURITY;
