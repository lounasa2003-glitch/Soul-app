import { verificarAdmin } from '../../lib/verificarAdmin.js';
import { llamarClaudeJSON } from '../../lib/anthropicClient.js';
import { registrarUsoTokens } from '../../lib/logUso.js';
import { COMPARE_PROMPT } from '../../lib/comparePrompt.js';
import { notificarNuevoMatch } from '../../lib/email.js';

// Fusiona lo que antes eran admin/ranking.js y admin/activarMatch.js en un
// solo archivo -- el plan Hobby de Vercel permite como maximo 12 funciones
// serverless por deploy, y el proyecto ya estaba por encima de eso. Se
// distingue por el campo "accion" del body.

const UMBRAL_COMPATIBILIDAD_HOY = 50;
const UMBRAL_POTENCIAL = 65;
const CONCURRENCIA = 20;

async function calcularRanking(req, res, supabaseUrl, headers) {
  const { personaId } = req.body;
  if (!personaId) {
    return res.status(400).json({ error: 'Falta personaId' });
  }

  const [miRes, otrosRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${encodeURIComponent(personaId)}`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=neq.${encodeURIComponent(personaId)}`, { headers })
  ]);
  const misPerfiles = miRes.ok ? await miRes.json() : [];
  const otrosPerfiles = otrosRes.ok ? await otrosRes.json() : [];

  if (!misPerfiles[0]) {
    return res.status(400).json({ error: 'sin_perfil', mensaje: 'Esta persona todavía no tiene perfil.' });
  }
  const miPerfil = misPerfiles[misPerfiles.length - 1];

  if (otrosPerfiles.length === 0) {
    return res.status(200).json({ ranking: [] });
  }

  const idsUnicos = [...new Set(otrosPerfiles.map(p => p.usuario_id))];
  const [nombresRes, matchesRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre&id=in.(${idsUnicos.map(encodeURIComponent).join(',')})`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&or=(usuario_a.eq.${encodeURIComponent(personaId)},usuario_b.eq.${encodeURIComponent(personaId)})`, { headers })
  ]);
  const nombresRows = nombresRes.ok ? await nombresRes.json() : [];
  const nombrePorId = {};
  nombresRows.forEach(u => { nombrePorId[u.id] = u.nombre; });

  const matchesExistentes = matchesRes.ok ? await matchesRes.json() : [];
  const paresExistentes = new Set(
    matchesExistentes.map(m => [m.usuario_a, m.usuario_b].sort().join('|'))
  );

  let totalInputTokens = 0, totalOutputTokens = 0;
  const comparaciones = [];

  for (let i = 0; i < otrosPerfiles.length; i += CONCURRENCIA) {
    const lote = otrosPerfiles.slice(i, i + CONCURRENCIA);
    const resultadosLote = await Promise.all(lote.map(async (otro) => {
      try {
        const { json: comp, usage } = await llamarClaudeJSON({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          system: COMPARE_PROMPT,
          messages: [{
            role: 'user',
            content: 'Perfil A:\n' + JSON.stringify(miPerfil) + '\n\nPerfil B:\n' + JSON.stringify(otro)
          }]
        });
        return { otro, comp, usage };
      } catch (error) {
        console.error('Error en ranking comparando contra', otro.usuario_id, error);
        return null;
      }
    }));
    resultadosLote.forEach(r => {
      if (!r) return;
      if (r.usage) {
        totalInputTokens += r.usage.input_tokens || 0;
        totalOutputTokens += r.usage.output_tokens || 0;
      }
      comparaciones.push(r);
    });
  }

  await registrarUsoTokens({
    usuarioId: null,
    endpoint: 'adminRanking',
    usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens }
  });

  const inserts = [];
  comparaciones.forEach(({ otro, comp }) => {
    const supera = comp.compatibilidad_hoy >= UMBRAL_COMPATIBILIDAD_HOY || comp.potencial_construccion >= UMBRAL_POTENCIAL;
    if (!supera) return;
    const clave = [personaId, otro.usuario_id].sort().join('|');
    if (paresExistentes.has(clave)) return;
    paresExistentes.add(clave);
    inserts.push({
      usuario_a: personaId,
      usuario_b: otro.usuario_id,
      compatibilidad_hoy: comp.compatibilidad_hoy,
      potencial_construccion: comp.potencial_construccion,
      fortalezas: comp.fortalezas,
      desafio: comp.desafio,
      mensaje_dupla: comp.mensaje_dupla,
      analisis_por_variable: comp.analisis_por_variable || null,
      estado: 'pendiente',
      activado_por: 'sistema'
    });
  });

  if (inserts.length > 0) {
    // El chequeo de "paresExistentes" de arriba solo protege dentro de esta
    // misma llamada -- si esta funcion se dispara dos veces casi al mismo
    // tiempo para la misma persona (doble click, reintento de red), las dos
    // pueden no ver el match de la otra todavia y terminar creando dos filas
    // para el mismo par. `on_conflict=par_clave` + `ignore-duplicates` hace
    // que Postgres directamente descarte el insert repetido en vez de crear
    // la fila de mas (requiere el indice unico sobre `par_clave`).
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/matches?on_conflict=par_clave`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(inserts)
    });
    if (!insertRes.ok) {
      console.error('Error creando matches desde ranking:', insertRes.status, await insertRes.text());
    }
  }

  const ranking = comparaciones
    .map(({ otro, comp }) => ({
      usuarioId: otro.usuario_id,
      nombre: nombrePorId[otro.usuario_id] || null,
      compatibilidad_hoy: comp.compatibilidad_hoy,
      potencial_construccion: comp.potencial_construccion,
      veredicto: comp.veredicto,
      promedio: (comp.compatibilidad_hoy + comp.potencial_construccion) / 2
    }))
    .sort((a, b) => b.promedio - a.promedio);

  return res.status(200).json({ ranking, totalComparados: comparaciones.length, totalPerfiles: otrosPerfiles.length });
}

async function cambiarEstado(req, res, supabaseUrl, headers, accion) {
  const { matchId } = req.body;
  if (!matchId) {
    return res.status(400).json({ error: 'Falta matchId' });
  }
  const datos = accion === 'activar'
    ? { estado: 'activo', activado_por: 'admin' }
    : { estado: 'pausado' };

  const response = await fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(datos)
  });
  const data = await response.json();
  if (!response.ok) {
    return res.status(response.status).json(data);
  }

  // La etapa de cada persona en el panel tiene que reflejar esto ya, no
  // recién cuando esa persona vuelva a entrar a la app -- antes esto solo
  // se actualizaba del lado del cliente (chequearMatchPendiente), así que
  // si todavía no volvió a loguearse la lista seguía mostrando "modulos"
  // aunque el match ya estuviera activo.
  if (accion === 'activar' && data[0]) {
    const match = data[0];
    await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(match.usuario_a)}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ etapa_actual: 'match' })
      }),
      fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(match.usuario_b)}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ etapa_actual: 'match' })
      })
    ]).catch(() => {});

    // Avisar por mail a los dos -- se espera a que termine (no
    // fire-and-forget): en serverless el contexto puede cortarse apenas se
    // responde, asi que una llamada sin await puede no llegar a mandarse.
    // Si Resend falla igual se responde 200 -- el match ya quedo activo.
    try {
      const nRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=nombre,email&id=in.(${encodeURIComponent(match.usuario_a)},${encodeURIComponent(match.usuario_b)})`, { headers });
      const usuarios = nRes.ok ? await nRes.json() : [];
      await notificarNuevoMatch(usuarios);
    } catch (e) {
      console.error('Error notificando match nuevo por mail:', e);
    }
  }

  return res.status(200).json(data[0] || null);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verificarAdmin(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  const { accion } = req.body;

  try {
    if (accion === 'ranking') {
      return await calcularRanking(req, res, supabaseUrl, headers);
    }
    if (accion === 'activar' || accion === 'pausar') {
      return await cambiarEstado(req, res, supabaseUrl, headers, accion);
    }
    return res.status(400).json({ error: 'Acción no válida' });
  } catch (error) {
    console.error('Error en /api/admin/matches:', error);
    return res.status(500).json({ error: 'Error procesando la solicitud' });
  }
}
