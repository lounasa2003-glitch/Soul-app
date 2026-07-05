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
      system,
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
// vez antes de tirar el error.
export async function llamarClaudeJSON(params) {
  for (let intento = 1; intento <= 2; intento++) {
    const data = await llamarClaude(params);
    const texto = data.content.map(b => b.text || '').join('');
    try {
      return extraerJSON(texto);
    } catch (e) {
      if (intento === 2) throw new Error('json_invalido');
    }
  }
}
