import { verificarUsuario } from '../lib/authUtil.js';
import { chequearLimite } from '../lib/rateLimit.js';
import { registrarErrorSilencioso } from '../lib/logErrorSilencioso.js';
import { crearPreapproval } from '../lib/mercadoPago.js';
import { registrarPreapprovalPendiente, buscarUsuarioPorId } from '../lib/suscripcionesMercadoPago.js';
import { calcularPrecioSoulProARS, registrarTrazabilidadPrecio } from '../lib/precioSoulPro.js';

// Arranca una suscripcion nueva de Soul Pro via Mercado Pago. Devuelve
// UNICAMENTE el init_point -- el frontend (pro.html) redirige ahi y a partir
// de ese momento es 100% pantalla de Mercado Pago; Soul no ve ni pide ningun
// dato de tarjeta en ningun punto de este endpoint.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario || !usuario.usuarioId) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    // 10/hora alcanza de sobra para cualquier uso legitimo (un intento, algun
    // reintento de red) sin abrir la puerta a generar preapprovals en loop.
    const limiteInfo = await chequearLimite(usuario.email, 'mp_subscribe', 10, 3600);
    if (!limiteInfo.permitido) {
      return res.status(429).json({ error: 'limite_alcanzado', mensaje: 'Demasiados intentos. Esperá un toque y volvé a intentar.' });
    }

    // Si ya hay una suscripcion autorizada, no se crea una segunda -- evita
    // que alguien termine con dos preapprovals activos por tocar el boton
    // dos veces.
    const filaActual = await buscarUsuarioPorId(usuario.usuarioId);
    if (filaActual && filaActual.plan_origen === 'mercadopago' && usuario.plan === 'pro') {
      return res.status(200).json({ ok: true, yaActivo: true });
    }

    // El precio en ARS se calcula de cero en cada alta nueva, a partir del
    // precio objetivo en USD (SOUL_PRO_PRECIO_USD) y la cotizacion oficial
    // del BCRA del momento -- nunca un monto mandado por el cliente. Si la
    // cotizacion no se puede obtener, se corta ACA, antes de crear nada en
    // Mercado Pago: mejor un error amigable que arrancar una suscripcion con
    // un precio inventado.
    let precio;
    try {
      precio = await calcularPrecioSoulProARS();
    } catch (e) {
      await registrarErrorSilencioso({ contexto: 'api/subscribe: calcularPrecioSoulProARS', error: e, meta: { usuarioId: usuario.usuarioId } });
      return res.status(503).json({ error: 'cotizacion_no_disponible', mensaje: 'No pudimos calcular el precio en pesos en este momento. Probá de nuevo en unos minutos.' });
    }

    let creado;
    try {
      creado = await crearPreapproval({ usuarioId: usuario.usuarioId, email: usuario.email, montoARS: precio.montoARS });
    } catch (e) {
      await registrarErrorSilencioso({ contexto: 'api/subscribe: crearPreapproval', error: e, meta: { usuarioId: usuario.usuarioId } });
      return res.status(502).json({ error: 'no_se_pudo_crear', mensaje: 'No pudimos iniciar la suscripción con Mercado Pago. Probá de nuevo en un rato.' });
    }

    try {
      await registrarPreapprovalPendiente(usuario.usuarioId, creado.preapprovalId);
    } catch (e) {
      // Best-effort: si esto falla, el webhook igual va a poder resolver a
      // la persona por external_reference (usuarioId) cuando llegue
      // subscription_preapproval -- se loguea pero no se corta el flujo,
      // la persona ya tiene el init_point y puede pagar igual.
      await registrarErrorSilencioso({ contexto: 'api/subscribe: registrarPreapprovalPendiente', error: e, meta: { usuarioId: usuario.usuarioId } });
    }

    try {
      await registrarTrazabilidadPrecio({
        usuarioId: usuario.usuarioId,
        preapprovalId: creado.preapprovalId,
        precioUSD: precio.precioUSD,
        cotizacion: precio.cotizacion,
        cotizacionFecha: precio.cotizacionFecha,
        montoARS: precio.montoARS
      });
    } catch (e) {
      // Best-effort, igual que registrarPreapprovalPendiente -- la
      // suscripcion ya se creo en Mercado Pago con el monto correcto, esto
      // es solo el registro de auditoria de como se calculo ese monto.
      await registrarErrorSilencioso({ contexto: 'api/subscribe: registrarTrazabilidadPrecio', error: e, meta: { usuarioId: usuario.usuarioId } });
    }

    return res.status(200).json({ initPoint: creado.initPoint });
  } catch (error) {
    console.error('Error en /api/subscribe:', error);
    await registrarErrorSilencioso({ contexto: 'api/subscribe', error });
    return res.status(500).json({ error: 'Error iniciando la suscripción' });
  }
}
