-- NO CORRER TODAVIA -- deployar codigo primero.
ALTER TABLE feedback_piloto ENABLE ROW LEVEL SECURITY;

CREATE POLICY feedback_piloto_propio ON feedback_piloto
  FOR ALL
  USING (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()))
  WITH CHECK (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()));

-- Verificacion obligatoria:
-- select relrowsecurity from pg_class where relname = 'feedback_piloto';

-- Rollback:
-- DROP POLICY feedback_piloto_propio ON feedback_piloto;
-- ALTER TABLE feedback_piloto DISABLE ROW LEVEL SECURITY;
