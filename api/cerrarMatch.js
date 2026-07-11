import { verificarUsuario } from '../lib/authUtil.js';

// Marca como visto el cierre de un match que no avanzó, para que el mensaje
// de "esta vez no fue" no se repita en cada login. Endpoint dedicado por el
// mismo motivo que api/elegirMatch.js: quien confirma esto puede ser
// usuario_a o usuario_b, y el /api/guardar genérico solo autoriza escrituras
// por 'usuario_a'.
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

    const { matchId } = req.body;
    if (!matchId) {
      return res.status(400).json({ error: 'Falta matchId' });
    }

    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
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
  } catch (error) {
    console.error('Error en /api/cerrarMatch:', error);
    return res.status(500).json({ error: 'Error al cerrar el match' });
  }
}
