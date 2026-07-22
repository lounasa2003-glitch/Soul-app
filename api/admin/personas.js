import { verificarAdmin } from '../../lib/verificarAdmin.js';
import { registrarErrorSilencioso } from '../../lib/logErrorSilencioso.js';

// Fusiona lo que antes eran admin/personas.js (listado), admin/persona.js
// (hoja de vida completa) y admin/perfil.js (par de perfiles para comparar)
// en un solo archivo -- el plan Hobby de Vercel permite como maximo 12
// funciones serverless por deploy, y el proyecto ya estaba por encima de
// eso. Se distingue por query params en vez de por ruta.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await verificarAdmin(req))) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  const { id, modo } = req.query;

  try {
    if (modo === 'metricas') {
      // Se trae todo y se agrega en memoria (nada de RPC/SQL crudo) --
      // mismo criterio que el resto del panel (ranking, listado de
      // personas), y el volumen de un piloto no justifica nada mas
      // elaborado. Se calcula al pedirlo, no en vivo/cacheado.
      const [tokensRes, eventosRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/uso_tokens?select=endpoint,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/eventos_piloto?select=tipo,usuario_id`, { headers })
      ]);
      const tokensFilas = tokensRes.ok ? await tokensRes.json() : [];
      const eventosFilas = eventosRes.ok ? await eventosRes.json() : [];

      // Tarifa de Claude Sonnet -- USD por millon de tokens. Ajustar aca si
      // cambia el precio real; es una estimacion, no factura. Cache
      // read/creation son fracciones estandar del precio de input normal
      // (lectura ~10%, escritura ~125%) -- el caching de prompts esta
      // activo de verdad (systemConCache en anthropicClient.js) y esos
      // tokens se cobran, asi que sin esto el costo quedaba subestimado.
      const PRECIO_INPUT_POR_MILLON = 3;
      const PRECIO_OUTPUT_POR_MILLON = 15;
      const PRECIO_CACHE_CREATION_POR_MILLON = PRECIO_INPUT_POR_MILLON * 1.25;
      const PRECIO_CACHE_READ_POR_MILLON = PRECIO_INPUT_POR_MILLON * 0.1;
      const costoDe = (f) => (f.inputTokens / 1e6) * PRECIO_INPUT_POR_MILLON
        + (f.outputTokens / 1e6) * PRECIO_OUTPUT_POR_MILLON
        + (f.cacheCreationTokens / 1e6) * PRECIO_CACHE_CREATION_POR_MILLON
        + (f.cacheReadTokens / 1e6) * PRECIO_CACHE_READ_POR_MILLON;
      const porEndpoint = {};
      let totalInput = 0, totalOutput = 0, totalCacheCreation = 0, totalCacheRead = 0;
      tokensFilas.forEach((f) => {
        const ep = f.endpoint || '(sin nombre)';
        if (!porEndpoint[ep]) porEndpoint[ep] = { endpoint: ep, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, llamadas: 0 };
        porEndpoint[ep].inputTokens += f.input_tokens || 0;
        porEndpoint[ep].outputTokens += f.output_tokens || 0;
        porEndpoint[ep].cacheCreationTokens += f.cache_creation_tokens || 0;
        porEndpoint[ep].cacheReadTokens += f.cache_read_tokens || 0;
        porEndpoint[ep].llamadas += 1;
        totalInput += f.input_tokens || 0;
        totalOutput += f.output_tokens || 0;
        totalCacheCreation += f.cache_creation_tokens || 0;
        totalCacheRead += f.cache_read_tokens || 0;
      });
      const tokensPorEndpoint = Object.values(porEndpoint)
        .map((f) => ({ ...f, costoEstimadoUsd: costoDe(f) }))
        .sort((a, b) => b.costoEstimadoUsd - a.costoEstimadoUsd);
      const costoTotalEstimadoUsd = costoDe({ inputTokens: totalInput, outputTokens: totalOutput, cacheCreationTokens: totalCacheCreation, cacheReadTokens: totalCacheRead });

      // Personas UNICAS por tipo de evento (no eventos crudos -- un tipo
      // como encuentro_agendado puede repetirse varias veces por persona).
      const usuariosPorTipo = {};
      eventosFilas.forEach((f) => {
        if (!usuariosPorTipo[f.tipo]) usuariosPorTipo[f.tipo] = new Set();
        usuariosPorTipo[f.tipo].add(f.usuario_id);
      });
      const ORDEN_EMBUDO = ['registro', 'onboarding_completado', 'calculo_matches', 'primera_conversacion', 'encuentro_agendado', 'encuentro_cerrado', 'debriefing_completado', 'eleccion_post_encuentro'];
      const embudo = ORDEN_EMBUDO.map((tipo) => ({ tipo, personas: usuariosPorTipo[tipo] ? usuariosPorTipo[tipo].size : 0 }));

      return res.status(200).json({
        tokens: { totalInput, totalOutput, totalCacheCreation, totalCacheRead, costoTotalEstimadoUsd, porEndpoint: tokensPorEndpoint },
        embudo
      });
    }

    if (modo === 'diagnosticos') {
      // ── Historial del diagnostico diario automatico (ver
      // api/cron/diagnostico-diario.js) -- ultimas 30 corridas. ──
      const diagRes = await fetch(
        `${supabaseUrl}/rest/v1/diagnosticos_diarios?select=id,fecha,resumen,texto_resumen,creado_en&order=creado_en.desc&limit=30`,
        { headers }
      );
      const diagnosticos = diagRes.ok ? await diagRes.json() : [];
      return res.status(200).json({ diagnosticos });
    }

    if (modo === 'citaMensajes') {
      // ── Transcripto crudo de una cita, para la administradora -- ver
      // "Durante el piloto" en el consentimiento (soul.html/legal.html):
      // esto se disclosea explicitamente ahi, incluida la posibilidad de
      // revisarla mientras esta en curso, no solo despues de cerrada. Sin
      // filtro de estado a proposito -- funciona igual si la cita sigue
      // activa o ya cerro. ──
      const { citaId } = req.query;
      if (!citaId) return res.status(400).json({ error: 'Falta citaId' });
      const citaIdEnc = encodeURIComponent(citaId);
      const [citaRes, msgsRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/citas?select=id,match_id,estado&id=eq.${citaIdEnc}`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/cita_mensajes?select=*&cita_id=eq.${citaIdEnc}&order=created_at.asc`, { headers })
      ]);
      const citaFila = citaRes.ok ? (await citaRes.json())[0] : null;
      if (!citaFila) return res.status(404).json({ error: 'Cita no encontrada' });
      const mensajes = msgsRes.ok ? await msgsRes.json() : [];

      const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&id=eq.${encodeURIComponent(citaFila.match_id)}`, { headers });
      const match = matchRes.ok ? (await matchRes.json())[0] : null;
      let nombrePorId = {};
      if (match) {
        const nRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email&id=in.(${encodeURIComponent(match.usuario_a)},${encodeURIComponent(match.usuario_b)})`, { headers });
        const nombres = nRes.ok ? await nRes.json() : [];
        nombres.forEach((u) => { nombrePorId[u.id] = u.nombre || u.email || null; });
      }
      const mensajesConNombre = mensajes.map((m) => ({ ...m, remitente_nombre: m.usuario_id ? (nombrePorId[m.usuario_id] || null) : 'Soul' }));
      return res.status(200).json({ estadoCita: citaFila.estado, mensajes: mensajesConNombre });
    }

    if (!id) {
      // ── Listado de personas ──
      const usuariosRes = await fetch(
        `${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,ciudad,etapa_actual,fecha_nacimiento,genero,preferencia_genero`,
        { headers }
      );
      const usuarios = usuariosRes.ok ? await usuariosRes.json() : [];
      // Deberia ser imposible pasar de 'nuevo' sin estos 3 campos (ver el
      // chequeo server-side en api/guardar.js), pero un par de cuentas
      // reales (Ezequiel, Marcela) quedaron asi de antes de que existiera
      // -- se marca para que sea visible de un vistazo, no solo abriendo
      // la Hoja de Vida.
      const personas = usuarios.map((u) => ({
        ...u,
        basicosIncompletos: u.etapa_actual !== 'nuevo' && (!u.fecha_nacimiento || !u.genero || !u.preferencia_genero)
      }));
      return res.status(200).json({ personas });
    }

    const idEnc = encodeURIComponent(id);

    if (modo === 'perfil') {
      // ── Par de perfiles para el comparador manual ──
      const [usuarioRes, perfilRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre&id=eq.${idEnc}`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${idEnc}`, { headers })
      ]);
      const usuarios = usuarioRes.ok ? await usuarioRes.json() : [];
      const perfiles = perfilRes.ok ? await perfilRes.json() : [];
      if (!usuarios[0]) {
        return res.status(404).json({ error: 'No encontrada' });
      }
      return res.status(200).json({
        nombre: usuarios[0].nombre,
        perfil: perfiles.length > 0 ? perfiles[perfiles.length - 1] : null
      });
    }

    // ── Hoja de vida completa ──
    const [usuarioRes, perfilRes, convRes, matchesRes, intentosFugaRes, reportesRes, feedbackRes, reportesTecnicosRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/usuarios?select=*&id=eq.${idEnc}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${idEnc}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/conversaciones?select=*&usuario_id=eq.${idEnc}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/matches?select=*&or=(usuario_a.eq.${idEnc},usuario_b.eq.${idEnc})`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/intentos_fuga_prompt?select=*&usuario_id=eq.${idEnc}&order=created_at.desc`, { headers }),
      // Reportes RECIBIDOS por esta persona (los que hizo ella misma sobre
      // otros no se muestran acá -- lo relevante para la administradora es
      // detectar patrones de conducta reportada, no quién reporta seguido).
      fetch(`${supabaseUrl}/rest/v1/reportes?select=*&usuario_reportado=eq.${idEnc}&order=created_at.desc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/feedback_piloto?select=*&usuario_id=eq.${idEnc}&order=creado_en.desc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/reportes_tecnicos?select=*&usuario_id=eq.${idEnc}&order=creado_en.desc`, { headers })
    ]);

    const usuarios = usuarioRes.ok ? await usuarioRes.json() : [];
    const perfiles = perfilRes.ok ? await perfilRes.json() : [];
    const conversaciones = convRes.ok ? await convRes.json() : [];
    const matches = matchesRes.ok ? await matchesRes.json() : [];
    const intentosFuga = intentosFugaRes.ok ? await intentosFugaRes.json() : [];
    const reportesRecibidos = reportesRes.ok ? await reportesRes.json() : [];
    const feedbackPiloto = feedbackRes.ok ? await feedbackRes.json() : [];
    const reportesTecnicos = reportesTecnicosRes.ok ? await reportesTecnicosRes.json() : [];

    if (!usuarios[0]) {
      return res.status(404).json({ error: 'No encontrada' });
    }

    const otrosIds = [...new Set(
      matches.map(m => (m.usuario_a === id ? m.usuario_b : m.usuario_a))
    )].filter(Boolean);

    let nombrePorId = {};
    if (otrosIds.length > 0) {
      const listaIds = otrosIds.map(encodeURIComponent).join(',');
      const otrosRes = await fetch(
        `${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email&id=in.(${listaIds})`,
        { headers }
      );
      const otros = otrosRes.ok ? await otrosRes.json() : [];
      // Varias personas del piloto real nunca llegaron a guardar "nombre"
      // (solo email) -- sin este fallback, esas mismas personas aparecian
      // con nombre en los matches de la OTRA parte (si su contraparte si
      // tenia nombre) pero como "(persona sin nombre)" del propio lado,
      // dando la falsa impresion de que el match no era el mismo de los dos
      // lados.
      otros.forEach(o => { nombrePorId[o.id] = o.nombre || o.email || null; });
    }

    // Se suman TODAS las citas (encuentros) de cada match, no solo la
    // ultima -- con la Sala de Encuentros un match puede tener varios
    // encuentros, cada uno con su propio estado, resumen y debriefing. Se
    // ordenan cronologicamente para que el panel pueda mostrar "Encuentro 1,
    // 2, 3..." igual que la pantalla de Matches de la persona.
    let citasPorMatch = {};
    if (matches.length > 0) {
      const idsMatches = matches.map(m => m.id);
      const citasRes = await fetch(
        `${supabaseUrl}/rest/v1/citas?select=id,match_id,estado,created_at,resumen_ia,refinamiento_a,refinamiento_b,consiente_analisis_a,consiente_analisis_b&match_id=in.(${idsMatches.map(encodeURIComponent).join(',')})&order=created_at.asc`,
        { headers }
      );
      const citas = citasRes.ok ? await citasRes.json() : [];
      citas.forEach(c => {
        if (!citasPorMatch[c.match_id]) citasPorMatch[c.match_id] = [];
        citasPorMatch[c.match_id].push(c);
      });
    }

    const matchesConNombre = matches.map(m => {
      const otraId = m.usuario_a === id ? m.usuario_b : m.usuario_a;
      const citasDelMatch = citasPorMatch[m.id] || [];
      return {
        ...m,
        otra_persona_id: otraId,
        otra_persona_nombre: nombrePorId[otraId] || null,
        citas: citasDelMatch,
        // Se mantiene "cita" (singular, la mas reciente) por compatibilidad
        // con el resto del panel que solo necesita saber el estado actual
        // para priorizar la lista -- ver tierDeMatch en panel-admin.html.
        cita: citasDelMatch.length > 0 ? citasDelMatch[citasDelMatch.length - 1] : null
      };
    });

    const reportesConNombre = reportesRecibidos.map(r => ({
      ...r,
      reportante_nombre: nombrePorId[r.usuario_reporta] || null
    }));

    return res.status(200).json({
      usuario: usuarios[0],
      perfil: perfiles.length > 0 ? perfiles[perfiles.length - 1] : null,
      conversacion: conversaciones.length > 0 ? conversaciones[conversaciones.length - 1] : null,
      matches: matchesConNombre,
      intentosFuga,
      reportesRecibidos: reportesConNombre,
      reportesTecnicos,
      feedbackPiloto: feedbackPiloto.length > 0 ? feedbackPiloto[0] : null
    });
  } catch (error) {
    console.error('Error en /api/admin/personas:', error);
    await registrarErrorSilencioso({ contexto: 'api/admin/personas', error });
    return res.status(500).json({ error: 'Error al obtener datos' });
  }
}
