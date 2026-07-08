// Registra el uso real de tokens por llamada, para poder trackear el costo
// real por usuaria -- nunca debe romper la respuesta real si falla.
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
        output_tokens: usage.output_tokens || 0
      })
    });
    // fetch() no tira excepcion por un status no-2xx -- sin este chequeo, un
    // insert rechazado (ej. RLS sin politica) quedaria fallando en silencio.
    if (!res.ok) {
      console.error('registrarUsoTokens: insert rechazado', res.status, await res.text());
    }
  } catch (e) {
    // Best-effort -- si falla el logging no se rompe la respuesta al usuario.
    console.error('registrarUsoTokens: error inesperado', e);
  }
}
