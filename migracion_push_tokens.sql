-- Tabla separada de 'usuarios' (no una columna) porque una persona puede
-- tener mas de un dispositivo/plataforma registrada (celular Android +
-- despues navegador web) -- un token por fila, no uno solo por persona.
CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token text NOT NULL,
  plataforma text NOT NULL CHECK (plataforma IN ('android', 'web')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, plataforma, token)
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
-- Igual que el resto de las tablas propias de una persona: cada quien
-- puede leer/escribir solo sus propios tokens, via auth.uid() = auth_id
-- de su fila en 'usuarios'. El envio real de notificaciones (lectura
-- cruzada de tokens ajenos) lo hace el servidor con la service role key,
-- igual que matches/citas cruzados.
CREATE POLICY "cada quien ve y escribe sus propios push tokens"
  ON push_tokens
  FOR ALL
  USING (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()))
  WITH CHECK (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()));

-- Verificacion (correr aparte, comentado):
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'push_tokens';
-- SELECT policyname FROM pg_policies WHERE tablename = 'push_tokens';

-- Rollback (comentado):
-- DROP TABLE IF EXISTS push_tokens;
