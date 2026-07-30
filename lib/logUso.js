// Registra el uso real de tokens por llamada, para poder trackear el costo
// real por usuaria -- nunca debe romper la respuesta real si falla.
import { registrarErrorSilencioso } from './logErrorSilencioso.js';

export async function registrarUsoTokens({ usuarioId, endpoint, moduloFase, usage }) {
  if (!usage) return { ok: true, omitido: true };
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    // uso_tokens es de acceso exclusivo server-side (sin RLS/policy para
    // anon ni authenticated, ver migracion_rls_tablas_internas.sql).
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
      // DIAGNOSTICO TEMPORAL (sesion harmonic-launching-finch) -- sacar
      // junto con el cambio en api/extraccionPerfil.js que expone esto en
      // la respuesta HTTP una vez encontrada la causa real. Nunca incluye
      // keys/tokens, solo lo que ya devuelve Supabase (status + texto).
      console.error('registrarUsoTokens: insert rechazado', { endpoint, status: res.status, texto });
      await registrarErrorSilencioso({ contexto: 'lib/logUso: insert rechazado', error: `HTTP ${res.status}: ${texto}`, meta: { usuarioId, endpoint } });
      return { ok: false, status: res.status, mensaje: texto, endpoint };
    }
    return { ok: true };
  } catch (e) {
    // Best-effort -- si falla el logging no se rompe la respuesta al usuario.
    console.error('registrarUsoTokens: error inesperado', { endpoint, mensaje: e && e.message });
    await registrarErrorSilencioso({ contexto: 'lib/logUso: error inesperado', error: e, meta: { usuarioId, endpoint } });
    return { ok: false, status: null, mensaje: e && e.message, endpoint };
  }
}
