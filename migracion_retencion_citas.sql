-- Decision 6, cierre de citas/cita_mensajes (propuesta-retencion-citas.md
-- aprobada). Dos columnas nuevas:
--
-- citas.cerrada_en: momento en que la cita pasa definitivamente a
-- 'cerrada' (ver finalizarCita en lib/cierreCita.js) -- es lo que dispara
-- el conteo de los 12 meses de retencion de cita_mensajes (ver
-- purgarCitaMensajesVencidos en api/cron/diagnostico-diario.js). Nullable:
-- las citas cerradas ANTES de esta migracion quedan con cerrada_en null, y
-- por lo tanto nunca entran en la purga (el filtro del cron es
-- "cerrada_en <= limite", null no matchea) hasta que alguien vuelva a
-- disparar finalizarCita sobre ellas (lo cual no pasa para citas ya
-- cerradas) -- en la practica, esas citas viejas quedan retenidas
-- indefinidamente salvo que se decida un backfill aparte a mano.
ALTER TABLE citas ADD COLUMN IF NOT EXISTS cerrada_en timestamptz;

-- reportes.estado: 'abierto' (default, recien creado) o 'cerrado'
-- (la administradora lo cierra desde el panel, Hoja de Vida -> Seguridad).
-- Mientras un reporte sobre un match sigue 'abierto', el cron de retencion
-- no borra los cita_mensajes de NINGUNA cita de ese match (ver el chequeo
-- de matchesConReporteAbierto en purgarCitaMensajesVencidos).
ALTER TABLE reportes ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'abierto';

-- Postgres no soporta "ADD CONSTRAINT IF NOT EXISTS" -- este bloque hace lo
-- mismo a mano (solo agrega el CHECK si todavia no existe), para que la
-- migracion se pueda correr mas de una vez sin romper.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reportes_estado_check'
  ) THEN
    ALTER TABLE reportes ADD CONSTRAINT reportes_estado_check CHECK (estado IN ('abierto', 'cerrado'));
  END IF;
END $$;
