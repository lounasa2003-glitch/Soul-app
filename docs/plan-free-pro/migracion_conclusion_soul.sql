-- Agrega el rastro real de "cuándo y qué versión de la conclusión confirmó
-- la persona" a la tabla perfiles. perfil_validado (boolean) y
-- ajuste_perfil_nota (text) ya existen -- esto solo suma lo que falta para
-- poder gatear matching de verdad (ver api/calcularMatches.js) en vez de
-- solo mostrarlo en el panel admin.
--
-- perfil_validado_snapshot es jsonb real (no texto/JSON.stringify) a
-- proposito: jsonb en Postgres no preserva el orden de insercion de las
-- claves de un objeto, así que comparar contra el texto crudo daba falsos
-- "cambió" incluso sin ningún cambio real. La comparación de verdad
-- (construirSnapshotConclusion + conclusionesIguales, en soul.html y
-- api/calcularMatches.js) es un deep-equal campo por campo, no un string
-- match -- por eso el tipo de columna correcto es jsonb, no text.
--
-- No agrega ni modifica ninguna policy de RLS -- perfiles ya tiene su RLS
-- real (acceso "solo el dueño" desde el cliente; las lecturas cruzadas de
-- matching pasan por SUPABASE_SERVICE_ROLE_KEY del lado del servidor, ver
-- api/calcularMatches.js). Estas dos columnas quedan cubiertas por esa
-- misma policy existente, sin necesidad de nada nuevo.
--
-- Idempotente: IF NOT EXISTS hace que correr esto una segunda vez no
-- rompa nada (no-op sobre las columnas que ya existen).
--
-- Correr sentencia por sentencia, no todas juntas.

ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS perfil_validado_en timestamptz;

ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS perfil_validado_snapshot jsonb;

-- Nota para quien corra esto: las filas existentes quedan con
-- perfil_validado_en/perfil_validado_snapshot en null a propósito -- no se
-- inventa una aceptación retroactiva. La próxima vez que esa persona
-- intente ver sus matches, el snapshot null nunca va a coincidir con su
-- conclusión actual (conclusionesIguales trata null como distinto de
-- cualquier objeto real) y se le va a volver a pedir confirmar (ver
-- mostrarMisMatches/conclusionEstaConfirmada en soul.html y el gate en
-- api/calcularMatches.js). Sus matches ya calculados hasta ahora no se
-- tocan ni se ocultan.
