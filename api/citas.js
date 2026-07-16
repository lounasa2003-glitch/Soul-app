import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaude, llamarClaudeJSON } from '../lib/anthropicClient.js';
import { registrarUsoTokens } from '../lib/logUso.js';
import { notificarMensajeCita } from '../lib/email.js';
import { EXTRACT_PROMPT } from './analisisExterno.js';

// Endpoint dedicado para la cita virtual asincronica -- mismo motivo que
// api/matches.js: hace falta que usuario_a Y usuario_b del match puedan
// leer/escribir sobre un recurso compartido entre los dos, y el /api/leer
// o /api/guardar genericos solo autorizan por una columna fija.

const BUCKET_AUDIO = 'cita-audio';
const EXPIRACION_URL_FIRMADA = 3600; // 1h, de sobra para una sesion de cita

// Si el destinatario polleo la cita hace menos de esto, esta mirando la
// pantalla ahora mismo -- no hace falta mandarle un mail. Si no, se le avisa
// pero como maximo una vez por este margen (evita mandar un mail por cada
// mensaje de una tanda mientras esta desconectado).
const ACTIVO_MS = 2 * 60 * 1000;
const COOLDOWN_EMAIL_MS = 20 * 60 * 1000;

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
// curso sin que el cliente tenga que conocer el id de antemano, y tambien
// la pantalla "Mis citas" para mostrar el historial completo.
async function listarMisCitas(req, res, supabaseUrl, headers, usuario) {
  const idEnc = encodeURIComponent(usuario.usuarioId);
  const matchesRes = await fetch(
    `${supabaseUrl}/rest/v1/matches?select=id,usuario_a,usuario_b,estado,compatibilidad_hoy,potencial_construccion,mensaje_dupla,fortalezas,desafio,debriefing_usuario_a,debriefing_usuario_b&or=(usuario_a.eq.${idEnc},usuario_b.eq.${idEnc})`,
    { headers }
  );
  const matches = matchesRes.ok ? await matchesRes.json() : [];
  if (matches.length === 0) return res.status(200).json({ citas: [] });

  const otrosIds = [...new Set(matches.map(m => (m.usuario_a === usuario.usuarioId ? m.usuario_b : m.usuario_a)))];
  let nombrePorId = {};
  if (otrosIds.length > 0) {
    const usuariosRes = await fetch(
      `${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email&id=in.(${otrosIds.map(encodeURIComponent).join(',')})`,
      { headers }
    );
    const usuarios = usuariosRes.ok ? await usuariosRes.json() : [];
    // Algunas personas del piloto nunca guardaron "nombre" (solo email) --
    // mismo fallback ya aplicado en api/admin/personas.js para el panel.
    usuarios.forEach(u => { nombrePorId[u.id] = u.nombre || u.email || null; });
  }
  const matchesConNombre = matches.map(m => {
    const otraId = m.usuario_a === usuario.usuarioId ? m.usuario_b : m.usuario_a;
    return { ...m, otra_persona_id: otraId, otra_persona_nombre: nombrePorId[otraId] || null };
  });

  const idsMatches = matchesConNombre.map(m => m.id);
  const citasRes = await fetch(
    `${supabaseUrl}/rest/v1/citas?select=*&match_id=in.(${idsMatches.map(encodeURIComponent).join(',')})`,
    { headers }
  );
  const citas = citasRes.ok ? await citasRes.json() : [];
  const citasConMatch = citas.map(c => ({ ...c, match: matchesConNombre.find(m => m.id === c.match_id) }));
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

async function avisarSiDesconectado(supabaseUrl, headers, citaId, cita, match, remitenteId) {
  const soyA = match.usuario_a === remitenteId;
  const receptorId = soyA ? match.usuario_b : match.usuario_a;
  const campoEmail = soyA ? 'ultimo_email_b' : 'ultimo_email_a';

  const uRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,ultima_actividad&id=in.(${encodeURIComponent(receptorId)},${encodeURIComponent(remitenteId)})`, { headers });
  const usuarios = uRes.ok ? await uRes.json() : [];
  const receptor = usuarios.find(u => u.id === receptorId);
  const remitente = usuarios.find(u => u.id === remitenteId);
  if (!receptor || !receptor.email) return;

  const ahora = Date.now();
  if (receptor.ultima_actividad && (ahora - new Date(receptor.ultima_actividad).getTime()) < ACTIVO_MS) {
    return; // esta viendo la app ahora mismo
  }
  const ultimoEmail = cita[campoEmail];
  if (ultimoEmail && (ahora - new Date(ultimoEmail).getTime()) < COOLDOWN_EMAIL_MS) {
    return; // ya se le aviso hace poco, no juntar mail por cada mensaje
  }

  const remitenteNombre = remitente ? (remitente.nombre || remitente.email) : null;
  const enviado = await notificarMensajeCita({ nombre: receptor.nombre, email: receptor.email, remitenteNombre });
  if (!enviado) return; // si Resend fallo, no marcar cooldown -- que reintente en el proximo mensaje

  await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ [campoEmail]: new Date().toISOString() })
  });
}

async function enviarMensaje(req, res, supabaseUrl, headers, usuario) {
  const { citaId, tipo, contenido } = req.body;
  if (!citaId || (tipo !== 'texto' && tipo !== 'audio') || !contenido) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  const auth = await obtenerCitaAutorizada(supabaseUrl, headers, citaId, usuario.usuarioId);
  if (auth.error) return res.status(auth.error).json({ error: 'No autorizado' });
  // Antes esto bloqueaba escribir si la cita ya estaba 'cerrada' -- ahora se
  // puede reabrir para seguir la charla desde "Mis citas" aunque ya haya
  // pasado por el cierre y el debriefing. No se toca el estado (se queda
  // 'cerrada'): asi no se reactiva sola la auto-navegacion de login a la
  // cita ni se pisa el debriefing ya resuelto.

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

  // Se espera a que termine (no fire-and-forget): en un entorno serverless
  // el contexto de ejecucion no sigue vivo garantizado despues de responder,
  // asi que una llamada sin await puede cortarse antes de llegar a Resend.
  try {
    await avisarSiDesconectado(supabaseUrl, headers, citaId, auth.cita, auth.match, usuario.usuarioId);
  } catch (e) {
    console.error('Error avisando mensaje nuevo por mail:', e);
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

function promptGenerarTema(refsA, refsB, transcripto) {
  return `${PROMPT_BASE}

Están en silencio o la charla se trabó. Traé un tema nuevo, natural, que abra una vía de conversación.

Acá está la charla hasta ahora -- leela antes de intervenir. Fijate el tono real: si viene profunda (se abrieron, hablaron de algo personal o denso), NO la bajes a algo liviano de golpe -- segui en ese mismo registro o traé algo que conecte con lo que ya se dijo. Si viene liviana o recién arrancando, no le metas peso de más -- algo simple y cálido alcanza. Nunca ignores lo que ya se dijo para meter un tema random.

${transcripto || '(Todavía no hay mensajes -- es el comienzo de la charla.)'}

Referencias culturales de A: ${refsA || 'ninguna registrada'}
Referencias culturales de B: ${refsB || 'ninguna registrada'}

Si alguna de las dos personas tiene referencias reales y encajan con el momento de la charla, usalas como puerta de entrada (describí brevemente la escena o canción en dos líneas si no es obvio). Si ninguna tiene o no encajan con el tono actual, elegí algo universal que sí encaje. Un solo mensaje corto. Nunca dos preguntas juntas.`;
}

function promptSalirIncomodidad(transcripto) {
  return `${PROMPT_BASE}

Algo en la charla se puso incómodo o tenso. Acá está la charla hasta ahora -- leela para entender qué generó la incomodidad y hacia dónde conviene ir, en vez de cambiar de tema a ciegas:

${transcripto || '(No hay mensajes previos disponibles.)'}

Cambiá de tema con delicadeza -- nunca mencionás que algo estuvo raro, incómodo o mal. Simplemente redirigís hacia otro lugar cálido, coherente con lo que veniían hablando, como si fuera una ocurrencia espontánea tuya. Un solo mensaje corto.`;
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

  // generar_tema / salir_incomodidad: una sola llamada real a Claude, pero
  // necesita ver la charla real -- sin esto Soul elegia un tema a ciegas,
  // sin saber si la conversacion venia profunda o liviana.
  const [perfilesRes, mensajesRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/perfiles?select=usuario_id,referencias_culturales&usuario_id=in.(${encodeURIComponent(auth.match.usuario_a)},${encodeURIComponent(auth.match.usuario_b)})`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/cita_mensajes?select=usuario_id,tipo,contenido&cita_id=eq.${encodeURIComponent(citaId)}&tipo=eq.texto&order=created_at.desc&limit=20`, { headers })
  ]);
  const perfiles = perfilesRes.ok ? await perfilesRes.json() : [];
  const mensajesRecientes = mensajesRes.ok ? (await mensajesRes.json()).reverse() : [];
  const transcripto = mensajesRecientes.map(m => {
    const quien = m.usuario_id === null ? 'Soul' : (m.usuario_id === auth.match.usuario_a ? 'A' : 'B');
    return quien + ': ' + m.contenido;
  }).join('\n');

  function refsDe(uid) {
    const p = perfiles.find(x => x.usuario_id === uid);
    if (!p || !p.referencias_culturales) return null;
    try {
      const r = JSON.parse(p.referencias_culturales);
      return [r.pelicula, r.cancion, r.libro].filter(Boolean).join(', ') || null;
    } catch (e) { return null; }
  }

  const prompt = tipoAyuda === 'generar_tema'
    ? promptGenerarTema(refsDe(auth.match.usuario_a), refsDe(auth.match.usuario_b), transcripto)
    : promptSalirIncomodidad(transcripto);

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
// Antes esto escribia derecho a matches.estado -- un campo unico
// compartido -- asi que en cuanto la PRIMERA persona completaba su
// debriefing, matches.estado dejaba de ser 'mutuamente_aceptado' y el
// chequeo de login de la SEGUNDA persona (que buscaba justo ese valor)
// ya no encontraba nada: caia derecho a la eleccion de sesion normal,
// como si su debriefing pendiente no existiera. Se guarda la eleccion de
// cada lado por separado (mismo patron que eleccion_usuario_a/b en la
// decision del match) y el estado final solo se resuelve cuando las DOS
// ya contestaron.
async function elegirDebriefing(req, res, supabaseUrl, headers, usuario) {
  const { matchId, eleccion } = req.body;
  if (!matchId || (eleccion !== 'aceptado' && eleccion !== 'rechazado')) {
    return res.status(400).json({ error: 'Faltan datos o elección inválida' });
  }
  const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b,debriefing_usuario_a,debriefing_usuario_b&id=eq.${encodeURIComponent(matchId)}`, { headers });
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  const soyA = match.usuario_a === usuario.usuarioId;
  const soyB = match.usuario_b === usuario.usuarioId;
  if (!soyA && !soyB) return res.status(403).json({ error: 'No autorizado' });

  const campoPropio = soyA ? 'debriefing_usuario_a' : 'debriefing_usuario_b';
  const campoAjeno = soyA ? 'debriefing_usuario_b' : 'debriefing_usuario_a';
  const ajena = match[campoAjeno];

  const datosPatch = { [campoPropio]: eleccion };
  if (ajena) {
    // Las dos ya contestaron -- recien ahi se resuelve el estado final.
    datosPatch.estado = (eleccion === 'aceptado' && ajena === 'aceptado') ? 'aceptado' : 'rechazado';
    datosPatch.fecha_respuesta = new Date().toISOString();
  }
  await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(datosPatch)
  });
  // Mi parte del debriefing ya termino -- vuelvo a 'chat', el estado normal
  // de espera/conversacion (antes quedaba en 'debriefing' para siempre).
  await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(usuario.usuarioId)}`, {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ etapa_actual: 'chat' })
  }).catch(() => {});
  return res.status(200).json({ ok: true });
}

async function checkinEmocional(req, res, supabaseUrl, headers, usuario) {
  const { matchId, valor } = req.body;
  if (!matchId || !valor) return res.status(400).json({ error: 'Faltan datos' });
  const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&id=eq.${encodeURIComponent(matchId)}`, { headers });
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  const soyA = match.usuario_a === usuario.usuarioId;
  if (!soyA && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  // Campo separado por lado -- antes era un unico campo compartido y el
  // checkin del segundo pisaba el del primero.
  await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ [soyA ? 'checkin_emocional_a' : 'checkin_emocional_b']: valor })
  });
  return res.status(200).json({ ok: true });
}

