const REDIRECT_URL = 'https://soul-app-tau.vercel.app/soul.html';

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
    const { accion, email, password, refresh_token } = req.body;

    // El link de recuperación llega con el token de sesión de la persona
    // (no el apikey) -- se reenvía tal cual a Supabase con el metodo PUT
    // que espera /auth/v1/user, distinto del resto de las acciones.
    if (accion === 'actualizarPassword') {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Falta el token de sesión' });
      }
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': authHeader
        },
        body: JSON.stringify({ password })
      });
      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json(data);
      }
      return res.status(200).json({ email: data.email });
    }

    let endpoint = '';
    let bodyData;
    if (accion === 'registro') {
      endpoint = '/auth/v1/signup';
      bodyData = { email, password };
    } else if (accion === 'login') {
      endpoint = '/auth/v1/token?grant_type=password';
      bodyData = { email, password };
    } else if (accion === 'recuperar') {
      endpoint = '/auth/v1/recover?redirect_to=' + encodeURIComponent(REDIRECT_URL);
      bodyData = { email };
    } else if (accion === 'refrescar') {
      endpoint = '/auth/v1/token?grant_type=refresh_token';
      bodyData = { refresh_token };
    } else {
      return res.status(400).json({ error: 'Acción no válida' });
    }

    const response = await fetch(`${supabaseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey
      },
      body: JSON.stringify(bodyData)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error en /api/auth:', error);
    return res.status(500).json({ error: 'Error de autenticación' });
  }
}
