import { verificarUsuario } from '../../lib/authUtil.js';
import { chequearLimite } from '../../lib/rateLimit.js';
import { registrarErrorSilencioso } from '../../lib/logErrorSilencioso.js';
import { obtenerPreapproval } from '../../lib/mercadoPago.js';
import { buscarUsuarioPorId, aplicarSuscripcionAUsuario } from '../../lib/suscripcionesMercadoPago.js';

// Reconciliacion manual bajo demanda -- fallback para cuando la persona
// vuelve del checkout de Mercado Pago (pro-retorno.html) y el webhook
// todavia no llego, o si por lo que sea un webhook se perdio. Siempre
// vuelve a consultar la API de Mercado Pago, nunca activa nada por su
// cuenta.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario || !usuario.usuarioId) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const limiteInfo = await chequearLimite(usuario.email, 'mp_sync', 30, 3600);
    if (!limiteInfo.permitido) {
      return res.status(429).json({ error: 'limite_alcanzado', mensaje: 'Demasiados intentos. Esperá un toque y volvé a intentar.' });
    }

    const fila = await buscarUsuarioPorId(usuario.usuarioId);
    if (!fila || !fila.mp_preapproval_id) {
      return res.status(200).json({ ok: true, plan: 'free', mensaje: 'Todavía no hay ninguna suscripción de Mercado Pago para esta cuenta.' });
    }

    let datosMP;
    try {
      datosMP = await obtenerPreapproval(fila.mp_preapproval_id);
    } catch (e) {
      await registrarErrorSilencioso({ contexto: 'api/subscription/sync: obtenerPreapproval', error: e, meta: { usuarioId: usuario.usuarioId } });
      return res.status(502).json({ error: 'no_se_pudo_verificar', mensaje: 'No pudimos confirmar el estado con Mercado Pago. Probá de nuevo en un rato.' });
    }

    if (!datosMP) {
      return res.status(200).json({ ok: true, plan: 'free', mensaje: 'Mercado Pago no reconoce esta suscripción.' });
    }

    const campos = await aplicarSuscripcionAUsuario(usuario.usuarioId, fila.mp_preapproval_id, datosMP);
    return res.status(200).json({ ok: true, plan: campos.plan || 'free', estadoMercadoPago: campos.mp_status });
  } catch (error) {
    console.error('Error en /api/subscription/sync:', error);
    await registrarErrorSilencioso({ contexto: 'api/subscription/sync', error });
    return res.status(500).json({ error: 'Error sincronizando la suscripción' });
  }
}
