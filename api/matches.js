import { verificarUsuario } from '../lib/authUtil.js';

// Fusiona lo que antes eran misMatches.js, elegirMatch.js y cerrarMatch.js
// en un solo archivo -- el plan Hobby de Vercel permite como maximo 12
// funciones serverless por deploy, y el proyecto ya estaba por encima de
// eso. GET lista los matches propios; POST con "accion" decide o cierra.
//
// Endpoint dedicado (no el /api/leer o /api/guardar genericos) porque esos
// solo autorizan lecturas/escrituras por 'usuario_a' (ver TABLAS_PERMITIDAS
// en lib/authUtil.js), y acá hace falta que 'usuario_b' también pueda leer
// y decidir sobre sus propios matches. Mismo patrón que api/chat.js usa
// para su validación extra: consulta propia en vez de forzar el caso en el
// validador compartido.

async function listarMisMatches(req, res, supabaseUrl, headers, usuario) {
  const idEnc = encodeURIComponent(usuario.usuarioId);
  const response = await fetch(
    `${supabaseUrl}/rest/v1/matches?select=*&or=(usuario_a.eq.${idEnc},usuario_b.eq.${idEnc})`,
    { headers }
  );
  const matches = response.ok ? await response.json() : [];
  return res.status(200).json({ matches });
}

async function elegir(req, res, supabaseUrl, headers, usuario) {
  const { matchId, eleccion } = req.body;
  if (!matchId || (eleccion !== 'acepta' && eleccion !== 'rechaza')) {
    return res.status(400).json({ error: 'Faltan datos o elección inválida' });
  }
  const idEnc = encodeURIComponent(matchId);

  const filaRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=*&id=eq.${idEnc}`, { headers });
  const filas = filaRes.ok ? await filaRes.json() : [];
  const match = filas[0];
  if (!match) {
    return res.status(404).json({ error: 'Match no encontrado' });
  }

  const soyA = match.usuario_a === usuario.usuarioId;
  const soyB = match.usuario_b === usuario.usuarioId;
  if (!soyA && !soyB) {
    return res.status(403).json({ error: 'No autorizado para decidir sobre este match' });
  }
  if (match.estado !== 'activo') {
    return res.status(409).json({ error: 'match_no_activo', mensaje: 'Este match ya no está esperando tu decisión.' });
  }

  const campoPropio = soyA ? 'eleccion_usuario_a' : 'eleccion_usuario_b';
  const campoAjeno = soyA ? 'eleccion_usuario_b' : 'eleccion_usuario_a';
  const eleccionAjena = match[campoAjeno] || 'pendiente';

  const datosPatch = { [campoPropio]: eleccion };

  let estadoResultante = 'pendiente';
  if (eleccionAjena !== 'pendiente') {
    estadoResultante = (eleccion === 'acepta' && eleccionAjena === 'acepta') ? 'mutuamente_aceptado' : 'no_avanza';
    datosPatch.estado = estadoResultante;
  }

  const patchRes = await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${idEnc}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(datosPatch)
  });
  if (!patchRes.ok) {
    console.error('Error guardando elección de match:', patchRes.status, await patchRes.text());
    return res.status(500).json({ error: 'No se pudo guardar tu elección' });
  }

  // Se crea la cita y se marca la etapa de las dos personas server-side,
  // en el momento mismo del acuerdo mutuo -- mismo principio que ya
  // aplicamos para 'match': no depende de que ninguna de las dos vuelva a
  // loguearse para que el panel y el chequeo de login reflejen esto.
  if (estadoResultante === 'mutuamente_aceptado') {
    await fetch(`${supabaseUrl}/rest/v1/citas`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ match_id: matchId })
    }).catch(() => {});
    await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(match.usuario_a)}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ etapa_actual: 'cita' })
      }),
      fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(match.usuario_b)}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ etapa_actual: 'cita' })
      })
    ]).catch(() => {});
  }

  return res.status(200).json({ estado: estadoResultante });
}

async function cerrar(req, res, supabaseUrl, headers, usuario) {
  const { matchId } = req.body;
  if (!matchId) {
    return res.status(400).json({ error: 'Falta matchId' });
  }
  const idEnc = encodeURIComponent(matchId);

  const filaRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b,estado&id=eq.${idEnc}`, { headers });
  const filas = filaRes.ok ? await filaRes.json() : [];
  const match = filas[0];
  if (!match) {
    return res.status(404).json({ error: 'Match no encontrado' });
  }
  if (match.usuario_a !== usuario.usuarioId && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  if (match.estado === 'no_avanza') {
    await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${idEnc}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: 'cerrado' })
    });
  }

  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario || !usuario.usuarioId) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

    if (req.method === 'GET') {
      return await listarMisMatches(req, res, supabaseUrl, headers, usuario);
    }
    if (req.method === 'POST') {
      const { accion } = req.body;
      if (accion === 'elegir') return await elegir(req, res, supabaseUrl, headers, usuario);
      if (accion === 'cerrar') return await cerrar(req, res, supabaseUrl, headers, usuario);
      return res.status(400).json({ error: 'Acción no válida' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error en /api/matches:', error);
    return res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
}
