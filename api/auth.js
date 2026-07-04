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
    const { accion, email, password } = req.body;

    let endpoint = '';
    if (accion === 'registro') {
      endpoint = '/auth/v1/signup';
    } else if (accion === 'login') {
      endpoint = '/auth/v1/token?grant_type=password';
    } else {
      return res.status(400).json({ error: 'Acción no válida' });
    }

    const response = await fetch(`${supabaseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: 'Error de autenticación', details: error.message });
  }
}
