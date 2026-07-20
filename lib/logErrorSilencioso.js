// Centraliza los catch "best-effort" que hoy solo hacen console.error --
// esos errores existen unicamente en los logs de Vercel, que nadie revisa,
// asi que un problema real (ej: un mail que nunca sale) puede pasar
// semanas sin que nadie se entere. Esta funcion nunca debe romper el flujo
// que la llama: si el insert falla, se loguea a consola y se sigue.
//
// Ningun catch actual del codigo adjunta headers/env vars al error que
// tira (revisado api/*.js, lib/*.js) -- ni Anthropic ni Supabase ni Resend
// devuelven las credenciales en sus respuestas de error. Aun asi, esto
// funciona como red de seguridad: si en el futuro algun error.message o
// stack terminara conteniendo un secreto real (por un cambio de codigo que
// no se dio cuenta), no queda guardado ni sale en el mail diario.
function valoresSecretos() {
  return [
    process.env.ANTHROPIC_API_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.RESEND_API_KEY,
    process.env.ADMIN_PASSWORD,
    process.env.CRON_SECRET
  ].filter((v) => v && v.length >= 6);
}

function redactar(valor) {
  if (valor === null || valor === undefined) return valor;
  let texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  for (const secreto of valoresSecretos()) {
    texto = texto.split(secreto).join('[REDACTADO]');
  }
  return typeof valor === 'string' ? texto : JSON.parse(texto);
}

export async function registrarErrorSilencioso({ contexto, error, meta }) {
  if (!contexto) return;
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const mensaje = redactar(error instanceof Error ? error.message : String(error ?? ''));
    const stack = redactar(error instanceof Error ? error.stack : null);
    const metaSegura = meta ? redactar(meta) : null;
    const res = await fetch(`${supabaseUrl}/rest/v1/errores_silenciosos`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ contexto, mensaje, stack, meta: metaSegura })
    });
    if (!res.ok) {
      console.error('registrarErrorSilencioso: insert rechazado', res.status, await res.text());
    }
  } catch (e) {
    console.error('registrarErrorSilencioso: error inesperado', e);
  }
}
