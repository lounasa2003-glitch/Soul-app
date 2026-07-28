-- Tabla separada de 'usuarios' a proposito: esto es solo interes en probar
-- la app (recluta testers para el track de Play Console), no una cuenta
-- real de Soul. El email es unico para no acumular duplicados si alguien
-- manda el formulario mas de una vez.
CREATE TABLE IF NOT EXISTS lista_espera_testers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  creado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lista_espera_testers ENABLE ROW LEVEL SECURITY;

-- Cualquiera puede anotarse (formulario publico, sin login) -- pero nadie
-- puede LEER la lista salvo la service role key (panel admin/consulta
-- manual). Sin politica de SELECT para anon/authenticated, esas dos
-- quedan en 0 filas visibles por diseno de RLS.
CREATE POLICY "cualquiera puede anotarse"
  ON lista_espera_testers
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Verificacion (correr aparte, comentado):
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'lista_espera_testers';
-- SELECT * FROM pg_policies WHERE tablename = 'lista_espera_testers';

-- Rollback (comentado):
-- DROP TABLE IF EXISTS lista_espera_testers;
