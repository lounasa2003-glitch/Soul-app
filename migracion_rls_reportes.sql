-- NO CORRER TODAVIA -- deployar codigo primero.
--
-- Solo quien reporta puede ver/escribir su propio reporte -- nunca la
-- persona reportada, y nunca reportes de otras personas.
ALTER TABLE reportes ENABLE ROW LEVEL SECURITY;

CREATE POLICY reportes_propio ON reportes
  FOR ALL
  USING (usuario_reporta IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()))
  WITH CHECK (usuario_reporta IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()));

-- Verificacion obligatoria:
-- select relrowsecurity from pg_class where relname = 'reportes';

-- Rollback:
-- DROP POLICY reportes_propio ON reportes;
-- ALTER TABLE reportes DISABLE ROW LEVEL SECURITY;
