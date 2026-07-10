import { verificarAdmin } from '../../lib/verificarAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verificarAdmin(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
    const usuariosRes = await fetch(
      `${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,ciudad,etapa_actual`,
      { headers }
    );
    const usuarios = usuariosRes.ok ? await usuariosRes.json() : [];

    return res.status(200).json({ personas: usuarios });
  } catch (error) {
    console.error('Error en /api/admin/personas:', error);
    return res.status(500).json({ error: 'Error al listar personas' });
  }
}