const PERFIL_VINCULAR_SHAPE = '{"grupo1":{"valores":["v1","v2","v3"],"estilo_comunicacion":"","ritmo_emocional":"","mascara_vs_autentico":"","momento_evolutivo":""},"grupo2":{"tipo_vinculo":"","proyecto_vida":"","necesidades_intimidad":"","no_puede_faltar":"","no_puede_estar":""},"grupo3":{"modo_conflictos":"","capacidad_reparacion":"","reciprocidad":"","flexibilidad":"","patrones_vinculares":""},"grupo4":{"apertura":"","consistencia":"","estabilidad_emocional":"","revision_creencias":"","metalenguaje":"","indice_disponibilidad":5}}';

// Mismo shape que EXTRACT_PROMPT (analisis de conversacion externa), pero
// aca la fuente es la transcripcion real de la cita virtual entre las dos
// personas del match -- se extrae por separado para A y para B, porque es
// una fuente de informacion distinta a lo auto-reportado en el perfil (como
// se vincula en la practica, no como dice que se vincula).
const EXTRACT_PROMPT_CITA = `Sos un sistema de análisis de compatibilidad vincular basado en coaching ontológico. Vas a leer la transcripción real de una cita virtual entre dos personas que hicieron match (marcadas como "A" y "B"; los mensajes de "Soul" son intervenciones de una IA anfitriona, no de ninguna de las dos personas -- no son fuente de perfil, pero te sirven para entender el contexto).

A diferencia de un perfil auto-reportado, esto es evidencia real de cómo cada persona efectivamente se vincula en la práctica. Extraé, por separado para A y para B, un perfil con esta forma. Respondé ÚNICAMENTE con JSON válido sin backticks: {"a":${PERFIL_VINCULAR_SHAPE},"b":${PERFIL_VINCULAR_SHAPE}}

MUY IMPORTANTE -- NO INVENTES: una sola cita casi nunca da para llenar todo. Si un campo no tiene información real y observable en esta charla puntual, su valor tiene que ser exactamente null -- nunca una inferencia plausible generada sin base. Es preferible un campo en null a uno con contenido inventado.`;

