import { llamarClaude } from '../lib/anthropicClient.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key no configurada en el servidor' });
  }

  try {
    const { model, max_tokens, system, messages } = req.body;
    const data = await llamarClaude({ model, max_tokens, system, messages });
    return res.status(200).json(data);

  } catch (error) {
    if (error.status) {
      return res.status(error.status).json(error.data);
    }
    return res.status(500).json({ error: 'Error al conectar con Soul', details: error.message });
  }
}
