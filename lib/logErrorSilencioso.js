// Centraliza los catch "best-effort" que hoy solo hacen console.error --
// esos errores existen unicamente en los logs de Vercel, que nadie revisa,
// asi que un problema real (ej: un mail que nunca sale) puede pasar
// semanas sin que nadie se entere. Esta funcion nunca debe romper el flujo
// que la llama: si el insert falla, se loguea a consola y se sigue.
export async function registrarErrorSilencioso({ contexto, error, meta }) {
  if (!contexto) return;
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const mensaje = error instanceof Error ? error.message : String(error ?? '');
    const stack = error instanceof Error ? error.stack : null;
    const res = await fetch(`${supabaseUrl}/rest/v1/errores_silenciosos`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ contexto, mensaje, stack, meta: meta || null })
    });
    if (!res.ok) {
      console.error('registrarErrorSilencioso: insert rechazado', res.status, await res.text());
    }
  } catch (e) {
    console.error('registrarErrorSilencioso: error inesperado', e);
  }
}
