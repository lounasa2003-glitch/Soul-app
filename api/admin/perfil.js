import { verificarAdmin } from '../../lib/verificarAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verificarAdmin(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Falta id' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
    const idEnc = encodeURIComponent(id);
    const [usuarioRes, perfilRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre&id=eq.${idEnc}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${idEnc}`, { headers })
    ]);
    const usuarios = usuarioRes.ok ? await usuarioRes.json() : [];
    const perfiles = perfilRes.ok ? await perfilRes.json() : [];

    if (!usuarios[0]) {
      return res.status(404).json({ error: 'No encontrada' });
    }

    return res.status(200).json({
      nombre: usuarios[0].nombre,
      perfil: perfiles.length > 0 ? perfiles[perfiles.length - 1] : null
    });
  } catch (error) {
    console.error('Error en /api/admin/perfil:', error);
    return res.status(500).json({ error: 'Error al obtener perfil' });
  }
}
