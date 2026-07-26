-- NO CORRER TODAVIA -- mismo criterio que las anteriores.
--
-- A DIFERENCIA de matches/citas/cita_mensajes, esta politica es
-- ESTRICTAMENTE PROPIA -- nunca "los dos miembros de la cita". Es el
-- debriefing privado de cada persona con Soul; ni siquiera su match puede
-- verlo. Si en algun momento se toca esta politica, NUNCA cambiarla a un
-- criterio de dos personas -- rompería la garantia de privacidad que
-- legal.html/consentimiento.html prometen sobre el debriefing.
ALTER TABLE cita_reflexiones ENABLE ROW LEVEL SECURITY;

CREATE POLICY cita_reflexiones_propia ON cita_reflexiones
  FOR ALL
  USING (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()))
  WITH CHECK (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()));

-- Verificacion obligatoria:
-- select relrowsecurity from pg_class where relname = 'cita_reflexiones';

-- Rollback:
-- DROP POLICY cita_reflexiones_propia ON cita_reflexiones;
-- ALTER TABLE cita_reflexiones DISABLE ROW LEVEL SECURITY;
