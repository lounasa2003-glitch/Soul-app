-- NO CORRER TODAVIA -- deployar codigo primero.
ALTER TABLE intentos_fuga_prompt ENABLE ROW LEVEL SECURITY;

CREATE POLICY intentos_fuga_prompt_propio ON intentos_fuga_prompt
  FOR ALL
  USING (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()))
  WITH CHECK (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()));

-- Verificacion obligatoria:
-- select relrowsecurity from pg_class where relname = 'intentos_fuga_prompt';

-- Rollback:
-- DROP POLICY intentos_fuga_prompt_propio ON intentos_fuga_prompt;
-- ALTER TABLE intentos_fuga_prompt DISABLE ROW LEVEL SECURITY;
