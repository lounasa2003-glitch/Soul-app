import crypto from 'crypto';
import { registrarErrorSilencioso } from '../lib/logErrorSilencioso.js';
import { consultarSuscripcion } from '../lib/googlePlay.js';
import { aplicarSuscripcionPorToken } from '../lib/suscripciones.js';

// Webhook de push de Google Cloud Pub/Sub para Real-time Developer
// Notifications de Play Billing. A diferencia de todo el resto de /api,
// esto no lo llama nunca soul.html -- lo llama Google, sin sesion de
// ninguna persona, asi que la autenticacion es otra: un token OIDC firmado
// por Google en el header Authorization (lo agrega Pub/Sub solo si la
// suscripcion push se configura con "Enable authentication", ver el paso a
// paso que le corresponde a Lu en Play Console/Cloud Console).
//
// Deliberadamente SIN token secreto en la URL/query string (esos quedan en
// logs de acceso, historial del navegador si se prueba a mano, etc). La
// segunda capa de defensa (mas alla de que la firma del JWT sea valida y el
// email sea el esperado) es que el 'aud' del JWT tiene que matchear un
// valor secreto elegido por nosotros -- Pub/Sub permite configurar CUALQUIER
// string como audience del token OIDC, no tiene que ser la URL del
// endpoint. Ese secreto vive DENTRO del JWT que Google firma (RTDN_OIDC_AUDIENCE
// en Vercel, mismo valor configurado como audience al crear la suscripcion
// push), nunca en un parametro visible.

let jwksCache = { keys: [], expiraEnMs: 0 };

async function obtenerJwks() {
  if (jwksCache.keys.length && Date.now() < jwksCache.expiraEnMs) return jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error(`No se pudieron obtener las claves publicas de Google: HTTP ${res.status}`);
  const data = await res.json();
  // 6hs de cache -- de sobra para no pegarle a este endpoint en cada
  // notificacion, y corto para no quedar pegado mucho tiempo a una clave
  // que Google ya roto si justo cambia.
  jwksCache = { keys: data.keys || [], expiraEnMs: Date.now() + 6 * 3600 * 1000 };
  return jwksCache.keys;
}

function decodificarSegmento(seg) {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
}

// Valida de punta a punta el JWT OIDC que Pub/Sub adjunta en el push:
// firma RS256 contra las claves publicas de Google, vencimiento, issuer,
// que el email sea exactamente la cuenta de servicio que Lu creo para esta
// suscripcion push, y la audience secreta (segunda capa, ver comentario
// arriba). Cualquier chequeo que falle devuelve invalido -- nunca se sigue
// adelante "por las dudas".
async function verificarJwtGoogle(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return { valido: false, motivo: 'sin_bearer' };
  const jwt = authHeader.slice(7).trim();
  const partes = jwt.split('.');
  if (partes.length !== 3) return { valido: false, motivo: 'formato_invalido' };
  const [headerB64, payloadB64, sigB64] = partes;

  let header, payload;
  try {
    header = decodificarSegmento(headerB64);
    payload = decodificarSegmento(payloadB64);
  } catch (e) {
    return { valido: false, motivo: 'no_decodificable' };
  }

  const claves = await obtenerJwks();
  const jwk = claves.find((k) => k.kid === header.kid);
  if (!jwk) return { valido: false, motivo: 'kid_desconocido' };

  let clavePublica;
  try {
    clavePublica = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (e) {
    return { valido: false, motivo: 'clave_publica_invalida' };
  }

  const datosFirmados = Buffer.from(`${headerB64}.${payloadB64}`);
  const firma = Buffer.from(sigB64, 'base64url');
  let firmaValida = false;
  try {
    firmaValida = crypto.verify('RSA-SHA256', datosFirmados, clavePublica, firma);
  } catch (e) {
    return { valido: false, motivo: 'error_verificando_firma' };
  }
  if (!firmaValida) return { valido: false, motivo: 'firma_invalida' };

  const ahora = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < ahora) return { valido: false, motivo: 'expirado' };
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    return { valido: false, motivo: 'issuer_invalido' };
  }

  const emailEsperado = process.env.RTDN_SERVICE_ACCOUNT_EMAIL;
  if (!emailEsperado || payload.email !== emailEsperado || !payload.email_verified) {
    return { valido: false, motivo: 'email_no_coincide' };
  }

  const audienceEsperada = process.env.RTDN_OIDC_AUDIENCE;
  if (!audienceEsperada || payload.aud !== audienceEsperada) {
    return { valido: false, motivo: 'audience_no_coincide' };
  }

  return { valido: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const verificacion = await verificarJwtGoogle(req.headers.authorization).catch((e) => {
    registrarErrorSilencioso({ contexto: 'api/billing-rtdn: verificarJwtGoogle', error: e });
    return { valido: false, motivo: 'error_inesperado' };
  });
  if (!verificacion.valido) {
    await registrarErrorSilencioso({ contexto: 'api/billing-rtdn: push rechazado', error: new Error(verificacion.motivo) });
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const mensaje = req.body && req.body.message;
    if (!mensaje || !mensaje.data) {
      // Pub/Sub manda un mensaje de prueba sin 'data' al verificar la
      // suscripcion -- 200 para no generar reintentos por algo que no es
      // un error real.
      return res.status(200).json({ ok: true });
    }

    const payload = JSON.parse(Buffer.from(mensaje.data, 'base64').toString('utf8'));
    const notif = payload.subscriptionNotification;
    if (!notif || !notif.purchaseToken) {
      // testNotification u otro tipo sin purchaseToken -- nada que aplicar.
      return res.status(200).json({ ok: true });
    }

    let datosGoogle;
    try {
      datosGoogle = await consultarSuscripcion(notif.purchaseToken);
    } catch (e) {
      await registrarErrorSilencioso({ contexto: 'api/billing-rtdn: consultarSuscripcion', error: e });
      // 500 a proposito -- Pub/Sub reintenga el push mas tarde ante un error
      // transitorio de la Android Publisher API.
      return res.status(500).json({ error: 'error_temporal' });
    }

    if (!datosGoogle) {
      return res.status(200).json({ ok: true, encontrado: false });
    }

    const resultado = await aplicarSuscripcionPorToken(notif.purchaseToken, datosGoogle);
    // resultado.encontrado=false cuando la notificacion (tipicamente la
    // primera, SUBSCRIPTION_PURCHASED) llega antes de que el cliente haya
    // llamado a api/billing.js con ese mismo token -- ver el comentario ahi
    // sobre esa carrera. No es un error: se resuelve solo la proxima vez que
    // el cliente verifique/restaure.
    return res.status(200).json({ ok: true, encontrado: resultado.encontrado, aplicado: resultado.aplicado });
  } catch (error) {
    console.error('Error en /api/billing-rtdn:', error);
    await registrarErrorSilencioso({ contexto: 'api/billing-rtdn', error });
    return res.status(500).json({ error: 'error_procesando' });
  }
}
