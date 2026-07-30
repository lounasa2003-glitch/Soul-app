import { notificarDiagnosticoDiario } from '../../lib/email.js';
import { finalizarCita } from '../../lib/cierreCita.js';
import { registrarErrorSilencioso } from '../../lib/logErrorSilencioso.js';

// Corre una vez por dia (ver vercel.json) y junta en un solo lugar lo que
// hoy solo se ve revisando a mano Resend/Supabase por separado -- tanto los
// errores que ya se ven (endpoints que devuelven 500) como los que quedan
// en silencio (catches best-effort que solo hacian console.error, ver
// lib/logErrorSilencioso.js). Vercel llama a este endpoint con
// Authorization: Bearer $CRON_SECRET automaticamente si esa env var esta
// configurada -- sin ella, nadie mas deberia poder disparar esto.
const VENTANA_HORAS = 24;
const UMBRAL_SIN_CONFIRMAR_HORAS = 3;
// Estimacion aproximada para claude-sonnet-4-6 -- ajustar si la facturacion
// real difiere. Es solo una referencia rapida en el mail, no un numero
// contable. Cache read/creation son fracciones estandar del precio de
// input normal de Anthropic (lectura ~10%, escritura ~125%) -- sin esto
// el costo quedaba subestimado, porque esos tokens de cache existen de
// verdad y se cobran, pero no se contaban en ningun lado (ver
// lib/logUso.js).
const USD_POR_MILLON_INPUT = 3;
const USD_POR_MILLON_OUTPUT = 15;
const USD_POR_MILLON_CACHE_CREATION = USD_POR_MILLON_INPUT * 1.25;
const USD_POR_MILLON_CACHE_READ = USD_POR_MILLON_INPUT * 0.1;

function haceHoras(horas) {
  return new Date(Date.now() - horas * 3600 * 1000).toISOString();
}

// Plazo prometido en legal.html ("tus datos se borran dentro de los 30 días
// posteriores a la solicitud") -- solicitarBorrado en api/auth.js ya corta
// el acceso al toque (ver eliminacion_solicitada_en en lib/authUtil.js);
// esto es lo que hace el borrado real, corrido desde ESTE cron (no uno
// nuevo) porque el plan Hobby de Vercel ya esta al limite de funciones.
const DIAS_GRACIA_BORRADO = 30;

// Las tablas puramente personales (nadie mas las necesita) se borran
// directo. Las compartidas con otra persona real (cita_mensajes, matches,
// citas) NO se tocan aca -- borrarlas completas destruiria el registro de
// la OTRA persona de un vinculo real que ella no pidio borrar. En cambio se
// anonimiza la fila de 'usuarios' en el lugar (mismo id, para no romper los
// FK de matches/citas que sigan referenciandola) y se le saca todo dato
// personal. uso_tokens/eventos_piloto tampoco se tocan: son metricas
// agregadas (conteos, no contenido), no dato personal identificable.
//
// cita_reflexiones, cita_ayudas y solicitudes_revision_perfil se sumaron
// via Decision 6 (propuesta-retencion.md) -- las tres son estrictamente
// propias (nunca compartidas con la otra persona de un match/cita, a
// diferencia de cita_mensajes/citas/matches), asi que no tienen el mismo
// problema de "romper el registro de otra persona" y pueden borrarse igual
// que perfiles/conversaciones.
const TABLAS_PERSONALES_A_BORRAR = ['perfiles', 'conversaciones', 'historial_relacional', 'intentos_fuga_prompt', 'cita_reflexiones', 'cita_ayudas', 'solicitudes_revision_perfil'];

