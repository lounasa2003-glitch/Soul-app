-- NO CORRER TODAVIA -- primero hay que deployar el codigo que reenvia el
-- token propio (api/matches.js, api/citas.js, api/calcularMatches.js,
-- api/leer.js, api/guardar.js, lib/authUtil.js) y confirmar que todo sigue
-- funcionando igual con RLS todavia apagado.
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY matches_dos_personas ON matches
  FOR ALL
  USING (
    usuario_a IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
    OR usuario_b IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
  )
  WITH CHECK (
    usuario_a IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
    OR usuario_b IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())
  );

-- Verificacion obligatoria despues de correr esto (la vez pasada la
-- politica se creo pero ENABLE ROW LEVEL SECURITY no habia quedado activo):
-- select relrowsecurity from pg_class where relname = 'matches';
-- tiene que dar 'true'.

-- Rollback si algo se rompe:
-- DROP POLICY matches_dos_personas ON matches;
-- ALTER TABLE matches DISABLE ROW LEVEL SECURITY;
