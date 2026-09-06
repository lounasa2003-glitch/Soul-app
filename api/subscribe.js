import { verificarUsuario } from '../lib/authUtil.js';
import { chequearLimite } from '../lib/rateLimit.js';
import { registrarErrorSilencioso } from '../lib/logErrorSilencioso.js';
import { crearPreapproval, obtenerPreapproval } from '../lib/mercadoPago.js';
import { registrarPreapprovalPendiente, buscarUsuarioPorId, aplicarSuscripcionAUsuario } from '../lib/suscripcionesMercadoPago.js';
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

    // Esta ruta ya existe y Vercel la publica de forma estable. El modo sync
    // solo consulta y aplica un preapproval ya creado: nunca calcula precio,
    // crea una suscripcion ni devuelve un init_point.
    const esSincronizacion = req.body && req.body.accion === 'sync';
    const limiteInfo = await chequearLimite(
      usuario.email,
      esSincronizacion ? 'mp_sync' : 'mp_subscribe',
      esSincronizacion ? 30 : 10,
      3600
    );
    if (!limiteInfo.permitido) {
      return res.status(429).json({ error: 'limite_alcanzado', mensaje: 'Demasiados intentos. Esperá un toque y volvé a intentar.' });
    }

    if (esSincronizacion) {
      const preapprovalId = req.body && typeof req.body.preapprovalId === 'string'
        ? req.body.preapprovalId.trim()
        : '';

      if (!preapprovalId || !/^[A-Za-z0-9_-]{1,128}$/.test(preapprovalId)) {
        return res.status(400).json({ error: 'preapproval_id_invalido', mensaje: 'No recibimos una suscripción válida para verificar.' });
      }

      let datosMP;
      try {
        datosMP = await obtenerPreapproval(preapprovalId);
      } catch (e) {
        await registrarErrorSilencioso({ contexto: 'api/subscribe: sincronizar preapproval', error: e, meta: { usuarioId: usuario.usuarioId } });
        return res.status(502).json({ error: 'no_se_pudo_verificar', mensaje: 'No pudimos confirmar el estado con Mercado Pago. Probá de nuevo en un rato.' });
      }

      if (!datosMP) {
        return res.status(404).json({ error: 'suscripcion_no_encontrada', mensaje: 'Mercado Pago no reconoce esta suscripción.' });
      }

      if (String(datosMP.external_reference || '') !== String(usuario.usuarioId)) {
        await registrarErrorSilencioso({ contexto: 'api/subscribe: external_reference de sync no coincide', error: new Error('external_reference_no_coincide'), meta: { usuarioId: usuario.usuarioId } });
        return res.status(403).json({ error: 'suscripcion_no_pertenece_al_usuario', mensaje: 'La suscripción aprobada corresponde a otra cuenta de Soul.' });
      }

      const campos = await aplicarSuscripcionAUsuario(usuario.usuarioId, preapprovalId, datosMP);
      return res.status(200).json({ ok: true, plan: campos.plan || 'free', estadoMercadoPago: campos.mp_status });
    }

    // Antes de crear otra suscripcion, se reconcilia cualquier preapproval ya
    // vinculado. Esto evita que un segundo clic sobrescriba el id de una
    // suscripcion que acaba de ser autorizada pero cuyo webhook/retorno aun no
    // actualizo Soul. Si sigue pending, se reutiliza su mismo init_point.
    const filaActual = await buscarUsuarioPorId(usuario.usuarioId);
    if (filaActual && filaActual.plan_origen === 'mercadopago' && usuario.plan === 'pro') {
      return res.status(200).json({ ok: true, yaActivo: true });
    }

    if (filaActual && filaActual.mp_preapproval_id) {
      let existente;
      try {
        existente = await obtenerPreapproval(filaActual.mp_preapproval_id);
      } catch (e) {
        await registrarErrorSilencioso({ contexto: 'api/subscribe: verificar preapproval existente', error: e, meta: { usuarioId: usuario.usuarioId } });
        return res.status(502).json({ error: 'no_se_pudo_verificar', mensaje: 'No pudimos verificar tu suscripción anterior. Probá de nuevo en unos minutos.' });
      }

      if (existente) {
        if (String(existente.external_reference || '') !== String(usuario.usuarioId)) {
          await registrarErrorSilencioso({ contexto: 'api/subscribe: external_reference no coincide', error: new Error('external_reference_no_coincide'), meta: { usuarioId: usuario.usuarioId } });
          return res.status(409).json({ error: 'suscripcion_no_coincide', mensaje: 'No pudimos verificar la suscripción asociada a esta cuenta.' });
        }

        if (existente.status === 'authorized') {
          await aplicarSuscripcionAUsuario(usuario.usuarioId, filaActual.mp_preapproval_id, existente);
          return res.status(200).json({ ok: true, yaActivo: true });
        }

        if (existente.status === 'pending' && existente.init_point) {
          return res.status(200).json({ initPoint: existente.init_point, yaPendiente: true });
        }

        if (existente.status === 'paused' || existente.status === 'cancelled') {
          await aplicarSuscripcionAUsuario(usuario.usuarioId, filaActual.mp_preapproval_id, existente);
        } else if (existente.status !== 'pending') {
          return res.status(409).json({ error: 'suscripcion_en_revision', mensaje: 'Tu suscripción anterior todavía está siendo verificada.' });
        }
      }
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
