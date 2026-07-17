import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaude, llamarClaudeJSON } from '../lib/anthropicClient.js';
import { registrarUsoTokens } from '../lib/logUso.js';
import { notificarMensajeCita } from '../lib/email.js';
import { EXTRACT_PROMPT } from './analisisExterno.js';

// Endpoint dedicado para la cita virtual asincronica -- mismo motivo que
// api/matches.js: hace falta que usuario_a Y usuario_b del match puedan
// leer/escribir sobre un recurso compartido entre los dos, y el /api/leer
// o /api/guardar genericos solo autorizan por una columna fija.

// Si el destinatario polleo la cita hace menos de esto, esta mirando la
// pantalla ahora mismo -- no hace falta mandarle un mail. Si no, se le avisa
// pero como maximo una vez por este margen (evita mandar un mail por cada
// mensaje de una tanda mientras esta desconectado).
const ACTIVO_MS = 2 * 60 * 1000;
const COOLDOWN_EMAIL_MS = 20 * 60 * 1000;

const PROMPT_BASE = `Sos Soul, presente en la cita virtual entre dos personas que hicieron match. Tu rol acá es de directora invisible: interviniste solo cuando hace falta, en mensajes cortos, cálidos, sin markdown ni listas, nunca como un bot de soporte. Nunca revelás que alguien te pidió algo -- lo que decís tiene que sonar como si fuera tu propia ocurrencia, participando naturalmente del momento.`;

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
    `${supabaseUrl}/rest/v1/matches?select=id,usuario_a,usuario_b,estado,compatibilidad_hoy,potencial_construccion,mensaje_dupla,fortalezas,desafio,decision_a,decision_b&or=(usuario_a.eq.${idEnc},usuario_b.eq.${idEnc})`,
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

  return res.status(200).json({ cita: auth.cita, soyA: auth.soyA, mensajes });
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

// Consentimiento explícito para que Soul pueda analizar la conversación de
// la cita -- se pregunta una sola vez por persona, al entrar a un encuentro
// nuevo. Si no contesta antes de que la cita cierre, cuenta como "no": el
// default es siempre no-analizar, nunca al revés.
async function consentirAnalisis(req, res, supabaseUrl, headers, usuario) {
  const { citaId, consiente } = req.body;
  if (!citaId || typeof consiente !== 'boolean') return res.status(400).json({ error: 'Faltan datos' });
  const auth = await obtenerCitaAutorizada(supabaseUrl, headers, citaId, usuario.usuarioId);
  if (auth.error) return res.status(auth.error).json({ error: 'No autorizado' });

  const campoPropio = auth.soyA ? 'consiente_analisis_a' : 'consiente_analisis_b';
  await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ [campoPropio]: consiente })
  });
  return res.status(200).json({ ok: true });
}

async function enviarMensaje(req, res, supabaseUrl, headers, usuario) {
  const { citaId, tipo, contenido } = req.body;
  if (!citaId || tipo !== 'texto' || !contenido) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  const auth = await obtenerCitaAutorizada(supabaseUrl, headers, citaId, usuario.usuarioId);
  if (auth.error) return res.status(auth.error).json({ error: 'No autorizado' });
  // Con la Sala de Encuentros, cada encuentro es una fila propia en citas
  // -- una vez cerrada queda cerrada para siempre (antes se podia reabrir
  // para seguir escribiendo ahi mismo). El proximo encuentro, si ambas
  // partes eligen seguir en Soul, es una fila NUEVA (ver
  // decidirSalaEncuentros), no esta misma reabierta.
  if (auth.cita.estado === 'cerrada') {
    return res.status(409).json({ error: 'cita_cerrada', mensaje: 'Este encuentro ya cerró.' });
  }
  // Si cualquiera de las dos personas "eliminó" este match, se corta la
  // escritura para ambos lados -- sin devolver un motivo explícito (el
  // cliente ya ignora este error en silencio), para que del otro lado se
  // sienta como que simplemente dejó de haber respuesta, no un aviso de
  // "te bloquearon".
  if (auth.match.eliminado_por) {
    return res.status(403).json({ error: 'no_disponible' });
  }

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
    // Mensaje compartido de cierre -- lo ven las dos personas en la cita
    // misma, marcando que el encuentro en vivo terminó (distinto del
    // debriefing privado que viene después, uno por persona).
    await fetch(`${supabaseUrl}/rest/v1/cita_mensajes`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ cita_id: citaId, usuario_id: null, tipo: 'texto', contenido: 'Gracias por encontrarse. No hace falta decidir el resto de la historia hoy. Solo pregúntense si les gustaría volver a conversar.' })
    }).catch(() => {});
    await generarResumenCitaEnSegundoPlano(supabaseUrl, headers, citaId, auth.match);
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

