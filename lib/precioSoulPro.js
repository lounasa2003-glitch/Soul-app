import { obtenerCotizacionUSDARS } from './cotizacionBCRA.js';

// Precio objetivo de Soul Pro en dolares -- constante de configuracion
// server-side, nunca mandada por el cliente (ver api/subscribe.js). Sin
// fallback hardcodeado a proposito: si no esta seteada, se corta con un
// error claro en vez de cobrar un precio "de prueba" por accidente (mismo
// criterio que ya tenia MERCADOPAGO_PRECIO_ARS, que este archivo reemplaza).
function precioObjetivoUSD() {
  const crudo = process.env.SOUL_PRO_PRECIO_USD;
  const numero = Number(crudo);
  if (!crudo || !Number.isFinite(numero) || numero <= 0) {
    throw new Error('Falta o es invalido SOUL_PRO_PRECIO_USD');
  }
  return numero;
}

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
// de precio real (y amerita aviso a la persona, no silencioso) es tocar
// SOUL_PRO_PRECIO_USD -- una variacion del equivalente en ARS por tipo de
// cambio no lo es.
export async function calcularPrecioSoulProARS() {
  const precioUSD = precioObjetivoUSD();
  const { cotizacion, fecha } = await obtenerCotizacionUSDARS();
  const montoARS = redondearARS(precioUSD * cotizacion);
  return { precioUSD, cotizacion, cotizacionFecha: fecha, montoARS };
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
