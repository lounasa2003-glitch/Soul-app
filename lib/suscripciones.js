import { reconocerCompra } from './googlePlay.js';
import { registrarErrorSilencioso } from './logErrorSilencioso.js';

// Unico lugar que traduce el subscriptionState "crudo" de Google (ver
// consultarSuscripcion en lib/googlePlay.js) a como lo guarda Soul --
// llamado desde api/billing.js (compra/restaurar), api/billing-rtdn.js
// (webhook) y el cron de respaldo (diagnostico-diario.js). Que los tres
// pasen por aca es lo que evita que una renovacion se procese distinto
// segun de donde vino el aviso.
//
// SUBSCRIPTION_STATE_PENDING (compra iniciada, todavia no confirmada -- ej.
// medio de pago que tarda en procesar) no toca 'plan' a proposito: activar
// Pro recien cuando Google confirma de verdad, nunca antes.
const MAPA_ESTADOS = {
  SUBSCRIPTION_STATE_ACTIVE: { plan: 'pro', estado: 'activa' },
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: { plan: 'pro', estado: 'en_gracia' },
  SUBSCRIPTION_STATE_CANCELED: { plan: 'pro', estado: 'cancelada_vigente' },
  SUBSCRIPTION_STATE_ON_HOLD: { plan: 'free', estado: 'suspendida' },
  SUBSCRIPTION_STATE_PAUSED: { plan: 'free', estado: 'pausada' },
  SUBSCRIPTION_STATE_EXPIRED: { plan: 'free', estado: 'vencida' },
  SUBSCRIPTION_STATE_REVOKED: { plan: 'free', estado: 'revocada' },
  SUBSCRIPTION_STATE_PENDING: { plan: null, estado: 'pendiente' }
};

// Arma los campos a guardar en 'usuarios' a partir de la respuesta de
// Google. Devuelve null si no hay datos (token que Google no reconoce).
function camposDesdeGoogle(purchaseToken, datosGoogle) {
  if (!datosGoogle) return null;
  const item = (datosGoogle.lineItems && datosGoogle.lineItems[0]) || {};
  const resuelto = MAPA_ESTADOS[datosGoogle.subscriptionState] || { plan: null, estado: 'desconocido' };
  let plan = resuelto.plan;
  let estado = resuelto.estado;

  // Defensivo: Google en teoria pasa sola de CANCELED a EXPIRED al llegar
  // la fecha, pero si por lo que sea leemos un CANCELED con expiryTime ya
  // pasado, no se deja a nadie con Pro vencido solo por la etiqueta cruda.
  if (datosGoogle.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED' && item.expiryTime && new Date(item.expiryTime) <= new Date()) {
    plan = 'free';
    estado = 'vencida';
  }

  const campos = {
    plan_purchase_token: purchaseToken,
    plan_producto_id: item.productId || null,
    plan_vencimiento: item.expiryTime || null,
    plan_auto_renueva: item.autoRenewingPlan ? !!item.autoRenewingPlan.autoRenewEnabled : null,
    plan_estado_suscripcion: estado,
    plan_actualizado_en: new Date().toISOString()
  };
  // Solo se pisa 'plan'/'plan_origen' cuando el estado de Google resuelve a
  // uno de los dos (nunca en 'pendiente'/'desconocido') -- así una lectura
  // ambigua nunca mueve a alguien de Pro a Free ni viceversa por las dudas.
  if (plan) {
    campos.plan = plan;
    campos.plan_origen = 'suscripcion';
  }
  return campos;
}

// Reconoce la compra ante Google si todavia esta pendiente (obligatorio
// dentro de las 72hs o Google reembolsa sola) -- best-effort: si falla, se
// loguea pero no aborta la actualizacion de 'usuarios', que es lo mas
// importante para la persona ahora mismo.
async function reconocerSiHaceFalta(datosGoogle, purchaseToken, usuarioId) {
  if (datosGoogle.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_PENDING') return;
  const productId = datosGoogle.lineItems && datosGoogle.lineItems[0] && datosGoogle.lineItems[0].productId;
  if (!productId) return;
  try {
    await reconocerCompra(productId, purchaseToken);
  } catch (e) {
    await registrarErrorSilencioso({ contexto: 'lib/suscripciones: reconocerCompra', error: e, meta: { usuarioId } });
  }
}

async function patchUsuario(usuarioId, campos) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(usuarioId)}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(campos)
  });
  if (!res.ok) {
    const texto = await res.text();
    // El indice unico de plan_purchase_token (migracion_suscripciones.sql)
    // rechaza esto si ese purchase token ya esta linkeado a OTRA fila --
    // pasa si alguien restaura, con la misma cuenta de Google Play, una
    // compra que en Soul en realidad pertenece a otra cuenta.
    if (res.status === 409 || /duplicate key|unique/i.test(texto)) {
      const err = new Error('token_ya_vinculado');
      err.codigo = 'token_ya_vinculado';
      throw err;
    }
    throw new Error(`No se pudo actualizar usuarios: HTTP ${res.status} ${texto}`);
  }
}

// Camino usado por api/billing.js (verificar/restaurar) -- ya conoce el
// usuarioId de la sesion autenticada, no necesita buscarlo.
export async function aplicarSuscripcionAUsuario(usuarioId, purchaseToken, datosGoogle) {
  const campos = camposDesdeGoogle(purchaseToken, datosGoogle);
  if (!campos) {
    const err = new Error('google_no_reconoce_el_token');
    err.codigo = 'google_no_reconoce_el_token';
    throw err;
  }
  await patchUsuario(usuarioId, campos);
  await reconocerSiHaceFalta(datosGoogle, purchaseToken, usuarioId);
  return campos;
}

// Camino usado por api/billing-rtdn.js y el cron de respaldo -- solo tienen
// el purchase token (RTDN lo manda Google; el cron lo lee de la fila que ya
// esta re-chequeando), no una sesion de usuario. Busca la fila por
// plan_purchase_token (indice unico, ver migracion) y, como segunda red de
// seguridad, se niega a tocar cualquier fila que no tenga
// plan_origen='suscripcion' -- eso nunca deberia pasar (ver el comentario en
// api/admin/personas.js sobre limpiar estos campos al pasar a manual), pero
// si pasara, es preferible no tocar nada a bajar a Free algo que en
// realidad es una cortesia.
export async function aplicarSuscripcionPorToken(purchaseToken, datosGoogle) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const filaRes = await fetch(
    `${supabaseUrl}/rest/v1/usuarios?select=id,plan_origen&plan_purchase_token=eq.${encodeURIComponent(purchaseToken)}`,
    { headers }
  );
  const filas = filaRes.ok ? await filaRes.json() : [];
  const fila = filas[0];
  if (!fila) return { encontrado: false };
  if (fila.plan_origen !== 'suscripcion') {
    return { encontrado: true, aplicado: false, motivo: 'plan_origen_no_es_suscripcion', usuarioId: fila.id };
  }

  const campos = camposDesdeGoogle(purchaseToken, datosGoogle);
  if (!campos) return { encontrado: true, aplicado: false, motivo: 'sin_datos_google', usuarioId: fila.id };

  await patchUsuario(fila.id, campos);
  await reconocerSiHaceFalta(datosGoogle, purchaseToken, fila.id);
  return { encontrado: true, aplicado: true, usuarioId: fila.id, campos };
}
