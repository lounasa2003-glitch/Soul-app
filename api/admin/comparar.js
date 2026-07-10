import { verificarAdmin } from '../../lib/verificarAdmin.js';
import { llamarClaudeJSON } from '../../lib/anthropicClient.js';
import { registrarUsoTokens } from '../../lib/logUso.js';
import { COMPARE_PROMPT } from '../../lib/comparePrompt.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verificarAdmin(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { idA, idB } = req.body;
  if (!idA || !idB) {
    return res.status(400).json({ error: 'Faltan ids' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
    const [resA, resB] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${encodeURIComponent(idA)}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${encodeURIComponent(idB)}`, { headers })
    ]);
    const perfilesA = resA.ok ? await resA.json() : [];
    const perfilesB = resB.ok ? await resB.json() : [];

    if (!perfilesA[0] || !perfilesB[0]) {
      return res.status(400).json({ error: 'sin_perfil', mensaje: 'Una o ambas personas todavía no tienen perfil.' });
    }

    const { json: comp, usage } = await llamarClaudeJSON({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: COMPARE_PROMPT,
      messages: [{
        role: 'user',
        content: 'Perfil A:\n' + JSON.stringify(perfilesA[perfilesA.length - 1]) +
          '\n\nPerfil B:\n' + JSON.stringify(perfilesB[perfilesB.length - 1])
      }]
    });
    await registrarUsoTokens({ usuarioId: null, endpoint: 'adminComparar', usage });

    return res.status(200).json(comp);
  } catch (error) {
    console.error('Error en /api/admin/comparar:', error);
    return res.status(500).json({ error: 'Error al comparar' });
  }
}
