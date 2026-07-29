import crypto from 'crypto';

// Manda notificaciones push via Firebase Cloud Messaging (API v1), sin
// ninguna libreria de Firebase/Google -- la autenticacion es un JWT
// firmado a mano con la clave privada de la cuenta de servicio
// (FIREBASE_SERVICE_ACCOUNT_KEY), intercambiado por un access token OAuth2.
// Mismo criterio que el resto del backend: cero dependencias npm.

let tokenCacheado = null; // { valor, expiraEn }

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

async function obtenerAccessToken() {
  if (tokenCacheado && Date.now() < tokenCacheado.expiraEn) {
    return tokenCacheado.valor;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no configurada');
  const cuenta = JSON.parse(raw);

  const ahora = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: cuenta.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600
  }));
  const firma = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(cuenta.private_key, 'base64url');
  const jwt = `${header}.${claims}.${firma}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`
  });
  if (!res.ok) throw new Error('No se pudo obtener access token de Google: ' + (await res.text()));
  const data = await res.json();
  // Se cachea con 2 minutos de margen antes del vencimiento real (data.expires_in
  // suele ser 3600s) -- esto vive en memoria del proceso serverless, asi que en
  // un cold start nuevo se vuelve a pedir, pero en invocaciones calidas seguidas
  // se reusa en vez de firmar un JWT nuevo cada vez.
  tokenCacheado = { valor: data.access_token, expiraEn: Date.now() + (data.expires_in - 120) * 1000 };
  return data.access_token;
}

// Manda una notificacion a UN token de dispositivo puntual. No tira si
// Google rechaza el token (ej: la persona desinstalo la app) -- eso lo
// tiene que manejar quien llama, borrando el token si corresponde.
export async function enviarPush({ token, titulo, cuerpo, data }) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) return { ok: false, error: 'no_configurado' };
  const cuenta = JSON.parse(raw);
  const accessToken = await obtenerAccessToken();

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: titulo, body: cuerpo },
        data: data || {}
      }
    })
  });
  if (!res.ok) return { ok: false, error: await res.text(), status: res.status };
  return { ok: true };
}

// Le manda a TODOS los dispositivos registrados de una persona (puede tener
// mas de uno, ver migracion_push_tokens.sql) -- usa la service role key
// porque esto corre del lado del servidor, para la persona X a partir de
// un evento (nuevo match, mensaje nuevo, etc.), no como ella misma pidiendo
// sus propios datos.
export async function enviarPushAUsuario(usuarioId, { titulo, cuerpo, data }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  const res = await fetch(`${supabaseUrl}/rest/v1/push_tokens?select=id,token&usuario_id=eq.${encodeURIComponent(usuarioId)}`, { headers });
  const filas = res.ok ? await res.json() : [];
  if (filas.length === 0) return { enviados: 0, resultados: [] };

  const tokensAEliminar = [];
  const resultados = await Promise.all(filas.map(async (fila) => {
    const resultado = await enviarPush({ token: fila.token, titulo, cuerpo, data }).catch((e) => ({ ok: false, error: String(e) }));
    if (!resultado.ok) console.error('enviarPushAUsuario: fallo el envio a un token:', resultado.status, resultado.error);
    // UNREGISTERED (token invalido/desinstalada) -- limpiar para no seguir
    // intentando mandarle a un dispositivo que ya no existe.
    if (!resultado.ok && resultado.error && String(resultado.error).includes('UNREGISTERED')) {
      tokensAEliminar.push(fila.id);
    }
    return resultado;
  }));

  if (tokensAEliminar.length > 0) {
    await fetch(`${supabaseUrl}/rest/v1/push_tokens?id=in.(${tokensAEliminar.map(encodeURIComponent).join(',')})`, {
      method: 'DELETE',
      headers
    }).catch(() => {});
  }
  return { enviados: filas.length, resultados };
}
