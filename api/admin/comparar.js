import { verificarAdmin } from '../../lib/verificarAdmin.js';
import { llamarClaudeJSON } from '../../lib/anthropicClient.js';
import { registrarUsoTokens } from '../../lib/logUso.js';
import { COMPARE_PROMPT } from '../../lib/comparePrompt.js';
import { registrarErrorSilencioso } from '../../lib/logErrorSilencioso.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await verificarAdmin(req))) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { idA, idB } = req.body;
  if (!idA || !idB) {
    return res.status(400).json({ error: 'Faltan ids' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
    const [resA, resB, usuariosRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${encodeURIComponent(idA)}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${encodeURIComponent(idB)}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,no_negociables,negociables&id=in.(${encodeURIComponent(idA)},${encodeURIComponent(idB)})`, { headers })
    ]);
    const perfilesA = resA.ok ? await resA.json() : [];
    const perfilesB = resB.ok ? await resB.json() : [];
    const usuarios = usuariosRes.ok ? await usuariosRes.json() : [];
    const usuarioA = usuarios.find(u => u.id === idA);
    const usuarioB = usuarios.find(u => u.id === idB);
    const nombreA = (usuarioA && (usuarioA.nombre || usuarioA.email)) || null;
    const nombreB = (usuarioB && (usuarioB.nombre || usuarioB.email)) || null;

    if (!perfilesA[0] || !perfilesB[0]) {
      return res.status(400).json({ error: 'sin_perfil', mensaje: 'Una o ambas personas todavía no tienen perfil.' });
    }

    const { json: comp, usage } = await llamarClaudeJSON({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: COMPARE_PROMPT,
      messages: [{
        role: 'user',
        content: 'Perfil A:\n' + JSON.stringify(perfilesA[perfilesA.length - 1]) +
          '\nNo negociables de A: ' + (usuarioA && usuarioA.no_negociables || 'null') +
          '\nNegociables de A: ' + (usuarioA && usuarioA.negociables || 'null') +
          '\n\nPerfil B:\n' + JSON.stringify(perfilesB[perfilesB.length - 1]) +
          '\nNo negociables de B: ' + (usuarioB && usuarioB.no_negociables || 'null') +
          '\nNegociables de B: ' + (usuarioB && usuarioB.negociables || 'null')
      }]
    });
    await registrarUsoTokens({ usuarioId: null, endpoint: 'adminComparar', usage });

    // La comparacion manual necesita una fila en `matches` para poder
    // ofrecer el mismo boton "Activar" que ya existe en la lista de
    // candidatos del ranking -- si ya existe un match para este par (en
    // cualquier direccion/estado) se reutiliza en vez de crear otro (evita
    // duplicar filas para el mismo par).
    const existenteRes = await fetch(
      `${supabaseUrl}/rest/v1/matches?select=id,estado&or=(and(usuario_a.eq.${encodeURIComponent(idA)},usuario_b.eq.${encodeURIComponent(idB)}),and(usuario_a.eq.${encodeURIComponent(idB)},usuario_b.eq.${encodeURIComponent(idA)}))`,
      { headers }
    );
    const existentes = existenteRes.ok ? await existenteRes.json() : [];
    let matchId = existentes[0] ? existentes[0].id : null;
    let matchEstado = existentes[0] ? existentes[0].estado : null;

    if (!matchId) {
      // on_conflict=par_clave + ignore-duplicates: si justo en este momento
      // se creo otro match para el mismo par (ranking corriendo en paralelo,
      // u otro admin comparando lo mismo), Postgres descarta este insert en
      // vez de duplicar la fila -- en ese caso no vuelve nada en el body,
      // asi que se recupera el id existente con un select aparte.
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/matches?on_conflict=par_clave`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({
          usuario_a: idA,
          usuario_b: idB,
          compatibilidad_hoy: comp.compatibilidad_hoy,
          potencial_construccion: comp.potencial_construccion,
          fortalezas: comp.fortalezas,
          desafio: comp.desafio,
          mensaje_dupla: comp.mensaje_dupla,
          analisis_por_variable: comp.analisis_por_variable || null,
          estado: 'pendiente',
          activado_por: 'admin'
        })
      });
      if (insertRes.ok) {
        const inserted = await insertRes.json();
        if (inserted[0]) {
          matchId = inserted[0].id; matchEstado = inserted[0].estado;
        } else {
          const recheckRes = await fetch(
            `${supabaseUrl}/rest/v1/matches?select=id,estado&or=(and(usuario_a.eq.${encodeURIComponent(idA)},usuario_b.eq.${encodeURIComponent(idB)}),and(usuario_a.eq.${encodeURIComponent(idB)},usuario_b.eq.${encodeURIComponent(idA)}))`,
            { headers }
          );
          const recheck = recheckRes.ok ? await recheckRes.json() : [];
          if (recheck[0]) { matchId = recheck[0].id; matchEstado = recheck[0].estado; }
        }
      } else {
        console.error('Error creando match desde comparador manual:', insertRes.status, await insertRes.text());
      }
    }

    return res.status(200).json({ ...comp, nombreA, nombreB, matchId, matchEstado });
  } catch (error) {
    console.error('Error en /api/admin/comparar:', error);
    await registrarErrorSilencioso({ contexto: 'api/admin/comparar', error });
    return res.status(500).json({ error: 'Error al comparar' });
  }
}
