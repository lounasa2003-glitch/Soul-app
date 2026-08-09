import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaudeJSON } from '../lib/anthropicClient.js';
import { chequearLimite } from '../lib/rateLimit.js';
import { registrarUsoTokens } from '../lib/logUso.js';
import { registrarEvento } from '../lib/logEvento.js';
import { COMPARE_PROMPT, FILTRO_BARATO_PROMPT } from '../lib/comparePrompt.js';
import { registrarErrorSilencioso } from '../lib/logErrorSilencioso.js';
import { generosCompatibles, tipoVinculoCompatible, distanciaCompatible, hijosCompatibles } from '../lib/matchCompatible.js';
import { enviarPushAUsuario } from '../lib/push.js';
import { construirSnapshotConclusion, conclusionesIguales } from '../lib/conclusionSoul.js';

const LIMITE_MATCHES = 5;
const VENTANA_MATCHES_SEGUNDOS = 3600;
// Free recalcula como mucho 1 vez cada 72hs -- el perfil no cambia tan
// rapido como para justificar mas, y calcularMatches compara contra todos
// los demas perfiles activos asi que escala con el tamaño de la base, no
// solo con esta persona. Pro mantiene el limite anti-abuso de siempre
// (5/hora) sin tope de producto adicional.
const LIMITE_MATCHES_FREE = 1;
const VENTANA_MATCHES_FREE_SEGUNDOS = 259200;

