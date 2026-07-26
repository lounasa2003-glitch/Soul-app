-- NO CORRER TODAVIA -- mismo criterio que las anteriores.
-- Estrictamente propia, igual que cita_reflexiones (registra pedidos de
-- ayuda/incomodidad de cada persona -- no es algo que su match deba ver).
ALTER TABLE cita_ayudas ENABLE ROW LEVEL SECURITY;

CREATE POLICY cita_ayudas_propia ON cita_ayudas
  FOR ALL
  USING (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()))
  WITH CHECK (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()));

-- Verificacion obligatoria:
-- select relrowsecurity from pg_class where relname = 'cita_ayudas';

-- Rollback:
-- DROP POLICY cita_ayudas_propia ON cita_ayudas;
-- ALTER TABLE cita_ayudas DISABLE ROW LEVEL SECURITY;