// Reemplaza elegirDebriefing (2 botones fijos aceptado/rechazado) por la
// decision de 3 caminos de la Sala de Encuentros. Cada lado contesta por
// separado, sin ver la respuesta de la otra persona (mismo patron que
// eleccion_usuario_a/b en la decision del match) -- recien cuando las DOS
// ya contestaron se resuelve:
// - si cualquiera eligio 'cerrar', el vinculo cierra (estado interno
//   'rechazado' -- nunca se muestra esa palabra, ver el resto de la app).
// - si no, y cualquiera eligio 'intercambiar', se resuelve a eso: exponer
//   contacto no bloquea que ademas sigan usando Soul si quieren, asi que es
//   la opcion mas inclusiva cuando hay diferencia de preferencia (estado
//   interno 'aceptado' -- construyeron algo, solo que se lleva la charla
//   afuera).
// - si las DOS eligieron 'seguir_soul', se crea un encuentro nuevo (fila
//   nueva en citas, mismo mensaje de apertura que el primero) y el match
//   sigue activo tal cual estaba.
async function decidirSalaEncuentros(req, res, supabaseUrl, headers, usuario) {
  const { matchId, decision } = req.body;
  if (!matchId || !['seguir_soul', 'intercambiar', 'cerrar'].includes(decision)) {
    return res.status(400).json({ error: 'Faltan datos o decisión inválida' });
  }
  const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b,decision_a,decision_b&id=eq.${encodeURIComponent(matchId)}`, { headers });
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  const soyA = match.usuario_a === usuario.usuarioId;
  const soyB = match.usuario_b === usuario.usuarioId;
  if (!soyA && !soyB) return res.status(403).json({ error: 'No autorizado' });

  const campoPropio = soyA ? 'decision_a' : 'decision_b';
  const campoAjeno = soyA ? 'decision_b' : 'decision_a';
  const ajena = match[campoAjeno];

  if (ajena) {
    let resultado;
    if (decision === 'cerrar' || ajena === 'cerrar') resultado = 'cerrar';
    else if (decision === 'intercambiar' || ajena === 'intercambiar') resultado = 'intercambiar';
    else resultado = 'seguir_soul';

    const datosPatch = { decision_a: null, decision_b: null };
    if (resultado === 'cerrar') datosPatch.estado = 'rechazado';
    else if (resultado === 'intercambiar') datosPatch.estado = 'aceptado';
    await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(datosPatch)
    });

    if (resultado === 'seguir_soul') {
      try {
        const citaRes = await fetch(`${supabaseUrl}/rest/v1/citas`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ match_id: matchId })
        });
        const citas = citaRes.ok ? await citaRes.json() : [];
        const citaCreada = citas[0];
        if (citaCreada) {
          await fetch(`${supabaseUrl}/rest/v1/cita_mensajes`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ cita_id: citaCreada.id, usuario_id: null, tipo: 'texto', contenido: 'No busquen impresionar. Intenten descubrir si disfrutan conversar.' })
          });
        }
      } catch (e) {
        console.error('Error creando el próximo encuentro:', e);
      }
    }
  } else {
    await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ [campoPropio]: decision })
    });
  }

  // Mi parte ya termino -- vuelvo a 'chat', el estado normal de espera.
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

// Shape de dinamica relacional -- reemplaza el viejo PERFIL_VINCULAR_SHAPE
// (grupo1-4, prestado del analizador de conversaciones externas). El foco
// ya no es QUE se dijo (temas, contenido) sino COMO se vincularon: balance
// de la conversacion, si construyeron temas juntos o cada uno fue por su
// lado, y patrones personales -- siempre como evidencia a reflejar, nunca
// como diagnostico.
const DINAMICA_RELACIONAL_SHAPE = '{"conversacion":{"balance_hablar_preguntar":null,"curiosidad_genuina":null,"profundidad":null,"fluidez":null},"vinculacion":{"construccion_conjunta_temas":null,"respondio_o_cambio_tema":null,"hubo_validacion_emocional":null,"interes_reciproco":null},"patrones_personales":{"necesidad_aprobacion":null,"tendencia_idealizar_rapido":null,"evitacion_temas_personales":null,"exceso_autopresentacion":null,"miedo_al_rechazo":null,"rigidez_expectativas":null}}';

// Esta extraccion SOLO se dispara si las dos personas dieron su
// consentimiento explicito (ver consiente_analisis_a/b, Etapa 1) -- es la
// fuente real detras de las 2 observaciones del debriefing (Nivel 1) y de
// la acumulacion de patrones a lo largo del tiempo (Nivel 2).
const DINAMICA_RELACIONAL_PROMPT = `Sos un sistema de análisis de dinámica vincular basado en coaching ontológico. Vas a leer la transcripción real de una cita virtual entre dos personas que hicieron match (marcadas como "A" y "B"; los mensajes de "Soul" son intervenciones de una IA anfitriona, no de ninguna de las dos personas -- no son fuente de perfil, pero te sirven para entender el contexto).

El foco NO es qué temas hablaron -- es CÓMO se vincularon: la dinámica de la conversación, si construyeron algo juntos, y qué patrones personales de vincularse aparecieron (nunca como diagnóstico, solo como evidencia observable para reflejar después con delicadeza).

Extraé, por separado para A y para B, un perfil con esta forma. Respondé ÚNICAMENTE con JSON válido sin backticks: {"a":${DINAMICA_RELACIONAL_SHAPE},"b":${DINAMICA_RELACIONAL_SHAPE}}

MUY IMPORTANTE -- NO INVENTES: una sola cita casi nunca da para llenar todo. Si un campo no tiene evidencia real y observable en esta charla puntual, su valor tiene que ser exactamente null -- nunca una inferencia plausible generada sin base. Es preferible un campo en null a uno con contenido inventado.`;

// Resumen objetivo de la cita en si (distinto del refinamiento del
// debriefing, que es autopercepcion de cada persona, y de
// insights_debriefing_a/b, que es perfil vincular por persona) -- pensado
// para que la administradora entienda rapido que paso en una cita puntual
// sin tener que leer todo el chat. Se genera una sola vez, al cerrarse la
// cita (ver responderCierre), y queda cacheado en citas.resumen_ia.
const RESUMEN_CITA_PROMPT = `Sos un sistema de análisis para el equipo de Soul (una plataforma de vínculos basada en coaching ontológico). Vas a leer la transcripción real de una cita virtual entre dos personas que hicieron match (marcadas como "A" y "B"; los mensajes de "Soul" son intervenciones de una IA anfitriona que a veces interviene). Esto lo va a leer la administradora de la plataforma, no ninguna de las dos personas -- podés ser directo y objetivo, no hace falta el tono cálido/interpretativo que usa Soul con las personas.

Armá un resumen objetivo y neutro de la cita. Nunca uses lenguaje que suene a juicio o descarte (nunca "rechazo", "fracasó", etc. -- si la cita fue incómoda o corta, describilo neutral, ej. "la conversación no profundizó" en vez de "no hubo química").

Respondé ÚNICAMENTE con JSON válido sin backticks:
{"resumen":"2-4 frases narrativas y objetivas de qué pasó en la cita","temas_principales":["tema1","tema2"],"tono_general":"frase breve, ej. cálido y fluido desde el inicio","nivel_reciprocidad":"frase breve sobre el balance de participación entre las dos personas, ej. equilibrado, o A llevó la mayor parte de la conversación","senales_de_tension":null}

Si la charla fue muy corta y no da para una lectura real, decilo así en "resumen" (ej. "La charla fue muy breve, no da para más lectura que eso") y dejá "temas_principales" como array vacío y "senales_de_tension" en null -- nunca inventes contenido para llenar el JSON.`;

// Se llama con await desde responderCierre, aunque agregue unos segundos a
// esa respuesta -- un "fire and forget" real (sin esperar la promesa) no es
// confiable en un entorno serverless, el contexto de ejecucion no sigue
// vivo garantizado despues de responder y la llamada puede cortarse antes
// de terminar (mismo motivo ya documentado en avisarSiDesconectado, mas
// arriba en este archivo). Cualquier fallo queda solo logueado, nunca
// tira error hacia el que esta cerrando la cita.
async function generarResumenCitaEnSegundoPlano(supabaseUrl, headers, citaId, match) {
  try {
    const msgsRes = await fetch(
      `${supabaseUrl}/rest/v1/cita_mensajes?select=usuario_id,contenido&cita_id=eq.${encodeURIComponent(citaId)}&tipo=eq.texto&order=created_at.asc`,
      { headers }
    );
    const msgs = msgsRes.ok ? await msgsRes.json() : [];
    const transcripto = msgs.map(m => {
      const quien = m.usuario_id === null ? 'Soul' : (m.usuario_id === match.usuario_a ? 'A' : 'B');
      return quien + ': ' + m.contenido;
    }).join('\n');
    if (!transcripto) return;

    const { json } = await llamarClaudeJSON({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: RESUMEN_CITA_PROMPT,
      messages: [{ role: 'user', content: transcripto }]
    });
    await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ resumen_ia: json })
    });
  } catch (e) {
    console.error('Error generando resumen de cita:', e);
  }
}

// Mensaje de apertura del debriefing corto (Nivel 1) -- primera de las 2
// preguntas que se conservan (ver CIERRE_DEBRIEFING_CORTO_PROMPT para el
// cierre, mas abajo, y buildReflexionPrompt en soul.html para la segunda
// pregunta).
function debriefingAperturaPrompt(otraPersonaNombre) {
  return `Sos Soul. Acaba de terminar una cita virtual entre dos personas que hicieron match, y le hablás en privado a una de ellas -- esta charla nunca la ve la otra persona. Es un chequeo brevísimo (no un análisis exhaustivo, no dura más que un par de mensajes) para pensar juntas cómo fue el encuentro con ${otraPersonaNombre || 'la otra persona'}.

Es el primer mensaje: arrancá vos, con calidez y curiosidad genuina, preguntando cómo se siente después del encuentro y, en el mismo mensaje, si tuviera que describir la cita con tres palabras, cuáles elegiría. Un solo mensaje corto, sin markdown, sin listas, nunca como un formulario.`;
}

// La segunda y última pregunta del debriefing corto (Nivel 1) se arma del
// lado del cliente (buildReflexionPrompt en soul.html), igual que la
// apertura de arriba se manda como primer mensaje pero el resto de la
// charla la maneja /api/chat directo con streaming -- ver ese archivo.

async function guardarHistorialReflexion(supabaseUrl, headers, citaId, usuarioId, historial) {
  await fetch(`${supabaseUrl}/rest/v1/cita_reflexiones?on_conflict=cita_id,usuario_id`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ cita_id: citaId, usuario_id: usuarioId, historial, updated_at: new Date().toISOString() })
  });
}

// Extrae las señales reales de vinculo desde los cita_mensajes (una sola
// vez por match, cacheadas en matches.insights_debriefing_a/b) -- sigue
// alimentando el algoritmo de compatibilidad con evidencia real de como se
// vincula cada persona en la practica, aparte de lo que se recolecta en la
// conversacion guiada del debriefing. Se llama con await (agrega unos
// segundos al primer mensaje del debriefing) porque un "fire and forget"
// real no es confiable en un entorno serverless -- mismo motivo que
// generarResumenCitaEnSegundoPlano, mas arriba. Cualquier fallo queda solo
// logueado.
// Toma la cita ya resuelta (con id, consiente_analisis_a/b,
// insights_debriefing_a/b) en vez de buscarla por matchId -- con la Sala de
// Encuentros puede haber varias citas por match, y esta extraccion es
// siempre sobre UNA cita puntual, la que se esta debriefeando.
async function extraerDinamicaRelacionalEnSegundoPlano(supabaseUrl, headers, match, cita) {
  if (cita.insights_debriefing_a || cita.insights_debriefing_b) return null;
  // Sin consentimiento explícito de las dos personas, no se analiza --
  // default siempre "no" (ver Etapa 1: si alguna no contestó, queda null,
  // que acá también cuenta como "no").
  if (cita.consiente_analisis_a !== true || cita.consiente_analisis_b !== true) return null;
  try {
    const msgsRes = await fetch(
      `${supabaseUrl}/rest/v1/cita_mensajes?select=usuario_id,contenido&cita_id=eq.${encodeURIComponent(cita.id)}&tipo=eq.texto&order=created_at.asc`,
      { headers }
    );
    const msgs = msgsRes.ok ? await msgsRes.json() : [];
    const transcripto = msgs.map(m => {
      const quien = m.usuario_id === null ? 'Soul' : (m.usuario_id === match.usuario_a ? 'A' : 'B');
      return quien + ': ' + m.contenido;
    }).join('\n');
    if (!transcripto) return null;

    const { json } = await llamarClaudeJSON({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: DINAMICA_RELACIONAL_PROMPT,
      messages: [{ role: 'user', content: 'Transcripción de la cita:\n\n' + transcripto }]
    });
    await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(cita.id)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ insights_debriefing_a: json.a || null, insights_debriefing_b: json.b || null })
    });
    return json;
  } catch (e) {
    console.error('Error extrayendo dinámica relacional de la cita:', e);
    return null;
  }
}

// Primera vez que esta persona abre el debriefing de esta cita puntual:
// Soul arranca con la primera pregunta -- la devolucion (2 observaciones)
// pasa recien al cierre, ver cerrarReflexion(). Cualquier fallo acá cae en
// un array vacio -- el cliente ya tiene su propio saludo generico de
// respaldo si el historial llega vacío.
async function generarDevolucionInicial(supabaseUrl, headers, usuario, match, cita, soyA, otraPersonaNombre) {
  await extraerDinamicaRelacionalEnSegundoPlano(supabaseUrl, headers, match, cita);
  try {
    const data = await llamarClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: debriefingAperturaPrompt(otraPersonaNombre),
      messages: [{ role: 'user', content: 'Arrancá la conversación.' }]
    });
    const texto = (data.content || []).map(b => b.text || '').join('').trim();
    if (!texto) return [];

    const historialNuevo = [{ role: 'assistant', content: texto }];
    await guardarHistorialReflexion(supabaseUrl, headers, cita.id, usuario.usuarioId, historialNuevo);
    return historialNuevo;
  } catch (e) {
    console.error('Error generando apertura de debriefing:', e);
    return [];
  }
}

// Conversacion privada de reflexion/debriefing sobre UNA cita puntual --
// una por (usuario, cita), nunca compartida con la otra persona del match.
// Con la Sala de Encuentros, cada encuentro (fila de citas) tiene su propio
// debriefing independiente, aunque sean del mismo match. La IA en si la
// maneja el cliente llamando directo a /api/chat (mismo streaming que el
// chat principal); esto persiste el historial (sembrando la devolucion
// inicial la primera vez) y devuelve el contexto para que el cliente arme
// el system prompt.
async function obtenerReflexion(req, res, supabaseUrl, headers, usuario) {
  const { reflexionCitaId } = req.query;
  const citaRes = await fetch(`${supabaseUrl}/rest/v1/citas?select=*&id=eq.${encodeURIComponent(reflexionCitaId)}`, { headers });
  const citasFila = citaRes.ok ? await citaRes.json() : [];
  const cita = citasFila[0];
  if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });

  const matchRes = await fetch(
    `${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b,mensaje_dupla,fortalezas,desafio&id=eq.${encodeURIComponent(cita.match_id)}`,
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
    `${supabaseUrl}/rest/v1/cita_reflexiones?select=historial&cita_id=eq.${encodeURIComponent(reflexionCitaId)}&usuario_id=eq.${encodeURIComponent(usuario.usuarioId)}`,
    { headers }
  );
  const reflexiones = reflexionRes.ok ? await reflexionRes.json() : [];
  let historial = reflexiones[0] ? reflexiones[0].historial : [];
  if (!historial || historial.length === 0) {
    historial = await generarDevolucionInicial(supabaseUrl, headers, usuario, match, cita, soyA, otraPersonaNombre);
  }

  return res.status(200).json({
    historial,
    otraPersonaNombre,
    mensajeDupla: match.mensaje_dupla || null,
    fortalezas: match.fortalezas || null,
    desafio: match.desafio || null,
    // Si ya se cerro (ver cerrarReflexion), el cliente muestra el
    // historial pero no deja seguir escribiendo -- evita otra ronda de
    // extraccion sobre una conversacion que ya se sintetizo.
    cerrada: !!(soyA ? cita.refinamiento_a : cita.refinamiento_b)
  });
}

// Cierre del debriefing corto (Nivel 1) -- se dispara apenas la persona
// contesta la segunda pregunta (ver TOPE_MENSAJES_REFLEXION=2 en
// soul.html), nunca una charla larga. Combina dos fuentes: lo que la
// persona autoreportó en esta charla (resumen_breve, aprendizaje) y --
// SOLO si hubo consentimiento de las dos partes -- el analisis objetivo de
// dinamica relacional ya extraido (insights_debriefing_a/b), del que salen
// las 2 observaciones (fortaleza_observada, algo_para_explorar). Sin
// consentimiento, esas dos quedan en null y el cierre es solo calido.
const CIERRE_DEBRIEFING_CORTO_PROMPT = `Sos Soul. Esta conversación breve de debriefing después de una cita real llegó a su cierre. Tenés dos fuentes:

1. Lo que la persona te contó en esta charla (cómo se sintió, tres palabras, qué descubrió sobre sí misma).
2. Un análisis aparte de la dinámica real de cómo se vinculó en la cita (te lo paso como JSON en el mensaje -- puede venir vacío/null si no hubo consentimiento para analizarlo; en ese caso NO inventes observaciones de contenido).

Tu tarea es doble:

1. Extraé, solo si es real y concreto (si no, null):
- resumen_breve: cómo dijo que se sintió + las tres palabras que usó, en una frase.
- aprendizaje: qué descubrió sobre sí misma, en una frase. Null si no llegó a contestar eso.
- fortaleza_observada: SOLO si hay análisis de dinámica disponible (fuente 2) -- una fortaleza concreta que viste en cómo se vinculó (ej. "hiciste varias preguntas abiertas que ayudaron a que la conversación avanzara"). Null si no hay análisis disponible.
- algo_para_explorar: SOLO si hay análisis de dinámica disponible -- algo puntual para que se pregunte a sí misma, en tono de pregunta abierta, nunca diagnóstico (ej. "cuando apareció un tema personal, cambiaste de conversación rápido -- ¿fue una elección consciente?"). Null si no hay análisis disponible.

2. Escribí el mensaje de cierre (2-3 frases como mucho, nunca una lista): si hay fortaleza_observada y algo_para_explorar, decilas ahí, siempre interpretativo ("me pareció notar que...", "tal vez..."), nunca "sos así" ni una verdad. Si no hay análisis disponible (sin consentimiento), cerrá con calidez simple a partir de lo que te contó, sin inventar observaciones de contenido.

Respondé ÚNICAMENTE con JSON válido sin backticks: {"resumen_breve":null,"aprendizaje":null,"fortaleza_observada":null,"algo_para_explorar":null,"mensaje_cierre":""}`;

async function cerrarReflexion(req, res, supabaseUrl, headers, usuario) {
  const { citaId, historial } = req.body;
  if (!citaId || !Array.isArray(historial)) return res.status(400).json({ error: 'Faltan datos' });
  const citaRes = await fetch(`${supabaseUrl}/rest/v1/citas?select=id,match_id,insights_debriefing_a,insights_debriefing_b&id=eq.${encodeURIComponent(citaId)}`, { headers });
  const citasFila = citaRes.ok ? await citaRes.json() : [];
  const cita = citasFila[0];
  if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
  const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&id=eq.${encodeURIComponent(cita.match_id)}`, { headers });
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  if (match.usuario_a !== usuario.usuarioId && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  const soyA = match.usuario_a === usuario.usuarioId;
  const dinamicaPropia = soyA ? cita.insights_debriefing_a : cita.insights_debriefing_b;

  const transcripto = historial.map(m => (m.role === 'assistant' ? 'Soul: ' : 'Usuario: ') + m.content).join('\n');
  let resultado = { resumen_breve: null, aprendizaje: null, fortaleza_observada: null, algo_para_explorar: null, mensaje_cierre: null };
  try {
    const { json } = await llamarClaudeJSON({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: CIERRE_DEBRIEFING_CORTO_PROMPT,
      messages: [{ role: 'user', content: 'Conversación:\n' + transcripto + '\n\nAnálisis de dinámica (fuente 2, puede ser null): ' + JSON.stringify(dinamicaPropia || null) }]
    });
    resultado = json;
  } catch (e) {
    console.error('Error cerrando debriefing corto:', e);
  }

  const mensajeCierre = resultado.mensaje_cierre || 'Gracias por pensar esto conmigo.';

  const refinamiento = {
    resumen_breve: resultado.resumen_breve || null,
    aprendizaje: resultado.aprendizaje || null,
    fortaleza_observada: resultado.fortaleza_observada || null,
    algo_para_explorar: resultado.algo_para_explorar || null
  };
  await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(citaId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ [soyA ? 'refinamiento_a' : 'refinamiento_b']: refinamiento })
  });

  const historialFinal = historial.concat([{ role: 'assistant', content: mensajeCierre }]);
  await guardarHistorialReflexion(supabaseUrl, headers, citaId, usuario.usuarioId, historialFinal);

  return res.status(200).json({ mensajeCierre });
}

