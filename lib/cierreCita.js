import { llamarClaudeJSON } from './anthropicClient.js';
import { registrarUsoTokens } from './logUso.js';
import { registrarEvento } from './logEvento.js';
import { registrarErrorSilencioso } from './logErrorSilencioso.js';
import { enviarPushAUsuario } from './push.js';

// Compartido entre api/citas.js (donde corren las dos personas del
// encuentro) y api/admin/personas.js (donde la administradora mira la Hoja
// de Vida o el transcripto de una cita) -- el cierre de una cita puede
// dispararse desde cualquiera de los dos lados, y tiene que ser exactamente
// la misma logica en los dos.

// Resumen objetivo de la cita en si (distinto del refinamiento del
// debriefing, que es autopercepcion de cada persona) -- pensado para que la
// administradora entienda rapido que paso en una cita puntual sin tener que
// leer todo el chat. Se genera una sola vez, al cerrarse la cita.
const RESUMEN_CITA_PROMPT = `Sos un sistema de análisis para el equipo de Soul (una plataforma de vínculos basada en coaching ontológico). Vas a leer la transcripción real de una cita virtual entre dos personas que hicieron match (marcadas como "A" y "B"; los mensajes de "Soul" son intervenciones de una IA anfitriona que a veces interviene). Esto lo va a leer la administradora de la plataforma, no ninguna de las dos personas -- podés ser directo y objetivo, no hace falta el tono cálido/interpretativo que usa Soul con las personas.

Armá un resumen objetivo y neutro de la cita. Nunca uses lenguaje que suene a juicio o descarte (nunca "rechazo", "fracasó", etc. -- si la cita fue incómoda o corta, describilo neutral, ej. "la conversación no profundizó" en vez de "no hubo química").

Respondé ÚNICAMENTE con JSON válido sin backticks:
{"resumen":"2-4 frases narrativas y objetivas de qué pasó en la cita","temas_principales":["tema1","tema2"],"tono_general":"frase breve, ej. cálido y fluido desde el inicio","nivel_reciprocidad":"frase breve sobre el balance de participación entre las dos personas, ej. equilibrado, o A llevó la mayor parte de la conversación","senales_de_tension":null}

Si la charla fue muy corta y no da para una lectura real, decilo así en "resumen" (ej. "La charla fue muy breve, no da para más lectura que eso") y dejá "temas_principales" como array vacío y "senales_de_tension" en null -- nunca inventes contenido para llenar el JSON.`;

// Se llama con await, aunque agregue unos segundos a la respuesta de quien
// cierra -- un "fire and forget" real no es confiable en un entorno
// serverless, el contexto de ejecucion no sigue vivo garantizado despues de
// responder. Cualquier fallo queda solo logueado, nunca tira error hacia
// quien esta cerrando la cita.
//
// Mismo gate de consentimiento que ya usan extraerDinamicaRelacionalEnSegundoPlano
// y extraerPerfilYCompatibilidadEnSegundoPlano (api/citas.js) sobre esta misma
// transcripcion -- antes este resumen (uso exclusivo admin) se generaba
// siempre, sin chequear consiente_analisis_a/b, a diferencia de esos otros
// dos analisis. 'cita' tiene que venir con esas dos columnas ya seleccionadas
// (ver obtenerCitaAutorizada en api/citas.js y el modo 'citaMensajes' en
// api/admin/personas.js) -- si no vinieran, el chequeo de abajo las trata
// como no-true y no genera nada, nunca al reves.
async function generarResumenCitaEnSegundoPlano(supabaseUrl, headers, citaId, match, cita) {
  try {
    if (cita.consiente_analisis_a !== true || cita.consiente_analisis_b !== true) {
      await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ resumen_ia: { estado: 'no_generado', motivo: 'Sin consentimiento de análisis de ambas personas' } })
      });
      return;
    }

    const msgsRes = await fetch(
      `${supabaseUrl}/rest/v1/cita_mensajes?select=usuario_id,contenido&cita_id=eq.${encodeURIComponent(citaId)}&tipo=eq.texto&order=created_at.asc`,
      { headers }
    );
    const msgs = msgsRes.ok ? await msgsRes.json() : [];
    const transcripto = msgs.map(m => {
      const quien = m.usuario_id === null ? 'Soul' : (m.usuario_id === match.usuario_a ? 'A' : 'B');
      return quien + ': ' + m.contenido;
    }).join('\n');
    if (!transcripto) return;

    const { json, usage } = await llamarClaudeJSON({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: RESUMEN_CITA_PROMPT,
      messages: [{ role: 'user', content: transcripto }]
    });
    await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ resumen_ia: json })
    });
    // No es una llamada de una persona puntual (el resumen es compartido
    // entre las dos) -- se loguea con usuarioId null, mismo criterio que
    // adminComparar en api/admin/comparar.js.
    await registrarUsoTokens({ usuarioId: null, endpoint: 'resumenCita', usage });
  } catch (e) {
    console.error('Error generando resumen de cita:', e);
    await registrarErrorSilencioso({ contexto: 'api/citas: resumen de cita', error: e, meta: { citaId } });
  }
}

