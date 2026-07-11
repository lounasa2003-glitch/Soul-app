import { verificarUsuario } from '../lib/authUtil.js';

// Endpoint dedicado para leer los matches propios de AMBOS lados (usuario_a
// y usuario_b) -- el /api/leer genérico solo valida lecturas por
// 'usuario_a' (ver TABLAS_PERMITIDAS en lib/authUtil.js), así que no le
// sirve a quien es usuario_b de un match. Mismo patrón que api/chat.js usa
// para su validación extra: consulta propia en vez de forzar el caso en el
// validador compartido.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
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

    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
    const idEnc = encodeURIComponent(usuario.usuarioId);
    const response = await fetch(
      `${supabaseUrl}/rest/v1/matches?select=*&or=(usuario_a.eq.${idEnc},usuario_b.eq.${idEnc})`,
      { headers }
    );
    const matches = response.ok ? await response.json() : [];

    return res.status(200).json({ matches });
  } catch (error) {
    console.error('Error en /api/misMatches:', error);
    return res.status(500).json({ error: 'Error al leer tus matches' });
  }
}
