-- NO CORRER TODAVIA -- deployar codigo primero.
ALTER TABLE perfiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY perfiles_propio ON perfiles
  FOR ALL
  USING (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()))
  WITH CHECK (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()));

-- Verificacion obligatoria:
-- select relrowsecurity from pg_class where relname = 'perfiles';

-- Rollback:
-- DROP POLICY perfiles_propio ON perfiles;
-- ALTER TABLE perfiles DISABLE ROW LEVEL SECURITY;
