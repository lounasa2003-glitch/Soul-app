// Cotizacion oficial USD/ARS para calcular el precio de Soul Pro en pesos a
// partir del precio objetivo en dolares (ver lib/precioSoulPro.js).
//
// Fuente elegida: API de Estadisticas Cambiarias del BCRA (Banco Central de
// la Republica Argentina) -- https://estadisticas-cambiarias.bcra.apidocs.ar/.
// Es la fuente oficial/bancaria del pais: publica, sin autenticacion ni
// costo, mantenida por el propio Banco Central. El valor que devuelve
// (tipoCotizacion) es el tipo de cambio de referencia de la Comunicacion A
// 3500 -- el dolar oficial/mayorista, NO el dolar blue ni un agregador de
// terceros. Confirmado con una llamada real en esta sesion: responde JSON
// con {results:[{fecha, detalle:[{codigoMoneda:"USD", tipoCotizacion}]}]}.
const BCRA_URL = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD';

// Cacheado en memoria del modulo, misma idea que tokenCacheado en
// lib/googlePlay.js -- el BCRA publica esto una vez por dia habil, no hace
// falta pedirlo en cada request. 10 minutos evita golpear la API del Central
// en rafagas de altas o de gente mirando pro.html, sin arriesgarse a
// mostrar/cobrar un valor desactualizado por horas.
let cache = { cotizacion: null, fecha: null, expiraEnMs: 0 };
const CACHE_MS = 10 * 60 * 1000;

// Nunca inventa un valor: si el BCRA no responde, tarda demas, o el shape de
// la respuesta no es el esperado, tira -- quien llama (lib/precioSoulPro.js)
// tiene que tratar eso como "no se pudo calcular el precio", nunca seguir
// adelante con un numero puesto a mano.
export async function obtenerCotizacionUSDARS() {
  if (cache.cotizacion && Date.now() < cache.expiraEnMs) {
    return { cotizacion: cache.cotizacion, fecha: cache.fecha };
  }

  const res = await fetch(BCRA_URL);
  if (!res.ok) {
    throw new Error(`BCRA respondio HTTP ${res.status}`);
  }
  const data = await res.json();
  const resultado = data && Array.isArray(data.results) && data.results[0];
  const detalle = resultado && Array.isArray(resultado.detalle) && resultado.detalle.find((d) => d.codigoMoneda === 'USD');
  const cotizacion = detalle ? Number(detalle.tipoCotizacion) : null;
  const fecha = resultado && resultado.fecha;

  if (!cotizacion || !Number.isFinite(cotizacion) || cotizacion <= 0 || !fecha) {
    throw new Error('Respuesta del BCRA con formato inesperado');
  }

  cache = { cotizacion, fecha, expiraEnMs: Date.now() + CACHE_MS };
  return { cotizacion, fecha };
}