async function purgarUsuario(supabaseUrl, supabaseKey, headers, usuarioId) {
  // Defensivo: si por lo que sea quedo una cita abierta (no deberia, ya se
  // cierran en el momento de solicitarBorrado), no se la deja huerfana.
  const matchesRes = await fetch(
    `${supabaseUrl}/rest/v1/matches?select=id,usuario_a,usuario_b&or=(usuario_a.eq.${encodeURIComponent(usuarioId)},usuario_b.eq.${encodeURIComponent(usuarioId)})`,
    { headers }
  );
  const matches = matchesRes.ok ? await matchesRes.json() : [];
  if (matches.length) {
    const idsMatches = matches.map((m) => encodeURIComponent(m.id)).join(',');
    const citasRes = await fetch(
      `${supabaseUrl}/rest/v1/citas?select=*&match_id=in.(${idsMatches})&estado=in.(pendiente,activa,chequeo_cierre)`,
      { headers }
    );
    const citasAbiertas = citasRes.ok ? await citasRes.json() : [];
    for (const cita of citasAbiertas) {
      const match = matches.find((m) => m.id === cita.match_id);
      if (!match) continue;
      await finalizarCita(supabaseUrl, headers, cita.id, cita, match, 'Este encuentro cerró porque una de las dos personas dejó Soul.').catch(() => {});
    }
  }

  for (const tabla of TABLAS_PERSONALES_A_BORRAR) {
    await fetch(`${supabaseUrl}/rest/v1/${tabla}?usuario_id=eq.${encodeURIComponent(usuarioId)}`, { method: 'DELETE', headers })
      .catch((e) => registrarErrorSilencioso({ contexto: `cron/diagnostico-diario: purgar ${tabla}`, error: e, meta: { usuarioId } }));
  }

  // feedback_piloto (Decision 6): a diferencia de las tablas de arriba, acá
  // NO se borra el contenido -- el feedback del piloto sigue teniendo valor
  // de aprendizaje de producto aunque la persona ya no esté. Se anonimiza
  // desvinculando el usuario_id (única columna identificadora directa de
  // esta tabla) en vez de borrar la fila entera.
  await fetch(`${supabaseUrl}/rest/v1/feedback_piloto?usuario_id=eq.${encodeURIComponent(usuarioId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ usuario_id: null })
  }).catch((e) => registrarErrorSilencioso({ contexto: 'cron/diagnostico-diario: anonimizar feedback_piloto', error: e, meta: { usuarioId } }));

  // Borrar la identidad real de Supabase Auth (email, password) requiere la
  // service role key, que hoy NO esta configurada en este proyecto (solo
  // existe SUPABASE_ANON_KEY) -- sin ella se anonimiza igual la fila de
  // 'usuarios', pero el login con ese email tecnicamente seguiria existiendo
  // en Supabase Auth hasta que se agregue esa env var. Se busca por email
  // (no se asume que usuarios.id == auth user id, ver soul_seguridad_rls).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let authBorrado = false;
  if (serviceKey) {
    try {
      const filaRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=email&id=eq.${encodeURIComponent(usuarioId)}`, { headers });
      const fila = (filaRes.ok ? await filaRes.json() : [])[0];
      if (fila && fila.email) {
        const buscarRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(fila.email)}`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
        });
        const buscarData = buscarRes.ok ? await buscarRes.json() : null;
        const authUser = buscarData && Array.isArray(buscarData.users) ? buscarData.users[0] : null;
        if (authUser) {
          const delRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(authUser.id)}`, {
            method: 'DELETE',
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
          });
          authBorrado = delRes.ok;
        }
      }
    } catch (e) {
      await registrarErrorSilencioso({ contexto: 'cron/diagnostico-diario: borrar usuario de Supabase Auth', error: e, meta: { usuarioId } });
    }
  }

  // Tombstone: se anonimiza en vez de borrar la fila para no romper los FK
  // de matches/citas que la otra persona real todavia necesita.
  await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(usuarioId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      cuenta_eliminada: true,
      nombre: null, email: `borrada-${usuarioId}@soul-app.eliminado`,
      fecha_nacimiento: null, hora_nacimiento: null, ciudad: null, distancia_max: null,
      genero: null, preferencia_genero: null, tipo_vinculo: null, hijos: null, preferencia_hijos: null,
      estado_civil: null, ocupacion: null, no_negociables: null, negociables: null,
      foto_cara: null, foto_cuerpo: null, foto_aprobada: false,
      mail_confirmado: false, token_confirmacion: null
    })
  });

  return authBorrado;
}

