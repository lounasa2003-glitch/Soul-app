-- NO CORRER TODAVIA -- deployar codigo primero (lib/rateLimit.js, lib/logUso.js,
-- lib/logEvento.js, lib/logErrorSilencioso.js, lib/verificarAdmin.js, api/citas.js,
-- api/cron/diagnostico-diario.js ya actualizados para usar SUPABASE_SERVICE_ROLE_KEY
-- en estas 6 tablas -- si esta migracion corre antes del deploy de ese codigo, todo
-- lo que hoy usa SUPABASE_ANON_KEY contra estas tablas empieza a fallar).
--
-- CORRER SENTENCIA POR SENTENCIA, NO TODO JUNTO -- confirmar cada bloque antes de
-- seguir con el siguiente (una tabla a la vez), verificando con las consultas de
-- verificacion al final de cada bloque.
--
-- Contexto: verificado en produccion (2026-07-29) que estas 6 tablas son hoy
-- legibles con el SUPABASE_ANON_KEY publico -- sin RLS activo, o con RLS sin
-- ninguna politica que efectivamente bloquee al rol 'anon'. Ninguna de las 6
-- necesita acceso directo desde el cliente: todo el codigo que las lee o
-- escribe corre server-side (funciones de Vercel), asi que quedan
-- exclusivamente para 'service_role'.
--
-- Efecto de cada bloque: RLS habilitado + cero politicas (una tabla con RLS
-- activo y sin ninguna CREATE POLICY deniega TODO acceso a cualquier rol que
-- no sea el dueño de la tabla o un rol con BYPASSRLS -- 'service_role' en
-- Supabase ya tiene ese atributo) + REVOKE explicito de los GRANTs de tabla a
-- anon/authenticated como segunda capa de defensa (para que ni siquiera
-- puedan intentar la consulta -- hoy fallaria igual por RLS, pero asi falla
-- directo por permiso denegado a nivel de tabla, sin depender solo de RLS).
--
-- No se crea NINGUNA politica para anon ni authenticated en ninguna de las
-- 6 tablas -- es intencional, no un olvido.

-- =============================================================
-- 1. rate_limits
-- =============================================================
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Elimina cualquier politica existente antes de dejarla sin ninguna --
-- idempotente, por si alguna vez se creo algo manualmente desde el
-- dashboard sin dejar migracion versionada (no hay migracion previa de
-- esta tabla en el repo).
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'rate_limits' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON rate_limits', pol.policyname);
  END LOOP;
END $$;

REVOKE ALL ON rate_limits FROM anon;
REVOKE ALL ON rate_limits FROM authenticated;
GRANT ALL ON rate_limits TO service_role;

-- Verificacion (correr aparte, no modifica nada):
-- select relrowsecurity from pg_class where relname = 'rate_limits';
-- select policyname from pg_policies where tablename = 'rate_limits'; -- debe devolver 0 filas
-- select has_table_privilege('anon', 'rate_limits', 'SELECT'); -- debe devolver false

-- Rollback (comentado):
-- GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO anon, authenticated;
-- ALTER TABLE rate_limits DISABLE ROW LEVEL SECURITY;

-- =============================================================
-- 2. uso_tokens
-- =============================================================
ALTER TABLE uso_tokens ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'uso_tokens' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON uso_tokens', pol.policyname);
  END LOOP;
END $$;

REVOKE ALL ON uso_tokens FROM anon;
REVOKE ALL ON uso_tokens FROM authenticated;
GRANT ALL ON uso_tokens TO service_role;

-- Verificacion:
-- select relrowsecurity from pg_class where relname = 'uso_tokens';
-- select policyname from pg_policies where tablename = 'uso_tokens';
-- select has_table_privilege('anon', 'uso_tokens', 'SELECT');

-- Rollback:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON uso_tokens TO anon, authenticated;
-- ALTER TABLE uso_tokens DISABLE ROW LEVEL SECURITY;

-- =============================================================
-- 3. eventos_piloto
-- =============================================================
ALTER TABLE eventos_piloto ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'eventos_piloto' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON eventos_piloto', pol.policyname);
  END LOOP;
END $$;

REVOKE ALL ON eventos_piloto FROM anon;
REVOKE ALL ON eventos_piloto FROM authenticated;
GRANT ALL ON eventos_piloto TO service_role;

-- Verificacion:
-- select relrowsecurity from pg_class where relname = 'eventos_piloto';
-- select policyname from pg_policies where tablename = 'eventos_piloto';
-- select has_table_privilege('anon', 'eventos_piloto', 'SELECT');

