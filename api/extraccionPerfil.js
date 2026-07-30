import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaude } from '../lib/anthropicClient.js';
import { registrarUsoTokens } from '../lib/logUso.js';
import { chequearLimite } from '../lib/rateLimit.js';

const MODELO_FIJO = 'claude-sonnet-4-6';
const MODELO_RAPIDO = 'claude-haiku-4-5-20251001';
// Tope por subpaso, no uno solo global -- un tope unico mas bajo que lo que
// alguno de estos necesita hoy cortaria el JSON a mitad y generaria
// perfiles incompletos. Estos numeros son los max_tokens reales que ya usa
// cada llamada en soul.html (EXTRACT_PROMPT:1200, MODULO_DETECCION_PROMPT
// :1024) -- si esos cambian ahi, cambian aca tambien.
const MAX_TOKENS_POR_SUBPASO = {
  compresion: 800,
  extraccion: 1200,
  deteccion_modulo: 1024
};
const SUBPASOS_VALIDOS = Object.keys(MAX_TOKENS_POR_SUBPASO);

// Mismo mecanismo que api/chat.js (chequearLimite, ventana fija guardada en
// 'rate_limits'), pero con clave propia -- 'extraccionPerfil'/
// 'extraccionPerfil-diario' nunca coinciden con 'chat'/'chat-diario', asi
// que esto no toca ni comparte contador con los limites del chat en vivo.
// Clave por usuario.usuarioId (no por email como el resto del codebase):
// el limite tiene que ser por cuenta autenticada, nunca por IP, y asi lo
// pidio explicitamente Lu. Una sola clave para los 3 subpasos juntos
// (compresion+extraccion+deteccion_modulo cuentan contra el mismo cupo) --
// alternar entre subpasos no lo esquiva. Un onboarding normal gasta ~3
// llamadas (una de cada subpaso) mas alguna de mas por pausas/recuperacion
// -- 12 cada 15 min y 40 por dia dejan margen de sobra sin abrir la puerta
// a abuso sostenido.
// TEMPORAL PARA TEST DE PREVIEW -- LIMITE_EXTRACCION baja a 2 (en vez de 12)
// para poder probar el 429 con 3 llamadas reales en vez de 13. Restaurar a
// 12 antes de mergear a produccion (ver segundo commit de esta rama).
const LIMITE_EXTRACCION = 2;
const VENTANA_EXTRACCION_SEGUNDOS = 900;
const LIMITE_EXTRACCION_DIARIO = 40;
const VENTANA_EXTRACCION_DIARIO_SEGUNDOS = 86400;

// Endpoint dedicado, un solo proposito: comprimir/extraer/detectar modulo a
// partir de la charla de onboarding. Existe por separado de api/chat.js
// (que es generico -- chat en vivo, espejo, resumenes, modulos en vivo)
// justamente para que el modelo NUNCA dependa de un campo que el cliente
// pueda mandar u omitir. Ver plan de la sesion (harmonic-launching-finch)
// para el porque: un primer diseno con un flag "contexto" en api/chat.js
// dejaba que un cliente Free simplemente no mandara ese campo y cayera en
// Sonnet, el comportamiento por default de ese endpoint generico. Aca no
// hay default: la unica variable que decide el modelo es usuario.plan,
// resuelto siempre en el servidor.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario || !usuario.usuarioId) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const { system, messages, max_tokens, subpaso } = req.body;

    // Este endpoint sirve solo estas 3 llamadas, nunca un chat generico.
    // Sin esta validacion, un subpaso vacio o inventado se colaria por el
    // tope de tokens y ensuciaria las etiquetas de costo del panel admin --
    // se rechaza ANTES de llamar a Claude, no despues.
    if (!SUBPASOS_VALIDOS.includes(subpaso)) {
      return res.status(400).json({ error: 'subpaso inválido' });
    }

    const limiteInfo = await chequearLimite(usuario.usuarioId, 'extraccionPerfil', LIMITE_EXTRACCION, VENTANA_EXTRACCION_SEGUNDOS);
    if (!limiteInfo.permitido) {
      return res.status(429).json({
        error: 'limite_alcanzado',
        mensaje: 'Estás mandando demasiadas solicitudes seguidas. Esperá un toque y volvé a intentar.',
        segundosParaReset: limiteInfo.segundosParaReset
      });
    }
    const limiteDiarioInfo = await chequearLimite(usuario.usuarioId, 'extraccionPerfil-diario', LIMITE_EXTRACCION_DIARIO, VENTANA_EXTRACCION_DIARIO_SEGUNDOS);
    if (!limiteDiarioInfo.permitido) {
      return res.status(429).json({
        error: 'limite_diario_alcanzado',
        mensaje: 'Llegaste al límite de hoy para esta acción. Volvé mañana.',
        segundosParaReset: limiteDiarioInfo.segundosParaReset
      });
    }

    // Unico lugar que decide el modelo -- usuario.plan viene resuelto en el
    // servidor (verificarUsuario, que ya aplica TODOS_PRO_TEMPORAL). Nada
    // de lo que manda el cliente puede cambiar esto.
    const modelo = usuario.plan === 'pro' ? MODELO_FIJO : MODELO_RAPIDO;
    const topeTokens = MAX_TOKENS_POR_SUBPASO[subpaso];

    const data = await llamarClaude({
      model: modelo,
      max_tokens: Math.min(max_tokens || topeTokens, topeTokens),
      system,
      messages
    });

    // Las llamadas Pro se loguean exactamente como las de api/chat.js
    // ('chat', sin cambios) -- solo las de Free (que ahora corren mas
    // barato) se distinguen por subpaso, para verlas separadas en el panel.
    const endpointLog = usuario.plan === 'pro' ? 'chat' :
      (subpaso === 'compresion' ? 'compresion_extraccion_free'
        : subpaso === 'deteccion_modulo' ? 'deteccion_modulo_free'
          : 'extraccion_perfil_free');
    await registrarUsoTokens({ usuarioId: usuario.usuarioId, endpoint: endpointLog, usage: data.usage });

    return res.status(200).json(data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json(error.data);
    }
    console.error('Error en /api/extraccionPerfil:', error);
    return res.status(500).json({ error: 'Error al conectar con Soul' });
  }
}