async function purgarCuentasVencidas(supabaseUrl, supabaseKey) {
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const limite = haceHoras(DIAS_GRACIA_BORRADO * 24);
  const res = await fetch(
    `${supabaseUrl}/rest/v1/usuarios?select=id&cuenta_eliminada=eq.false&eliminacion_solicitada_en=lte.${encodeURIComponent(limite)}`,
    { headers }
  );
  const pendientes = res.ok ? await res.json() : [];
  let purgadas = 0, authBorrados = 0;
  for (const u of pendientes) {
    try {
      const authOk = await purgarUsuario(supabaseUrl, supabaseKey, headers, u.id);
      purgadas += 1;
      if (authOk) authBorrados += 1;
    } catch (e) {
      await registrarErrorSilencioso({ contexto: 'cron/diagnostico-diario: purgarCuentasVencidas', error: e, meta: { usuarioId: u.id } });
    }
  }
  return { candidatas: pendientes.length, purgadas, authBorrados, serviceKeyConfigurada: !!process.env.SUPABASE_SERVICE_ROLE_KEY };
}

// Purga por antiguedad (Decision 6, propuesta-retencion.md) -- a diferencia
// de TABLAS_PERSONALES_A_BORRAR, esto NO depende de que nadie pida el
// borrado de su cuenta: son tablas puramente operativas (soporte tecnico,
// diagnostico interno), sin ningun vinculo compartido con otra persona, asi
// que se purgan por su propia fecha una vez que superan el plazo aprobado.
// 'creado_en' es el nombre de columna real en las tres tablas (verificado
// en el codigo que ya las lee mas abajo en este mismo archivo).
const RETENCION_DIAS = {
  reportes_tecnicos: 180, // ~6 meses
  errores_silenciosos: 90,
  diagnosticos_diarios: 90
};

