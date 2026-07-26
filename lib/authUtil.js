// Vercel solo convierte en endpoint publico los archivos dentro de /api,
// asi que este helper compartido vive afuera para no quedar expuesto como ruta.

import { chequearRecordatoriosIntake } from './recordatorioIntake.js';
import { chequearRecordatoriosMatches } from './recordatorioMatches.js';

export const TABLAS_PERMITIDAS = {
  usuarios: 'email',
  perfiles: 'usuario_id',
  conversaciones: 'usuario_id',
  matches: 'usuario_a',
  feedback_piloto: 'usuario_id',
  reportes_tecnicos: 'usuario_id'
};

// Valida el token de sesion de Supabase Auth y resuelve la fila de 'usuarios'
// ligada a ese email. Devuelve null si el token no es valido.
export async function verificarUsuario(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` }
  });
  if (!userRes.ok) return null;
  const authUser = await userRes.json();
  if (!authUser.email) return null;

  const rowRes = await fetch(
    `${supabaseUrl}/rest/v1/usuarios?select=id,analisis_usados,ultima_actividad,mail_confirmado,etapa_actual,plan,eliminacion_solicitada_en&email=eq.${encodeURIComponent(authUser.email)}`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const rows = rowRes.ok ? await rowRes.json() : [];
  const fila = rows[0];

  // Apenas se pide el borrado (ver accion 'solicitarBorrado' en api/auth.js)
  // la cuenta deja de ser accesible de inmediato, aunque el purgado real de
  // datos recien pase a los 30 dias (ver el cron en
  // api/cron/diagnostico-diario.js y la promesa en legal.html). Tratarla
  // como sesion invalida ahora mismo evita tener que agregar este chequeo en
  // cada endpoint por separado.
  if (fila && fila.eliminacion_solicitada_en) return null;

  // Se actualiza acá porque este helper corre en CADA request autenticado
  // de la app (no solo en la cita, que ya lo hacía por su cuenta para el
  // chequeo de "activo ahora") -- asi "ultima actividad" sirve para medir
  // retencion real durante el piloto. Throttleado a como maximo una
  // escritura por minuto por persona: la inmensa mayoria de los requests
  // ve una ultima_actividad reciente y no escribe nada, asi que el costo
  // extra de latencia solo se paga aprox. una vez por minuto de uso activo.
  if (fila) {
    const ultima = fila.ultima_actividad ? new Date(fila.ultima_actividad).getTime() : 0;
    if (Date.now() - ultima > 60000) {
      await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(fila.id)}`, {
        method: 'PATCH',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ ultima_actividad: new Date().toISOString() })
      }).catch(() => {});
    }
  }

  // Recordatorio a quien dejó la Etapa 1 (datos básicos) a medias -- sin
  // esperar la promesa, no debe agregar latencia a un request que no tiene
  // nada que ver con esto. Throttleado internamente, ver
  // lib/recordatorioIntake.js sobre por qué va acá y no en un cron.
  chequearRecordatoriosIntake(supabaseUrl, supabaseKey).catch(() => {});

  // Mismo criterio: recordatorio para matches sin elección y citas sin
  // primer mensaje. Ver lib/recordatorioMatches.js.
  chequearRecordatoriosMatches(supabaseUrl, supabaseKey).catch(() => {});

  return {
    email: authUser.email,
    // El token de sesion tal cual llego, para reenviarlo a Postgres en vez
    // del anon key en las tablas que ya tienen politica RLS real -- ver
    // migracion_rls_conversaciones.sql. Nunca se usa para autenticar contra
    // Supabase Auth de nuevo (eso ya paso arriba); solo viaja como
    // Authorization de la llamada REST siguiente, dentro del mismo request.
    token,
    // El id real de Supabase Auth -- NO es lo mismo que usuarioId (fila.id
    // de la tabla 'usuarios' es un uuid propio de la app, generado aparte).
    // Se guarda en usuarios.auth_id (ver migracion_rls_auth_id.sql) para que
    // las politicas RLS puedan usar auth.uid() = auth_id en vez de intentar
    // comparar contra usuarioId, que nunca va a coincidir.
    authId: authUser.id,
    usuarioId: fila ? fila.id : null,
    analisisUsados: fila ? fila.analisis_usados : 0,
    // Con "Confirm email" apagado en Supabase, el registro da sesion
    // inmediata y Supabase marca la cuenta como confirmada en el momento
    // del alta, sin importar si la persona toco el link real -- ese dato
    // ya no sirve para nada. Este flag es propio (usuarios.mail_confirmado,
    // ver lib/email.js y api/auth.js), y es lo que de verdad permite
    // frenar mas adelante (matches, citas) sin bloquear el onboarding/chat
    // con Soul, que no involucra a otra persona real. Si todavia no existe
    // la fila (recien registrada, antes del primer /api/guardar), el
    // default seguro es "no confirmado".
    emailConfirmado: fila ? !!fila.mail_confirmado : false,
    // 'nuevo' (o sin fila todavia) significa que todavia no termino la
    // Etapa 1 (datos basicos) -- lo usa api/chat.js para no dejar
    // conversar con Soul antes de eso, sin importar que mande el cliente.
    etapaActual: fila ? fila.etapa_actual : 'nuevo',
    // Default 'free' si todavia no existe la fila -- mismo default que la
    // columna en la base (ver migracion_plan_free_pro.sql). No hay pago
    // conectado todavia: por ahora el plan se cambia a mano desde el panel
    // admin (PATCH /api/admin/personas), ver panel-admin.html.
    plan: fila ? (fila.plan || 'free') : 'free'
  };
}

