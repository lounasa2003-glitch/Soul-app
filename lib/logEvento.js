// Registra eventos crudos del embudo del piloto (registro, onboarding,
// primer match, primer mensaje, encuentro agendado/cerrado, debriefing,
// eleccion post-encuentro) -- nunca debe romper la respuesta real si falla.
// "Primera vez" se deriva despues con min(created_at) group by usuario_id,
// no se calcula aca -- cada llamada es una fila cruda mas.
import { registrarErrorSilencioso } from './logErrorSilencioso.js';

export async function registrarEvento({ usuarioId, tipo, metadata }) {
  if (!usuarioId || !tipo) return;
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const res = await fetch(`${supabaseUrl}/rest/v1/eventos_piloto`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        usuario_id: usuarioId,
        tipo,
        metadata: metadata || null
      })
    });
    if (!res.ok) {
      const texto = await res.text();
      console.error('registrarEvento: insert rechazado', res.status, texto);
      await registrarErrorSilencioso({ contexto: 'lib/logEvento: insert rechazado', error: `HTTP ${res.status}: ${texto}`, meta: { usuarioId, tipo } });
    }
  } catch (e) {
    console.error('registrarEvento: error inesperado', e);
    await registrarErrorSilencioso({ contexto: 'lib/logEvento: error inesperado', error: e, meta: { usuarioId, tipo } });
  }
}