async function purgarPorAntiguedad(supabaseUrl, supabaseKey) {
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=representation' };
  const resultado = {};
  for (const [tabla, dias] of Object.entries(RETENCION_DIAS)) {
    const limite = haceHoras(dias * 24);
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/${tabla}?creado_en=lt.${encodeURIComponent(limite)}`, {
        method: 'DELETE',
        headers
      });
      const borradas = res.ok ? (await res.json()).length : 0;
      resultado[tabla] = { borradas, ok: res.ok };
    } catch (e) {
      resultado[tabla] = { borradas: 0, ok: false };
      await registrarErrorSilencioso({ contexto: `cron/diagnostico-diario: purgarPorAntiguedad ${tabla}`, error: e });
    }
  }
  return resultado;
}

// Retención de cita_mensajes (Decisión 6, propuesta-retencion-citas.md
// aprobada) -- cita_mensajes es la transcripción íntima entre dos personas
// reales, así que no se conserva indefinidamente como el resto de lo
// compartido (citas/matches). citas.cerrada_en (ver finalizarCita en
// lib/cierreCita.js) es el momento en que arranca a correr este plazo. La
// fila de 'citas' en sí NUNCA se borra -- la otra persona necesita poder
// seguir viendo que el encuentro existió (Mis citas, Hoja de Vida) -- solo
// se borran los mensajes y se limpian los campos derivados por IA que
// resumen esa conversación (resumen_ia, insights_debriefing_a/b,
// perfil_cita_a/b, compatibilidad_cita_a/b, refinamiento_a/b), dejando en
// 'citas' únicamente lo estructural (estado, fechas, elecciones, flags de
// lectura/consentimiento) -- lo mínimo para que quede constancia de que la
// cita existió, sin transcripción ni análisis íntimo.
const RETENCION_MESES_CITA_MENSAJES = 12;

// Campos derivados por IA que resumen/analizan la conversación real de la
// cita -- se limpian junto con cita_mensajes porque son, en los hechos, otra
// forma de la misma transcripción íntima (un resumen sigue siendo
// contenido íntimo, no un dato estructural).
const CAMPOS_IA_CITA_A_LIMPIAR = {
  resumen_ia: null,
  insights_debriefing_a: null,
  insights_debriefing_b: null,
  perfil_cita_a: null,
  perfil_cita_b: null,
  compatibilidad_cita_a: null,
  compatibilidad_cita_b: null,
  refinamiento_a: null,
  refinamiento_b: null
};

async function purgarCitaMensajesVencidos(supabaseUrl, supabaseKey) {
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const limite = new Date(Date.now() - RETENCION_MESES_CITA_MENSAJES * 30 * 24 * 3600 * 1000).toISOString();

  const citasRes = await fetch(
    `${supabaseUrl}/rest/v1/citas?select=id,match_id&cerrada_en=lte.${encodeURIComponent(limite)}`,
    { headers }
  );
  const citasVencidas = citasRes.ok ? await citasRes.json() : [];
  if (citasVencidas.length === 0) return { citasVencidas: 0, citasPurgadas: 0, citasFrenadasPorReporte: 0 };

  // Un reporte ABIERTO sobre el match frena la purga de TODAS las citas de
  // ese match (no solo la reportada) -- puede necesitarse la transcripción
  // completa como evidencia mientras el caso sigue abierto.
  const matchIds = [...new Set(citasVencidas.map((c) => c.match_id))];
  const reportesRes = await fetch(
    `${supabaseUrl}/rest/v1/reportes?select=match_id&match_id=in.(${matchIds.map(encodeURIComponent).join(',')})&estado=eq.abierto`,
    { headers }
  );
  const reportesAbiertos = reportesRes.ok ? await reportesRes.json() : [];
  const matchesConReporteAbierto = new Set(reportesAbiertos.map((r) => r.match_id));

  let citasPurgadas = 0;
  let citasFrenadasPorReporte = 0;
  for (const cita of citasVencidas) {
    if (matchesConReporteAbierto.has(cita.match_id)) {
      citasFrenadasPorReporte += 1;
      continue;
    }
    try {
      await fetch(`${supabaseUrl}/rest/v1/cita_mensajes?cita_id=eq.${encodeURIComponent(cita.id)}`, {
        method: 'DELETE',
        headers
      });
      await fetch(`${supabaseUrl}/rest/v1/citas?id=eq.${encodeURIComponent(cita.id)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(CAMPOS_IA_CITA_A_LIMPIAR)
      });
      citasPurgadas += 1;
    } catch (e) {
      await registrarErrorSilencioso({ contexto: 'cron/diagnostico-diario: purgarCitaMensajesVencidos', error: e, meta: { citaId: cita.id } });
    }
  }
  return { citasVencidas: citasVencidas.length, citasPurgadas, citasFrenadasPorReporte };
}

// Este HTML se guarda en diagnosticos_diarios.texto_resumen y despues se
// inserta con innerHTML en el panel admin (ver cargarDiagnosticos en
// panel-admin.html) -- varios de los valores que arma este reporte son
// texto libre de usuarios reales (nombre, email, y el subject de mails que
// puede incluir el nombre de otra persona via notificarNuevoMatch). Sin
// escapar, alguien podria poner algo como su nombre y quedar guardado en
// la base para ejecutarse en el navegador de la administradora la proxima
// vez que abra esta pestaña -- mismo criterio que esc() en soul.html y
// panel-admin.html.
function esc(valor) {
  return String(valor == null ? '' : valor).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function leerSupabase(tabla, params) {
  const supabaseUrl = process.env.SUPABASE_URL;
  // Este cron no tiene sesion de ninguna persona (corre solo, con
  // CRON_SECRET) -- todas las tablas que lee este cron ya tienen politica
  // RLS real (o, para las tablas puramente internas -- errores_silenciosos,
  // uso_tokens, diagnosticos_diarios -- directamente cero acceso para
  // anon/authenticated, ver migracion_rls_tablas_internas.sql), asi que el
  // anon key devolveria 0 filas en cualquiera de los dos casos. Sin
  // fallback: si falta la service role key, que falle explicito (se ve en
  // el resultado de cada leerSupabase, no queda enmascarado con "0 filas"
  // silencioso como si no hubiera nada que reportar).
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${supabaseUrl}/rest/v1/${tabla}?${params}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  });
  if (!res.ok) {
    console.error(`diagnostico-diario: error leyendo ${tabla}`, res.status, await res.text());
    return [];
  }
  return res.json();
}

