import { verificarAdmin } from '../../lib/verificarAdmin.js';
import { llamarClaudeJSON } from '../../lib/anthropicClient.js';
import { registrarUsoTokens } from '../../lib/logUso.js';
import { COMPARE_PROMPT } from '../../lib/comparePrompt.js';

// Mismo umbral que api/calcularMatches.js usa para crear una fila de match real.
const UMBRAL_COMPATIBILIDAD_HOY = 50;
const UMBRAL_POTENCIAL = 65;
// Concurrencia limitada -- comparar contra decenas o cientos de perfiles sin
// ningún límite arriesga un rate limit de la API; en lotes de 20 sigue siendo
// muy por debajo de lo que soporta una cuenta real, y corta bastante el
// tiempo total comparado con ir de a uno.
const CONCURRENCIA = 20;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verificarAdmin(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { personaId } = req.body;
  if (!personaId) {
    return res.status(400).json({ error: 'Falta personaId' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase no configurado' });
  }
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
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
      // Matches existentes de esta persona -- para no duplicar filas si ya
      // hay una comparación previa (manual o del sistema) contra alguien.
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

    // Crea filas 'pendiente' para los pares que superan el umbral y todavía
    // no tienen match -- así lo que sale mejor rankeado ya queda listo para
    // que la administradora lo active con un click desde la pestaña Matches.
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
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/matches`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
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

  } catch (error) {
    console.error('Error en /api/admin/ranking:', error);
    return res.status(500).json({ error: 'Error al calcular el ranking' });
  }
}
