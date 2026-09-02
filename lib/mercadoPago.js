// Cliente minimo de la API de Mercado Pago, a mano con fetch nativo (mismo
// patron que lib/googlePlay.js: este proyecto no tiene package.json/npm en
// el backend, asi que no se suma el SDK oficial de MP para esto).
//
// Cubre SOLO lo que necesita el flujo aprobado para Soul Pro: preapproval
// (suscripcion) SIN preapproval_plan y SIN card_token_id -- el checkout tiene
// que quedar 100% alojado en el dominio de Mercado Pago (init_point), Soul
// nunca ve ni procesa un dato de tarjeta. Ver la arquitectura corregida:
// una Suscripcion con plan asociado (preapproval_plan_id) exige card_token_id
// y no devuelve init_point (confirmado en la doc oficial de Suscripciones
// AR), asi que preapproval_plan queda deliberadamente afuera de este cliente.

// URL de retorno visual post-checkout -- NUNCA se usa para activar Pro (eso
// pasa solo server-side, ver lib/suscripcionesMercadoPago.js). No es un
// secreto, se hardcodea igual que PACKAGE_NAME en lib/googlePlay.js.
const BACK_URL = 'https://soulapp.love/pro-retorno.html';

const API_BASE = 'https://api.mercadopago.com';

function accessToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN');
  return token;
}

async function llamarMP(path, opciones) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
      ...(opciones && opciones.headers)
    }
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// Crea la suscripcion SIN plan asociado, en el modelo de "pago pendiente"
// (sin card_token_id) -- la respuesta trae init_point, la URL alojada por
// Mercado Pago donde la persona carga/autoriza su medio de pago. external_reference
// es el user_id de Supabase (usuarios.id), la unica forma segura de asociar
// esta suscripcion a la cuenta correcta cuando llegue el webhook.
//
// montoARS lo calcula SIEMPRE el llamador (api/subscribe.js, via
// lib/precioSoulPro.js) a partir del precio objetivo en USD + la cotizacion
// oficial del momento -- este cliente no sabe nada de dolares ni de
// cotizaciones, solo recibe el numero final en ARS ya calculado y lo manda
// tal cual. Nunca se acepta un monto mandado por el cliente/frontend.
export async function crearPreapproval({ usuarioId, email, montoARS }) {
  if (!usuarioId || !email) throw new Error('crearPreapproval: falta usuarioId o email');
  if (!Number.isFinite(montoARS) || montoARS <= 0) throw new Error('crearPreapproval: montoARS invalido');

  const { ok, status, data } = await llamarMP('/preapproval', {
    method: 'POST',
    body: JSON.stringify({
      reason: 'Soul Pro',
      external_reference: usuarioId,
      payer_email: email,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: montoARS,
        currency_id: 'ARS'
      },
      back_url: BACK_URL,
      status: 'pending'
    })
  });

  if (!ok || !data || !data.id || !data.init_point) {
    throw new Error(`No se pudo crear la suscripcion en Mercado Pago: HTTP ${status} ${JSON.stringify(data)}`);
  }
  return { preapprovalId: data.id, initPoint: data.init_point };
}

// Estado autoritativo de una suscripcion, tal cual lo ve Mercado Pago --
// unica fuente de verdad real (nunca se confia en el payload de un webhook
// ni en parametros de back_url). Devuelve null si MP no reconoce ese id.
export async function obtenerPreapproval(preapprovalId) {
  if (!preapprovalId) return null;
  const { ok, status, data } = await llamarMP(`/preapproval/${encodeURIComponent(preapprovalId)}`, { method: 'GET' });
  if (status === 404) return null;
  if (!ok) throw new Error(`Error consultando preapproval en Mercado Pago: HTTP ${status} ${JSON.stringify(data)}`);
  return data;
}

// Cancela la suscripcion en Mercado Pago. No hay (confirmado en la doc
// oficial) un mecanismo de "cancelar pero mantener vigente hasta el fin del
// periodo ya pagado" -- la cancelacion es efectiva ya mismo del lado de MP,
// asi que Soul refleja el corte de inmediato tambien (ver
// lib/suscripcionesMercadoPago.js). Si mas adelante se quiere una gracia
// hasta la proxima fecha de cobro, tendria que construirse aparte en Soul,
// no asumirse como comportamiento nativo de MP.
export async function cancelarPreapproval(preapprovalId) {
  if (!preapprovalId) throw new Error('cancelarPreapproval: falta preapprovalId');
  const { ok, status, data } = await llamarMP(`/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' })
  });
  if (!ok) throw new Error(`No se pudo cancelar la suscripcion en Mercado Pago: HTTP ${status} ${JSON.stringify(data)}`);
  return data;
}

// Usado solo por el webhook para el topic 'payment' -- da external_reference
// (el user_id) cuando esta disponible. NO se asume que este recurso traiga
// un campo preapproval_id documentado de forma confiable (no se encontro un
// quote oficial que lo confirme para pagos generados por una suscripcion) --
// el mapeo real a la suscripcion pasa por external_reference + la fila ya
// guardada en 'usuarios' (ver lib/suscripcionesMercadoPago.js). Verificar el
// JSON real en sandbox antes de confiar en campos no listados aca.
export async function obtenerPago(pagoId) {
  if (!pagoId) return null;
  const { ok, status, data } = await llamarMP(`/v1/payments/${encodeURIComponent(pagoId)}`, { method: 'GET' });
  if (status === 404) return null;
  if (!ok) throw new Error(`Error consultando pago en Mercado Pago: HTTP ${status} ${JSON.stringify(data)}`);
  return data;
}

export { BACK_URL };
