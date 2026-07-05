import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaude } from '../lib/anthropicClient.js';

const LIMITE_ANALISIS = 2;

const EXTRACT_PROMPT = `Sos un sistema de análisis de compatibilidad vincular basado en coaching ontológico. Leé la conversación y extraé un perfil estructurado. Respondé ÚNICAMENTE con JSON válido sin backticks: {"grupo1":{"valores":["v1","v2","v3"],"estilo_comunicacion":"","ritmo_emocional":"","mascara_vs_autentico":"","momento_evolutivo":""},"grupo2":{"tipo_vinculo":"","proyecto_vida":"","necesidades_intimidad":"","no_puede_faltar":"","no_puede_estar":""},"grupo3":{"modo_conflictos":"","capacidad_reparacion":"","reciprocidad":"","flexibilidad":"","patrones_vinculares":""},"grupo4":{"apertura":"","consistencia":"","estabilidad_emocional":"","revision_creencias":"","metalenguaje":"","indice_disponibilidad":5}}`;

const COMPARE_EXTERNO_PROMPT = `Sos el motor de compatibilidad de Soul. Vas a comparar el perfil real de una persona (construido a través de una conversación profunda con Soul) contra una conversación externa con alguien que conoció fuera de la plataforma. Esta segunda fuente es información parcial — sé honesto sobre esa limitación en el veredicto. Respondé ÚNICAMENTE con JSON válido sin backticks: {"compatibilidad_hoy":60,"potencial_construccion":75,"veredicto":"frase honesta que mencione que es un análisis probabilístico basado en información parcial"}`;

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

    if ((usuario.analisisUsados || 0) >= LIMITE_ANALISIS) {
      return res.status(403).json({
        error: 'limite_alcanzado',
        mensaje: 'Ya usaste los 2 análisis disponibles por ahora.'
      });
    }

    const { conversacion, nombre } = req.body;
    if (!conversacion || !conversacion.trim()) {
      return res.status(400).json({ error: 'sin_conversacion', mensaje: 'Pegá la conversación primero.' });
    }

    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

    const misPerRes = await fetch(
      `${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${encodeURIComponent(usuario.usuarioId)}`,
      { headers }
    );
    const misPer = misPerRes.ok ? await misPerRes.json() : [];
    if (!misPer || misPer.length === 0) {
      return res.status(400).json({ error: 'sin_perfil', mensaje: 'Todavía no completaste tu perfil con Soul.' });
    }
    const miPerfil = misPer[misPer.length - 1];

    const dataE = await llamarClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: EXTRACT_PROMPT,
      messages: [{ role: 'user', content: 'Analizá esta conversación:\n\n' + conversacion }]
    });
    const txtE = dataE.content.map(b => b.text || '').join('');
    const perfilExterno = JSON.parse(txtE.replace(/```json|```/g, '').trim());

    const dataC = await llamarClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: COMPARE_EXTERNO_PROMPT,
      messages: [{
        role: 'user',
        content: 'Mi perfil:\n' + JSON.stringify(miPerfil) +
          '\n\nPerfil de ' + (nombre || 'esta persona') + ' (basado en conversación externa):\n' + JSON.stringify(perfilExterno)
      }]
    });
    const txtC = dataC.content.map(b => b.text || '').join('');
    const resultado = JSON.parse(txtC.replace(/```json|```/g, '').trim());

    await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(usuario.usuarioId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ analisis_usados: (usuario.analisisUsados || 0) + 1 })
    });

    return res.status(200).json({
      compatibilidad_hoy: resultado.compatibilidad_hoy,
      potencial_construccion: resultado.potencial_construccion,
      veredicto: resultado.veredicto
    });

  } catch (error) {
    return res.status(500).json({ error: 'Error al analizar', details: error.message });
  }
}
