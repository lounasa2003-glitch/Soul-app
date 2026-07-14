import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaude } from '../lib/anthropicClient.js';
import { registrarUsoTokens } from '../lib/logUso.js';

// Endpoint dedicado para la cita virtual asincronica -- mismo motivo que
// api/matches.js: hace falta que usuario_a Y usuario_b del match puedan
// leer/escribir sobre un recurso compartido entre los dos, y el /api/leer
// o /api/guardar genericos solo autorizan por una columna fija.

const BUCKET_AUDIO = 'cita-audio';
const EXPIRACION_URL_FIRMADA = 3600; // 1h, de sobra para una sesion de cita

const PROMPT_BASE = `Sos Soul, presente en la cita virtual entre dos personas que hicieron match. Tu rol acá es de directora invisible: interviniste solo cuando hace falta, en mensajes cortos, cálidos, sin markdown ni listas, nunca como un bot de soporte. Nunca revelás que alguien te pidió algo -- lo que decís tiene que sonar como si fuera tu propia ocurrencia, participando naturalmente del momento.`;

async function firmarUrlLectura(supabaseUrl, headers, path) {
  const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET_AUDIO}/${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: EXPIRACION_URL_FIRMADA })
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.signedURL ? `${supabaseUrl}/storage/v1${data.signedURL}` : null;
}

async function obtenerCitaAutorizada(supabaseUrl, headers, citaId, usuarioId) {
  const citaRes = await fetch(`${supabaseUrl}/rest/v1/citas?select=*&id=eq.${encodeURIComponent(citaId)}`, { headers });
  const citas = citaRes.ok ? await citaRes.json() : [];
  const cita = citas[0];
  if (!cita) return { error: 404 };

  const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=*&id=eq.${encodeURIComponent(cita.match_id)}`, { headers });
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return { error: 404 };

  const soyA = match.usuario_a === usuarioId;
  const soyB = match.usuario_b === usuarioId;
  if (!soyA && !soyB) return { error: 403 };

  return { cita, match, soyA };
}

// Sin citaId: lista las citas propias (via los matches donde soy
// usuario_a/b) -- lo usa el chequeo de login para saber si hay una cita en
// curso sin que el cliente tenga que conocer el id de antemano.
async function listarMisCitas(req, res, supabaseUrl, headers, usuario) {
  const idEnc = encodeURIComponent(usuario.usuarioId);
  const matchesRes = await fetch(
    `${supabaseUrl}/rest/v1/matches?select=id,usuario_a,usuario_b,estado,compatibilidad_hoy,potencial_construccion,mensaje_dupla&or=(usuario_a.eq.${idEnc},usuario_b.eq.${idEnc})`,
    { headers }
  );
  const matches = matchesRes.ok ? await matchesRes.json() : [];
  if (matches.length === 0) return res.status(200).json({ citas: [] });

  const idsMatches = matches.map(m => m.id);
  const citasRes = await fetch(
    `${supabaseUrl}/rest/v1/citas?select=*&match_id=in.(${idsMatches.map(encodeURIComponent).join(',')})`,
    { headers }
  );
  const citas = citasRes.ok ? await citasRes.json() : [];
  const citasConMatch = citas.map(c => ({ ...c, match: matches.find(m => m.id === c.match_id) }));
  return res.status(200).json({ citas: citasConMatch });
}

async function obtenerCita(req, res, supabaseUrl, headers, usuario) {
  const { citaId } = req.query;
  if (!citaId) return await listarMisCitas(req, res, supabaseUrl, headers, usuario);

  const auth = await obtenerCitaAutorizada(supabaseUrl, headers, citaId, usuario.usuarioId);
  if (auth.error) return res.status(auth.error).json({ error: auth.error === 404 ? 'Cita no encontrada' : 'No autorizado' });

  const mensajesRes = await fetch(
    `${supabaseUrl}/rest/v1/cita_mensajes?select=*&cita_id=eq.${encodeURIComponent(citaId)}&order=created_at.asc`,
    { headers }
  );
  const mensajes = mensajesRes.ok ? await mensajesRes.json() : [];

  const mensajesConUrl = await Promise.all(mensajes.map(async (m) => {
    if (m.tipo === 'audio' && m.contenido) {
      const url = await firmarUrlLectura(supabaseUrl, headers, m.contenido);
      return { ...m, audioUrl: url };
    }
    return m;
  }));

  return res.status(200).json({ cita: auth.cita, soyA: auth.soyA, mensajes: mensajesConUrl });
}

async function enviarMensaje(req, res, supabaseUrl, headers, usuario) {
  const { citaId, tipo, contenido } = req.body;
  if (!citaId || (tipo !== 'texto' && tipo !== 'audio') || !contenido) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  const auth = await obtenerCitaAutorizada(supabaseUrl, headers, citaId, usuario.usuarioId);
  if (auth.error) return res.status(auth.error).json({ error: 'No autorizado' });
  if (auth.cita.estado === 'cerrada') return res.status(409).json({ error: 'cita_cerrada', mensaje: 'Esta cita ya terminó.' });

  await fetch(`${supabaseUrl}/rest/v1/cita_mensajes`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ cita_id: citaId, usuario_id: usuario.usuarioId, tipo, contenido })
  });

  if (auth.cita.estado === 'pendiente') {
    await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: 'activa' })
    });
  }

  return res.status(200).json({ ok: true });
}

async function audioUploadUrl(req, res, supabaseUrl, headers, usuario) {
  const { citaId } = req.body;
  if (!citaId) return res.status(400).json({ error: 'Falta citaId' });
  const auth = await obtenerCitaAutorizada(supabaseUrl, headers, citaId, usuario.usuarioId);
  if (auth.error) return res.status(auth.error).json({ error: 'No autorizado' });

  const path = `${citaId}/${usuario.usuarioId}-${Date.now()}.webm`;
  const signRes = await fetch(`${supabaseUrl}/storage/v1/object/upload/sign/${BUCKET_AUDIO}/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (!signRes.ok) {
    console.error('Error firmando subida de audio:', signRes.status, await signRes.text());
    return res.status(500).json({ error: 'No se pudo preparar la subida de audio' });
  }
  const data = await signRes.json();
  return res.status(200).json({ uploadUrl: `${supabaseUrl}/storage/v1${data.url}`, path });
}

