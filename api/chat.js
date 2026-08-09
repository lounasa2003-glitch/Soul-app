import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaude, systemConCache, messagesConCache } from '../lib/anthropicClient.js';
import { chequearLimite } from '../lib/rateLimit.js';
import { registrarUsoTokens } from '../lib/logUso.js';
import { detectarIntentoDeFuga, RESPUESTA_INTENTO_FUGA, registrarIntentoFuga } from '../lib/seguridadPrompt.js';

const MODELO_FIJO = 'claude-sonnet-4-6';
// Probando este modelo mas chico/rapido solo para la charla informal
// ("Hablar con Soul", enviarAlChat en soul.html) -- modulos, espejo y la
// reflexion post-cita siguen con Sonnet, que es donde mas importa la
// sutileza. El cliente pide esto explicitamente con "rapido:true" en el
// body -- ningun otro llamado a /api/chat manda ese flag, asi que nada mas
// se ve afectado.
const MODELO_RAPIDO = 'claude-haiku-4-5-20251001';
const MAX_TOKENS_TOPE = 1500;
const LIMITE_CHAT = 30;
const VENTANA_CHAT_SEGUNDOS = 300;
// Tope diario del chat libre -- contador propio ('chat-diario'), separado
// del de modulos ('modulo'/'modulo-semanal' mas abajo). Hasta ahora los dos
// compartian este mismo contador (ver historial de este archivo); quedaban
// mezclados un chat casual con una charla de profundizacion, que tienen
// perfiles de costo muy distintos (Haiku vs Sonnet). 40/dia es el limite de
// producto para Soul Pro (ver propuesta de limites aprobada). Aplica a free
// y pro por igual -- sigue siendo ante todo un freno anti-abuso, no algo que
// dependa del plan.
const LIMITE_CHAT_DIARIO = 40;
const VENTANA_CHAT_DIARIO_SEGUNDOS = 86400;
// Reflexion post-cita (contexto:'reflexion', ver enviarReflexion en
// soul.html): contador diario propio, separado del de chat casual --
// comparte modelo (Sonnet) y volumen con el resto del bundle de debriefing,
// no con el chat libre de Haiku, asi que no debe competir por el mismo
// cupo de 40/dia. 80 es el valor que ya tenia el limite compartido antes de
// separar chat/modulos/reflexion en contadores propios -- no se reduce ni
// se ajusta la logica de la reflexion en si, solo se le da su propio cupo
// para que dejar de compartir con chat no le reste volumen.
const LIMITE_REFLEXION_DIARIO = 80;
// Modulos: contador de rafaga propio (mismos numeros que el chat libre, pero
// bucket separado -- 'modulo' en vez de 'chat', para no compartir cupo).
const LIMITE_MODULO_RAFAGA = 30;
const VENTANA_MODULO_RAFAGA_SEGUNDOS = 300;
// 3 sesiones de modulo por semana (limite de producto aprobado). Se
// consume UNA vez por sesion, no por mensaje -- se detecta "arranca una
// sesion nueva" cuando el array de mensajes que llega trae un solo turno
// 'user' (el primer mensaje de iniciarModuloReal/iniciarModuloObligatorio en
// soul.html), asi que no hace falta ninguna tabla nueva para contar
// sesiones: se reutiliza rate_limits con chequearLimite() igual que el
// resto de los limites de este archivo. "obligatorio" (Capacidad de volver
// a elegir) queda afuera: es requisito para todos antes de un encuentro,
// nunca compite por este cupo (mismo criterio que el gate de plan mas abajo).
const LIMITE_MODULO_SEMANAL = 3;
const VENTANA_MODULO_SEMANAL_SEGUNDOS = 604800;
// Tope de intercambios POR SESION de modulo (15, limite de producto
// aprobado). Server-side es un respaldo -- el cliente ya se autolimita en
// soul.html (TOPE_MENSAJES_POR_MODULO) y corta con un cierre pregrabado
// antes de llegar aca, pero un cliente desactualizado o modificado no debe
// poder superar esto. Se cuenta sobre el array "messages" que llega en el
// body (moduloHistory completo, se manda entero en cada turno) -- no hace
// falta persistir un contador aparte, el numero de turnos 'user' presentes
// ES el numero de intercambios de esta sesion.
const TOPE_INTERCAMBIOS_MODULO = 15;

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
    // Nadie puede conversar con Soul (ni chat principal ni modulos) antes de
    // terminar la Etapa 1 (datos basicos) -- el cliente ya evita mandar a
    // alguien ahi (ver cargarProgreso en soul.html), pero esto lo cierra del
    // lado del servidor sin importar que mande el cliente, mismo criterio
    // que basicosCompletos en api/guardar.js.
    if (usuario.etapaActual === 'nuevo') {
      return res.status(403).json({ error: 'intake_incompleto', mensaje: 'Todavía no completaste tus datos básicos para poder hablar con Soul.' });
    }

    const { max_tokens, system, messages, contexto, moduloFase } = req.body;
    // Unico indicador de origen que ya viaja en el body -- modulos siempre
    // manda contexto:'modulo' (ver enviarAlModulo/iniciarModuloReal/
    // iniciarModuloObligatorio en soul.html). Se usa para separar los
    // contadores de rate-limit de chat libre y modulos, que hasta ahora
    // compartian el mismo cupo diario.
    const esModulo = contexto === 'modulo';
    const esReflexion = contexto === 'reflexion';

    const limiteInfo = await chequearLimite(
      usuario.email,
      esModulo ? 'modulo' : 'chat',
      esModulo ? LIMITE_MODULO_RAFAGA : LIMITE_CHAT,
      esModulo ? VENTANA_MODULO_RAFAGA_SEGUNDOS : VENTANA_CHAT_SEGUNDOS
    );
    if (!limiteInfo.permitido) {
      return res.status(429).json({
        error: 'limite_alcanzado',
        mensaje: 'Estás mandando mensajes muy rápido. Esperá un toque y volvé a intentar.',
        segundosParaReset: limiteInfo.segundosParaReset
      });
    }

    if (esModulo) {
      // Tope de intercambios por sesion -- respaldo server-side (el cliente
      // ya se autolimita antes de llegar aca, ver TOPE_MENSAJES_POR_MODULO
      // en soul.html). Se cuenta sobre los turnos 'user' del historial que
      // llega en el body: es exactamente el numero de intercambios de esta
      // sesion, sin necesidad de persistir un contador aparte.
      const intercambiosEnSesion = Array.isArray(messages) ? messages.filter((m) => m.role === 'user').length : 0;
      if (intercambiosEnSesion > TOPE_INTERCAMBIOS_MODULO) {
        return res.status(429).json({
          error: 'tope_intercambios_modulo',
          mensaje: 'Esta sesión ya llegó a su límite de intercambios.'
        });
      }
      // El cupo semanal se consume UNA sola vez, al arrancar la sesion (un
      // unico turno 'user' en el historial que llega). "obligatorio"
      // (Capacidad de volver a elegir) nunca lo consume -- es requisito para
      // todos antes de un encuentro, sin importar el plan, mismo criterio
      // que el gate de Pro un poco mas abajo.
      if (moduloFase !== 'obligatorio' && intercambiosEnSesion === 1) {
        const limiteSemanalInfo = await chequearLimite(usuario.email, 'modulo-semanal', LIMITE_MODULO_SEMANAL, VENTANA_MODULO_SEMANAL_SEGUNDOS);
        if (!limiteSemanalInfo.permitido) {
          return res.status(429).json({
            error: 'tope_modulo_semanal',
            mensaje: 'Ya usaste tus sesiones de profundización de esta semana. Volvé la semana que viene.',
            segundosParaReset: limiteSemanalInfo.segundosParaReset
          });
        }
      }
    } else if (esReflexion) {
      // Cupo propio ('reflexion-diario') -- no debe consumir el cupo de
      // chat casual (ver LIMITE_REFLEXION_DIARIO). El resto de la logica de
      // la reflexion (TOPE_MENSAJES_REFLEXION, extensiones, cierre, etc. en
      // soul.html/api/citas.js) no se toca.
      const limiteReflexionDiarioInfo = await chequearLimite(usuario.email, 'reflexion-diario', LIMITE_REFLEXION_DIARIO, VENTANA_CHAT_DIARIO_SEGUNDOS);
      if (!limiteReflexionDiarioInfo.permitido) {
        return res.status(429).json({
          error: 'limite_diario_alcanzado',
          mensaje: 'Llegaste al límite de mensajes por hoy. Volvé mañana.',
          segundosParaReset: limiteReflexionDiarioInfo.segundosParaReset
        });
      }
    } else {
      const limiteDiarioInfo = await chequearLimite(usuario.email, 'chat-diario', LIMITE_CHAT_DIARIO, VENTANA_CHAT_DIARIO_SEGUNDOS);
      if (!limiteDiarioInfo.permitido) {
        return res.status(429).json({
          error: 'limite_diario_alcanzado',
          mensaje: 'Llegaste al límite de mensajes por hoy. Volvé mañana.',
          segundosParaReset: limiteDiarioInfo.segundosParaReset
        });
      }
    }

    // Se manda como header (no como parte del body) porque el chat principal
    // usa streaming -- el body en ese caso es texto plano progresivo, no JSON,
    // asi que no hay forma de sumarle un campo ahi. El header lo pueden leer
    // los dos caminos (streaming y no-streaming) de la misma forma.
    res.setHeader('X-Limite-Restante', String(limiteInfo.restantes));

    // Los mensajes de un modulo declaran en que fase creen estar -- se valida
    // contra lo que quedo guardado en la base antes de dejarlos pasar, para
    // que no se pueda seguir escribiendo en un modulo ya completado (o saltar
    // a uno que todavia no se desbloqueo) aunque el cliente este desactualizado.
    // No afecta al chat principal ni al espejo, que no mandan "contexto".
    if (contexto === 'modulo') {
      if (!usuario.usuarioId) {
        return res.status(403).json({ error: 'Todavía no existe tu perfil' });
      }
      // Los modulos de profundizacion son la extension paga -- el chat
      // principal (onboarding + charla libre) sigue completo y sin tope de
      // plan arriba, que es lo que no se puede tocar sin traicionar la
      // mision de Soul. Esto es lo unico que hoy queda atras de Pro.
      // "obligatorio" (Capacidad de volver a elegir) es la excepcion: es
      // requisito para TODOS antes de un encuentro, sin importar el plan
      // (ver iniciarModuloObligatorio en soul.html) -- bloquearlo dejaba a
      // alguien en Free sin poder avanzar nunca a la Sala de Encuentros.
      if (moduloFase !== 'obligatorio' && usuario.plan !== 'pro') {
        return res.status(403).json({
          error: 'requiere_pro',
          mensaje: 'Este momento de profundización es parte de Soul Pro.'
        });
      }
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_ANON_KEY;
      // 'perfiles' ya tiene politica RLS de "solo el dueño" -- esta es la
      // propia fila de quien esta pidiendo el modulo, token propio.
      const headersPerfilPropio = { apikey: supabaseKey, Authorization: `Bearer ${usuario.token}` };
      const perfilRes = await fetch(
        `${supabaseUrl}/rest/v1/perfiles?select=modulo_fase&usuario_id=eq.${encodeURIComponent(usuario.usuarioId)}`,
        { headers: headersPerfilPropio }
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
          headers: { ...headersPerfilPropio, 'Content-Type': 'application/json' },
          body: JSON.stringify({ modulo_fase: moduloFase })
        });
      }
    }

    // Filtro server-side de intentos de fuga/inyeccion -- corta ANTES de
    // gastar un llamado al modelo si el ultimo mensaje de la persona matchea
    // un patron comun (ver lib/seguridadPrompt.js). Complementa el bloque de
    // blindaje que ya esta al final de todos los prompts conversacionales,
    // no lo reemplaza -- esto es lo que evita ademas gastar tokens en cada
    // intento evidente. Se revisa solo el ultimo mensaje de la persona.
    const ultimoMensaje = Array.isArray(messages) ? [...messages].reverse().find((m) => m.role === 'user') : null;
    const textoUltimoMensaje = ultimoMensaje && typeof ultimoMensaje.content === 'string'
      ? ultimoMensaje.content
      : (ultimoMensaje && Array.isArray(ultimoMensaje.content) ? ultimoMensaje.content.map((b) => b.text || '').join(' ') : '');

    if (detectarIntentoDeFuga(textoUltimoMensaje)) {
      await registrarIntentoFuga(usuario, textoUltimoMensaje, contexto || 'chat');
      if (req.body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.write(RESPUESTA_INTENTO_FUGA);
        res.end();
        return;
      }
      return res.status(200).json({ content: [{ type: 'text', text: RESPUESTA_INTENTO_FUGA }], usage: { input_tokens: 0, output_tokens: 0 } });
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
          model: req.body.rapido ? MODELO_RAPIDO : MODELO_FIJO,
          max_tokens: Math.min(max_tokens || 1024, MAX_TOKENS_TOPE),
          system: systemConCache(system),
          // El chat principal, los modulos y la reflexion post-cita son las
          // unicas charlas de ida y vuelta que pasan por este endpoint
          // (ver messagesConCache en anthropicClient.js) -- el camino sin
          // stream de mas abajo es de un solo mensaje (extraccion/resumen)
          // y no debe cachearse.
          messages: messagesConCache(messages),
          stream: true
        })
      });

      if (!anthropicRes.ok) {
        const errData = await anthropicRes.json().catch(() => ({}));
        return res.status(anthropicRes.status).json(errData);
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });

      // message_start ya trae el usage completo (incluidos los campos de
      // cache -- confirmado contra la API real) desde el arranque del
      // stream, antes de que exista ningun texto generado todavia. Antes
      // solo se leia input_tokens de ahi: el caching de prompts esta
      // activo de verdad (systemConCache), pero cache_creation_input_tokens
      // y cache_read_input_tokens nunca se guardaban, asi que el costo que
      // mostraba el panel quedaba mas bajo que el que Anthropic cobra de
      // verdad.
      let inputTokens = 0, outputTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0, buffer = '', stopReason = null;
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
            cacheCreationTokens = evt.message.usage.cache_creation_input_tokens || 0;
            cacheReadTokens = evt.message.usage.cache_read_input_tokens || 0;
          } else if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
            res.write(evt.delta.text);
          } else if (evt.type === 'message_delta' && evt.usage) {
            outputTokens = evt.usage.output_tokens || 0;
            if (evt.delta && evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
          }
        }
      }
      // Marca invisible al final del cuerpo (nunca aparece caracter por
      // caracter durante el streaming -- se escribe recien aca, ya
      // terminado el texto real) para que el cliente sepa si la respuesta
      // se cortó por max_tokens sin tener que abrir un canal aparte
      // (headers ya se mandaron al arrancar el stream, y este endpoint no
      // usa HTTP trailers). El cliente la separa del texto visible antes de
      // mostrar nada -- ver llamarChatStreaming en soul.html.
      res.write('\u0000SOULSTOP:' + (stopReason || 'end_turn'));
      res.end();

      registrarUsoTokens({
        usuarioId: usuario.usuarioId,
        endpoint: 'chat',
        moduloFase: contexto === 'modulo' ? moduloFase : null,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_creation_input_tokens: cacheCreationTokens, cache_read_input_tokens: cacheReadTokens }
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
