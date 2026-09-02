import { verificarUsuario } from '../../lib/authUtil.js';
import { registrarErrorSilencioso } from '../../lib/logErrorSilencioso.js';
import { calcularPrecioSoulProARS } from '../../lib/precioSoulPro.js';

// Solo lectura, para que pro.html muestre un equivalente APROXIMADO en ARS
// antes de tocar "Continuar con Mercado Pago". El monto real que se cobra se
// vuelve a calcular de cero en api/subscribe.js en el momento de la alta
// (misma funcion, pero otra llamada) -- este endpoint es puramente
// informativo y nunca decide ni fija el monto real de ningun cobro.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario || !usuario.usuarioId) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const { precioUSD, montoARS, cotizacionFecha } = await calcularPrecioSoulProARS();
    return res.status(200).json({ precioUSD, montoARSAproximado: montoARS, cotizacionFecha });
  } catch (error) {
    await registrarErrorSilencioso({ contexto: 'api/subscription/precio', error });
    return res.status(503).json({ error: 'cotizacion_no_disponible', mensaje: 'No pudimos calcular el precio en pesos en este momento.' });
  }
}
