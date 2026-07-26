-- NO CORRER TODAVIA -- primero deployar el codigo (api/citas.js) y probar
-- con RLS apagado en conversaciones/matches ya activo. Recien despues correr
-- esto, y verificar relrowsecurity antes de seguir.
ALTER TABLE citas ENABLE ROW LEVEL SECURITY;

CREATE POLICY citas_dos_personas ON citas
  FOR ALL
  USING (
    match_id IN (
      SELECT id FROM matches
      WHERE usuario_a IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
         OR usuario_b IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
    )
  )
  WITH CHECK (
    match_id IN (
      SELECT id FROM matches
      WHERE usuario_a IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
         OR usuario_b IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
    )
  );

-- Verificacion obligatoria:
-- select relrowsecurity from pg_class where relname = 'citas';
-- tiene que dar 'true'.

-- Rollback:
-- DROP POLICY citas_dos_personas ON citas;
-- ALTER TABLE citas DISABLE ROW LEVEL SECURITY;
