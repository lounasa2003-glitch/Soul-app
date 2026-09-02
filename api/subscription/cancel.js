import { verificarUsuario } from '../../lib/authUtil.js';
import { chequearLimite } from '../../lib/rateLimit.js';
import { registrarErrorSilencioso } from '../../lib/logErrorSilencioso.js';
import { cancelarPreapproval, obtenerPreapproval } from '../../lib/mercadoPago.js';
import { buscarUsuarioPorId, aplicarSuscripcionAUsuario } from '../../lib/suscripcionesMercadoPago.js';

// Cancela la suscripcion de Mercado Pago de la persona autenticada. MP no
// ofrece (confirmado en la doc oficial) una cancelacion con gracia hasta fin
// de periodo -- el corte es inmediato tambien del lado de Soul, reflejando
// el status real que MP devuelve apenas se cancela.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario || !usuario.usuarioId) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const limiteInfo = await chequearLimite(usuario.email, 'mp_cancel', 10, 3600);
    if (!limiteInfo.permitido) {
      return res.status(429).json({ error: 'limite_alcanzado', mensaje: 'Demasiados intentos. Esperá un toque y volvé a intentar.' });
    }

    const fila = await buscarUsuarioPorId(usuario.usuarioId);
    if (!fila || fila.plan_origen !== 'mercadopago' || !fila.mp_preapproval_id) {
      return res.status(400).json({ error: 'sin_suscripcion_mercadopago', mensaje: 'No encontramos una suscripción de Mercado Pago activa en tu cuenta.' });
    }

    let datosMP;
    try {
      await cancelarPreapproval(fila.mp_preapproval_id);
      // Nunca se confia en la respuesta del PUT como fuente de verdad -- se
      // vuelve a pedir el estado con un GET propio antes de tocar 'usuarios'.
      datosMP = await obtenerPreapproval(fila.mp_preapproval_id);
    } catch (e) {
      await registrarErrorSilencioso({ contexto: 'api/subscription/cancel: cancelarPreapproval', error: e, meta: { usuarioId: usuario.usuarioId } });
      return res.status(502).json({ error: 'no_se_pudo_cancelar', mensaje: 'No pudimos cancelar la suscripción con Mercado Pago. Probá de nuevo en un rato.' });
    }

    const campos = await aplicarSuscripcionAUsuario(usuario.usuarioId, fila.mp_preapproval_id, datosMP);
    return res.status(200).json({ ok: true, plan: campos.plan || 'free', estadoMercadoPago: campos.mp_status });
  } catch (error) {
    console.error('Error en /api/subscription/cancel:', error);
    await registrarErrorSilencioso({ contexto: 'api/subscription/cancel', error });
    return res.status(500).json({ error: 'Error cancelando la suscripción' });
  }
}
