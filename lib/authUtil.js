// Vercel solo convierte en endpoint publico los archivos dentro de /api,
// asi que este helper compartido vive afuera para no quedar expuesto como ruta.

export const TABLAS_PERMITIDAS = {
  usuarios: 'email',
  perfiles: 'usuario_id',
  conversaciones: 'usuario_id',
  matches: 'usuario_a'
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
    `${supabaseUrl}/rest/v1/usuarios?select=id&email=eq.${encodeURIComponent(authUser.email)}`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const rows = rowRes.ok ? await rowRes.json() : [];
  return { email: authUser.email, usuarioId: rows[0] ? rows[0].id : null };
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
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const res = await fetch(
      `${supabaseUrl}/rest/v1/conversaciones?select=usuario_id&id=eq.${encodeURIComponent(valor)}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const rows = res.ok ? await res.json() : [];
    return rows.length > 0 && rows[0].usuario_id === usuario.usuarioId;
  }

  return false;
}