// Rediseño del motor de matching para controlar costo de IA (propuesta de
// limites aprobada): filtro duro sin IA (ya existia, ver lib/matchCompatible.js
// y el snapshot vigente mas abajo) -> filtro barato con Haiku (hasta 100
// candidatos/mes) -> analisis profundo con Sonnet SOLO para los finalistas
// (hasta 20/mes). Los dos topes son mensuales y por persona -- se consumen
// con chequearLimite() igual que el resto de los limites de este archivo,
// sin tabla nueva (rate_limits ya soporta cualquier endpoint nuevo).
const LIMITE_FILTRO_BARATO_MENSUAL = 100;
const LIMITE_MATCHING_PROFUNDO_MENSUAL = 20;
const VENTANA_MENSUAL_SEGUNDOS = 2592000; // 30 dias

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  // 'perfiles' ya tiene politica RLS real de "solo el dueño" (ver
  // migracion_rls_perfiles.sql) -- comparar contra todas las demas personas
  // es inherente al matching, asi que esa lectura cruzada necesita
  // bypassear la politica con la service role key, no con el token de esta
  // persona (que solo veria su propia fila).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey || !serviceKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }

  try {
    const usuario = await verificarUsuario(req);
    if (!usuario || !usuario.usuarioId) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }
    // El onboarding y el chat con Soul no requieren mail confirmado (no
    // involucran a otra persona real) -- pero calcular matches es el primer
    // paso hacia una interaccion con alguien mas, asi que ahi si se exige.
    if (!usuario.emailConfirmado) {
      return res.status(403).json({ error: 'email_no_confirmado', mensaje: 'Confirmá tu email para poder buscar matches.' });
    }
    const usuarioId = usuario.usuarioId;

    const limiteInfo = await chequearLimite(usuario.email, 'calcularMatches', LIMITE_MATCHES, VENTANA_MATCHES_SEGUNDOS);
    if (!limiteInfo.permitido) {
      return res.status(429).json({
        error: 'limite_alcanzado',
        mensaje: 'Ya calculaste tus matches varias veces en poco tiempo. Probá de nuevo más tarde.'
      });
    }
    if (usuario.plan !== 'pro') {
      const limiteFreeInfo = await chequearLimite(usuario.email, 'calcularMatches-free', LIMITE_MATCHES_FREE, VENTANA_MATCHES_FREE_SEGUNDOS);
      if (!limiteFreeInfo.permitido) {
        return res.status(429).json({
          error: 'limite_free_alcanzado',
          mensaje: 'En el plan gratuito podés recalcular matches una vez cada 3 días. Soul Pro lo permite con más frecuencia.',
          segundosParaReset: limiteFreeInfo.segundosParaReset
        });
      }
    }

    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

    const misPerRes = await fetch(
      `${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${encodeURIComponent(usuarioId)}`,
      { headers: { ...headers, Authorization: `Bearer ${usuario.token}` } }
    );
    const misPer = misPerRes.ok ? await misPerRes.json() : [];
    if (!misPer || misPer.length === 0) {
      return res.status(200).json({ matchEncontrado: false, matchData: null });
    }
    const miPerfil = misPer[0];

    // No habilitar matching hasta que la persona confirmó la conclusión de
    // Soul tal como está ahora -- mismo criterio que conclusionEstaConfirmada()
    // en soul.html (DEBEN quedar sincronizadas -- ver construirSnapshotConclusion
    // y conclusionesIguales ahi), pero este es el gate real del lado del
    // servidor (el cliente ya evita llamar a este endpoint sin confirmar,
    // pero eso es UX, no el limite real). Cuentas de antes de este cambio
    // tienen perfil_validado_snapshot en null, que nunca va a coincidir --
    // se les pide confirmar una vez, sin inventar una aceptacion retroactiva
    // (ver docs/plan-free-pro/migracion_conclusion_soul.sql).
    //
    // Campos incluidos -- los unicos que calcularMatches manda a Claude como
    // señal real de compatibilidad (ver mas abajo y lib/comparePrompt.js):
    // grupo1-4 (la sintesis interpretativa) e indice_disponibilidad (viven
    // en esta misma fila de 'perfiles'), mas no_negociables/negociables
    // (texto declarado directamente por la persona, viven en 'usuarios' --
    // por eso se leen aparte). Nunca timestamps, plan, estado online, ni
    // ninguna otra columna ajena a lo que realmente compara el matching.
    const miUsuarioTextosRes = await fetch(
      `${supabaseUrl}/rest/v1/usuarios?select=no_negociables,negociables&id=eq.${encodeURIComponent(usuarioId)}`,
      { headers: { ...headers, Authorization: `Bearer ${usuario.token}` } }
    );
    const miUsuarioTextosRows = miUsuarioTextosRes.ok ? await miUsuarioTextosRes.json() : [];
    const miUsuarioTextos = miUsuarioTextosRows[0] || {};

    const conclusionActual = construirSnapshotConclusion(miPerfil, miUsuarioTextos);
    if (miPerfil.perfil_validado !== true || !conclusionesIguales(miPerfil.perfil_validado_snapshot, conclusionActual)) {
      return res.status(200).json({ matchEncontrado: false, matchData: null, conclusionNoConfirmada: true });
    }

    // Comparar contra TODOS los demas perfiles es el corazon del matching --
    // service role key, no el token propio.
    const headersServiceRole = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const [otrosRes, cuentasPruebaRes] = await Promise.all([
      // perfil_validado=eq.true filtra en el SQL a cualquiera que todavia no
      // confirmo su representacion -- antes esto no se filtraba aca, y una
      // persona con perfil pendiente podia terminar propuesta como candidata
      // de otra sin haber confirmado nada.
      fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=neq.${encodeURIComponent(usuarioId)}&perfil_validado=eq.true`, { headers: headersServiceRole }),
      // Las cuentas de prueba fijas (Vista Previa del panel admin) usan a
      // proposito el dominio @soul-app.test -- nunca deben terminar
      // matcheadas con una persona real por casualidad de compatibilidad.
      // Filtro sobre TODAS las cuentas, no solo la propia -- service role.
      fetch(`${supabaseUrl}/rest/v1/usuarios?select=id&email=like.*@soul-app.test`, { headers: headersServiceRole })
    ]);
    let otrosPerfiles = otrosRes.ok ? await otrosRes.json() : [];
    const idsCuentasPrueba = new Set((cuentasPruebaRes.ok ? await cuentasPruebaRes.json() : []).map((u) => u.id));
    if (idsCuentasPrueba.size > 0) {
      otrosPerfiles = otrosPerfiles.filter((p) => !idsCuentasPrueba.has(p.usuario_id));
    }

    // Trae cualquier match ya existente con esta persona (en cualquier
    // estado) para decidir mas abajo, POR PAR, si hace falta volver a
    // analizar con IA o si se puede reusar el resultado guardado --
    // reemplaza la exclusion en bloque de antes (que nunca reconsideraba un
    // par ya comparado, ni aunque el perfil de alguno cambiara despues).
    // 'matches' ya tiene politica RLS real (ver migracion_rls_matches.sql) --
    // token propio, no el anon key.
    const yaMatcheadosRes = await fetch(
      `${supabaseUrl}/rest/v1/matches?select=id,usuario_a,usuario_b,estado,compatibilidad_hoy,potencial_construccion,mensaje_dupla,matching_analizado_en&or=(usuario_a.eq.${encodeURIComponent(usuarioId)},usuario_b.eq.${encodeURIComponent(usuarioId)})`,
      { headers: { ...headers, Authorization: `Bearer ${usuario.token}` } }
    );
    const yaMatcheados = yaMatcheadosRes.ok ? await yaMatcheadosRes.json() : [];
    const matchExistentePorOtroId = {};
    yaMatcheados.forEach((m) => {
      const otroId = m.usuario_a === usuarioId ? m.usuario_b : m.usuario_a;
      matchExistentePorOtroId[otroId] = m;
    });
    // Ya no se excluye en bloque a quien tiene un match existente -- los
    // filtros duros de abajo (genero, vinculo, distancia, hijos, snapshot
    // vigente) siguen aplicando igual sobre todos, y el chequeo de "hace
    // falta reanalizar" pasa a hacerse por par, mas abajo.
    const otrosPerfilesSinMatch = otrosPerfiles;

    // Genero/preferencia, tipo de vinculo, ciudad y distancia viven en
    // 'usuarios', no en 'perfiles' -- hace falta traerlos aparte para
    // filtrar ANTES de gastar ninguna llamada a Claude (ver
    // lib/matchCompatible.js: sin el filtro de genero se llegaron a crear
    // matches que cruzaban lo que la persona eligio en "¿Con quien queres
    // conectar?"; tipo de vinculo y distancia son la misma idea aplicada a
    // datos que ya se piden en la Etapa 1 y hasta ahora no se usaban para
    // nada mas que mostrarse en el panel).
    const idsCandidatos = otrosPerfilesSinMatch.map((p) => p.usuario_id);
    let miGeneroInfo = null;
    let otrosPerfilesCompatibles = [];
    // Se usa tambien mas abajo, al armar el mensaje para Claude (no
    // negociables de cada candidato) -- declarada afuera del if para que
    // el loop de comparacion pueda leerla.
    let generoPorId = {};
    if (idsCandidatos.length > 0) {
      const SELECT_FILTRO = 'id,genero,preferencia_genero,tipo_vinculo,ciudad,distancia_max,hijos,preferencia_hijos,no_negociables,negociables,eliminacion_solicitada_en';
      // La segunda lectura es sobre TODOS los candidatos (no solo yo) --
      // service role para las dos, mismo criterio que arriba con 'perfiles'.
      const [miUsuarioRes, otrosUsuariosRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/usuarios?select=${SELECT_FILTRO}&id=eq.${encodeURIComponent(usuarioId)}`, { headers: headersServiceRole }),
        fetch(`${supabaseUrl}/rest/v1/usuarios?select=${SELECT_FILTRO}&id=in.(${idsCandidatos.map(encodeURIComponent).join(',')})`, { headers: headersServiceRole })
      ]);
      const miUsuarioRows = miUsuarioRes.ok ? await miUsuarioRes.json() : [];
      miGeneroInfo = miUsuarioRows[0] || null;
      const otrosUsuarios = otrosUsuariosRes.ok ? await otrosUsuariosRes.json() : [];
      otrosUsuarios.forEach((u) => { generoPorId[u.id] = u; });
      otrosPerfilesCompatibles = otrosPerfilesSinMatch.filter((p) => {
        const candidato = generoPorId[p.usuario_id];
        if (!candidato) return false;
        // Cuenta con borrado solicitado -- no debe proponerse aunque el
        // purgado real (cron diario) todavia no haya corrido.
        if (candidato.eliminacion_solicitada_en) return false;
        // Snapshot vigente: el candidato ya tenia perfil_validado=true (filtrado
        // arriba en la consulta SQL), pero eso solo dice que confirmo ALGUNA
        // vez -- si no_negociables/negociables (o grupo1-4) cambiaron despues
        // sin volver a confirmar, ya no es un "si" vigente. Misma comparacion
        // pura (sin IA) que ya protege a quien ejecuta el calculo, aplicada
        // ahora tambien a cada candidato.
        const snapshotActualCandidato = construirSnapshotConclusion(p, candidato);
        if (!conclusionesIguales(p.perfil_validado_snapshot, snapshotActualCandidato)) return false;
        return generosCompatibles(miGeneroInfo, candidato)
          && tipoVinculoCompatible(miGeneroInfo, candidato)
          && distanciaCompatible(miGeneroInfo, candidato)
          && hijosCompatibles(miGeneroInfo, candidato);
      });
    }

    let matchEncontrado = false;
    let matchData = null;
    // Este endpoint puede hacer varias llamadas a Claude (filtro barato +
    // analisis profundo, cada uno hasta su propio cupo mensual) -- se
    // acumula el uso total de cada modelo y se loguea una sola vez al
    // final, en vez de sumar una escritura a Supabase por cada llamada.
    let totalInputTokens = 0, totalOutputTokens = 0;
    let totalInputTokensFiltro = 0, totalOutputTokensFiltro = 0;
    let cantidadAnalizadosProfundo = 0;

    // Por cada candidato que paso los filtros duros, decide si hace falta
    // (re)analizar con IA o si alcanza con el resultado ya guardado: sin
    // match previo -> analizar; con match previo pero sin fecha de analisis,
    // o con el perfil de cualquiera de los dos revalidado DESPUES de esa
    // fecha -> reanalizar (y actualizar la fila existente en vez de crear
    // una nueva); en cualquier otro caso -> reusar, cero llamada a IA.
    const candidatosParaAnalizar = [];
    for (const otro of otrosPerfilesCompatibles) {
      const existente = matchExistentePorOtroId[otro.usuario_id];
      if (!existente) {
        candidatosParaAnalizar.push({ otro, existente: null });
        continue;
      }
      const sinFechaAnalisis = !existente.matching_analizado_en;
      const miPerfilCambioDespues = !sinFechaAnalisis && miPerfil.perfil_validado_en &&
        new Date(miPerfil.perfil_validado_en) > new Date(existente.matching_analizado_en);
      const suPerfilCambioDespues = !sinFechaAnalisis && otro.perfil_validado_en &&
        new Date(otro.perfil_validado_en) > new Date(existente.matching_analizado_en);
      if (sinFechaAnalisis || miPerfilCambioDespues || suPerfilCambioDespues) {
        candidatosParaAnalizar.push({ otro, existente });
        continue;
      }
      // Cache vigente: nada cambio desde el ultimo analisis -- se reusa el
      // resultado guardado, cero llamada a IA.
      if (existente.estado === 'pendiente' || existente.estado === 'activo' || existente.estado === 'mutuamente_aceptado') {
        matchEncontrado = true;
        matchData = {
          id: existente.id,
          compatibilidad_hoy: existente.compatibilidad_hoy,
          potencial_construccion: existente.potencial_construccion,
          mensaje_dupla: existente.mensaje_dupla
        };
      }
    }

    // Filtro barato (Haiku): ordena por un puntaje estimado antes de gastar
    // el cupo de analisis profundo. Se corta apenas se agota el cupo
    // mensual (100) -- los candidatos que quedan afuera esta vez se
    // retoman en una proxima corrida, no se pierden.
    const candidatosConEstimado = [];
    for (const candidato of candidatosParaAnalizar) {
      const limiteFiltroInfo = await chequearLimite(usuario.email, 'matching-filtro-barato', LIMITE_FILTRO_BARATO_MENSUAL, VENTANA_MENSUAL_SEGUNDOS);
      if (!limiteFiltroInfo.permitido) break;
      try {
        const { json: filtro, usage: usageFiltro } = await llamarClaudeJSON({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 60,
          system: FILTRO_BARATO_PROMPT,
          messages: [{
            role: 'user',
            content: 'Perfil A:\n' + JSON.stringify(miPerfil) + '\n\nPerfil B:\n' + JSON.stringify(candidato.otro)
          }]
        });
        if (usageFiltro) {
          totalInputTokensFiltro += usageFiltro.input_tokens || 0;
          totalOutputTokensFiltro += usageFiltro.output_tokens || 0;
        }
        candidatosConEstimado.push({ ...candidato, estimado: (filtro && typeof filtro.estimado === 'number') ? filtro.estimado : 0 });
      } catch (e) {
        // Si el filtro barato falla para este candidato se lo deja pasar
        // igual al analisis profundo (fail-open) en vez de perderlo en
        // silencio -- el cupo de Sonnet de abajo sigue siendo el limite real.
        candidatosConEstimado.push({ ...candidato, estimado: 0 });
      }
    }
    candidatosConEstimado.sort((a, b) => b.estimado - a.estimado);

    for (const { otro, existente } of candidatosConEstimado) {
      const limiteProfundoInfo = await chequearLimite(usuario.email, 'matching-profundo-mensual', LIMITE_MATCHING_PROFUNDO_MENSUAL, VENTANA_MENSUAL_SEGUNDOS);
      if (!limiteProfundoInfo.permitido) break; // cupo mensual de analisis profundo agotado

      const candidatoUsuario = generoPorId[otro.usuario_id];
      const { json: comp, usage } = await llamarClaudeJSON({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: COMPARE_PROMPT,
        messages: [{
          role: 'user',
          content: 'Perfil A:\n' + JSON.stringify(miPerfil) +
            '\nNo negociables de A: ' + (miGeneroInfo && miGeneroInfo.no_negociables || 'null') +
            '\nNegociables de A: ' + (miGeneroInfo && miGeneroInfo.negociables || 'null') +
            '\n\nPerfil B:\n' + JSON.stringify(otro) +
            '\nNo negociables de B: ' + (candidatoUsuario && candidatoUsuario.no_negociables || 'null') +
            '\nNegociables de B: ' + (candidatoUsuario && candidatoUsuario.negociables || 'null')
        }]
      });
      if (usage) {
        totalInputTokens += usage.input_tokens || 0;
        totalOutputTokens += usage.output_tokens || 0;
      }
      cantidadAnalizadosProfundo++;

      // Umbral acorde a la recalibracion de COMPARE_PROMPT (ver
      // lib/comparePrompt.js): "alineacion real" empieza en 55-70 y
      // "solida" en 70-85, asi que el corte se ubica adentro de esas
      // bandas en vez del umbral viejo (50/65), que con el prompt anterior
      // dejaba pasar casi cualquier par -- una persona real del piloto
      // llego a tener 17 matches simultaneos con eso.
      const supera = comp.compatibilidad_hoy >= 60 || comp.potencial_construccion >= 75;
      const cuerpoMatch = {
        compatibilidad_hoy: comp.compatibilidad_hoy,
        potencial_construccion: comp.potencial_construccion,
        fortalezas: comp.fortalezas,
        desafio: comp.desafio,
        mensaje_dupla: comp.mensaje_dupla,
        // veredicto no tiene columna propia -- va adentro de este jsonb
        // para no perderse (mismo criterio que calcularRanking en
        // api/admin/matches.js).
        analisis_por_variable: { ...(comp.analisis_por_variable || {}), veredicto: comp.veredicto || null },
        // Se guarda la comparacion aunque no supere el umbral (estado
        // "descartado") -- le permite a la administradora activarlo a mano
        // desde el panel, y evita volver a gastar Claude en este mismo par
        // mientras nada cambie (matching_analizado_en, mas abajo).
        estado: supera ? 'pendiente' : 'descartado',
        matching_analizado_en: new Date().toISOString()
      };

      let matchId;
      if (existente) {
        // Reanalisis de un par ya existente -- se actualiza la misma fila
        // en vez de crear una nueva (asi 'matches' nunca duplica un par).
        await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(existente.id)}`, {
          method: 'PATCH',
          headers: { ...headers, Authorization: `Bearer ${usuario.token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(cuerpoMatch)
        });
        matchId = existente.id;
      } else {
        const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches`, {
          method: 'POST',
          headers: { ...headers, Authorization: `Bearer ${usuario.token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ usuario_a: usuarioId, usuario_b: otro.usuario_id, activado_por: 'sistema', ...cuerpoMatch })
        });
        const matchRows = matchRes.ok ? await matchRes.json() : [];
        matchId = matchRows[0] ? matchRows[0].id : null;
      }

      if (supera) {
        matchEncontrado = true;
        matchData = {
          id: matchId,
          compatibilidad_hoy: comp.compatibilidad_hoy,
          potencial_construccion: comp.potencial_construccion,
          mensaje_dupla: comp.mensaje_dupla
        };
        // Push a la OTRA persona (usuario_b) SOLO cuando el match nace de
        // verdad por primera vez -- ni cuando se reusa desde cache (mas
        // arriba, sin llegar aca), ni cuando se REANALIZA un par que ya
        // estaba pendiente/activo/mutuamente aceptado (ese ya fue
        // notificado la vez que cruzo el umbral). Si el par no existia, o
        // existia pero todavia no habia cruzado el umbral (ej.
        // "descartado"), esta es la primera vez que se le avisa.
        const yaEstabaNotificado = existente && ['pendiente', 'activo', 'mutuamente_aceptado'].includes(existente.estado);
        if (!yaEstabaNotificado) {
          // usuarioId ya esta viendo el resultado en pantalla en este mismo
          // momento, no necesita aviso. DE PRODUCTO -- gateado por
          // comunicaciones_producto_aceptadas dentro de enviarPushAUsuario
          // (ver lib/push.js).
          enviarPushAUsuario(otro.usuario_id, {
            titulo: 'Soul encontró un match para vos',
            cuerpo: 'Los planetas se alinearon con alguien nuevo.',
            data: { tipo: 'match_nuevo' },
            esencial: false
          }).catch(() => {});
        }
      }
    }

    await registrarUsoTokens({
      usuarioId,
      endpoint: 'calcularMatches',
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens }
    });
    if (totalInputTokensFiltro > 0 || totalOutputTokensFiltro > 0) {
      await registrarUsoTokens({
        usuarioId,
        endpoint: 'calcularMatches-filtro',
        usage: { input_tokens: totalInputTokensFiltro, output_tokens: totalOutputTokensFiltro }
      });
    }
    await registrarEvento({
      usuarioId,
      tipo: 'calculo_matches',
      metadata: { matchEncontrado, cantidadComparaciones: cantidadAnalizadosProfundo }
    });

    return res.status(200).json({ matchEncontrado, matchData });

  } catch (error) {
    console.error('Error en /api/calcularMatches:', error);
    await registrarErrorSilencioso({ contexto: 'api/calcularMatches', error });
    return res.status(500).json({ error: 'Error calculando matches' });
  }
}