function promptGenerarTema(refsA, refsB) {
  return `${PROMPT_BASE}

Están en silencio o la charla se trabó. Traé un tema nuevo, natural, que abra una vía de conversación.

Referencias culturales de A: ${refsA || 'ninguna registrada'}
Referencias culturales de B: ${refsB || 'ninguna registrada'}

Si alguna de las dos personas tiene referencias reales, usalas como puerta de entrada (describí brevemente la escena o canción en dos líneas si no es obvio). Si ninguna tiene, elegí algo universal y cálido (una escena de película, una pregunta genuina, un "¿nunca les pasó...?"). Un solo mensaje corto. Nunca dos preguntas juntas.`;
}

function promptSalirIncomodidad() {
  return `${PROMPT_BASE}

Algo en la charla se puso incómodo o tenso. Cambiá de tema con delicadeza -- nunca mencionás que algo estuvo raro, incómodo o mal. Simplemente redirigís hacia otro lugar cálido, como si fuera una ocurrencia espontánea tuya. Un solo mensaje corto.`;
}

async function pedirAyuda(req, res, supabaseUrl, headers, usuario) {
  const { citaId, tipoAyuda } = req.body;
  if (!citaId || !['generar_tema', 'salir_incomodidad', 'cerrar'].includes(tipoAyuda)) {
    return res.status(400).json({ error: 'Faltan datos o tipo de ayuda inválido' });
  }
  const auth = await obtenerCitaAutorizada(supabaseUrl, headers, citaId, usuario.usuarioId);
  if (auth.error) return res.status(auth.error).json({ error: 'No autorizado' });

  await fetch(`${supabaseUrl}/rest/v1/cita_ayudas`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ cita_id: citaId, usuario_id: usuario.usuarioId, tipo_ayuda: tipoAyuda, resuelto: true })
  });

  if (tipoAyuda === 'cerrar') {
    if (auth.cita.estado === 'chequeo_cierre') {
      // Ya hay un chequeo en curso -- no duplicar la pregunta.
      return res.status(200).json({ ok: true });
    }
    await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: 'chequeo_cierre', eleccion_a: null, eleccion_b: null })
    });
    await fetch(`${supabaseUrl}/rest/v1/cita_mensajes`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        cita_id: citaId, usuario_id: null, tipo: 'texto',
        contenido: '¿Cómo se están sintiendo? ¿Quieren seguir un rato más o prefieren dejarlo acá por hoy?'
      })
    });
    return res.status(200).json({ ok: true });
  }

  // generar_tema / salir_incomodidad: una sola llamada real a Claude.
  const perfilesRes = await fetch(
    `${supabaseUrl}/rest/v1/perfiles?select=usuario_id,referencias_culturales&usuario_id=in.(${encodeURIComponent(auth.match.usuario_a)},${encodeURIComponent(auth.match.usuario_b)})`,
    { headers }
  );
  const perfiles = perfilesRes.ok ? await perfilesRes.json() : [];
  function refsDe(uid) {
    const p = perfiles.find(x => x.usuario_id === uid);
    if (!p || !p.referencias_culturales) return null;
    try {
      const r = JSON.parse(p.referencias_culturales);
      return [r.pelicula, r.cancion, r.libro].filter(Boolean).join(', ') || null;
    } catch (e) { return null; }
  }

  const prompt = tipoAyuda === 'generar_tema'
    ? promptGenerarTema(refsDe(auth.match.usuario_a), refsDe(auth.match.usuario_b))
    : promptSalirIncomodidad();

  try {
    const data = await llamarClaude({ model: 'claude-sonnet-4-6', max_tokens: 300, system: prompt, messages: [{ role: 'user', content: 'Intervení ahora.' }] });
    const texto = (data.content || []).map(b => b.text || '').join('').trim();
    await fetch(`${supabaseUrl}/rest/v1/cita_mensajes`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ cita_id: citaId, usuario_id: null, tipo: 'texto', contenido: texto })
    });
    await registrarUsoTokens({ usuarioId: usuario.usuarioId, endpoint: 'citaAyuda', usage: data.usage });
  } catch (e) {
    console.error('Error generando intervención de ayuda:', e);
    return res.status(500).json({ error: 'No se pudo generar la intervención' });
  }

  return res.status(200).json({ ok: true });
}

