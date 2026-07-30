// TEMPORAL -- diagnostico del 401 intermitente en /api/guardar (incidente
// 2026-07-30). Borrar este archivo, el workflow y el script de prueba en
// cuanto se confirme la causa (ver checklist en la conversacion).
//
// No cambia NINGUN criterio de autenticacion real de la app: es de solo
// lectura, replica exactamente la misma llamada que ya hace verificarUsuario
// en lib/authUtil.js (GET /auth/v1/user con apikey=SUPABASE_ANON_KEY +
// Authorization del usuario bajo diagnostico) y devuelve el resultado
// sanitizado en la respuesta HTTP en vez de silenciarlo en un simple null.
//
// Protegido con una firma HMAC-SHA256 sobre un timestamp, usando
// SUPABASE_SERVICE_ROLE_KEY como secreto -- la MISMA clave que ya existe
// como secret en Vercel y en GitHub Actions, sin agregar ningun secreto
// nuevo. La key nunca viaja en la request (ni como valor ni enmascarada):
// el llamador demuestra que la conoce firmando el timestamp, el servidor
// verifica recalculando la misma firma. Quien ya tiene la service role key
// ya tiene acceso total a la base por diseño (bypassea RLS); este endpoint
// no le da a esa persona ningun privilegio nuevo, solo una lectura
// sanitizada de un diagnostico puntual.
import crypto from 'crypto';

const VENTANA_MS = 2 * 60 * 1000; // tolerancia de reloj para la firma

function timingSafeEqualHex(a, b) {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!serviceKey || !supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'no_configurado' });
  }

  const timestamp = req.headers['x-diagnostico-timestamp'];
  const firma = req.headers['x-diagnostico-firma'];
  if (!timestamp || !firma) {
    return res.status(401).json({ error: 'faltan_headers_firma' });
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > VENTANA_MS) {
    return res.status(401).json({ error: 'firma_vencida' });
  }

  const firmaEsperada = crypto.createHmac('sha256', serviceKey).update(String(timestamp)).digest('hex');
  if (!timingSafeEqualHex(String(firma), firmaEsperada)) {
    return res.status(401).json({ error: 'firma_invalida' });
  }

  // Anti-reuso: una fila por timestamp, misma tabla/patron que ya usa
  // lib/verificarAdmin.js para contar intentos (rate_limits, columnas
  // email/endpoint con UNIQUE(email,endpoint)). Sin on_conflict, un insert
  // repetido con el mismo timestamp choca contra esa constraint y PostgREST
  // devuelve un error -- eso es lo que indica "esta firma ya se uso".
  const headersService = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  const insertNonce = await fetch(`${supabaseUrl}/rest/v1/rate_limits`, {
    method: 'POST',
    headers: headersService,
    body: JSON.stringify({ email: `diag_${timestamp}`, endpoint: 'diagnostico_temporal_hmac', ventana_inicio: new Date().toISOString(), contador: 1 })
  });
  if (!insertNonce.ok) {
    return res.status(401).json({ error: 'firma_reutilizada' });
  }

  const rawAuth = req.headers.authorization || '';
  const token = rawAuth.replace(/^Bearer\s+/i, '');

  let projectRef = '<no parseable>';
  try { projectRef = new URL(supabaseUrl).hostname.split('.')[0]; } catch { /* queda el default */ }

  if (!token) {
    return res.status(200).json({
      tieneAuthorization: false,
      empiezaConBearer: false,
      longitudToken: 0,
      projectRef,
      statusAuthUser: null,
      errorSupabase: null
    });
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}` }
  });

  let errorSupabase = null;
  if (!userRes.ok) {
    try {
      const cuerpo = await userRes.json();
      errorSupabase = {
        code: cuerpo.code || cuerpo.error_code || null,
        msg: cuerpo.msg || cuerpo.message || cuerpo.error_description || cuerpo.error || null
      };
    } catch {
      errorSupabase = { code: null, msg: '<respuesta no-JSON>' };
    }
  }

  // Nunca: token, ninguna clave, email, user.id ni ningun otro dato personal.
  return res.status(200).json({
    tieneAuthorization: !!rawAuth,
    empiezaConBearer: /^Bearer\s+/i.test(rawAuth),
    longitudToken: token.length,
    projectRef,
    statusAuthUser: userRes.status,
    errorSupabase
  });
}
