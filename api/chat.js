import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaude } from '../lib/anthropicClient.js';

const MODELO_FIJO = 'claude-sonnet-4-6';
const MAX_TOKENS_TOPE = 1500;

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

    const { max_tokens, system, messages } = req.body;
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
