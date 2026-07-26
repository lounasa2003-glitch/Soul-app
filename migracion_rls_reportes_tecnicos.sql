-- NO CORRER TODAVIA -- deployar codigo primero.
--
-- A diferencia de las demas politicas "propias": reportarProblema en
-- api/auth.js escribe ANTES de que exista sesion (pantallas de login/
-- registro), con usuario_id null -- por eso la condicion permite null
-- ademas del caso normal de usuario logueado.
ALTER TABLE reportes_tecnicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY reportes_tecnicos_propio ON reportes_tecnicos
  FOR ALL
  USING (
    usuario_id IS NULL
    OR usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
  )
  WITH CHECK (
    usuario_id IS NULL
    OR usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
  );

-- Verificacion obligatoria:
-- select relrowsecurity from pg_class where relname = 'reportes_tecnicos';

-- Rollback:
-- DROP POLICY reportes_tecnicos_propio ON reportes_tecnicos;
-- ALTER TABLE reportes_tecnicos DISABLE ROW LEVEL SECURITY;