async function responderCierre(req, res, supabaseUrl, headers, usuario) {
  const { citaId, respuesta } = req.body;
  if (!citaId || (respuesta !== 'sigue' && respuesta !== 'para')) {
    return res.status(400).json({ error: 'Faltan datos o respuesta inválida' });
  }
  const auth = await obtenerCitaAutorizada(supabaseUrl, headers, citaId, usuario.usuarioId);
  if (auth.error) return res.status(auth.error).json({ error: 'No autorizado' });
  if (auth.cita.estado !== 'chequeo_cierre') {
    return res.status(409).json({ error: 'sin_chequeo', mensaje: 'No hay ningún chequeo de cierre esperando tu respuesta.' });
  }

  const campoPropio = auth.soyA ? 'eleccion_a' : 'eleccion_b';
  const campoAjeno = auth.soyA ? 'eleccion_b' : 'eleccion_a';
  const respuestaAjena = auth.cita[campoAjeno];

  // "Si CUALQUIERA de los dos responde que prefiere parar, la cita se
  // cierra" -- cierra apenas llega un 'para', sin esperar a que la otra
  // persona también haya contestado (antes esperaba a las dos respuestas
  // antes de mirar si alguna era 'para', lo cual dejaba la cita abierta de
  // más si la primera persona en responder ya quería parar).
  if (respuesta === 'para') {
    await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ [campoPropio]: respuesta, estado: 'cerrada' })
    });
    await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(auth.match.usuario_a)}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ etapa_actual: 'debriefing' })
      }),
      fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(auth.match.usuario_b)}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ etapa_actual: 'debriefing' })
      })
    ]).catch(() => {});
    return res.status(200).json({ estado: 'cerrada' });
  }

  if (respuestaAjena !== 'sigue') {
    // La otra persona todavía no respondió (si hubiera dicho 'para' ya se
    // habría cerrado más arriba) -- solo guardo mi 'sigue' y espero.
    await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ [campoPropio]: respuesta })
    });
    return res.status(200).json({ estado: 'esperando_otra_persona' });
  }

  // Las dos dijeron que quieren seguir.
  await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ [campoPropio]: respuesta, estado: 'activa', eleccion_a: null, eleccion_b: null })
  });
  await fetch(`${supabaseUrl}/rest/v1/cita_mensajes`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ cita_id: citaId, usuario_id: null, tipo: 'texto', contenido: 'Sigamos, entonces.' })
  });
  return res.status(200).json({ estado: 'activa' });
}

// Mismo trabajo que antes hacian elegir()/guardarCheckinEmocional sobre
// 'matches' directo con guardarTabla generico -- eso solo autoriza
// escrituras de usuario_a, asi que usuario_b nunca podia guardar su propia
// eleccion de debriefing. Se pasa por este endpoint, autorizando por
// cualquiera de los dos lados.
async function elegirDebriefing(req, res, supabaseUrl, headers, usuario) {
  const { matchId, eleccion } = req.body;
  if (!matchId || (eleccion !== 'aceptado' && eleccion !== 'rechazado')) {
    return res.status(400).json({ error: 'Faltan datos o elección inválida' });
  }
  const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&id=eq.${encodeURIComponent(matchId)}`, { headers });
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  if (match.usuario_a !== usuario.usuarioId && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: eleccion, fecha_respuesta: new Date().toISOString() })
  });
  return res.status(200).json({ ok: true });
}

async function checkinEmocional(req, res, supabaseUrl, headers, usuario) {
  const { matchId, valor } = req.body;
  if (!matchId || !valor) return res.status(400).json({ error: 'Faltan datos' });
  const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&id=eq.${encodeURIComponent(matchId)}`, { headers });
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  if (match.usuario_a !== usuario.usuarioId && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ checkin_emocional: valor })
  });
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
      return await obtenerCita(req, res, supabaseUrl, headers, usuario);
    }
    if (req.method === 'POST') {
      const { accion } = req.body;
      if (accion === 'mensaje') return await enviarMensaje(req, res, supabaseUrl, headers, usuario);
      if (accion === 'audioUploadUrl') return await audioUploadUrl(req, res, supabaseUrl, headers, usuario);
      if (accion === 'ayudaPrivada') return await pedirAyuda(req, res, supabaseUrl, headers, usuario);
      if (accion === 'responderCierre') return await responderCierre(req, res, supabaseUrl, headers, usuario);
      if (accion === 'elegirDebriefing') return await elegirDebriefing(req, res, supabaseUrl, headers, usuario);
      if (accion === 'checkinEmocional') return await checkinEmocional(req, res, supabaseUrl, headers, usuario);
      return res.status(400).json({ error: 'Acción no válida' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error en /api/citas:', error);
    return res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
}
