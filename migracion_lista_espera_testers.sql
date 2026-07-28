-- La version anterior de esta tabla quedo en un estado minimo de prueba
-- (id serial, email text, sin UNIQUE) mientras diagnosticabamos un problema
-- de infraestructura de Supabase que rechazaba inserts de 'anon'/'public'
-- pese a que la politica RLS era correcta. La escritura real ahora pasa a
-- usar la service role key desde el servidor (ver api/auth.js), asi que
-- RLS en esta tabla solo protege la LECTURA -- nadie sin la service role
-- key puede leer estos mails, ni siquiera con el anon key.
DROP TABLE IF EXISTS lista_espera_testers;
DROP TABLE IF EXISTS interesados_testers;

CREATE TABLE lista_espera_testers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  creado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lista_espera_testers ENABLE ROW LEVEL SECURITY;
-- Sin ninguna policy: RLS activado + cero policies = 0 filas visibles para
-- anon/authenticated, tanto para leer como para escribir. Solo la service
-- role key (que bypasea RLS por diseño de Supabase) puede tocar esta tabla,
-- y eso es exactamente lo que hace api/auth.js.

-- Verificacion (correr aparte, comentado):
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'lista_espera_testers';

-- Rollback (comentado):
-- DROP TABLE IF EXISTS lista_espera_testers;
