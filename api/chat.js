import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaude, systemConCache } from '../lib/anthropicClient.js';
import { chequearLimite } from '../lib/rateLimit.js';
import { registrarUsoTokens } from '../lib/logUso.js';

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

    // El chat principal pide streaming (stream:true en el body) para que la
    // respuesta de Soul aparezca progresivamente en vez de esperar a que
    // termine de generarse entera -- eso era lo que se sentia "lento": los
    // puntitos de "escribiendo" se quedaban quietos varios segundos y despues
    // aparecia todo junto. El resto de los llamados (modulos, deteccion de
    // JSON) siguen sin mandar este flag y se comportan exactamente igual que
    // antes (necesitan la respuesta completa para poder parsearla).
    if (req.body.stream) {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: MODELO_FIJO,
          max_tokens: Math.min(max_tokens || 1024, MAX_TOKENS_TOPE),
          system: systemConCache(system),
          messages,
          stream: true
        })
      });

      if (!anthropicRes.ok) {
        const errData = await anthropicRes.json().catch(() => ({}));
        return res.status(anthropicRes.status).json(errData);
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });

      let inputTokens = 0, outputTokens = 0, buffer = '';
      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lineas = buffer.split('\n');
        buffer = lineas.pop(); // linea incompleta -- se retoma en la proxima vuelta
        for (const linea of lineas) {
          if (!linea.startsWith('data: ')) continue;
          const jsonStr = linea.slice(6).trim();
          if (!jsonStr) continue;
          let evt;
          try { evt = JSON.parse(jsonStr); } catch (e) { continue; }
          if (evt.type === 'message_start' && evt.message && evt.message.usage) {
            inputTokens = evt.message.usage.input_tokens || 0;
          } else if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
            res.write(evt.delta.text);
          } else if (evt.type === 'message_delta' && evt.usage) {
            outputTokens = evt.usage.output_tokens || 0;
          }
        }
      }
      res.end();

      registrarUsoTokens({
        usuarioId: usuario.usuarioId,
        endpoint: 'chat',
        moduloFase: contexto === 'modulo' ? moduloFase : null,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens }
      }).catch(() => {});
      return;
    }

    const data = await llamarClaude({
      model: MODELO_FIJO,
      max_tokens: Math.min(max_tokens || 1024, MAX_TOKENS_TOPE),
      system,
      messages
    });
    await registrarUsoTokens({
      usuarioId: usuario.usuarioId,
      endpoint: 'chat',
      moduloFase: contexto === 'modulo' ? moduloFase : null,
      usage: data.usage
    });
    return res.status(200).json(data);

  } catch (error) {
    if (res.headersSent) { res.end(); return; }
    if (error.status) {
      return res.status(error.status).json(error.data);
    }
    console.error('Error en /api/chat:', error);
    return res.status(500).json({ error: 'Error al conectar con Soul' });
  }
}
