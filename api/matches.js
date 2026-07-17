import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaude } from '../lib/anthropicClient.js';

// Fusiona lo que antes eran misMatches.js, elegirMatch.js y cerrarMatch.js
// en un solo archivo -- el plan Hobby de Vercel permite como maximo 12
// funciones serverless por deploy, y el proyecto ya estaba por encima de
// eso. GET lista los matches propios; POST con "accion" decide o cierra.
//
// Endpoint dedicado (no el /api/leer o /api/guardar genericos) porque esos
// solo autorizan lecturas/escrituras por 'usuario_a' (ver TABLAS_PERMITIDAS
// en lib/authUtil.js), y acá hace falta que 'usuario_b' también pueda leer
// y decidir sobre sus propios matches. Mismo patrón que api/chat.js usa
// para su validación extra: consulta propia en vez de forzar el caso en el
// validador compartido.

// Resuelve nombre (o email si nunca guardaron "nombre") de la otra persona
// de cada match -- mismo fallback ya usado en api/admin/personas.js y en
// listarMisCitas de api/citas.js. Hace falta para las etiquetas de la
// pantalla de "varios pendientes" en soul.html ("Match nuevo con X", etc.)
// sin que el cliente tenga que pedirlo aparte.
async function listarMisMatches(req, res, supabaseUrl, headers, usuario) {
  const idEnc = encodeURIComponent(usuario.usuarioId);
  const response = await fetch(
    `${supabaseUrl}/rest/v1/matches?select=*&or=(usuario_a.eq.${idEnc},usuario_b.eq.${idEnc})`,
    { headers }
  );
  const matches = response.ok ? await response.json() : [];
  if (matches.length === 0) return res.status(200).json({ matches: [] });

  const otrosIds = [...new Set(matches.map(m => (m.usuario_a === usuario.usuarioId ? m.usuario_b : m.usuario_a)))];
  let nombrePorId = {};
  if (otrosIds.length > 0) {
    const usuariosRes = await fetch(
      `${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email&id=in.(${otrosIds.map(encodeURIComponent).join(',')})`,
      { headers }
    );
    const usuarios = usuariosRes.ok ? await usuariosRes.json() : [];
    usuarios.forEach(u => { nombrePorId[u.id] = u.nombre || u.email || null; });
  }
  const matchesConNombre = matches
    // Un match que ESTA persona eliminó deja de aparecer en su propia
    // lista -- la otra persona (si no fue quien eliminó) lo sigue viendo
    // igual que antes, ver eliminarMatch() para el resto del efecto.
    .filter(m => m.eliminado_por !== usuario.usuarioId)
    .map(m => {
      const otraId = m.usuario_a === usuario.usuarioId ? m.usuario_b : m.usuario_a;
      return { ...m, otra_persona_id: otraId, otra_persona_nombre: nombrePorId[otraId] || null };
    });

  return res.status(200).json({ matches: matchesConNombre });
}

