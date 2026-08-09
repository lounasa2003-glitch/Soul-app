import crypto from 'crypto';

// Cliente minimo de la Android Publisher API, a mano con fetch+crypto nativos
// de Node (este proyecto no tiene package.json/npm en el backend -- ver el
// resto de api/*.js, todos sin dependencias -- asi que instalar
// googleapis/google-auth-library rompería ese patron para ganar algo que se
// arma en pocas lineas: un JWT RS256 firmado con la cuenta de servicio,
// canjeado por un access token de OAuth2).

// applicationId real (ver android/app/build.gradle en soul-app-native) -- no
// es un secreto, no hace falta env var. Si algun dia cambia el applicationId
// de la app, esto tiene que cambiar junto con Play Console.
const PACKAGE_NAME = 'love.soulapp.app';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// La clave privada de la cuenta de servicio es un PEM multilinea -- si se
// carga en Vercel como variable de una sola linea (pegada con "\n" literal
// en vez de saltos de linea reales), se normaliza aca. Si ya viene con
// saltos de linea reales (Vercel tambien acepta valores multilinea), se usa
// tal cual.
function normalizarClavePrivada(valor) {
  if (!valor) return null;
  return valor.includes('\\n') ? valor.replace(/\\n/g, '\n') : valor;
}

// Cacheado en memoria del modulo -- sirve entre invocaciones "calientes" de
// la misma funcion serverless (Fluid Compute reusa instancias, ver notas de
// Vercel) y evita pedir un access token nuevo en cada request. Si la
// instancia es nueva o el token ya vencio, se pide uno igual. Nunca se loguea.
let tokenCacheado = null; // { accessToken, expiraEnMs }

async function obtenerAccessToken() {
  if (tokenCacheado && Date.now() < tokenCacheado.expiraEnMs) {
    return tokenCacheado.accessToken;
  }

  const email = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  const clavePrivada = normalizarClavePrivada(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY);
  if (!email || !clavePrivada) {
    throw new Error('Falta GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL o GOOGLE_PLAY_SERVICE_ACCOUNT_KEY');
  }

  const ahora = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600
  };
  const sinFirmar = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));
  const firmante = crypto.createSign('RSA-SHA256');
  firmante.update(sinFirmar);
  firmante.end();
  const firma = firmante.sign(clavePrivada).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = sinFirmar + '.' + firma;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`No se pudo obtener access token de Google: HTTP ${res.status} ${JSON.stringify(data)}`);
  }

  // Un margen de 60s antes del vencimiento real para no arriesgarse a usar
  // un token que expira a mitad de un request.
  tokenCacheado = { accessToken: data.access_token, expiraEnMs: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

// Estado autoritativo de una suscripcion, tal cual lo ve Google -- esta es
// la UNICA fuente de verdad real (nunca se confia en lo que manda el
// cliente, ni siquiera en el tipo de notificacion que manda RTDN, ver
// lib/suscripciones.js). Devuelve null si Google no conoce ese purchase
// token (token invalido/de otra app).
export async function consultarSuscripcion(purchaseToken) {
  const accessToken = await obtenerAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404 || res.status === 400) return null;
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Error consultando suscripcion en Google Play: HTTP ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// Google reembolsa automaticamente una compra que no se reconoce (acknowledge)
// dentro de las 72hs -- este paso es obligatorio para toda compra nueva,
// tanto de suscripciones como de compras unicas. subscriptionsv2 no tiene su
// propio endpoint de acknowledge; sigue siendo el de v3 purchases.subscriptions.
export async function reconocerCompra(productId, purchaseToken) {
  const accessToken = await obtenerAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok && res.status !== 400) {
    // 400 aca casi siempre es "ya estaba reconocida" (doble llamada, carrera
    // entre RTDN y el chequeo del cliente) -- no es un error real.
    const data = await res.json().catch(() => ({}));
    throw new Error(`Error reconociendo compra en Google Play: HTTP ${res.status} ${JSON.stringify(data)}`);
  }
}

export { PACKAGE_NAME };
