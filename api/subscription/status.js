import { verificarUsuario } from '../../lib/authUtil.js';
import { registrarErrorSilencioso } from '../../lib/logErrorSilencioso.js';
import { buscarUsuarioPorId } from '../../lib/suscripcionesMercadoPago.js';

// Solo lectura -- lo que ve pro.html para mostrar "sos Pro", proxima
// renovacion, etc. Nunca activa ni cambia nada; el unico lugar que escribe
// 'plan' es lib/suscripcionesMercadoPago.js, siempre a partir de un GET
// fresco a la API de Mercado Pago.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario || !usuario.usuarioId) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const res2 = await fetch(
      `${supabaseUrl}/rest/v1/usuarios?select=plan,plan_origen,mp_status,plan_vencimiento,plan_auto_renueva&id=eq.${encodeURIComponent(usuario.usuarioId)}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${usuario.token}` } }
    );
    const filas = res2.ok ? await res2.json() : [];
    const fila = filas[0] || {};

    return res.status(200).json({
      plan: fila.plan || 'free',
      origen: fila.plan_origen || null,
      estadoMercadoPago: fila.mp_status || null,
      proximaRenovacion: fila.plan_vencimiento || null,
      autoRenueva: !!fila.plan_auto_renueva
    });
  } catch (error) {
    console.error('Error en /api/subscription/status:', error);
    await registrarErrorSilencioso({ contexto: 'api/subscription/status', error });
    return res.status(500).json({ error: 'Error consultando la suscripción' });
  }
}
