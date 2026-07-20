import { verificarUsuario } from '../lib/authUtil.js';
import { llamarClaudeJSON } from '../lib/anthropicClient.js';
import { chequearLimite } from '../lib/rateLimit.js';
import { registrarUsoTokens } from '../lib/logUso.js';
import { registrarEvento } from '../lib/logEvento.js';
import { COMPARE_PROMPT } from '../lib/comparePrompt.js';
import { registrarErrorSilencioso } from '../lib/logErrorSilencioso.js';
import { generosCompatibles } from '../lib/matchCompatible.js';

const LIMITE_MATCHES = 5;
const VENTANA_MATCHES_SEGUNDOS = 3600;

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

    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

    const misPerRes = await fetch(
      `${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${encodeURIComponent(usuarioId)}`,
      { headers }
    );
    const misPer = misPerRes.ok ? await misPerRes.json() : [];
    if (!misPer || misPer.length === 0) {
      return res.status(200).json({ matchEncontrado: false, matchData: null });
    }
    const miPerfil = misPer[0];

    const [otrosRes, cuentasPruebaRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=neq.${encodeURIComponent(usuarioId)}`, { headers }),
      // Las cuentas de prueba fijas (Vista Previa del panel admin) usan a
      // proposito el dominio @soul-app.test -- nunca deben terminar
      // matcheadas con una persona real por casualidad de compatibilidad.
      fetch(`${supabaseUrl}/rest/v1/usuarios?select=id&email=like.*@soul-app.test`, { headers })
    ]);
    let otrosPerfiles = otrosRes.ok ? await otrosRes.json() : [];
    const idsCuentasPrueba = new Set((cuentasPruebaRes.ok ? await cuentasPruebaRes.json() : []).map((u) => u.id));
    if (idsCuentasPrueba.size > 0) {
      otrosPerfiles = otrosPerfiles.filter((p) => !idsCuentasPrueba.has(p.usuario_id));
    }

    // Evita generar un match duplicado con alguien con quien ya existe uno
    // (en cualquier estado) -- sin este chequeo, reintentar el pipeline
    // (ej. el boton "Reintentar" tras un error en un paso posterior) podia
    // volver a correr calcularMatches() y crear una fila nueva con la misma
    // persona, gastando Claude de nuevo y ensuciando el listado de matches.
    const yaMatcheadosRes = await fetch(
      `${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&or=(usuario_a.eq.${encodeURIComponent(usuarioId)},usuario_b.eq.${encodeURIComponent(usuarioId)})`,
      { headers }
    );
    const yaMatcheados = yaMatcheadosRes.ok ? await yaMatcheadosRes.json() : [];
    const idsYaMatcheados = new Set(
      yaMatcheados.map((m) => (m.usuario_a === usuarioId ? m.usuario_b : m.usuario_a))
    );
    const otrosPerfilesSinMatch = otrosPerfiles.filter((p) => !idsYaMatcheados.has(p.usuario_id));

    // El genero/preferencia vive en 'usuarios', no en 'perfiles' -- hace
    // falta traerlo aparte para filtrar ANTES de gastar ninguna llamada a
    // Claude (ver lib/matchCompatible.js: sin esto se llegaron a crear
    // matches que cruzaban lo que la persona eligio en "¿Con quien queres
    // conectar?").
    const idsCandidatos = otrosPerfilesSinMatch.map((p) => p.usuario_id);
    let miGeneroInfo = null;
    let otrosPerfilesCompatibles = [];
    if (idsCandidatos.length > 0) {
      const [miUsuarioRes, otrosUsuariosRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,genero,preferencia_genero&id=eq.${encodeURIComponent(usuarioId)}`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,genero,preferencia_genero&id=in.(${idsCandidatos.map(encodeURIComponent).join(',')})`, { headers })
      ]);
      const miUsuarioRows = miUsuarioRes.ok ? await miUsuarioRes.json() : [];
      miGeneroInfo = miUsuarioRows[0] || null;
      const otrosUsuarios = otrosUsuariosRes.ok ? await otrosUsuariosRes.json() : [];
      const generoPorId = {};
      otrosUsuarios.forEach((u) => { generoPorId[u.id] = u; });
      otrosPerfilesCompatibles = otrosPerfilesSinMatch.filter((p) => generosCompatibles(miGeneroInfo, generoPorId[p.usuario_id]));
    }

    let matchEncontrado = false;
    let matchData = null;
    // Este endpoint puede hacer varias llamadas a Claude (una por cada otro
    // perfil) -- se acumula el uso total y se loguea una sola vez al final,
    // en vez de sumar una escritura a Supabase por cada comparacion.
    let totalInputTokens = 0, totalOutputTokens = 0;

    for (const otro of otrosPerfilesCompatibles) {
      const { json: comp, usage } = await llamarClaudeJSON({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: COMPARE_PROMPT,
        messages: [{
          role: 'user',
          content: 'Perfil A:\n' + JSON.stringify(miPerfil) + '\n\nPerfil B:\n' + JSON.stringify(otro)
        }]
      });
      if (usage) {
        totalInputTokens += usage.input_tokens || 0;
        totalOutputTokens += usage.output_tokens || 0;
      }

      // Umbral acorde a la recalibracion de COMPARE_PROMPT (ver
      // lib/comparePrompt.js): "alineacion real" empieza en 55-70 y
      // "solida" en 70-85, asi que el corte se ubica adentro de esas
      // bandas en vez del umbral viejo (50/65), que con el prompt anterior
      // dejaba pasar casi cualquier par -- una persona real del piloto
      // llego a tener 17 matches simultaneos con eso.
      const supera = comp.compatibilidad_hoy >= 60 || comp.potencial_construccion >= 75;
      // Se guarda la comparacion aunque no supere el umbral (estado
      // "descartado") -- mismo motivo que en calcularRanking de
      // api/admin/matches.js: le permite a la administradora activarlo a
      // mano desde el panel con su propio criterio, y evita volver a
      // gastar Claude comparando este mismo par de nuevo (yaMatcheados,
      // mas arriba en este archivo, ya trata cualquier estado como "ya
      // comparado"). listarMisMatches excluye "descartado" explicitamente,
      // asi que la persona real nunca lo ve como si fuera un match.
      const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          usuario_a: usuarioId,
          usuario_b: otro.usuario_id,
          compatibilidad_hoy: comp.compatibilidad_hoy,
          potencial_construccion: comp.potencial_construccion,
          fortalezas: comp.fortalezas,
          desafio: comp.desafio,
          mensaje_dupla: comp.mensaje_dupla,
          analisis_por_variable: comp.analisis_por_variable || null,
          estado: supera ? 'pendiente' : 'descartado',
          activado_por: 'sistema'
        })
      });
      const matchRows = matchRes.ok ? await matchRes.json() : [];
      if (supera) {
        matchEncontrado = true;
        matchData = {
          id: matchRows[0] ? matchRows[0].id : null,
          compatibilidad_hoy: comp.compatibilidad_hoy,
          potencial_construccion: comp.potencial_construccion,
          mensaje_dupla: comp.mensaje_dupla
        };
      }
    }

    await registrarUsoTokens({
      usuarioId,
      endpoint: 'calcularMatches',
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens }
    });
    await registrarEvento({
      usuarioId,
      tipo: 'calculo_matches',
      metadata: { matchEncontrado, cantidadComparaciones: otrosPerfilesCompatibles.length }
    });

    return res.status(200).json({ matchEncontrado, matchData });

  } catch (error) {
    console.error('Error en /api/calcularMatches:', error);
    await registrarErrorSilencioso({ contexto: 'api/calcularMatches', error });
    return res.status(500).json({ error: 'Error calculando matches' });
  }
}
