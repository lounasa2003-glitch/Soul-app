import { verificarUsuario } from '../lib/authUtil.js';

// Guarda la elección de UNA persona sobre un match ('acepta'/'rechaza') y,
// si con esta respuesta ya están las dos, resuelve el estado del match --
// server-side y no en el cliente, para que no dependa de que las dos
// personas estén conectadas al mismo tiempo ni de una carrera entre dos
// PATCH concurrentes.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    const { matchId, eleccion } = req.body;
    if (!matchId || (eleccion !== 'acepta' && eleccion !== 'rechaza')) {
      return res.status(400).json({ error: 'Faltan datos o elección inválida' });
    }

    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
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

    return res.status(200).json({ estado: estadoResultante });
  } catch (error) {
    console.error('Error en /api/elegirMatch:', error);
    return res.status(500).json({ error: 'Error al guardar tu elección' });
  }
}