const DEVOLUCION_DEBRIEFING_PROMPT = `Sos Soul. Acaba de terminar una cita virtual entre dos personas que hicieron match, y le estás hablando en privado a una de ellas -- esta charla nunca la ve la otra persona. Es el primer mensaje de esta conversación: arrancá vos con una devolución, no esperes a que hable primero.

Tu devolución tiene que:
- Nombrar con delicadeza cómo puede haber sido el encuentro para ella, dejando lugar a que corrija si no es así.
- Compartir qué te pareció notar como fortaleza -- de ella, de la otra persona, o del vínculo que se está armando entre las dos -- basado en las señales reales que se ven en la charla (no en lo que cada quien reportó de sí mismo antes de conocerse).
- Compartir algo que te pareció que podría trabajarse o cuidarse.
- Preguntarle, al final, si se siente identificada con esa lectura -- la última palabra siempre es de ella.

Regla central, no negociable: nunca presentes esto como diagnóstico ni como verdad -- siempre en tono interpretativo y tentativo ("me pareció notar que...", "tal vez...", "se sintió como si..."). Nunca "sos así" ni "esto fue lo que pasó". Si la evidencia real es escasa (charla corta, poco material), decilo con naturalidad y quedate con lo poco que sí viste, en vez de generalizar.

Más adelante en esta misma conversación (no necesariamente en este primer mensaje) te va a interesar explorar con ella qué le gustó de esta persona, qué sintió que no encajaba, y qué aprendió sobre lo que está buscando -- pero no lo preguntes todo de una, dejá que la charla fluya de a poco.

Mensajes cortos, cálidos, sin markdown, sin listas, nunca como un formulario.`;

