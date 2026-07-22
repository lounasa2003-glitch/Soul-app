// Registra el uso real de tokens por llamada, para poder trackear el costo
// real por usuaria -- nunca debe romper la respuesta real si falla.
import { registrarErrorSilencioso } from './logErrorSilencioso.js';

export async function registrarUsoTokens({ usuarioId, endpoint, moduloFase, usage }) {
  if (!usage) return;
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const res = await fetch(`${supabaseUrl}/rest/v1/uso_tokens`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        usuario_id: usuarioId || null,
        endpoint,
        modulo_fase: moduloFase || null,
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        // El caching de prompts esta activo (systemConCache en
        // anthropicClient.js) y de verdad reduce lo que Anthropic cobra --
        // pero esos tokens de cache viajan en campos separados
        // (cache_creation_input_tokens/cache_read_input_tokens) que hasta
        // ahora nunca se guardaban, asi que el costo mostrado en el panel
        // quedaba mas bajo que el real. Cache read cuesta ~10% del precio
        // normal, cache creation ~125% (una sola vez por escritura) --
        // ver el ajuste de la formula de costo en diagnostico-diario.js y
        // admin/personas.js (modo=metricas).
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0
      })
    });
    // fetch() no tira excepcion por un status no-2xx -- sin este chequeo, un
    // insert rechazado (ej. RLS sin politica) quedaria fallando en silencio.
    if (!res.ok) {
      const texto = await res.text();
      console.error('registrarUsoTokens: insert rechazado', res.status, texto);
      await registrarErrorSilencioso({ contexto: 'lib/logUso: insert rechazado', error: `HTTP ${res.status}: ${texto}`, meta: { usuarioId, endpoint } });
    }
  } catch (e) {
    // Best-effort -- si falla el logging no se rompe la respuesta al usuario.
    console.error('registrarUsoTokens: error inesperado', e);
    await registrarErrorSilencioso({ contexto: 'lib/logUso: error inesperado', error: e, meta: { usuarioId, endpoint } });
  }
}
