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
