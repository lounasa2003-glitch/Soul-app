import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaude } from '../lib/anthropicClient.js';
import { chequearLimite } from '../lib/rateLimit.js';

const MODELO_FIJO = 'claude-sonnet-4-6';
const MAX_TOKENS_TOPE = 1500;
const LIMITE_CHAT = 30;
const VENTANA_CHAT_SEGUNDOS = 300;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key no configurada en el servidor' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const dentroDelLimite = await chequearLimite(usuario.email, 'chat', LIMITE_CHAT, VENTANA_CHAT_SEGUNDOS);
    if (!dentroDelLimite) {
      return res.status(429).json({
        error: 'limite_alcanzado',
        mensaje: 'Estás mandando mensajes muy rápido. Esperá un toque y volvé a intentar.'
      });
    }

    const { max_tokens, system, messages, contexto, moduloFase } = req.body;

    // Los mensajes de un modulo declaran en que fase creen estar -- se valida
    // contra lo que quedo guardado en la base antes de dejarlos pasar, para
    // que no se pueda seguir escribiendo en un modulo ya completado (o saltar
    // a uno que todavia no se desbloqueo) aunque el cliente este desactualizado.
    // No afecta al chat principal ni al espejo, que no mandan "contexto".
    if (contexto === 'modulo') {
      if (!usuario.usuarioId) {
        return res.status(403).json({ error: 'Todavía no existe tu perfil' });
      }
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_ANON_KEY;
      const perfilRes = await fetch(
        `${supabaseUrl}/rest/v1/perfiles?select=modulo_fase&usuario_id=eq.${encodeURIComponent(usuario.usuarioId)}`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      const perfilRows = perfilRes.ok ? await perfilRes.json() : [];
      const faseActual = perfilRows[0] ? perfilRows[0].modulo_fase : null;

      if (faseActual === 'completo' || (faseActual && faseActual !== moduloFase)) {
        return res.status(403).json({
          error: 'modulo_no_disponible',
          mensaje: 'Este momento del recorrido ya no está disponible.'
        });
      }
      if (!faseActual) {
        // Fila de antes de que esto se empezara a validar -- se repara en
        // vez de bloquear a alguien que ya estaba en medio de un modulo real.
        await fetch(`${supabaseUrl}/rest/v1/perfiles?usuario_id=eq.${encodeURIComponent(usuario.usuarioId)}`, {
          method: 'PATCH',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ modulo_fase: moduloFase })
        });
      }
    }

    const data = await llamarClaude({
      model: MODELO_FIJO,
      max_tokens: Math.min(max_tokens || 1024, MAX_TOKENS_TOPE),
      system,
      messages
    });
    return res.status(200).json(data);

  } catch (error) {
    if (error.status) {
      return res.status(error.status).json(error.data);
    }
    console.error('Error en /api/chat:', error);
    return res.status(500).json({ error: 'Error al conectar con Soul' });
  }
}
