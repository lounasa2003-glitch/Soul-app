// Gate simple de admin -- una sola contraseña compartida via variable de
// entorno, sin usuario/rol en la base. Suficiente para una sola persona
// administradora; si en algun momento hay mas de una, esto se puede
// reemplazar por un flag real en 'usuarios' sin tocar los endpoints que
// ya la usan.
//
// Los intentos FALLIDOS se cuentan por IP (misma tabla rate_limits que usa
// chequearLimite en lib/rateLimit.js, pero sin reusar esa funcion): a
// diferencia del chat o la cita, el panel de admin llama a este chequeo en
// cada pantalla que carga (cada persona que se abre en la Hoja de Vida es
// un request autenticado nuevo) -- si se contara cada llamada like hace
// chequearLimite, el uso normal de la administradora navegando varios
// perfiles seguidos la autobloquearia a ella misma. Contando solo los
// fallos, una vez que se supera el limite de intentos incorrectos queda
// bloqueado incluso si el siguiente intento fuera la contraseña correcta
// (lockout real, no solo un contador informativo) -- eso es lo que de
// verdad frena la fuerza bruta.
const LIMITE_INTENTOS_FALLIDOS = 5;
const VENTANA_SEGUNDOS = 900;

function obtenerIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'ip_desconocida';
}

async function leerFilaIntentos(ip) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const res = await fetch(
    `${supabaseUrl}/rest/v1/rate_limits?select=*&email=eq.${encodeURIComponent(ip)}&endpoint=eq.admin_password`,
    { headers }
  );
  return res.ok ? (await res.json())[0] : undefined;
}

async function estaBloqueado(ip) {
  const fila = await leerFilaIntentos(ip);
  if (!fila) return false;
  const ventanaVencida = (new Date() - new Date(fila.ventana_inicio)) / 1000 > VENTANA_SEGUNDOS;
  if (ventanaVencida) return false;
  return fila.contador >= LIMITE_INTENTOS_FALLIDOS;
}

async function registrarIntentoFallido(ip) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const fila = await leerFilaIntentos(ip);
  const ahora = new Date();
  const ventanaVencida = !fila || (ahora - new Date(fila.ventana_inicio)) / 1000 > VENTANA_SEGUNDOS;

  if (ventanaVencida) {
    await fetch(`${supabaseUrl}/rest/v1/rate_limits?on_conflict=email,endpoint`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: ip, endpoint: 'admin_password', ventana_inicio: ahora.toISOString(), contador: 1 })
    });
    return;
  }

  await fetch(`${supabaseUrl}/rest/v1/rate_limits?email=eq.${encodeURIComponent(ip)}&endpoint=eq.admin_password`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contador: fila.contador + 1 })
  });
}

export async function verificarAdmin(req) {
  const esperado = process.env.ADMIN_PASSWORD;
  if (!esperado) return false;

  const ip = obtenerIp(req);
  if (await estaBloqueado(ip)) return false;

  const recibido = req.headers['x-admin-password'];
  if (recibido === esperado) return true;

  await registrarIntentoFallido(ip);
  return false;
}
