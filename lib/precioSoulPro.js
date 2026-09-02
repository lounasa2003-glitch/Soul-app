import { obtenerCotizacionUSDARS } from './cotizacionBCRA.js';

// Precio objetivo de Soul Pro en dolares -- decision comercial, no un
// secreto (a diferencia del access token o el webhook secret de Mercado
// Pago, que si siguen siendo variables de entorno). Constante server-side
// en vez de env var: en el Preview de Vercel la env var quedaba cargada con
// scope "Preview" pero el runtime nunca la veia (process.env.SOUL_PRO_PRECIO_USD
// resultaba undefined pese a redeploys y a un build 100% nuevo, confirmado
// con un diagnostico temporal) -- para un valor que no es sensible, una
// constante en el codigo es mas simple y mas confiable que perseguir ese
// problema de configuracion.
const SOUL_PRO_PRECIO_USD = 8.99;

// Redondeo consistente: al peso entero mas cercano. A la escala del tipo de
// cambio actual (miles de pesos por dolar), un centavo no tiene significado
// practico -- redondear a entero es lo mas simple de calcular igual siempre
// y lo mas facil de auditar despues.
function redondearARS(monto) {
  return Math.round(monto);
}

// Calcula, con la cotizacion oficial del momento, cuanto hay que cobrar en
// ARS para llegar al precio objetivo en USD. Se llama UNA sola vez por alta
// nueva (api/subscribe.js) -- el monto resultante queda fijo en el
// preapproval creado en Mercado Pago.
//
// Decision comercial (no solo tecnica): el precio de REFERENCIA siempre es
// SOUL_PRO_PRECIO_USD -- el equivalente en ARS puede actualizarse entre
// renovaciones para seguir esa referencia a medida que cambia la
// cotizacion. Por ahora ningun sync posterior (ver
// lib/suscripcionesMercadoPago.js) vuelve a llamar a esta funcion ni toca
// transaction_amount de una suscripcion ya autorizada -- la actualizacion
// automatica de renovaciones esta pendiente de validar en sandbox (como
// aplica MP un PUT /preapproval/{id} con nuevo transaction_amount: si rige
// desde la proxima renovacion, si dispara un cobro inmediato, si exige
// nueva autorizacion) antes de implementarla. Lo unico que SI es un cambio
// de precio real (y amerita aviso a la persona, no silencioso) es tocar la
// constante SOUL_PRO_PRECIO_USD -- una variacion del equivalente en ARS por
// tipo de cambio no lo es. El monto en ARS NUNCA se hardcodea: sale siempre
// de multiplicar esa constante por la cotizacion que devuelve el BCRA en
// el momento del calculo.
export async function calcularPrecioSoulProARS() {
  const { cotizacion, fecha } = await obtenerCotizacionUSDARS();
  const montoARS = redondearARS(SOUL_PRO_PRECIO_USD * cotizacion);
  return { precioUSD: SOUL_PRO_PRECIO_USD, cotizacion, cotizacionFecha: fecha, montoARS };
}

// Trazabilidad minima de la conversion usada en cada alta -- insert-only en
// una tabla separada (mp_precios_alta, ver migracion_mp_precios_alta.sql),
// NO en 'usuarios': 'usuarios' representa el estado actual (se sobreescribe
// en cada sync), mientras que esto es un registro historico de un evento
// puntual (que cotizacion se uso para fijar ESTE monto en ESTA alta). Poner
// esto en 'usuarios' perderia el historial en la primera renovacion/resync,
// y una persona puede cancelar y volver a suscribirse mas adelante con otra
// cotizacion. Best-effort: si esto falla no aborta el alta (ver
// api/subscribe.js), solo se loguea.
export async function registrarTrazabilidadPrecio({ usuarioId, preapprovalId, precioUSD, cotizacion, cotizacionFecha, montoARS }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${supabaseUrl}/rest/v1/mp_precios_alta`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      usuario_id: usuarioId,
      mp_preapproval_id: preapprovalId,
      precio_objetivo_usd: precioUSD,
      cotizacion_usd_ars: cotizacion,
      monto_ars: montoARS,
      cotizacion_fecha: cotizacionFecha
    })
  });
  if (!res.ok) {
    throw new Error(`No se pudo registrar trazabilidad de precio: HTTP ${res.status} ${await res.text()}`);
  }
}
