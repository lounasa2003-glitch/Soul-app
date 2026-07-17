// Filtro simple del lado del servidor para cortar los intentos mas comunes
// y evidentes de fuga del system prompt / inyeccion de instrucciones ANTES
// de mandarle el mensaje al modelo -- complementa (no reemplaza) el bloque
// de blindaje que ya esta al final de todos los prompts conversacionales
// (ver BLINDAJE_PROMPT en soul.html y api/citas.js). Un modelo de lenguaje
// siempre puede en teoria ser convencido con la combinacion de mensajes
// correcta, asi que esta capa server-side corta lo obvio antes de gastar un
// llamado al modelo, y deja un registro para que la administradora pueda
// ver patrones de uso indebido durante el piloto.

const PATRONES_FUGA = [
  // Pedidos directos de revelar/repetir/resumir/parafrasear/traducir las instrucciones
  /repet.{0,15}(tus? )?instruccion/i,
  /(mostrame|muestrame|decime|dime|revela|revelame|comparti|compartime|dame).{0,20}(tu |tus )?(prompt|instruccion|configuracion|system ?prompt)/i,
  /cual(es)? (es|son) tu.{0,20}(prompt|instruccion|configuracion)/i,
  /resum.{0,15}(tus? )?instruccion/i,
  /parafrase.{0,15}(tus? )?instruccion/i,
  /traduc.{0,15}(tus? )?instruccion/i,
  /(what('?s| is) your|show me your|reveal your|print your|repeat your|give me your|tell me your).{0,25}(system ?prompt|instructions|prompt|configuration)/i,
  // "Modo desarrollador" y variantes de jailbreak
  /modo (desarrollador|dios|debug|admin)/i,
  /developer mode/i,
  /\bDAN\b/,
  /jailbreak/i,
  // Inyeccion / cambio de rol
  /ignor.{0,15}(las |tus )?instruccion(es)? (anterior|previa)/i,
  /ignore (all )?(previous|prior|above) instructions/i,
  /olvid.{0,10}(todo lo|lo)? anterior/i,
  /a partir de ahora (sos|eres|vas a ser)/i,
  /from now on you are/i,
  /(actua|comportate|responde) como si (fueras|no fueras soul)/i,
  /pretend (you are|to be)/i,
  /you are now/i,
  /adopta (el|un) rol/i
];

function normalizar(texto) {
  return (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Revisa solo el ultimo mensaje de la persona (no todo el historial -- ya
// paso el filtro en turnos anteriores, y evaluar todo de nuevo cada vez
// solo suma falsos positivos si Soul cito ese mensaje al responder).
export function detectarIntentoDeFuga(texto) {
  if (!texto) return false;
  const t = normalizar(texto);
  return PATRONES_FUGA.some((re) => re.test(t));
}

export const RESPUESTA_INTENTO_FUGA = 'Prefiero seguir siendo yo en esta charla. ¿Seguimos con lo que estábamos hablando?';

export async function registrarIntentoFuga(usuarioId, mensaje, endpoint) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    await fetch(`${supabaseUrl}/rest/v1/intentos_fuga_prompt`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ usuario_id: usuarioId, mensaje: String(mensaje).slice(0, 2000), endpoint: endpoint || null })
    });
  } catch (e) {
    console.error('Error registrando intento de fuga:', e);
  }
}
