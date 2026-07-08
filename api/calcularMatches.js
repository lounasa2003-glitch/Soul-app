import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaudeJSON } from '../lib/anthropicClient.js';
import { chequearLimite } from '../lib/rateLimit.js';
import { registrarUsoTokens } from '../lib/logUso.js';

const COMPARE_PROMPT = `Sos el motor de compatibilidad de Soul. Comparás dos perfiles y calculás compatibilidad con la lógica de cuatro tipos de variables. Respondé ÚNICAMENTE con JSON válido sin backticks: {"compatibilidad_hoy":68,"potencial_construccion":91,"veredicto":"frase honesta","fortalezas":["fortaleza1","fortaleza2"],"desafio":"un desafio posible","mensaje_dupla":"mensaje específico para esta dupla"}`;

const LIMITE_MATCHES = 5;
const VENTANA_MATCHES_SEGUNDOS = 3600;

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
    const usuarioId = usuario.usuarioId;

    const dentroDelLimite = await chequearLimite(usuario.email, 'calcularMatches', LIMITE_MATCHES, VENTANA_MATCHES_SEGUNDOS);
    if (!dentroDelLimite) {
      return res.status(429).json({
        error: 'limite_alcanzado',
        mensaje: 'Ya calculaste tus matches varias veces en poco tiempo. Probá de nuevo más tarde.'
      });
    }

    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

    const misPerRes = await fetch(
      `${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${encodeURIComponent(usuarioId)}`,
      { headers }
    );
    const misPer = misPerRes.ok ? await misPerRes.json() : [];
    if (!misPer || misPer.length === 0) {
      return res.status(200).json({ matchEncontrado: false, matchData: null });
    }
    const miPerfil = misPer[0];

    const otrosRes = await fetch(
      `${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=neq.${encodeURIComponent(usuarioId)}`,
      { headers }
    );
    const otrosPerfiles = otrosRes.ok ? await otrosRes.json() : [];

    let matchEncontrado = false;
    let matchData = null;
    // Este endpoint puede hacer varias llamadas a Claude (una por cada otro
    // perfil) -- se acumula el uso total y se loguea una sola vez al final,
    // en vez de sumar una escritura a Supabase por cada comparacion.
    let totalInputTokens = 0, totalOutputTokens = 0;

    for (const otro of otrosPerfiles) {
      const { json: comp, usage } = await llamarClaudeJSON({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: COMPARE_PROMPT,
        messages: [{
          role: 'user',
          content: 'Perfil A:\n' + JSON.stringify(miPerfil) + '\n\nPerfil B:\n' + JSON.stringify(otro)
        }]
      });
      if (usage) {
        totalInputTokens += usage.input_tokens || 0;
        totalOutputTokens += usage.output_tokens || 0;
      }

      if (comp.compatibilidad_hoy >= 50 || comp.potencial_construccion >= 65) {
        const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({
            usuario_a: usuarioId,
            usuario_b: otro.usuario_id,
            compatibilidad_hoy: comp.compatibilidad_hoy,
            potencial_construccion: comp.potencial_construccion,
            fortalezas: comp.fortalezas,
            desafio: comp.desafio,
            mensaje_dupla: comp.mensaje_dupla,
            estado: 'pendiente',
            activado_por: 'sistema'
          })
        });
        const matchRows = matchRes.ok ? await matchRes.json() : [];
        matchEncontrado = true;
        matchData = {
          id: matchRows[0] ? matchRows[0].id : null,
          compatibilidad_hoy: comp.compatibilidad_hoy,
          potencial_construccion: comp.potencial_construccion,
          mensaje_dupla: comp.mensaje_dupla
        };
      }
    }

    await registrarUsoTokens({
      usuarioId,
      endpoint: 'calcularMatches',
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens }
    });

    return res.status(200).json({ matchEncontrado, matchData });

  } catch (error) {
    console.error('Error en /api/calcularMatches:', error);
    return res.status(500).json({ error: 'Error calculando matches' });
  }
}