// Compartida entre el cierre manual (boton "salir" -> responderCierre) y el
// cierre automatico por inactividad -- mismos efectos en los dos casos,
// solo cambia el mensaje que ven las dos personas en la sala.
export async function finalizarCita(supabaseUrl, headers, citaId, cita, match, mensajeCierre) {
  await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'cerrada' })
  });
  // cerrada_en marca el momento en que arranca a correr la retencion de 12
  // meses de cita_mensajes (ver purgarCitaMensajesVencidos en
  // api/cron/diagnostico-diario.js). El filtro cerrada_en=is.null en la URL
  // (no un simple PATCH por id) hace que esta escritura sea atomica y
  // condicional al mismo tiempo -- si finalizarCita se llama mas de una vez
  // sobre la misma cita (ej. alguien responde 'para' justo cuando el cierre
  // automatico por inactividad ya corrio), la fila ya no matchea el filtro y
  // Postgres no toca cerrada_en, sin necesidad de leer el valor actual antes.
  await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}&cerrada_en=is.null`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ cerrada_en: new Date().toISOString() })
  });
  await fetch(`${supabaseUrl}/rest/v1/cita_mensajes`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ cita_id: citaId, usuario_id: null, tipo: 'texto', contenido: mensajeCierre })
  }).catch(() => {});
  await generarResumenCitaEnSegundoPlano(supabaseUrl, headers, citaId, match, cita);
  // Escritura cruzada -- se marca la etapa de LAS DOS personas del match,
  // sin importar quien llamo a finalizarCita (una de las dos partes desde
  // api/citas.js, o la administradora desde api/admin/personas.js). Service
  // role key propia, independiente del 'headers' que llego por parametro --
  // ningun token de una sola persona alcanza para la fila de la otra.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headersService = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(match.usuario_a)}`, {
      method: 'PATCH', headers: { ...headersService, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ etapa_actual: 'debriefing' })
    }),
    fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(match.usuario_b)}`, {
      method: 'PATCH', headers: { ...headersService, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ etapa_actual: 'debriefing' })
    }),
    registrarEvento({ usuarioId: match.usuario_a, tipo: 'encuentro_cerrado', metadata: { citaId } }),
    registrarEvento({ usuarioId: match.usuario_b, tipo: 'encuentro_cerrado', metadata: { citaId } }),
    // A las dos personas -- ninguna de las dos sabe necesariamente que la
    // otra (o el sistema, por inactividad) fue quien cerro el encuentro.
    // DE PRODUCTO -- gateado por comunicaciones_producto_aceptadas dentro de
    // enviarPushAUsuario (ver lib/push.js).
    enviarPushAUsuario(match.usuario_a, { titulo: 'Tu encuentro cerró', cuerpo: 'Soul preparó una reflexión para vos.', data: { tipo: 'debriefing_listo', citaId }, esencial: false }),
    enviarPushAUsuario(match.usuario_b, { titulo: 'Tu encuentro cerró', cuerpo: 'Soul preparó una reflexión para vos.', data: { tipo: 'debriefing_listo', citaId }, esencial: false })
  ]).catch(() => {});
}

// 24hs sin un mensaje nuevo en un encuentro que sigue "abierto"
// (pendiente/activa/chequeo_cierre) -- se cierra solo (subido de 2hs: una
// persona real quedó disconforme con un cierre tan rápido -- 2hs alcanzaba
// para una pausa normal dentro de una charla real). Si cualquiera de las
// dos personas cierra manualmente (boton "salir"), eso sigue sin depender
// de este tiempo -- cierra al toque, como siempre. Se llama de forma
// perezosa desde cualquier lugar que lea una cita (las acciones de
// api/citas.js, Y la Hoja de Vida / transcripto del panel admin): no hay
// cron de alta frecuencia en este proyecto (el unico existente corre una
// vez por dia), asi que "chequear al acceder" es el unico jeito confiable
// de que esto se resuelva sin depender de que alguna de las dos personas
// vuelva a abrir la app. Devuelve la cita actualizada (con estado:'cerrada'
// si acaba de cerrarse) para que quien llama no siga tratandola como viva.
const LIMITE_INACTIVIDAD_MS = 24 * 60 * 60 * 1000;

export async function cerrarSiInactiva(supabaseUrl, headers, cita, match) {
  if (!['pendiente', 'activa', 'chequeo_cierre'].includes(cita.estado)) return cita;
  const referencia = cita.ultima_actividad || cita.created_at;
  if (Date.now() - new Date(referencia).getTime() <= LIMITE_INACTIVIDAD_MS) return cita;

  await finalizarCita(supabaseUrl, headers, cita.id, cita, match, 'Este encuentro cerró por inactividad. No hace falta decidir el resto de la historia hoy. Solo pregúntense si les gustaría volver a conversar.');
  return { ...cita, estado: 'cerrada' };
}
