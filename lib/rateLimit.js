// Rate limiting de ventana fija por email+endpoint, guardado en Supabase
// (no hay Redis ni estado en memoria compartido entre invocaciones de la
// funcion serverless). Best-effort: el ciclo lectura-luego-escritura no es
// atomico, asi que en el peor caso una carrera deja pasar un par de
// requests de mas -- aceptable para el objetivo de frenar abuso, no para
// contar con precision perfecta.
//
// Devuelve { permitido, restantes, segundosParaReset } en vez de un booleano
// simple -- restantes y segundosParaReset le permiten a quien llama avisar
// en la UI ("te quedan N mensajes", "podés seguir en X minutos") en vez de
// solo bloquear en seco al llegar al limite.
export async function chequearLimite(email, endpoint, limite, ventanaSegundos) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  const res = await fetch(
    `${supabaseUrl}/rest/v1/rate_limits?select=*&email=eq.${encodeURIComponent(email)}&endpoint=eq.${encodeURIComponent(endpoint)}`,
    { headers }
  );
  const rows = res.ok ? await res.json() : [];
  const fila = rows[0];
  const ahora = new Date();
  const ventanaVencida = !fila || (ahora - new Date(fila.ventana_inicio)) / 1000 > ventanaSegundos;

  if (ventanaVencida) {
    await fetch(`${supabaseUrl}/rest/v1/rate_limits?on_conflict=email,endpoint`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email, endpoint, ventana_inicio: ahora.toISOString(), contador: 1 })
    });
    return { permitido: true, restantes: limite - 1, segundosParaReset: ventanaSegundos };
  }

  const segundosParaReset = Math.max(0, ventanaSegundos - Math.floor((ahora - new Date(fila.ventana_inicio)) / 1000));

  if (fila.contador >= limite) {
    return { permitido: false, restantes: 0, segundosParaReset };
  }

  await fetch(
    `${supabaseUrl}/rest/v1/rate_limits?email=eq.${encodeURIComponent(email)}&endpoint=eq.${encodeURIComponent(endpoint)}`,
    {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contador: fila.contador + 1 })
    }
  );
  return { permitido: true, restantes: Math.max(0, limite - fila.contador - 1), segundosParaReset };
}