async function guardarHistorialReflexion(supabaseUrl, headers, matchId, usuarioId, historial) {
  await fetch(`${supabaseUrl}/rest/v1/cita_reflexiones?on_conflict=match_id,usuario_id`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ match_id: matchId, usuario_id: usuarioId, historial, updated_at: new Date().toISOString() })
  });
}

// Primera vez que esta persona abre el debriefing de este match: en vez de
// un saludo generico, Soul arranca con una devolucion real basada en la
// cita. Si hace falta, primero extrae las señales de vinculo reales desde
// los cita_mensajes (una sola vez por match, cacheadas en
// matches.insights_debriefing_a/b) y despues genera la devolucion
// personalizada para el lado que esta pidiendo. Cualquier fallo acá cae en
// un array vacio -- el cliente ya tiene su propio saludo generico de
// respaldo si el historial llega vacío.
async function generarDevolucionInicial(supabaseUrl, headers, usuario, match, matchId, soyA, otraPersonaNombre) {
  try {
    let insightsPropio = soyA ? match.insights_debriefing_a : match.insights_debriefing_b;

    if (!insightsPropio) {
      const citaRes = await fetch(
        `${supabaseUrl}/rest/v1/citas?select=id&match_id=eq.${encodeURIComponent(matchId)}&estado=eq.cerrada&order=created_at.desc&limit=1`,
        { headers }
      );
      const citasCerradas = citaRes.ok ? await citaRes.json() : [];
      const citaCerrada = citasCerradas[0];

      let transcripto = '';
      if (citaCerrada) {
        const msgsRes = await fetch(
          `${supabaseUrl}/rest/v1/cita_mensajes?select=usuario_id,contenido&cita_id=eq.${encodeURIComponent(citaCerrada.id)}&tipo=eq.texto&order=created_at.asc`,
          { headers }
        );
        const msgs = msgsRes.ok ? await msgsRes.json() : [];
        transcripto = msgs.map(m => {
          const quien = m.usuario_id === null ? 'Soul' : (m.usuario_id === match.usuario_a ? 'A' : 'B');
          return quien + ': ' + m.contenido;
        }).join('\n');
      }

      if (transcripto) {
        const { json } = await llamarClaudeJSON({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          system: EXTRACT_PROMPT_CITA,
          messages: [{ role: 'user', content: 'Transcripción de la cita:\n\n' + transcripto }]
        });
        await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ insights_debriefing_a: json.a || null, insights_debriefing_b: json.b || null })
        });
        insightsPropio = soyA ? json.a : json.b;
      }
    }

    const insumo = {
      otraPersonaNombre,
      senalesRealesDeLaCita: insightsPropio || null,
      fortalezasDetectadasEnLosPerfiles: match.fortalezas || null,
      desafioDetectadoEnLosPerfiles: match.desafio || null
    };
    const data = await llamarClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: DEVOLUCION_DEBRIEFING_PROMPT,
      messages: [{ role: 'user', content: 'Insumo interno (no mostrar en crudo): ' + JSON.stringify(insumo) }]
    });
    const texto = (data.content || []).map(b => b.text || '').join('').trim();
    if (!texto) return [];

    const historialNuevo = [{ role: 'assistant', content: texto }];
    await guardarHistorialReflexion(supabaseUrl, headers, matchId, usuario.usuarioId, historialNuevo);
    return historialNuevo;
  } catch (e) {
    console.error('Error generando devolución de debriefing:', e);
    return [];
  }
}

