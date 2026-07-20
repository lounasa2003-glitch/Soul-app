import crypto from 'crypto';
import { chequearLimite } from '../lib/rateLimit.js';
import { notificarConfirmarMail } from '../lib/email.js';

const REDIRECT_URL = 'https://soulapp.love/soul.html';

// Sin ningun freno, login/registro/recuperar quedaban abiertos a fuerza
// bruta y creacion masiva de cuentas -- se limita por email (misma clave
// que usa chequearLimite en el resto de la app) antes de mandar nada a
// Supabase. login queda mas ajustado que el resto porque es el vector mas
// directo de fuerza bruta contra una cuenta puntual; registro y recuperar
// se limitan por hora, que alcanza para uso legitimo (nadie necesita
// registrarse o pedir recuperar contraseña muchas veces seguidas para el
// mismo email).
const LIMITES_AUTH = {
  login: { limite: 8, ventanaSegundos: 600 },
  registro: { limite: 5, ventanaSegundos: 3600 },
  recuperar: { limite: 5, ventanaSegundos: 3600 },
  reenviarConfirmacion: { limite: 5, ventanaSegundos: 3600 }
};

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

    const limiteConfig = LIMITES_AUTH[accion];
    if (limiteConfig) {
      if (!email) return res.status(400).json({ error: 'Falta email' });
      const limiteInfo = await chequearLimite(email, 'auth_' + accion, limiteConfig.limite, limiteConfig.ventanaSegundos);
      if (!limiteInfo.permitido) {
        return res.status(429).json({
          error: 'limite_alcanzado',
          mensaje: 'Demasiados intentos. Esperá un toque y volvé a intentar.',
          segundosParaReset: limiteInfo.segundosParaReset
        });
      }
    }

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

    // Confirmacion de cuenta propia (independiente de la de Supabase Auth --
    // ver el comentario en lib/email.js sobre por que). No requieren la
    // sesion de la persona: reenviarConfirmacion se pide desde la pantalla
    // "Revisá tu email" sin sesion valida todavia en algunos casos, y
    // confirmarMail llega desde el link del mail, que puede abrirse en un
    // dispositivo distinto al que se registro.
    if (accion === 'reenviarConfirmacion') {
      const headersSb = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      const rowRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,mail_confirmado&email=eq.${encodeURIComponent(email)}`, { headers: headersSb });
      const rows = rowRes.ok ? await rowRes.json() : [];
      const fila = rows[0];
      // Misma respuesta exista o no la cuenta, o ya este confirmada -- este
      // endpoint no es un lugar para confirmar si un mail esta registrado.
      if (fila && !fila.mail_confirmado) {
        const token = crypto.randomBytes(24).toString('hex');
        await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(fila.id)}`, {
          method: 'PATCH',
          headers: { ...headersSb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ token_confirmacion: token })
        });
        await notificarConfirmarMail({ nombre: fila.nombre, email: fila.email, token });
      }
      return res.status(200).json({ ok: true });
    }

    if (accion === 'confirmarMail') {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Falta token' });
      const headersSb = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      const rowRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=id&token_confirmacion=eq.${encodeURIComponent(token)}`, { headers: headersSb });
      const rows = rowRes.ok ? await rowRes.json() : [];
      const fila = rows[0];
      if (!fila) {
        return res.status(400).json({ error: 'token_invalido', mensaje: 'Este link ya no es válido -- puede que ya lo hayas usado, o que hayas pedido uno nuevo después.' });
      }
      await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(fila.id)}`, {
        method: 'PATCH',
        headers: { ...headersSb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ mail_confirmado: true, token_confirmacion: null })
      });
      return res.status(200).json({ ok: true });
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