async function guardarReflexion(req, res, supabaseUrl, headers, usuario) {
  const { citaId, historial } = req.body;
  if (!citaId || !Array.isArray(historial)) return res.status(400).json({ error: 'Faltan datos' });
  const citaRes = await fetch(`${supabaseUrl}/rest/v1/citas?select=id,match_id&id=eq.${encodeURIComponent(citaId)}`, { headers });
  const citasFila = citaRes.ok ? await citaRes.json() : [];
  const cita = citasFila[0];
  if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
  const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&id=eq.${encodeURIComponent(cita.match_id)}`, { headers });
  const matches = matchRes.ok ? await matchRes.json() : [];
  const match = matches[0];
  if (!match) return res.status(404).json({ error: 'Match no encontrado' });
  if (match.usuario_a !== usuario.usuarioId && match.usuario_b !== usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  // Upsert por (cita_id, usuario_id) -- el cliente siempre manda el
  // historial completo, no hace falta trackear un id de fila. Cada
  // encuentro (fila de citas) tiene su propio debriefing independiente.
  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/cita_reflexiones?on_conflict=cita_id,usuario_id`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ cita_id: citaId, usuario_id: usuario.usuarioId, historial, updated_at: new Date().toISOString() })
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
      if (req.query.reflexionCitaId) {
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
      if (accion === 'consentirAnalisis') return await consentirAnalisis(req, res, supabaseUrl, headers, usuario);
      if (accion === 'ayudaPrivada') return await pedirAyuda(req, res, supabaseUrl, headers, usuario);
      if (accion === 'responderCierre') return await responderCierre(req, res, supabaseUrl, headers, usuario);
      if (accion === 'decidirSalaEncuentros') return await decidirSalaEncuentros(req, res, supabaseUrl, headers, usuario);
      if (accion === 'checkinEmocional') return await checkinEmocional(req, res, supabaseUrl, headers, usuario);
      if (accion === 'guardarReflexion') return await guardarReflexion(req, res, supabaseUrl, headers, usuario);
      if (accion === 'cerrarReflexion') return await cerrarReflexion(req, res, supabaseUrl, headers, usuario);
      return res.status(400).json({ error: 'Acción no válida' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error en /api/citas:', error);
    return res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
}
