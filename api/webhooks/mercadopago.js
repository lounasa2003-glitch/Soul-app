import crypto from 'crypto';
import { registrarErrorSilencioso } from '../../lib/logErrorSilencioso.js';
import { obtenerPreapproval, obtenerPago } from '../../lib/mercadoPago.js';
import { aplicarSuscripcionPorUsuarioId, buscarUsuarioPorId } from '../../lib/suscripcionesMercadoPago.js';

// Webhook de Mercado Pago para Suscripciones. Como en api/billing-rtdn.js
// (Google), esto no lo llama nunca soul.html/pro.html -- lo llama Mercado
// Pago, sin sesion de ninguna persona. La autenticidad se valida con la
// firma HMAC del header x-signature (documentado oficialmente por MP:
// manifest "id:{data.id};request-id:{x-request-id};ts:{ts};", HMAC-SHA256
// contra MERCADOPAGO_WEBHOOK_SECRET).
//
// Topics soportados (los 3 pedidos, confirmados en la doc oficial de
// Suscripciones AR): subscription_preapproval, subscription_authorized_payment,
// payment. Cualquier otro topic (o un ping de prueba sin data.id) responde
// 200 sin hacer nada, para no generar reintentos por algo que no es un error.
//
// PENDIENTE DE CONFIRMAR EN SANDBOX (no se pudo ejecutar en esta sesion por
// no tener credenciales de prueba de Mercado Pago configuradas -- ver el
// checklist al final de la respuesta): el shape exacto del query string para
// los topics de suscripciones (se asume "type"/"data.id", que es el formato
// documentado para el resto de los productos de MP) y si el recurso de
// 'payment'/'subscription_authorized_payment' expone algun campo propio para
// llegar directo al preapproval_id. Por eso el mapeo de mas abajo NO depende
// de ningun campo no confirmado: usa external_reference (si el recurso lo
// trae) + el mp_preapproval_id que Soul ya guardo en 'usuarios' al crear la
// suscripcion (ver api/subscribe.js), nunca un campo inventado.

function parsearXSignature(header) {
  if (!header) return {};
  const partes = {};
  header.split(',').forEach((par) => {
    const [k, v] = par.split('=');
    if (k && v) partes[k.trim()] = v.trim();
  });
  return partes;
}

function validarFirma({ xSignature, xRequestId, dataId, secret }) {
  if (!xSignature || !secret) return false;
  const { ts, v1 } = parsearXSignature(xSignature);
  if (!ts || !v1) return false;

  // Si data.id o x-request-id no vinieron, se sacan del manifest (asi lo
  // indica la doc oficial) en vez de meter un valor vacio que rompa el hash.
  let manifest = '';
  if (dataId) manifest += `id:${dataId};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;

  const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'utf8'), Buffer.from(v1, 'utf8'));
  } catch (e) {
    return false;
  }
}

// Resuelve, para cualquiera de los 3 topics, el usuarioId (via
// external_reference) y los datos frescos del preapproval -- SIEMPRE termina
// haciendo un GET /preapproval/{id} propio (nunca se confia en el payload del
// webhook como fuente de verdad de el status).
async function resolverEvento(topic, dataId) {
  if (topic === 'subscription_preapproval') {
    const preapproval = await obtenerPreapproval(dataId);
    if (!preapproval || !preapproval.external_reference) return null;
    return { usuarioId: preapproval.external_reference, preapprovalId: dataId, preapproval };
  }

  // 'payment' / 'subscription_authorized_payment': dataId es un id de pago,
  // no de preapproval. Se intenta external_reference del pago si esta
  // disponible; si no, se recurre a la fila ya guardada en 'usuarios' -- eso
  // evita depender de un campo (preapproval_id dentro de /v1/payments) que
  // no esta confirmado en la doc oficial para este caso.
  const pago = await obtenerPago(dataId);
  const usuarioIdDelPago = pago && pago.external_reference;
  if (!usuarioIdDelPago) return null;

  const fila = await buscarUsuarioPorId(usuarioIdDelPago);
  if (!fila || !fila.mp_preapproval_id) return null;

  const preapproval = await obtenerPreapproval(fila.mp_preapproval_id);
  if (!preapproval) return null;
  return { usuarioId: usuarioIdDelPago, preapprovalId: fila.mp_preapproval_id, preapproval };
}

const TOPICS_SOPORTADOS = new Set(['subscription_preapproval', 'subscription_authorized_payment', 'payment']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const dataId = req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || null;
  const topic = req.query.type || req.query.topic || (req.body && req.body.type) || null;

  const firmaValida = validarFirma({
    xSignature: req.headers['x-signature'],
    xRequestId: req.headers['x-request-id'],
    dataId,
    secret: process.env.MERCADOPAGO_WEBHOOK_SECRET
  });
  if (!firmaValida) {
    await registrarErrorSilencioso({ contexto: 'api/webhooks/mercadopago: firma invalida', error: new Error('firma_invalida'), meta: { topic } });
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    if (!topic || !TOPICS_SOPORTADOS.has(topic) || !dataId) {
      // Notificacion de un topic no suscripto o un ping sin data.id -- no es
      // un error, no hay nada que aplicar.
      return res.status(200).json({ ok: true, ignorado: true });
    }

    const evento = await resolverEvento(topic, dataId);
    if (!evento) {
      // Puede pasar si la notificacion de 'payment' llega antes de que
      // api/subscribe.js haya terminado de guardar mp_preapproval_id (carrera
      // minima, ver registrarPreapprovalPendiente) -- se resuelve solo con
      // el proximo webhook o con /api/subscription/sync.
      return res.status(200).json({ ok: true, encontrado: false });
    }

    // Idempotencia: cada escritura sale de un GET fresco y determinista
    // (mismo status de MP -> mismos campos), asi que reaplicar el mismo
    // evento dos veces deja a 'usuarios' en el mismo estado -- no hace falta
    // una tabla de deduplicacion aparte para esto (no es una accion de
    // cobro propia, es un simple sync de estado idempotente por diseño).
    const resultado = await aplicarSuscripcionPorUsuarioId(evento.usuarioId, evento.preapprovalId, evento.preapproval);
    return res.status(200).json({ ok: true, encontrado: resultado.encontrado, aplicado: resultado.aplicado });
  } catch (error) {
    console.error('Error en /api/webhooks/mercadopago:', error);
    await registrarErrorSilencioso({ contexto: 'api/webhooks/mercadopago', error, meta: { topic, dataId } });
    // 500 a proposito -- Mercado Pago reintenta el webhook mas tarde ante un
    // error transitorio (misma logica que api/billing-rtdn.js con Pub/Sub).
    return res.status(500).json({ error: 'error_procesando' });
  }
}