// "Eliminar" un match desde la pantalla de Matches: deja de aparecer en la
// lista de quien lo eliminó (no en la de la otra persona, que puede seguir
// viendo el historial) y bloquea cualquier mensaje nuevo entre las dos
// partes (ver el chequeo de eliminado_por en enviarMensaje, api/citas.js) --
// "una especie de borrado y bloqueado", sin avisarle explícitamente a la
// otra persona que fue bloqueada.
async function eliminarMatch(req, res, supabaseUrl, headers, usuario) {
  const { matchId } = req.body;
  if (!matchId) return res.status(400).json({ error: 'Falta matchId' });
  const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b,eliminado_por&id=eq.${encodeURIComponent(matchId)}`, { headers });
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  if (match.usuario_a !== usuario.usuarioId && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  if (!match.eliminado_por) {
    await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ eliminado_por: usuario.usuarioId })
    });
  }
  return res.status(200).json({ ok: true });
}

const PRESENTACION_PERFIL_PROMPT = `Sos Soul. Vas a presentar a una persona a alguien que está por decidir si quiere conocerla -- todavía no se conocieron. Escribí una bio breve y cálida (2-3 frases), en tercera persona, a partir del perfil real que te paso. Nunca menciones puntajes, módulos, diagnósticos ni jerga técnica -- es una primera impresión humana, no un informe. Si algo del perfil no da para una frase natural, omitilo en vez de forzarlo. Respondé solo con el texto de la bio, sin comillas ni markdown.`;

function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const nacimiento = new Date(fechaNacimiento);
  if (isNaN(nacimiento.getTime())) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const noCumplioAun = hoy.getMonth() < nacimiento.getMonth() ||
    (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate());
  if (noCumplioAun) edad--;
  return edad;
}

// Introduccion humana de la otra persona (nombre, edad, bio breve, foto)
// antes de decidir si avanzar con el match -- info parcial e introductoria
// a proposito, nunca el perfil psicologico completo (eso ya tiene su
// momento mas adelante en el flujo). Se genera en el momento, sin cachear
// -- es un llamado unico por decision de match, volumen bajo.
async function obtenerPresentacion(req, res, supabaseUrl, headers, usuario) {
  const { presentacionMatchId } = req.query;
  const matchRes = await fetch(
    `${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&id=eq.${encodeURIComponent(presentacionMatchId)}`,
    { headers }
  );
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  if (match.usuario_a !== usuario.usuarioId && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  const otraId = match.usuario_a === usuario.usuarioId ? match.usuario_b : match.usuario_a;

  const [otraRes, perfilRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/usuarios?select=nombre,fecha_nacimiento,foto_cara,foto_aprobada&id=eq.${encodeURIComponent(otraId)}`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/perfiles?select=grupo1,grupo2&usuario_id=eq.${encodeURIComponent(otraId)}`, { headers })
  ]);
  const otras = otraRes.ok ? await otraRes.json() : [];
  const otra = otras[0];
  if (!otra) return res.status(404).json({ error: 'Perfil no encontrado' });
  const perfiles = perfilRes.ok ? await perfilRes.json() : [];
  const perfil = perfiles[0];

  let bio = null;
  if (perfil && (perfil.grupo1 || perfil.grupo2)) {
    try {
      const data = await llamarClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: PRESENTACION_PERFIL_PROMPT,
        messages: [{ role: 'user', content: 'Perfil: ' + JSON.stringify({ grupo1: perfil.grupo1, grupo2: perfil.grupo2 }) }]
      });
      bio = (data.content || []).map(b => b.text || '').join('').trim() || null;
    } catch (e) {
      console.error('Error generando bio de presentación:', e);
    }
  }

  return res.status(200).json({
    nombre: otra.nombre || null,
    edad: calcularEdad(otra.fecha_nacimiento),
    // Solo se manda la foto si la persona autorizó explícitamente que se
    // muestre en la presentación de un match -- sin esa aprobación, la foto
    // existe (para el perfil interno) pero no viaja a la otra persona.
    foto: otra.foto_aprobada ? (otra.foto_cara || null) : null,
    bio
  });
}

async function elegir(req, res, supabaseUrl, headers, usuario) {
  const { matchId, eleccion } = req.body;
  if (!matchId || (eleccion !== 'acepta' && eleccion !== 'rechaza')) {
    return res.status(400).json({ error: 'Faltan datos o elección inválida' });
  }
  const idEnc = encodeURIComponent(matchId);

  const filaRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=*&id=eq.${idEnc}`, { headers });
  const filas = filaRes.ok ? await filaRes.json() : [];
  const match = filas[0];
  if (!match) {
    return res.status(404).json({ error: 'Match no encontrado' });
  }

  const soyA = match.usuario_a === usuario.usuarioId;
  const soyB = match.usuario_b === usuario.usuarioId;
  if (!soyA && !soyB) {
    return res.status(403).json({ error: 'No autorizado para decidir sobre este match' });
  }
  if (match.estado !== 'activo') {
    return res.status(409).json({ error: 'match_no_activo', mensaje: 'Este match ya no está esperando tu decisión.' });
  }

  const campoPropio = soyA ? 'eleccion_usuario_a' : 'eleccion_usuario_b';
  const campoAjeno = soyA ? 'eleccion_usuario_b' : 'eleccion_usuario_a';
  const eleccionAjena = match[campoAjeno] || 'pendiente';

  const datosPatch = { [campoPropio]: eleccion };

  let estadoResultante = 'pendiente';
  if (eleccionAjena !== 'pendiente') {
    estadoResultante = (eleccion === 'acepta' && eleccionAjena === 'acepta') ? 'mutuamente_aceptado' : 'no_avanza';
    datosPatch.estado = estadoResultante;
  }

  const patchRes = await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${idEnc}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(datosPatch)
  });
  if (!patchRes.ok) {
    console.error('Error guardando elección de match:', patchRes.status, await patchRes.text());
    return res.status(500).json({ error: 'No se pudo guardar tu elección' });
  }

  // Se crea la cita y se marca la etapa de las dos personas server-side,
  // en el momento mismo del acuerdo mutuo -- mismo principio que ya
  // aplicamos para 'match': no depende de que ninguna de las dos vuelva a
  // loguearse para que el panel y el chequeo de login reflejen esto.
  if (estadoResultante === 'mutuamente_aceptado') {
    try {
      const citaRes = await fetch(`${supabaseUrl}/rest/v1/citas`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ match_id: matchId })
      });
      const citas = citaRes.ok ? await citaRes.json() : [];
      const citaCreada = citas[0];
      // Primer mensaje de la sala -- encuadra el momento antes de que
      // cualquiera de las dos personas escriba algo. Mismo texto que se usa
      // al abrir cada encuentro nuevo dentro de la Sala de Encuentros (ver
      // decidirSalaEncuentros en api/citas.js).
      if (citaCreada) {
        await fetch(`${supabaseUrl}/rest/v1/cita_mensajes`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ cita_id: citaCreada.id, usuario_id: null, tipo: 'texto', contenido: 'No busquen impresionar. Intenten descubrir si disfrutan conversar.' })
        });
      }
    } catch (e) {
      console.error('Error creando la cita o su mensaje de apertura:', e);
    }
    await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(match.usuario_a)}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ etapa_actual: 'cita' })
      }),
      fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(match.usuario_b)}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ etapa_actual: 'cita' })
      })
    ]).catch(() => {});
  }

  return res.status(200).json({ estado: estadoResultante });
}