-- Rollback:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON eventos_piloto TO anon, authenticated;
-- ALTER TABLE eventos_piloto DISABLE ROW LEVEL SECURITY;

-- =============================================================
-- 4. errores_silenciosos
-- =============================================================
ALTER TABLE errores_silenciosos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'errores_silenciosos' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON errores_silenciosos', pol.policyname);
  END LOOP;
END $$;

REVOKE ALL ON errores_silenciosos FROM anon;
REVOKE ALL ON errores_silenciosos FROM authenticated;
GRANT ALL ON errores_silenciosos TO service_role;

-- Verificacion:
-- select relrowsecurity from pg_class where relname = 'errores_silenciosos';
-- select policyname from pg_policies where tablename = 'errores_silenciosos';
-- select has_table_privilege('anon', 'errores_silenciosos', 'SELECT');

-- Rollback:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON errores_silenciosos TO anon, authenticated;
-- ALTER TABLE errores_silenciosos DISABLE ROW LEVEL SECURITY;

-- =============================================================
-- 5. diagnosticos_diarios
-- =============================================================
ALTER TABLE diagnosticos_diarios ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'diagnosticos_diarios' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON diagnosticos_diarios', pol.policyname);
  END LOOP;
END $$;

REVOKE ALL ON diagnosticos_diarios FROM anon;
REVOKE ALL ON diagnosticos_diarios FROM authenticated;
GRANT ALL ON diagnosticos_diarios TO service_role;

-- Verificacion:
-- select relrowsecurity from pg_class where relname = 'diagnosticos_diarios';
-- select policyname from pg_policies where tablename = 'diagnosticos_diarios';
-- select has_table_privilege('anon', 'diagnosticos_diarios', 'SELECT');

-- Rollback:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON diagnosticos_diarios TO anon, authenticated;
-- ALTER TABLE diagnosticos_diarios DISABLE ROW LEVEL SECURITY;

-- =============================================================
-- 6. historial_relacional
-- =============================================================
ALTER TABLE historial_relacional ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'historial_relacional' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON historial_relacional', pol.policyname);
  END LOOP;
END $$;

REVOKE ALL ON historial_relacional FROM anon;
REVOKE ALL ON historial_relacional FROM authenticated;
GRANT ALL ON historial_relacional TO service_role;

-- Verificacion:
-- select relrowsecurity from pg_class where relname = 'historial_relacional';
-- select policyname from pg_policies where tablename = 'historial_relacional';
-- select has_table_privilege('anon', 'historial_relacional', 'SELECT');

-- Rollback:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON historial_relacional TO anon, authenticated;
-- ALTER TABLE historial_relacional DISABLE ROW LEVEL SECURITY;

-- =============================================================
-- push_tokens -- NO SE TOCA EN ESTA MIGRACION
-- =============================================================
-- Revisada aparte (no es una de las 6 tablas confirmadas como expuestas).
-- Ya tiene RLS activo y una politica real desde migracion_push_tokens.sql
-- ("cada quien ve y escribe sus propios push tokens", USING/WITH CHECK
-- por auth.uid()). El guardado del token en el dispositivo ya pasa por
-- /api/guardar (soul.html: guardarTabla('push_tokens', {...})), que reenvia
-- el token propio de la persona -- no el anon key -- porque 'push_tokens'
-- ya esta en TABLAS_CON_RLS (api/guardar.js) y en TABLAS_PERMITIDAS
-- (lib/authUtil.js). No hay ningun punto del cliente que escriba directo
-- contra la API de Supabase sin pasar por ese endpoint.
--
-- Con RLS + policy por auth.uid() ya activos, el anon key (sin sesion,
-- auth.uid() = null) no matchea la condicion de la policy y no devuelve
-- filas -- verificado en produccion (Fase 1): 0 filas accesibles con anon
-- key, consistente con este diseño ya correcto (no distinguible de "tabla
-- vacia" solo por el conteo, pero la migracion ya desplegada lo confirma).
--
-- Endurecimiento opcional, no obligatorio (mismo patron que las 6 tablas de
-- arriba, solo si se quiere quitarle a 'anon' incluso el intento, no solo
-- el resultado -- push_tokens ya esta protegida sin esto):
-- REVOKE ALL ON push_tokens FROM anon;
-- GRANT ALL ON push_tokens TO service_role;
-- (authenticated se mantiene con GRANT + policy propia -- es el uso legitimo real)