// Parsea un filtro estilo PostgREST "campo=operador.valor" (ej. "usuario_id=eq.123").
export function parsearFiltro(filtro) {
  if (!filtro) return null;
  const m = /^(\w+)=(eq|neq)\.(.+)$/.exec(filtro);
  if (!m) return null;
  return { campo: m[1], operador: m[2], valor: m[3] };
}

// Confirma que un filtro de lectura solo pida datos propios (o, para 'perfiles',
// el conjunto explicito de "todos menos yo" que necesita el calculo de matches).
export function filtroDeLecturaValido(tabla, filtro, usuario) {
  const parsed = parsearFiltro(filtro);
  if (!parsed) return false;
  const { campo, operador, valor } = parsed;

  if (tabla === 'usuarios') {
    if (campo === 'email' && operador === 'eq' && valor === usuario.email) return true;
    if (campo === 'id' && operador === 'eq' && valor === usuario.usuarioId) return true;
    return false;
  }
  if (campo !== TABLAS_PERMITIDAS[tabla]) return false;
  if (operador === 'eq') return valor === usuario.usuarioId;
  if (operador === 'neq') return tabla === 'perfiles' && valor === usuario.usuarioId;
  return false;
}

// Confirma que un filtro de escritura (UPDATE) solo apunte a datos propios.
// 'conversaciones' se actualiza por su propio id (no por usuario_id), asi que
// ese caso requiere ir a buscar la fila y confirmar que el dueno coincide.
export async function filtroDeEscrituraValido(tabla, filtro, usuario) {
  const parsed = parsearFiltro(filtro);
  if (!parsed) return false;
  const { campo, operador, valor } = parsed;
  if (operador !== 'eq') return false;

  if (tabla === 'usuarios') {
    if (campo === 'email') return valor === usuario.email;
    if (campo === 'id') return valor === usuario.usuarioId;
    return false;
  }
  if (campo === TABLAS_PERMITIDAS[tabla]) return valor === usuario.usuarioId;

  if (tabla === 'conversaciones' && campo === 'id') {
    // 'conversaciones' ya tiene politica RLS real (ver
    // migracion_rls_conversaciones.sql) -- con el anon key esta consulta
    // siempre devolveria 0 filas (auth.uid() nulo no matchea la politica),
    // asi que tiene que ir con el token propio de la persona, igual que en
    // api/leer.js y api/guardar.js.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const res = await fetch(
      `${supabaseUrl}/rest/v1/conversaciones?select=usuario_id&id=eq.${encodeURIComponent(valor)}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${usuario.token}` } }
    );
    const rows = res.ok ? await res.json() : [];
    return rows.length > 0 && rows[0].usuario_id === usuario.usuarioId;
  }

  // 'matches' se actualiza por su propio id (para registrar la respuesta de
  // la persona a SU match), no por usuario_a -- requiere ir a buscar la fila
  // y confirmar que quien pide el cambio es efectivamente usuario_a.
  if (tabla === 'matches' && campo === 'id') {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const res = await fetch(
      `${supabaseUrl}/rest/v1/matches?select=usuario_a&id=eq.${encodeURIComponent(valor)}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const rows = res.ok ? await res.json() : [];
    return rows.length > 0 && rows[0].usuario_a === usuario.usuarioId;
  }

  return false;
}