// Conversacion privada de reflexion/debriefing sobre una cita puntual -- una
// por (usuario, match), nunca compartida con la otra persona del match. La
// IA en si la maneja el cliente llamando directo a /api/chat (mismo
// streaming que el chat principal); esto persiste el historial (sembrando
// la devolucion inicial la primera vez) y devuelve el contexto del match
// para que el cliente arme el system prompt.
async function obtenerReflexion(req, res, supabaseUrl, headers, usuario) {
  const { reflexionMatchId } = req.query;
  const matchRes = await fetch(
    `${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b,mensaje_dupla,fortalezas,desafio,insights_debriefing_a,insights_debriefing_b&id=eq.${encodeURIComponent(reflexionMatchId)}`,
    { headers }
  );
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  if (match.usuario_a !== usuario.usuarioId && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  const soyA = match.usuario_a === usuario.usuarioId;
  const otraId = soyA ? match.usuario_b : match.usuario_a;
  const otraRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=nombre,email&id=eq.${encodeURIComponent(otraId)}`, { headers });
  const otras = otraRes.ok ? await otraRes.json() : [];
  const otraPersonaNombre = otras[0] ? (otras[0].nombre || otras[0].email || null) : null;

  const reflexionRes = await fetch(
    `${supabaseUrl}/rest/v1/cita_reflexiones?select=historial&match_id=eq.${encodeURIComponent(reflexionMatchId)}&usuario_id=eq.${encodeURIComponent(usuario.usuarioId)}`,
    { headers }
  );
  const reflexiones = reflexionRes.ok ? await reflexionRes.json() : [];
  let historial = reflexiones[0] ? reflexiones[0].historial : [];
  if (!historial || historial.length === 0) {
    historial = await generarDevolucionInicial(supabaseUrl, headers, usuario, match, reflexionMatchId, soyA, otraPersonaNombre);
  }

  return res.status(200).json({
    historial,
    otraPersonaNombre,
    mensajeDupla: match.mensaje_dupla || null,
    fortalezas: match.fortalezas || null,
    desafio: match.desafio || null
  });
}

async function guardarReflexion(req, res, supabaseUrl, headers, usuario) {
  const { matchId, historial } = req.body;
  if (!matchId || !Array.isArray(historial)) return res.status(400).json({ error: 'Faltan datos' });
  const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&id=eq.${encodeURIComponent(matchId)}`, { headers });
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  if (match.usuario_a !== usuario.usuarioId && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  // Upsert por (match_id, usuario_id) -- el cliente siempre manda el
  // historial completo, no hace falta trackear un id de fila.
  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/cita_reflexiones?on_conflict=match_id,usuario_id`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ match_id: matchId, usuario_id: usuario.usuarioId, historial, updated_at: new Date().toISOString() })
  });
  if (!upsertRes.ok) {
    console.error('Error guardando reflexion:', upsertRes.status, await upsertRes.text());
    return res.status(500).json({ error: 'No se pudo guardar' });
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
      if (req.query.reflexionMatchId) {
        return await obtenerReflexion(req, res, supabaseUrl, headers, usuario);
      }
      // Marca de presencia: mientras el cliente este polleando la cita
      // activamente, se lo considera "conectado" y no hace falta mandarle
      // mail cuando le llega un mensaje nuevo.
      fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(usuario.usuarioId)}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ ultima_actividad: new Date().toISOString() })
      }).catch(() => {});
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
      if (accion === 'guardarReflexion') return await guardarReflexion(req, res, supabaseUrl, headers, usuario);
      return res.status(400).json({ error: 'Acción no válida' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error en /api/citas:', error);
    return res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
}