async function chequearResend(desde) {
  const rkey = process.env.RESEND_API_KEY;
  if (!rkey) return { disponible: false, problematicos: [], totalEnviados: 0 };
  const res = await fetch('https://api.resend.com/emails?limit=100', {
    headers: { Authorization: `Bearer ${rkey}` }
  });
  if (!res.ok) {
    console.error('diagnostico-diario: error consultando Resend', res.status, await res.text());
    return { disponible: false, problematicos: [], totalEnviados: 0 };
  }
  const data = await res.json();
  const emails = data.data || [];
  const desdeMs = new Date(desde).getTime();
  // @soul-app.test es el dominio sintetico de Vista Previa (ver
  // sembrarPreview en api/admin/matches.js) -- no es un dominio real, asi
  // que siempre va a rebotar/demorarse. Filtrarlo ademas de las cuentas de
  // test para no generar ruido falso todos los dias.
  const enVentana = emails.filter(e => {
    if (new Date(e.created_at).getTime() < desdeMs) return false;
    return !(e.to || []).some(d => d.endsWith('@soul-app.test'));
  });
  const problematicos = enVentana.filter(e => !['delivered', 'sent', 'queued'].includes(e.last_event));
  return {
    disponible: true,
    totalEnviados: enVentana.length,
    problematicos: problematicos.map(e => ({ to: (e.to || []).join(','), asunto: e.subject, estado: e.last_event, fecha: e.created_at }))
  };
}

