-- NO CORRER TODAVIA -- mismo criterio que las anteriores: deployar codigo,
-- probar con RLS apagado, y recien despues activar.
ALTER TABLE cita_mensajes ENABLE ROW LEVEL SECURITY;

-- cita_mensajes es el chat compartido -- las dos personas de la cita lo ven
-- completo (a diferencia de cita_reflexiones, que es estrictamente privada).
CREATE POLICY cita_mensajes_dos_personas ON cita_mensajes
  FOR ALL
  USING (
    cita_id IN (
      SELECT c.id FROM citas c
      JOIN matches m ON m.id = c.match_id
      WHERE m.usuario_a IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
         OR m.usuario_b IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
    )
  )
  WITH CHECK (
    cita_id IN (
      SELECT c.id FROM citas c
      JOIN matches m ON m.id = c.match_id
      WHERE m.usuario_a IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
         OR m.usuario_b IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
    )
  );

-- Verificacion obligatoria:
-- select relrowsecurity from pg_class where relname = 'cita_mensajes';

-- Rollback:
-- DROP POLICY cita_mensajes_dos_personas ON cita_mensajes;
-- ALTER TABLE cita_mensajes DISABLE ROW LEVEL SECURITY;
