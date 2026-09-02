-- Trazabilidad de la conversion USD->ARS usada en cada alta nueva de Soul
-- Pro via Mercado Pago (ver lib/precioSoulPro.js). Tabla separada de
-- 'usuarios' a proposito: 'usuarios' representa el estado ACTUAL del plan
-- (se sobreescribe en cada sync), mientras que esto es un registro
-- historico e inmutable de un evento puntual -- que cotizacion se uso para
-- fijar el monto de ESTA alta en particular. Guardarlo en 'usuarios' se
-- perderia en la primera renovacion/resync, y una persona puede cancelar y
-- volver a suscribirse mas adelante con otra cotizacion (otra fila nueva
-- aca, no un pisado del historial).
--
-- Correr las sentencias de a una (no todas pegadas juntas).

CREATE TABLE IF NOT EXISTS mp_precios_alta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  mp_preapproval_id text NOT NULL,
  precio_objetivo_usd numeric NOT NULL,
  cotizacion_usd_ars numeric NOT NULL,
  monto_ars numeric NOT NULL,
  cotizacion_fecha date NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_precios_alta_usuario_id_idx ON mp_precios_alta(usuario_id);

-- Tabla de auditoria de acceso exclusivo server-side -- mismo criterio que
-- rate_limits/errores_silenciosos (ver migracion_rls_tablas_internas.sql):
-- RLS activo pero CERO policies (invisible para anon/authenticated aunque
-- tengan el id), solo la service role key (que bypasea RLS) puede
-- leer/escribir. Nadie necesita ver esto desde el cliente.
ALTER TABLE mp_precios_alta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mp_precios_alta FROM anon;
REVOKE ALL ON mp_precios_alta FROM authenticated;
GRANT ALL ON mp_precios_alta TO service_role;

-- Verificacion (correr aparte, comentado):
-- select relrowsecurity from pg_class where relname = 'mp_precios_alta';
-- select policyname from pg_policies where tablename = 'mp_precios_alta'; -- debe devolver 0 filas
-- select has_table_privilege('anon', 'mp_precios_alta', 'SELECT'); -- debe devolver false

-- Rollback (comentado):
-- DROP TABLE IF EXISTS mp_precios_alta;
