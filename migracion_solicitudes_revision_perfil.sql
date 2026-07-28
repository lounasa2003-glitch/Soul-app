CREATE TABLE IF NOT EXISTS solicitudes_revision_perfil (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  texto_cuestionado text NOT NULL,
  explicacion text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_revision','resuelto')),
  respuesta_admin text,
  respondido_en timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE solicitudes_revision_perfil ENABLE ROW LEVEL SECURITY;

CREATE POLICY solicitudes_revision_perfil_propio ON solicitudes_revision_perfil
  FOR ALL
  USING (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()))
  WITH CHECK (usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()));

-- Verificacion obligatoria:
-- select relrowsecurity from pg_class where relname = 'solicitudes_revision_perfil';

-- Rollback:
-- DROP POLICY solicitudes_revision_perfil_propio ON solicitudes_revision_perfil;
-- DROP TABLE solicitudes_revision_perfil;
