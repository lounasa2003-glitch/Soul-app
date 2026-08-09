import { verificarUsuario } from '../lib/authUtil.js';
import { chequearLimite } from '../lib/rateLimit.js';
import { registrarErrorSilencioso } from '../lib/logErrorSilencioso.js';
import { consultarSuscripcion } from '../lib/googlePlay.js';
import { aplicarSuscripcionAUsuario } from '../lib/suscripciones.js';

// Un solo endpoint para compra nueva Y restaurar -- del lado del cliente son
// dos gestos distintos (comprar vs. "restaurar compra" en soul.html), pero
// llegan aca con el mismo purchase token de Google Play y el backend hace
// exactamente lo mismo con los dos: le pregunta a Google que estado tiene
// ese token (nunca confia en lo que diga el cliente sobre si es "nuevo" o
// "restaurado") y aplica ese estado real. No hay una accion 'restaurar'
// separada porque no habria nada distinto que hacer.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario || !usuario.usuarioId) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const { accion, purchaseToken } = req.body || {};
    if (accion !== 'verificar') {
      return res.status(400).json({ error: 'Acción no válida' });
    }
    if (!purchaseToken || typeof purchaseToken !== 'string') {
      return res.status(400).json({ error: 'Falta purchaseToken' });
    }

    // Cubre tanto a alguien reintentando una compra fallida como un intento
    // de abuso mandando tokens inventados en loop -- 20/hora alcanza de
    // sobra para cualquier uso legitimo (comprar, restaurar, algun reintento
    // de red) sin gastar de mas la cuota de la Android Publisher API.
    const limiteInfo = await chequearLimite(usuario.email, 'billing_verificar', 20, 3600);
    if (!limiteInfo.permitido) {
      return res.status(429).json({ error: 'limite_alcanzado', mensaje: 'Demasiados intentos. Esperá un toque y volvé a intentar.' });
    }

    let datosGoogle;
    try {
      datosGoogle = await consultarSuscripcion(purchaseToken);
    } catch (e) {
      await registrarErrorSilencioso({ contexto: 'api/billing: consultarSuscripcion', error: e, meta: { usuarioId: usuario.usuarioId } });
      return res.status(502).json({ error: 'no_se_pudo_verificar', mensaje: 'No pudimos confirmar la compra con Google Play. Probá de nuevo en un rato.' });
    }

    if (!datosGoogle) {
      return res.status(400).json({ error: 'token_invalido', mensaje: 'Google Play no reconoce esta compra.' });
    }

    const productoEsperado = process.env.GOOGLE_PLAY_PRODUCT_ID;
    const productoRecibido = datosGoogle.lineItems && datosGoogle.lineItems[0] && datosGoogle.lineItems[0].productId;
    if (productoEsperado && productoRecibido && productoRecibido !== productoEsperado) {
      return res.status(400).json({ error: 'producto_no_reconocido', mensaje: 'Esta compra no corresponde a Soul Pro.' });
    }

    let campos;
    try {
      campos = await aplicarSuscripcionAUsuario(usuario.usuarioId, purchaseToken, datosGoogle);
    } catch (e) {
      if (e.codigo === 'token_ya_vinculado') {
        return res.status(409).json({ error: 'token_ya_vinculado', mensaje: 'Esta compra ya está asociada a otra cuenta de Soul.' });
      }
      throw e;
    }

    return res.status(200).json({ ok: true, plan: campos.plan || usuario.plan, estado: campos.plan_estado_suscripcion });
  } catch (error) {
    console.error('Error en /api/billing:', error);
    await registrarErrorSilencioso({ contexto: 'api/billing', error });
    return res.status(500).json({ error: 'Error verificando la compra' });
  }
}
