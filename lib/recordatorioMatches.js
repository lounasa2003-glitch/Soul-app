import { notificarMatchSinDecision, notificarCitaSinMensaje, notificarDebriefingPendiente } from './email.js';
import { registrarErrorSilencioso } from './logErrorSilencioso.js';
import { enviarPushAUsuario } from './push.js';

// Recordatorio para dos situaciones distintas de "matcheó y no contestó":
// 1) el match sigue 'activo' y esta persona nunca eligió aceptar/rechazar
//    (eleccion_usuario_a/b en null o 'pendiente' -- ver api/matches.js).
// 2) ya se aceptó y hay una cita abierta, pero esta persona nunca escribió
//    un mensaje ahí (distinto del caso anterior: acá sí decidió seguir).
// Mismo criterio de disparo oportunista + throttle que
// lib/recordatorioIntake.js (ver ese archivo para la explicación de por qué
// no es un cron dedicado) -- se llama fire-and-forget desde authUtil.js.
const ESPERA_MATCH_MS = 24 * 60 * 60 * 1000; // acá se trata de una decisión real sobre un vínculo, no de un trámite a medio completar -- avisar a las 2hs (como el recordatorio de datos) se sentiría apurado.
const THROTTLE_CHEQUEO_MS = 15 * 60 * 1000;

export async function chequearRecordatoriosMatches(supabaseUrl, supabaseKey) {
  // 'matches', 'citas' y 'cita_mensajes' ya tienen politica RLS real -- este
  // chequeo recorre TODAS las personas del piloto buscando recordatorios
  // pendientes, no una sola sesion, asi que no hay ningun token propio que
  // tenga sentido usar aca. Service role key, bypasea la politica siempre.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  try {
    const throttleRes = await fetch(
      `${supabaseUrl}/rest/v1/rate_limits?select=ventana_inicio&email=eq.sistema&endpoint=eq.recordatorio_matches`,
      { headers }
    );
    const throttleFilas = throttleRes.ok ? await throttleRes.json() : [];
    const ultimaCorrida = throttleFilas[0] ? new Date(throttleFilas[0].ventana_inicio).getTime() : 0;
    if (Date.now() - ultimaCorrida < THROTTLE_CHEQUEO_MS) return;

    // Se marca ANTES de hacer el trabajo -- mismo motivo que en
    // recordatorioIntake.js (evitar que dos requests casi simultáneos
    // dupliquen la corrida).
    await fetch(`${supabaseUrl}/rest/v1/rate_limits?on_conflict=email,endpoint`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: 'sistema', endpoint: 'recordatorio_matches', ventana_inicio: new Date().toISOString(), contador: 1 })
    });

    const limite = new Date(Date.now() - ESPERA_MATCH_MS).toISOString();
    await avisarEleccionPendiente(supabaseUrl, headers, limite);
    await avisarCitaSinMensaje(supabaseUrl, headers, limite);
    await avisarDebriefingPendiente(supabaseUrl, headers, limite);
  } catch (e) {
    console.error('Error chequeando recordatorios de matches:', e);
    await registrarErrorSilencioso({ contexto: 'lib/recordatorioMatches', error: e });
  }
}

