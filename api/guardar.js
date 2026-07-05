import { verificarUsuario, TABLAS_PERMITIDAS, filtroDeEscrituraValido } from '../lib/authUtil.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const { tabla, datos, filtro } = req.body;
    if (!Object.prototype.hasOwnProperty.call(TABLAS_PERMITIDAS, tabla)) {
      return res.status(403).json({ error: 'Tabla no permitida' });
    }
    if (tabla !== 'usuarios' && !usuario.usuarioId) {
      return res.status(403).json({ error: 'Todavía no existe tu fila de usuario' });
    }

    let datosFinales = datos;
    if (!filtro) {
      // INSERT: el dueño de la fila lo decide el servidor, no el cliente.
      if (tabla === 'usuarios') datosFinales = { ...datos, email: usuario.email };
      else if (tabla === 'matches') datosFinales = { ...datos, usuario_a: usuario.usuarioId };
      else datosFinales = { ...datos, usuario_id: usuario.usuarioId };
    } else if (!(await filtroDeEscrituraValido(tabla, filtro, usuario))) {
      return res.status(403).json({ error: 'No autorizado para modificar estos datos' });
    }

    const url = filtro
      ? `${supabaseUrl}/rest/v1/${tabla}?${filtro}`
      : `${supabaseUrl}/rest/v1/${tabla}`;

    const response = await fetch(url, {
      method: filtro ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(datosFinales)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: 'Error al guardar en base de datos', details: error.message });
  }
}
