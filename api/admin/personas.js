import { verificarAdmin } from '../../lib/verificarAdmin.js';

// Fusiona lo que antes eran admin/personas.js (listado), admin/persona.js
// (hoja de vida completa) y admin/perfil.js (par de perfiles para comparar)
// en un solo archivo -- el plan Hobby de Vercel permite como maximo 12
// funciones serverless por deploy, y el proyecto ya estaba por encima de
// eso. Se distingue por query params en vez de por ruta.
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

  const { id, modo } = req.query;

  try {
    if (!id) {
      // ── Listado de personas ──
      const usuariosRes = await fetch(
        `${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,ciudad,etapa_actual`,
        { headers }
      );
      const usuarios = usuariosRes.ok ? await usuariosRes.json() : [];
      return res.status(200).json({ personas: usuarios });
    }

    const idEnc = encodeURIComponent(id);

    if (modo === 'perfil') {
      // ── Par de perfiles para el comparador manual ──
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
    }

    // ── Hoja de vida completa ──
    const [usuarioRes, perfilRes, convRes, matchesRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/usuarios?select=*&id=eq.${idEnc}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${idEnc}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/conversaciones?select=*&usuario_id=eq.${idEnc}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/matches?select=*&or=(usuario_a.eq.${idEnc},usuario_b.eq.${idEnc})`, { headers })
    ]);

    const usuarios = usuarioRes.ok ? await usuarioRes.json() : [];
    const perfiles = perfilRes.ok ? await perfilRes.json() : [];
    const conversaciones = convRes.ok ? await convRes.json() : [];
    const matches = matchesRes.ok ? await matchesRes.json() : [];

    if (!usuarios[0]) {
      return res.status(404).json({ error: 'No encontrada' });
    }

    const otrosIds = [...new Set(
      matches.map(m => (m.usuario_a === id ? m.usuario_b : m.usuario_a))
    )].filter(Boolean);

    let nombrePorId = {};
    if (otrosIds.length > 0) {
      const listaIds = otrosIds.map(encodeURIComponent).join(',');
      const otrosRes = await fetch(
        `${supabaseUrl}/rest/v1/usuarios?select=id,nombre&id=in.(${listaIds})`,
        { headers }
      );
      const otros = otrosRes.ok ? await otrosRes.json() : [];
      otros.forEach(o => { nombrePorId[o.id] = o.nombre; });
    }

    const matchesConNombre = matches.map(m => {
      const otraId = m.usuario_a === id ? m.usuario_b : m.usuario_a;
      return { ...m, otra_persona_id: otraId, otra_persona_nombre: nombrePorId[otraId] || null };
    });

    return res.status(200).json({
      usuario: usuarios[0],
      perfil: perfiles.length > 0 ? perfiles[perfiles.length - 1] : null,
      conversacion: conversaciones.length > 0 ? conversaciones[conversaciones.length - 1] : null,
      matches: matchesConNombre
    });
  } catch (error) {
    console.error('Error en /api/admin/personas:', error);
    return res.status(500).json({ error: 'Error al obtener datos' });
  }
}
