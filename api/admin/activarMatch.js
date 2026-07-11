import { verificarAdmin } from '../../lib/verificarAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verificarAdmin(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { matchId, accion } = req.body;
  if (!matchId || (accion !== 'activar' && accion !== 'pausar')) {
    return res.status(400).json({ error: 'Faltan datos o acción inválida' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  // Activar dispara la misma secuencia del lado de las dos personas que si
  // el sistema lo hubiera activado solo (chequeo al login en soul.html) --
  // por eso alcanza con cambiar el estado, sin lógica extra acá.
  const datos = accion === 'activar'
    ? { estado: 'activo', activado_por: 'admin' }
    : { estado: 'pausado' };

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(datos)
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    return res.status(200).json(data[0] || null);
  } catch (error) {
    console.error('Error en /api/admin/activarMatch:', error);
    return res.status(500).json({ error: 'Error al cambiar el estado del match' });
  }
}
