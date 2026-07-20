import { verificarUsuario, TABLAS_PERMITIDAS, filtroDeLecturaValido, parsearFiltro } from '../lib/authUtil.js';
import { registrarErrorSilencioso } from '../lib/logErrorSilencioso.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
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

    const { tabla, filtro } = req.query;
    if (!Object.prototype.hasOwnProperty.call(TABLAS_PERMITIDAS, tabla)) {
      return res.status(403).json({ error: 'Tabla no permitida' });
    }

    let filtroFinal = filtro;
    if (!filtroFinal && tabla !== 'usuarios') {
      filtroFinal = 'usuario_id=eq.' + usuario.usuarioId;
    }
    if (tabla === 'usuarios' && !usuario.usuarioId && !filtroFinal) {
      filtroFinal = 'email=eq.' + usuario.email;
    }

    if (!filtroDeLecturaValido(tabla, filtroFinal, usuario)) {
      return res.status(403).json({ error: 'No autorizado para leer estos datos' });
    }

    // Reconstruir el filtro con el valor re-codificado -- si vino con
    // caracteres como "+" (comun en emails de gmail con subaddressing), el
    // "+" sin re-codificar viaja literal en la URL saliente y PostgREST lo
    // interpreta como espacio, haciendo que la busqueda no encuentre nada
    // aunque la fila exista.
    const { campo, operador, valor } = parsearFiltro(filtroFinal);
    const url = `${supabaseUrl}/rest/v1/${tabla}?select=*&${campo}=${operador}.${encodeURIComponent(valor)}`;

    const response = await fetch(url, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error en /api/leer:', error);
    await registrarErrorSilencioso({ contexto: 'api/leer', error });
    return res.status(500).json({ error: 'Error al leer base de datos' });
  }
}
