import crypto from 'crypto';
import { verificarUsuario, TABLAS_PERMITIDAS, filtroDeEscrituraValido, parsearFiltro } from '../lib/authUtil.js';
import { registrarEvento } from '../lib/logEvento.js';
import { notificarConfirmarMail } from '../lib/email.js';

// Tablas con relacion 1:1 con el usuario -- el insert se resuelve como upsert
// atomico (on_conflict=usuario_id) para no depender de un check-then-act
// del lado del cliente, que puede duplicar filas con dos pestanas o un
// doble click. Requiere una constraint UNIQUE(usuario_id) en la tabla.
const TABLAS_UPSERT_POR_DUENIO = new Set(['perfiles']);

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
    let esUpsert = false;
    if (!filtro) {
      // INSERT: el dueño de la fila lo decide el servidor, no el cliente.
      if (tabla === 'usuarios') datosFinales = { ...datos, email: usuario.email };
      else if (tabla === 'matches') datosFinales = { ...datos, usuario_a: usuario.usuarioId };
      else datosFinales = { ...datos, usuario_id: usuario.usuarioId };
      esUpsert = TABLAS_UPSERT_POR_DUENIO.has(tabla);
    } else if (!(await filtroDeEscrituraValido(tabla, filtro, usuario))) {
      return res.status(403).json({ error: 'No autorizado para modificar estos datos' });
    }

    // Mismo motivo que en /api/leer: reconstruir con el valor re-codificado
    // en vez de inyectar el filtro crudo -- un "+" sin re-codificar (comun
    // en emails de gmail con subaddressing) viaja como espacio literal y
    // PostgREST no encuentra la fila a actualizar.
    let url = supabaseUrl + '/rest/v1/' + tabla;
    if (filtro) {
      const { campo, operador, valor } = parsearFiltro(filtro);
      url += `?${campo}=${operador}.${encodeURIComponent(valor)}`;
    }
    if (esUpsert) url += '?on_conflict=usuario_id';

    const response = await fetch(url, {
      method: filtro ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': esUpsert ? 'resolution=merge-duplicates,return=representation' : 'return=representation'
      },
      body: JSON.stringify(datosFinales)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    if (!filtro && tabla === 'usuarios' && data[0]) {
      await registrarEvento({ usuarioId: data[0].id, tipo: 'registro' });
      // Token propio de confirmacion (independiente del de Supabase Auth --
      // ver notificarConfirmarMail en lib/email.js sobre por que). Best-
      // effort: si el mail no sale, la cuenta queda creada igual y puede
      // pedir el reenvio desde la pantalla de "Revisá tu email".
      try {
        const token = crypto.randomBytes(24).toString('hex');
        await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(data[0].id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=minimal' },
          body: JSON.stringify({ token_confirmacion: token })
        });
        await notificarConfirmarMail({ nombre: data[0].nombre, email: data[0].email, token });
      } catch (e) {
        console.error('Error generando/enviando confirmacion de mail:', e);
      }
    } else if (tabla === 'perfiles' && esUpsert) {
      await registrarEvento({ usuarioId: usuario.usuarioId, tipo: 'onboarding_completado' });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error en /api/guardar:', error);
    return res.status(500).json({ error: 'Error al guardar en base de datos' });
  }
}
