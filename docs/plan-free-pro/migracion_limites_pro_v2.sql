-- Columnas para la v2 de limites de Soul Pro (matching con cache por par +
-- bio de presentacion cacheada). No agrega ni modifica ninguna policy de
-- RLS -- las dos tablas ya tienen su RLS real, estas columnas quedan
-- cubiertas por esa misma policy existente.
--
-- Idempotente: IF NOT EXISTS hace que correr esto una segunda vez no rompa
-- nada (no-op sobre las columnas que ya existen).
--
-- Correr sentencia por sentencia, no todas juntas.

-- matches.matching_analizado_en: se guarda cada vez que un par se analiza
-- (o reanaliza) con Sonnet en api/calcularMatches.js. Si despues de esa
-- fecha ninguno de los dos perfiles se revalido (perfiles.perfil_validado_en
-- posterior), el par se reusa desde 'matches' sin volver a llamar a la IA.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS matching_analizado_en timestamptz;

-- perfiles.bio_presentacion / bio_generada_en: la bio breve que Soul genera
-- para presentar a una persona antes de decidir un match (api/matches.js,
-- obtenerPresentacion). Va en 'perfiles' -- keyed por la persona descripta,
-- NO por match -- porque la bio depende solo de grupo1/grupo2 de esa
-- persona, no del par: un mismo texto sirve para cualquier match en el que
-- esa persona aparezca. Se reutiliza mientras bio_generada_en sea posterior
-- (o igual) a perfil_validado_en; si el perfil se revalido despues, se
-- regenera una sola vez y se vuelve a cachear.
ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS bio_presentacion text;

ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS bio_generada_en timestamptz;

-- Nota para quien corra esto: las filas existentes quedan con las tres
-- columnas en null a proposito. Primer efecto practico: la primera vez que
-- alguien vea una presentacion o que un par se (re)analice despues de este
-- deploy, se genera y cachea igual que cualquier caso nuevo -- no hace
-- falta backfill.
