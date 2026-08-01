import { notificarPerfilPendiente } from './email.js';
import { registrarErrorSilencioso } from './logErrorSilencioso.js';
import { enviarPushAUsuario } from './push.js';

// Recordatorio para quien terminó de hablar con Soul pero todavía no
// confirmó su representación interpretativa ("Esto me representa") -- ver
// perfil_pendiente_desde/perfil_validado en 'perfiles'. Mismo criterio de
// disparo oportunista + throttle que lib/recordatorioIntake.js y
// lib/recordatorioMatches.js (se llama fire-and-forget desde
// verificarUsuario en lib/authUtil.js).
const ESPERA_24H_MS = 24 * 60 * 60 * 1000;
const ESPERA_72H_MS = 72 * 60 * 60 * 1000;
const THROTTLE_CHEQUEO_MS = 15 * 60 * 1000;

export async function chequearRecordatoriosPerfilPendiente(supabaseUrl, supabaseKey) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  try {
    const throttleRes = await fetch(
      `${supabaseUrl}/rest/v1/rate_limits?select=ventana_inicio&email=eq.sistema&endpoint=eq.recordatorio_perfil_pendiente`,
      { headers }
    );
    const throttleFilas = throttleRes.ok ? await throttleRes.json() : [];
    const ultimaCorrida = throttleFilas[0] ? new Date(throttleFilas[0].ventana_inicio).getTime() : 0;
    if (Date.now() - ultimaCorrida < THROTTLE_CHEQUEO_MS) return;

    // Se marca ANTES de hacer el trabajo -- mismo motivo que en
    // recordatorioIntake.js/recordatorioMatches.js (evitar que dos
    // requests casi simultáneos dupliquen la corrida completa). La
    // protección fina por persona (mark-then-send) va aparte, más abajo.
    await fetch(`${supabaseUrl}/rest/v1/rate_limits?on_conflict=email,endpoint`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: 'sistema', endpoint: 'recordatorio_perfil_pendiente', ventana_inicio: new Date().toISOString(), contador: 1 })
    });

    const limite24h = new Date(Date.now() - ESPERA_24H_MS).toISOString();
    const limite72h = new Date(Date.now() - ESPERA_72H_MS).toISOString();
    await avisarPerfilPendiente(supabaseUrl, headers, limite24h, '24h', 'recordatorio_pendiente_24h_enviado');
    await avisarPerfilPendiente(supabaseUrl, headers, limite72h, '72h', 'recordatorio_pendiente_72h_enviado');
  } catch (e) {
    console.error('Error chequeando recordatorios de perfil pendiente:', e);
    await registrarErrorSilencioso({ contexto: 'lib/recordatorioPerfilPendiente', error: e });
  }
}

// campoGuard es cual de los dos avisos (24h/72h) se está evaluando --
// máximo un envío por campo, así que entre los dos nunca se manda más de
// dos veces por ciclo pendiente (Decision: "máximo dos avisos").
async function avisarPerfilPendiente(supabaseUrl, headers, limite, etiqueta, campoGuard) {
  // perfil_validado=eq.false (no is.null): NO se manda a quien nunca llegó
  // a tener una interpretación generada (perfil_pendiente_desde seguiría
  // null ahí tampoco, asi que el segundo filtro ya lo excluye igual --
  // este es el chequeo explícito). Se vuelve a consultar el estado
  // completo acá mismo, no un valor cacheado de una corrida anterior.
  const res = await fetch(
    `${supabaseUrl}/rest/v1/perfiles?select=usuario_id,perfil_pendiente_desde&perfil_validado=eq.false&perfil_pendiente_desde=lt.${encodeURIComponent(limite)}&perfil_pendiente_desde=not.is.null&${campoGuard}=is.null`,
    { headers }
  );
  const pendientes = res.ok ? await res.json() : [];
  if (pendientes.length === 0) return;

  const idsUsuarios = pendientes.map((p) => p.usuario_id);
  const usuariosRes = await fetch(
    `${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,comunicaciones_producto_aceptadas,eliminacion_solicitada_en&id=in.(${idsUsuarios.map(encodeURIComponent).join(',')})`,
    { headers }
  );
  const usuarios = usuariosRes.ok ? await usuariosRes.json() : [];
  const porId = Object.fromEntries(usuarios.map((u) => [u.id, u]));

  for (const p of pendientes) {
    const propio = porId[p.usuario_id];
    if (!propio) continue;
    // Cuenta con borrado solicitado -- no tiene sentido recordarle que
    // confirme un perfil que va a dejar de existir.
    if (propio.eliminacion_solicitada_en) continue;

    // PATCH condicional ("mark-then-send"): el propio filtro de la URL
    // (campoGuard=is.null) hace que esto sea atómico -- si otro request
    // simultáneo ya marcó esta fila entre la lectura de arriba y este
    // PATCH, la condición ya no matchea y el UPDATE no afecta ninguna
    // fila. Recién si esto confirma haber actualizado algo se manda el
    // aviso -- nunca al revés (send-then-mark), que es como hoy funcionan
    // recordatorioIntake.js/recordatorioMatches.js y sí deja una ventana de
    // carrera real.
    const claimRes = await fetch(
      `${supabaseUrl}/rest/v1/perfiles?usuario_id=eq.${encodeURIComponent(p.usuario_id)}&${campoGuard}=is.null`,
      {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ [campoGuard]: new Date().toISOString() })
      }
    );
    const claimData = claimRes.ok ? await claimRes.json() : [];
    if (!Array.isArray(claimData) || claimData.length === 0) continue; // otro proceso ya lo marcó primero

    // DE PRODUCTO -- gateado por comunicaciones_producto_aceptadas dentro
    // de enviarPushAUsuario (ver lib/push.js) y de notificarPerfilPendiente.
    enviarPushAUsuario(p.usuario_id, {
      titulo: 'Tu perfil sigue pendiente de confirmar',
      cuerpo: 'Hasta que lo confirmes, Soul no te incluye en las búsquedas de compatibilidad.',
      data: { tipo: 'perfil_pendiente_confirmar' },
      esencial: false
    }).catch(() => {});
    await notificarPerfilPendiente({
      nombre: propio.nombre,
      email: propio.email,
      comunicaciones_producto_aceptadas: propio.comunicaciones_producto_aceptadas
    }).catch(() => {});
  }
}