// Lado A y B por separado -- cada uno puede necesitar el aviso
// independientemente del otro, y cada uno tiene su propia columna de guard
// (recordatorio_eleccion_enviado_a/b en matches) para no duplicar el envío.
async function avisarEleccionPendiente(supabaseUrl, headers, limite) {
  for (const lado of ['a', 'b']) {
    const campoEleccion = `eleccion_usuario_${lado}`;
    const campoGuard = `recordatorio_eleccion_enviado_${lado}`;
    const res = await fetch(
      `${supabaseUrl}/rest/v1/matches?select=id,usuario_a,usuario_b&estado=eq.activo&created_at=lt.${encodeURIComponent(limite)}&${campoGuard}=is.null&or=(${campoEleccion}.is.null,${campoEleccion}.eq.pendiente)`,
      { headers }
    );
    const pendientes = res.ok ? await res.json() : [];
    if (pendientes.length === 0) continue;

    const idsUsuarios = [...new Set(pendientes.flatMap(m => [m.usuario_a, m.usuario_b]))];
    const usuariosRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,comunicaciones_producto_aceptadas&id=in.(${idsUsuarios.map(encodeURIComponent).join(',')})`, { headers });
    const usuarios = usuariosRes.ok ? await usuariosRes.json() : [];
    const porId = Object.fromEntries(usuarios.map(u => [u.id, u]));

    for (const m of pendientes) {
      const propioId = lado === 'a' ? m.usuario_a : m.usuario_b;
      const otroId = lado === 'a' ? m.usuario_b : m.usuario_a;
      const propio = porId[propioId];
      const otro = porId[otroId];
      if (!propio || !propio.email) continue;
      // DE PRODUCTO -- gateado por comunicaciones_producto_aceptadas dentro
      // de enviarPushAUsuario (ver lib/push.js).
      enviarPushAUsuario(propioId, {
        titulo: 'Tenés un match esperando',
        cuerpo: 'Todavía no elegiste si querés conocer a esta persona.',
        data: { tipo: 'recordatorio_eleccion' },
        esencial: false
      }).catch(() => {});
      const enviado = await notificarMatchSinDecision({ nombre: propio.nombre, email: propio.email, otroNombre: otro ? otro.nombre : null, comunicaciones_producto_aceptadas: propio.comunicaciones_producto_aceptadas });
      if (enviado) {
        await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(m.id)}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ [campoGuard]: new Date().toISOString() })
        });
      }
    }
  }
}

// El guard vive en la cita (no en el match): una misma persona puede tener
// varios encuentros dentro del mismo match ("seguir en Soul" abre uno
// nuevo), y cada encuentro es una oportunidad de escribir independiente de
// las anteriores.
async function avisarCitaSinMensaje(supabaseUrl, headers, limite) {
  for (const lado of ['a', 'b']) {
    const campoGuard = `recordatorio_sin_mensaje_enviado_${lado}`;
    const citasRes = await fetch(
      `${supabaseUrl}/rest/v1/citas?select=id,match_id&created_at=lt.${encodeURIComponent(limite)}&${campoGuard}=is.null&estado=in.(pendiente,activa)`,
      { headers }
    );
    const citas = citasRes.ok ? await citasRes.json() : [];
    if (citas.length === 0) continue;

    const matchIds = [...new Set(citas.map(c => c.match_id))];
    const matchesRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=id,usuario_a,usuario_b&id=in.(${matchIds.map(encodeURIComponent).join(',')})`, { headers });
    const matches = matchesRes.ok ? await matchesRes.json() : [];
    const matchPorId = Object.fromEntries(matches.map(m => [m.id, m]));

    const citaIds = citas.map(c => c.id);
    const mensajesRes = await fetch(`${supabaseUrl}/rest/v1/cita_mensajes?select=cita_id,usuario_id&cita_id=in.(${citaIds.map(encodeURIComponent).join(',')})&tipo=eq.texto`, { headers });
    const mensajes = mensajesRes.ok ? await mensajesRes.json() : [];
    const remitentesPorCita = {};
    for (const msg of mensajes) {
      if (!remitentesPorCita[msg.cita_id]) remitentesPorCita[msg.cita_id] = new Set();
      remitentesPorCita[msg.cita_id].add(msg.usuario_id);
    }

    const candidatas = [];
    for (const c of citas) {
      const match = matchPorId[c.match_id];
      if (!match) continue;
      const propioId = lado === 'a' ? match.usuario_a : match.usuario_b;
      const otroId = lado === 'a' ? match.usuario_b : match.usuario_a;
      const yaEscribio = remitentesPorCita[c.id] && remitentesPorCita[c.id].has(propioId);
      if (!yaEscribio) candidatas.push({ citaId: c.id, propioId, otroId });
    }
    if (candidatas.length === 0) continue;

    const idsUsuarios = [...new Set(candidatas.flatMap(x => [x.propioId, x.otroId]))];
    const usuariosRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,comunicaciones_producto_aceptadas&id=in.(${idsUsuarios.map(encodeURIComponent).join(',')})`, { headers });
    const usuarios = usuariosRes.ok ? await usuariosRes.json() : [];
    const porId = Object.fromEntries(usuarios.map(u => [u.id, u]));

    for (const cand of candidatas) {
      const propio = porId[cand.propioId];
      const otro = porId[cand.otroId];
      if (!propio || !propio.email) continue;
      // DE PRODUCTO -- gateado por comunicaciones_producto_aceptadas dentro
      // de enviarPushAUsuario (ver lib/push.js).
      enviarPushAUsuario(cand.propioId, {
        titulo: 'Tu encuentro está esperando el primer mensaje',
        cuerpo: 'Todavía no escribiste nada ahí.',
        data: { tipo: 'recordatorio_sin_mensaje', citaId: cand.citaId },
        esencial: false
      }).catch(() => {});
      const enviado = await notificarCitaSinMensaje({ nombre: propio.nombre, email: propio.email, otroNombre: otro ? otro.nombre : null, comunicaciones_producto_aceptadas: propio.comunicaciones_producto_aceptadas });
      if (enviado) {
        await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(cand.citaId)}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ [campoGuard]: new Date().toISOString() })
        });
      }
    }
  }
}

// El único aviso que hoy tenía una cita cerrada era el push que manda
// finalizarCita() en el momento mismo del cierre (lib/cierreCita.js) -- sin
// respaldo por mail y sin ningún recordatorio si esa notificación puntual
// no se vio o el push no estaba activado todavía. Este es ese respaldo:
// mismo criterio de guard por cita+lado que avisarCitaSinMensaje. Reusa a
// propósito el mismo tipo de push 'debriefing_listo' que ya dispara
// finalizarCita() -- el deep link al abrirlo ya está resuelto en el cliente
// (aplicarDeepLinkPush en soul.html), no hace falta un tipo nuevo.
async function avisarDebriefingPendiente(supabaseUrl, headers, limite) {
  for (const lado of ['a', 'b']) {
    const campoRefinamiento = `refinamiento_${lado}`;
    const campoGuard = `recordatorio_debriefing_enviado_${lado}`;
    const citasRes = await fetch(
      `${supabaseUrl}/rest/v1/citas?select=id,match_id&estado=eq.cerrada&cerrada_en=lt.${encodeURIComponent(limite)}&${campoGuard}=is.null&${campoRefinamiento}=is.null`,
      { headers }
    );
    const citas = citasRes.ok ? await citasRes.json() : [];
    if (citas.length === 0) continue;

    const matchIds = [...new Set(citas.map(c => c.match_id))];
    const matchesRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=id,usuario_a,usuario_b&id=in.(${matchIds.map(encodeURIComponent).join(',')})`, { headers });
    const matches = matchesRes.ok ? await matchesRes.json() : [];
    const matchPorId = Object.fromEntries(matches.map(m => [m.id, m]));

    const candidatas = [];
    for (const c of citas) {
      const match = matchPorId[c.match_id];
      if (!match) continue;
      const propioId = lado === 'a' ? match.usuario_a : match.usuario_b;
      candidatas.push({ citaId: c.id, propioId });
    }
    if (candidatas.length === 0) continue;

    const idsUsuarios = [...new Set(candidatas.map(x => x.propioId))];
    const usuariosRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,comunicaciones_producto_aceptadas&id=in.(${idsUsuarios.map(encodeURIComponent).join(',')})`, { headers });
    const usuarios = usuariosRes.ok ? await usuariosRes.json() : [];
    const porId = Object.fromEntries(usuarios.map(u => [u.id, u]));

    for (const cand of candidatas) {
      const propio = porId[cand.propioId];
      if (!propio) continue;
      // DE PRODUCTO -- gateado por comunicaciones_producto_aceptadas dentro
      // de enviarPushAUsuario (ver lib/push.js).
      enviarPushAUsuario(cand.propioId, {
        titulo: 'Tu reflexión sigue esperando',
        cuerpo: 'Soul preparó algo para vos sobre tu último encuentro.',
        data: { tipo: 'debriefing_listo', citaId: cand.citaId },
        esencial: false
      }).catch(() => {});
      if (!propio.email) continue;
      const enviado = await notificarDebriefingPendiente({ nombre: propio.nombre, email: propio.email, comunicaciones_producto_aceptadas: propio.comunicaciones_producto_aceptadas });
      if (enviado) {
        await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(cand.citaId)}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ [campoGuard]: new Date().toISOString() })
        });
      }
    }
  }
}