async function cerrar(req, res, supabaseUrl, headers, usuario) {
  const { matchId } = req.body;
  if (!matchId) {
    return res.status(400).json({ error: 'Falta matchId' });
  }
  const idEnc = encodeURIComponent(matchId);

  const filaRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b,estado&id=eq.${idEnc}`, { headers });
  const filas = filaRes.ok ? await filaRes.json() : [];
  const match = filas[0];
  if (!match) {
    return res.status(404).json({ error: 'Match no encontrado' });
  }
  if (match.usuario_a !== usuario.usuarioId && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  if (match.estado === 'no_avanza') {
    await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${idEnc}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: 'cerrado' })
    });
  }

  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario || !usuario.usuarioId) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

    if (req.method === 'GET') {
      if (req.query.presentacionMatchId) {
        return await obtenerPresentacion(req, res, supabaseUrl, headers, usuario);
      }
      return await listarMisMatches(req, res, supabaseUrl, headers, usuario);
    }
    if (req.method === 'POST') {
      const { accion } = req.body;
      if (accion === 'elegir') return await elegir(req, res, supabaseUrl, headers, usuario);
      if (accion === 'cerrar') return await cerrar(req, res, supabaseUrl, headers, usuario);
      if (accion === 'eliminarMatch') return await eliminarMatch(req, res, supabaseUrl, headers, usuario);
      return res.status(400).json({ error: 'Acción no válida' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error en /api/matches:', error);
    return res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
}