export default async function handler(req, res) {
  const secretoEsperado = process.env.CRON_SECRET;
  if (secretoEsperado) {
    const recibido = (req.headers.authorization || '').replace('Bearer ', '');
    if (recibido !== secretoEsperado) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }

  try {
    const desde = haceHoras(VENTANA_HORAS);

    // Va antes que el resto del diagnostico (que es solo lectura) porque
    // esto SI escribe/borra -- si algo de la lectura de mas abajo fallara,
    // preferible que el borrado de cuentas vencidas ya haya corrido.
    // Service role key: matches/citas ya tienen politica RLS real, y este
    // cron no tiene sesion de nadie para usar un token propio. Sin fallback
    // a anon -- si falta la key, mejor que falle explicito (queda como
    // error en el diagnostico) a que corra en silencio sin borrar nada.
    const purgado = await purgarCuentasVencidas(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      .catch(async (e) => {
        await registrarErrorSilencioso({ contexto: 'cron/diagnostico-diario: purgarCuentasVencidas', error: e });
        return { candidatas: 0, purgadas: 0, authBorrados: 0, serviceKeyConfigurada: !!process.env.SUPABASE_SERVICE_ROLE_KEY, error: true };
      });

    // Purga por antiguedad (Decision 6) -- independiente de si alguien pidio
    // borrar su cuenta o no, corre siempre, mismo motivo de orden que arriba
    // (escritura antes que lectura).
    const purgadoAntiguedad = await purgarPorAntiguedad(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      .catch(async (e) => {
        await registrarErrorSilencioso({ contexto: 'cron/diagnostico-diario: purgarPorAntiguedad', error: e });
        return {};
      });

    // Retención de cita_mensajes a 12 meses desde el cierre (Decisión 6,
    // propuesta-retencion-citas.md) -- mismo motivo de orden que arriba
    // (escritura antes que lectura).
    const purgadoCitaMensajes = await purgarCitaMensajesVencidos(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      .catch(async (e) => {
        await registrarErrorSilencioso({ contexto: 'cron/diagnostico-diario: purgarCitaMensajesVencidos', error: e });
        return { citasVencidas: 0, citasPurgadas: 0, citasFrenadasPorReporte: 0, error: true };
      });

    const [errores, reportes, fugas, tokens, resend, sinConfirmar, reportesTecnicos] = await Promise.all([
      leerSupabase('errores_silenciosos', `select=contexto,mensaje,creado_en&creado_en=gte.${encodeURIComponent(desde)}&order=creado_en.desc&limit=500`),
      leerSupabase('reportes', `select=id,usuario_reporta,usuario_reportado,motivo,created_at&created_at=gte.${encodeURIComponent(desde)}`),
      leerSupabase('intentos_fuga_prompt', `select=id,usuario_id,mensaje,endpoint,created_at&created_at=gte.${encodeURIComponent(desde)}`),
      leerSupabase('uso_tokens', `select=endpoint,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens&created_at=gte.${encodeURIComponent(desde)}`),
      chequearResend(desde),
      leerSupabase('usuarios', `select=id,nombre,email,ultima_actividad&etapa_actual=eq.chat&mail_confirmado=eq.false&created_at=lte.${encodeURIComponent(haceHoras(UMBRAL_SIN_CONFIRMAR_HORAS))}`),
      leerSupabase('reportes_tecnicos', `select=id,usuario_id,email,contexto,creado_en&creado_en=gte.${encodeURIComponent(desde)}&order=creado_en.desc`)
    ]);

    const reportesTecnicosPorContexto = {};
    reportesTecnicos.forEach(r => { reportesTecnicosPorContexto[r.contexto] = (reportesTecnicosPorContexto[r.contexto] || 0) + 1; });

    const erroresPorContexto = {};
    errores.forEach(e => { erroresPorContexto[e.contexto] = (erroresPorContexto[e.contexto] || 0) + 1; });

    let totalInput = 0, totalOutput = 0, totalCacheCreation = 0, totalCacheRead = 0;
    tokens.forEach(t => {
      totalInput += t.input_tokens || 0;
      totalOutput += t.output_tokens || 0;
      totalCacheCreation += t.cache_creation_tokens || 0;
      totalCacheRead += t.cache_read_tokens || 0;
    });
    const costoEstimado = (totalInput / 1e6) * USD_POR_MILLON_INPUT
      + (totalOutput / 1e6) * USD_POR_MILLON_OUTPUT
      + (totalCacheCreation / 1e6) * USD_POR_MILLON_CACHE_CREATION
      + (totalCacheRead / 1e6) * USD_POR_MILLON_CACHE_READ;

    const resumen = {
      ventanaHoras: VENTANA_HORAS,
      erroresSilenciosos: { total: errores.length, porContexto: erroresPorContexto },
      reportes: { total: reportes.length, filas: reportes },
      intentosFuga: { total: fugas.length, filas: fugas },
      resend,
      cuentasSinConfirmar: { total: sinConfirmar.length, filas: sinConfirmar },
      reportesTecnicos: { total: reportesTecnicos.length, porContexto: reportesTecnicosPorContexto, filas: reportesTecnicos },
      borradoDeCuentas: purgado,
      purgaPorAntiguedad: purgadoAntiguedad,
      purgaCitaMensajes: purgadoCitaMensajes,
      tokens: { totalInput, totalOutput, totalCacheCreation, totalCacheRead, costoEstimadoUsd: Number(costoEstimado.toFixed(2)) }
    };

    const lineas = [];
    lineas.push(`<h2>Diagnóstico diario de Soul</h2>`);
    lineas.push(`<p>Ventana: últimas ${VENTANA_HORAS}hs.</p>`);

    lineas.push(`<h3>Errores silenciosos: ${errores.length}</h3>`);
    if (errores.length) {
      lineas.push('<ul>' + Object.entries(erroresPorContexto).map(([c, n]) => `<li>${esc(c)}: ${n}</li>`).join('') + '</ul>');
    } else {
      lineas.push('<p>Ninguno. 👍</p>');
    }

    lineas.push(`<h3>Reportes de usuarios: ${reportes.length}</h3>`);
    lineas.push(`<h3>Intentos de fuga de prompt: ${fugas.length}</h3>`);

    lineas.push(`<h3>Avisos de "algo no funciona" de usuarios: ${reportesTecnicos.length}</h3>`);
    if (reportesTecnicos.length) {
      lineas.push('<ul>' + Object.entries(reportesTecnicosPorContexto).map(([c, n]) => `<li>${esc(c)}: ${n}</li>`).join('') + '</ul>');
    }

    lineas.push(`<h3>Mails con problemas de entrega (Resend): ${resend.problematicos.length} de ${resend.totalEnviados} enviados</h3>`);
    if (resend.problematicos.length) {
      lineas.push('<ul>' + resend.problematicos.map(p => `<li>${esc(p.to)} — ${esc(p.estado)} (${esc(p.asunto)})</li>`).join('') + '</ul>');
    }

    lineas.push(`<h3>Cuentas trabadas sin confirmar mail (+${UMBRAL_SIN_CONFIRMAR_HORAS}hs): ${sinConfirmar.length}</h3>`);
    if (sinConfirmar.length) {
      lineas.push('<ul>' + sinConfirmar.map(u => `<li>${esc(u.nombre || '(sin nombre)')} — ${esc(u.email)}</li>`).join('') + '</ul>');
    }

    lineas.push(`<h3>Borrado de cuentas (30 días de gracia): ${purgado.purgadas} de ${purgado.candidatas} vencidas</h3>`);
    if (!purgado.serviceKeyConfigurada && purgado.candidatas > 0) {
      lineas.push('<p>⚠ Falta SUPABASE_SERVICE_ROLE_KEY -- los datos de la app se borraron pero el usuario sigue existiendo en Supabase Auth (todavía podría loguearse con ese email/contraseña).</p>');
    } else if (purgado.purgadas > 0) {
      lineas.push(`<p>Auth borrado de verdad en ${purgado.authBorrados} de ${purgado.purgadas}.</p>`);
    }

    lineas.push(`<h3>Purga por antigüedad (Decisión 6)</h3>`);
    lineas.push('<ul>' + Object.entries(purgadoAntiguedad).map(([tabla, r]) =>
      `<li>${esc(tabla)}: ${r.ok ? r.borradas + ' borradas' : 'error al purgar'}</li>`
    ).join('') + '</ul>');

    lineas.push(`<h3>Retención de cita_mensajes a 12 meses (Decisión 6): ${purgadoCitaMensajes.citasPurgadas} de ${purgadoCitaMensajes.citasVencidas} citas vencidas</h3>`);
    if (purgadoCitaMensajes.citasFrenadasPorReporte > 0) {
      lineas.push(`<p>${purgadoCitaMensajes.citasFrenadasPorReporte} citas frenadas por tener un reporte abierto en su match.</p>`);
    }

    lineas.push(`<h3>Uso de tokens (24hs)</h3>`);
    lineas.push(`<p>Input: ${totalInput.toLocaleString()} | Output: ${totalOutput.toLocaleString()} | Cache creado: ${totalCacheCreation.toLocaleString()} | Cache leído: ${totalCacheRead.toLocaleString()} | Costo estimado: ~$${costoEstimado.toFixed(2)} USD (aproximado, no es el numero de facturacion real)</p>`);

    const html = lineas.join('\n');

    const supabaseUrl = process.env.SUPABASE_URL;
    // diagnosticos_diarios es de acceso exclusivo server-side (sin
    // RLS/policy para anon ni authenticated, ver
    // migracion_rls_tablas_internas.sql) -- contiene nombres/emails reales
    // en texto plano, hace falta la service role key.
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    await fetch(`${supabaseUrl}/rest/v1/diagnosticos_diarios`, {
      method: 'POST',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ resumen, texto_resumen: html })
    });

    const adminEmail = process.env.ADMIN_EMAIL;
    let mailEnviado = false;
    if (adminEmail) {
      mailEnviado = await notificarDiagnosticoDiario({
        email: adminEmail,
        asunto: `Diagnóstico diario de Soul — ${errores.length} errores, ${reportes.length} reportes, ${reportesTecnicos.length} avisos de usuarios, ${resend.problematicos.length} mails con problema`,
        html
      });
    }

    return res.status(200).json({ ok: true, mailEnviado, resumen });
  } catch (error) {
    console.error('Error en /api/cron/diagnostico-diario:', error);
    return res.status(500).json({ error: 'Error generando el diagnostico' });
  }
}
