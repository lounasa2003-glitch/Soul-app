// El system prompt del chat principal (y el de deteccion de modulo) son
// grandes (~2000 tokens) y por definicion siempre iguales entre llamadas --
// sin cachear, Anthropic los vuelve a procesar enteros en CADA mensaje de la
// charla, lo cual suma varios segundos de latencia antes de que aparezca el
// primer token (algo que el streaming del lado del cliente no soluciona,
// porque esa demora pasa antes de que empiece a llegar texto). Con
// cache_control, las llamadas siguientes con el mismo prefijo lo reusan.
export function systemConCache(system) {
  if (!system) return undefined;
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

// Para conversaciones de ida y vuelta (chat principal, modulos, reflexion)
// el historial de mensajes crece en cada turno y hoy se manda entero de
// nuevo cada vez sin cachear -- en una charla larga eso pesa mas que el
// system prompt (que ya esta cacheado). Marcar cache_control en el ultimo
// mensaje cachea todo el prefijo hasta ahi; el proximo turno, si llega
// dentro de los 5 minutos de TTL (lo normal en una charla activa), ese
// prefijo entero se lee a ~10% del precio en vez de reprocesarse entero, y
// solo el mensaje nuevo se cobra a precio de escritura de cache (~125%,
// unicamente sobre lo que se agrego, no sobre todo el historial). NO usar
// esto para llamados de un solo mensaje sin continuacion (extraccion,
// resumenes, ranking): ahi el prefijo nunca se reutiliza, asi que solo se
// pagaria el 125% sin ganar nunca el descuento de lectura.
export function messagesConCache(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  return messages.map((m, i) => {
    if (i !== messages.length - 1 || typeof m.content !== 'string') return m;
    return { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] };
  });
}

export async function llamarClaude({ model, max_tokens, system, messages }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: max_tokens || 1024,
      system: systemConCache(system),
      messages
    })
  });
  const data = await response.json();
  if (!response.ok) {
    const err = new Error('anthropic_error');
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

function extraerJSON(texto) {
  const limpio = texto.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(limpio);
  } catch (e) {
    const inicio = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (inicio !== -1 && fin > inicio) {
      return JSON.parse(limpio.slice(inicio, fin + 1));
    }
    throw e;
  }
}

// Le pide a Claude un JSON y lo parsea con salvataje (recorta texto de mas
// alrededor del JSON); si aun asi no parsea, reintenta la llamada una sola
// vez antes de tirar el error. Devuelve el uso de tokens junto con el JSON
// parseado (antes se descartaba) para poder loguear el costo real.
export async function llamarClaudeJSON(params) {
  for (let intento = 1; intento <= 2; intento++) {
    const data = await llamarClaude(params);
    const texto = data.content.map(b => b.text || '').join('');
    try {
      return { json: extraerJSON(texto), usage: data.usage };
    } catch (e) {
      if (intento === 2) throw new Error('json_invalido');
    }
  }
}
