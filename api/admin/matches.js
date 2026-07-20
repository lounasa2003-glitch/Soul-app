import { verificarAdmin } from '../../lib/verificarAdmin.js';
import { llamarClaudeJSON } from '../../lib/anthropicClient.js';
import { registrarUsoTokens } from '../../lib/logUso.js';
import { COMPARE_PROMPT } from '../../lib/comparePrompt.js';
import { notificarNuevoMatch } from '../../lib/email.js';
import { generosCompatibles } from '../../lib/matchCompatible.js';

// Fusiona lo que antes eran admin/ranking.js y admin/activarMatch.js en un
// solo archivo -- el plan Hobby de Vercel permite como maximo 12 funciones
// serverless por deploy, y el proyecto ya estaba por encima de eso. Se
// distingue por el campo "accion" del body.

// Mismo umbral que api/calcularMatches.js -- ver el comentario ahi sobre la
// recalibracion de COMPARE_PROMPT (lib/comparePrompt.js).
const UMBRAL_COMPATIBILIDAD_HOY = 60;
const UMBRAL_POTENCIAL = 75;
const CONCURRENCIA = 20;

async function calcularRanking(req, res, supabaseUrl, headers) {
  const { personaId } = req.body;
  if (!personaId) {
    return res.status(400).json({ error: 'Falta personaId' });
  }

  const [miRes, otrosRes, cuentasPruebaRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=eq.${encodeURIComponent(personaId)}`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/perfiles?select=*&usuario_id=neq.${encodeURIComponent(personaId)}`, { headers }),
    // Las cuentas de prueba fijas (Vista Previa) usan a proposito el dominio
    // @soul-app.test -- nunca deben terminar sugeridas como match para una
    // persona real por casualidad de compatibilidad.
    fetch(`${supabaseUrl}/rest/v1/usuarios?select=id&email=like.*@soul-app.test`, { headers })
  ]);
  const misPerfiles = miRes.ok ? await miRes.json() : [];
  let otrosPerfiles = otrosRes.ok ? await otrosRes.json() : [];
  const idsCuentasPrueba = new Set((cuentasPruebaRes.ok ? await cuentasPruebaRes.json() : []).map((u) => u.id));
  if (idsCuentasPrueba.size > 0) {
    otrosPerfiles = otrosPerfiles.filter((p) => !idsCuentasPrueba.has(p.usuario_id));
  }

  if (!misPerfiles[0]) {
    return res.status(400).json({ error: 'sin_perfil', mensaje: 'Esta persona todavía no tiene perfil.' });
  }
  const miPerfil = misPerfiles[misPerfiles.length - 1];

  if (otrosPerfiles.length === 0) {
    return res.status(200).json({ ranking: [] });
  }

  const idsUnicos = [...new Set(otrosPerfiles.map(p => p.usuario_id))];
  const [nombresRes, matchesRes, miUsuarioRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre,genero,preferencia_genero&id=in.(${idsUnicos.map(encodeURIComponent).join(',')})`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/matches?select=usuario_a,usuario_b&or=(usuario_a.eq.${encodeURIComponent(personaId)},usuario_b.eq.${encodeURIComponent(personaId)})`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,genero,preferencia_genero&id=eq.${encodeURIComponent(personaId)}`, { headers })
  ]);
  const nombresRows = nombresRes.ok ? await nombresRes.json() : [];
  const nombrePorId = {};
  const generoPorId = {};
  nombresRows.forEach(u => { nombrePorId[u.id] = u.nombre; generoPorId[u.id] = u; });
  const miUsuarioRows = miUsuarioRes.ok ? await miUsuarioRes.json() : [];
  const miGeneroInfo = miUsuarioRows[0] || null;

  const matchesExistentes = matchesRes.ok ? await matchesRes.json() : [];
  const paresExistentes = new Set(
    matchesExistentes.map(m => [m.usuario_a, m.usuario_b].sort().join('|'))
  );

  // Filtra ANTES de gastar ninguna llamada a Claude -- ver
  // lib/matchCompatible.js: sin esto el ranking llegaba a comparar (y hasta
  // matchear) personas que cruzaban lo que cada una eligio en "¿Con quien
  // queres conectar?".
  otrosPerfiles = otrosPerfiles.filter(p => generosCompatibles(miGeneroInfo, generoPorId[p.usuario_id]));

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

    // Decision de producto confirmada: una persona puede tener varios
    // matches activos en paralelo, cada uno en su propia etapa -- ya no se
    // pausan los demas al activar uno nuevo (antes si, cuando el diseño era
    // "un match a la vez"; el cliente ahora junta todos los pendientes en
    // vez de quedarse con el primero que encuentra).

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

// ── Vista previa: sembrar una cuenta fija en distintos momentos del
// proceso, para poder revisarlos sin jugar de usuaria de prueba desde cero
// cada vez. Dos cuentas fijas y conocidas (mismo email/password siempre) --
// los datos se resetean en cada siembra, nunca se acumulan escenarios
// viejos. Todo lo que puede pasar por la API real (cerrar una cita, etc.)
// pasa por ahi -- asi los efectos reales (resumen, dinamica relacional)
// tambien se generan de verdad, no se simulan a mano.
const PREVIEW_EMAIL_A = 'preview@soul-app.test';
const PREVIEW_EMAIL_B = 'preview-alex@soul-app.test';
const PREVIEW_PASSWORD = 'PreviewSoul2026!';
const PREVIEW_NOMBRE_A = 'Vista Previa';
const PREVIEW_NOMBRE_B = 'Alex (preview)';
const ESCENARIOS_PREVIEW = new Set(['chat', 'modulos', 'match_pendiente', 'cita', 'debriefing', 'sala_encuentros']);

// Avatar de prueba autocontenido (sin depender de ninguna imagen externa,
// coherente con "cero dependencias") -- solo para que la pantalla de
// presentación de match tenga algo real que mostrar en la foto.
function avatarPreview(letra, color) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><rect width='300' height='300' fill='${color}'/><text x='150' y='185' font-size='130' font-family='Georgia, serif' fill='white' text-anchor='middle'>${letra}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function baseUrlDesdeRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers['host']}`;
}

async function loginOCrearAuth(supabaseUrl, supabaseKey, email, password) {
  const headersBase = { 'Content-Type': 'application/json', apikey: supabaseKey };
  let r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: headersBase, body: JSON.stringify({ email, password }) });
  if (r.ok) return await r.json();
  r = await fetch(`${supabaseUrl}/auth/v1/signup`, { method: 'POST', headers: headersBase, body: JSON.stringify({ email, password }) });
  const data = await r.json();
  if (!r.ok) throw new Error('No se pudo crear la cuenta de preview: ' + JSON.stringify(data));
  return data;
}

async function asegurarUsuario(supabaseUrl, headers, email, nombre) {
  const r = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=id&email=eq.${encodeURIComponent(email)}`, { headers });
  const rows = r.ok ? await r.json() : [];
  if (rows[0]) return rows[0].id;
  const insertRes = await fetch(`${supabaseUrl}/rest/v1/usuarios`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ email, nombre })
  });
  const inserted = await insertRes.json();
  return inserted[0].id;
}

function perfilPreview() {
  return {
    grupo1: { valores: ['honestidad', 'curiosidad', 'humor'], estilo_comunicacion: 'directa', ritmo_emocional: 'reflexivo', mascara_vs_autentico: 'autentica', momento_evolutivo: 'en crecimiento' },
    grupo2: { tipo_vinculo: 'compañerismo profundo', proyecto_vida: 'construir algo propio y viajar', necesidades_intimidad: 'cercanía con espacio propio', no_puede_faltar: 'humor compartido', no_puede_estar: 'falta de honestidad' },
    grupo3: { modo_conflictos: 'lo habla enseguida', capacidad_reparacion: 'alta', reciprocidad: 'equilibrada', flexibilidad: 'media', patrones_vinculares: 'tiende a dar el primer paso' },
    grupo4: { apertura: 'alta', consistencia: 'alta', estabilidad_emocional: 'media', revision_creencias: 'activa', metalenguaje: 'fluido', indice_disponibilidad: 7 },
    referencias_culturales: JSON.stringify({ pelicula: 'Película de prueba', cancion: 'Canción de prueba', libro: 'Libro de prueba' }),
    modulo_esencial: 'Capacidad de volver a elegir',
    modulo_recomendado: 'Autonomía emocional',
    modulo_fase: 'esencial'
  };
}

// Limpia todo lo que haya quedado de una siembra anterior antes de armar la
// nueva -- asi cada escenario queda inequívoco, sin restos de otro.
async function limpiarDatosPreview(supabaseUrl, headers, idA, idB) {
  const ids = [idA, idB].filter(Boolean);
  const condiciones = ids.flatMap((id) => [`usuario_a.eq.${id}`, `usuario_b.eq.${id}`]).join(',');
  const matchesRes = await fetch(`${supabaseUrl}/rest/v1/matches?select=id&or=(${condiciones})`, { headers });
  const matches = matchesRes.ok ? await matchesRes.json() : [];
  const matchIds = matches.map((m) => m.id);
  if (matchIds.length > 0) {
    const listaMatchIds = matchIds.map(encodeURIComponent).join(',');
    const citasRes = await fetch(`${supabaseUrl}/rest/v1/citas?select=id&match_id=in.(${listaMatchIds})`, { headers });
    const citas = citasRes.ok ? await citasRes.json() : [];
    const citaIds = citas.map((c) => c.id);
    if (citaIds.length > 0) {
      const listaCitaIds = citaIds.map(encodeURIComponent).join(',');
      await fetch(`${supabaseUrl}/rest/v1/cita_mensajes?cita_id=in.(${listaCitaIds})`, { method: 'DELETE', headers });
      await fetch(`${supabaseUrl}/rest/v1/cita_reflexiones?cita_id=in.(${listaCitaIds})`, { method: 'DELETE', headers });
      await fetch(`${supabaseUrl}/rest/v1/cita_ayudas?cita_id=in.(${listaCitaIds})`, { method: 'DELETE', headers });
      await fetch(`${supabaseUrl}/rest/v1/citas?id=in.(${listaCitaIds})`, { method: 'DELETE', headers });
    }
    await fetch(`${supabaseUrl}/rest/v1/matches?id=in.(${listaMatchIds})`, { method: 'DELETE', headers });
  }
  for (const id of ids) {
    await fetch(`${supabaseUrl}/rest/v1/perfiles?usuario_id=eq.${id}`, { method: 'DELETE', headers });
    await fetch(`${supabaseUrl}/rest/v1/historial_relacional?usuario_id=eq.${id}`, { method: 'DELETE', headers });
    await fetch(`${supabaseUrl}/rest/v1/conversaciones?usuario_id=eq.${id}`, { method: 'DELETE', headers });
  }
}

async function sembrarPreview(req, res, supabaseUrl, supabaseKey, headers) {
  const { escenario } = req.body;
  if (!ESCENARIOS_PREVIEW.has(escenario)) {
    return res.status(400).json({ error: 'Escenario no válido' });
  }

  const authA = await loginOCrearAuth(supabaseUrl, supabaseKey, PREVIEW_EMAIL_A, PREVIEW_PASSWORD);
  const idA = await asegurarUsuario(supabaseUrl, headers, PREVIEW_EMAIL_A, PREVIEW_NOMBRE_A);

  const necesitaSegundaPersona = escenario === 'match_pendiente' || escenario === 'cita' || escenario === 'debriefing' || escenario === 'sala_encuentros';
  let authB = null, idB = null;
  if (necesitaSegundaPersona) {
    authB = await loginOCrearAuth(supabaseUrl, supabaseKey, PREVIEW_EMAIL_B, PREVIEW_PASSWORD);
    idB = await asegurarUsuario(supabaseUrl, headers, PREVIEW_EMAIL_B, PREVIEW_NOMBRE_B);
  }

  await limpiarDatosPreview(supabaseUrl, headers, idA, idB);

  const base = baseUrlDesdeRequest(req);
  let instrucciones = 'Iniciá sesión en soul.html con este email y contraseña.';

  if (escenario === 'modulos' || necesitaSegundaPersona) {
    await fetch(`${supabaseUrl}/rest/v1/perfiles`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ usuario_id: idA, ...perfilPreview() }) });
  }

  if (escenario === 'chat') {
    instrucciones = 'Vas a caer en "¿Qué querés hacer hoy?" -- elegí seguir charlando con Soul para entrar al chat inicial, vacío.';
  }

  if (escenario === 'modulos') {
    instrucciones = 'Vas a caer en "¿Qué querés hacer hoy?" -- elegí seguir charlando con Soul para entrar directo a los módulos.';
  }

  if (necesitaSegundaPersona) {
    await fetch(`${supabaseUrl}/rest/v1/perfiles`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ usuario_id: idB, ...perfilPreview() }) });

    if (escenario === 'match_pendiente') {
      // Fotos + fecha de nacimiento reales (aunque sea un avatar generado)
      // porque obtenerPresentacion (api/matches.js) las necesita para armar
      // la pantalla que ve la otra persona antes de decidir -- sin esto se
      // vería vacía, no representaría lo que pasa en un caso real.
      await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${idA}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ fecha_nacimiento: '1994-05-12', foto_cara: avatarPreview('VP', '#6b5b8f'), foto_aprobada: true }) }),
        fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${idB}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ fecha_nacimiento: '1992-11-03', foto_cara: avatarPreview('A', '#8f5b6b'), foto_aprobada: true }) })
      ]);

      // estado 'activo' con eleccion_usuario_a/b sin definir -- exactamente
      // como queda un match recien activado por la admin, antes de que
      // ninguna de las dos personas haya decidido nada. Es lo que hace que
      // recolectarPendientes() lo detecte como "decision" pendiente y
      // muestre la pantalla de presentación al loguearse.
      await fetch(`${supabaseUrl}/rest/v1/matches`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          usuario_a: idA, usuario_b: idB, compatibilidad_hoy: 74, potencial_construccion: 81,
          fortalezas: ['Los dos valoran la honestidad directa', 'Buen equilibrio entre cercanía y espacio propio'],
          desafio: 'Podrían evitar los temas incómodos por privilegiar la calidez',
          mensaje_dupla: 'Dos personas que valoran la honestidad y el humor compartido -- el desafío va a ser no esquivar lo incómodo.',
          estado: 'activo', activado_por: 'admin'
        })
      });

      instrucciones = 'Al iniciar sesión vas a caer directo en el preámbulo del match nuevo y después en la presentación de Alex (preview): nombre, edad, bio y foto, antes de decidir si querés conocerla. Con la otra cuenta (preview-alex@soul-app.test, misma contraseña) vas a ver la presentación de Vista Previa, simétrica.';
      return res.status(200).json({ ok: true, email: PREVIEW_EMAIL_A, password: PREVIEW_PASSWORD, instrucciones });
    }

    const matchRes = await fetch(`${supabaseUrl}/rest/v1/matches`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        usuario_a: idA, usuario_b: idB, compatibilidad_hoy: 74, potencial_construccion: 81,
        fortalezas: ['Los dos valoran la honestidad directa', 'Buen equilibrio entre cercanía y espacio propio'],
        desafio: 'Podrían evitar los temas incómodos por privilegiar la calidez',
        mensaje_dupla: 'Dos personas que valoran la honestidad y el humor compartido -- el desafío va a ser no esquivar lo incómodo.',
        estado: 'mutuamente_aceptado', activado_por: 'admin'
      })
    });
    const match = (await matchRes.json())[0];

    const citaRes = await fetch(`${supabaseUrl}/rest/v1/citas`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ match_id: match.id, estado: 'activa', consiente_analisis_a: true, consiente_analisis_b: true })
    });
    const cita = (await citaRes.json())[0];

    const mensajes = [
      { usuario_id: null, contenido: 'No busquen impresionar. Intenten descubrir si disfrutan conversar.' },
      { usuario_id: idB, contenido: 'Hola! ¿Cómo llegaste hasta acá, con todo esto de Soul?' },
      { usuario_id: idA, contenido: 'Un poco por curiosidad, un poco porque estaba cansada de las apps normales. ¿Y vos?' },
      { usuario_id: idB, contenido: 'Parecido. Me gustó que no arranca preguntando edad y trabajo como si fuera un formulario.' }
    ];
    for (const m of mensajes) {
      await fetch(`${supabaseUrl}/rest/v1/cita_mensajes`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ cita_id: cita.id, tipo: 'texto', ...m }) });
    }

    if (escenario === 'cita') {
      instrucciones = 'Vas a caer directo en la cita en curso con Alex (preview).';
    }

    if (escenario === 'debriefing' || escenario === 'sala_encuentros') {
      // Se cierra de verdad via la API real (no un UPDATE directo a la
      // base) para que se disparen los efectos reales -- resumen objetivo,
      // extraccion de dinamica relacional -- igual que le pasaria a una
      // pareja real, no una version simulada a mano.
      await fetch(`${base}/api/citas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authB.access_token }, body: JSON.stringify({ accion: 'ayudaPrivada', citaId: cita.id, tipoAyuda: 'cerrar' }) });
      await fetch(`${base}/api/citas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authA.access_token }, body: JSON.stringify({ accion: 'responderCierre', citaId: cita.id, respuesta: 'para' }) });

      if (escenario === 'debriefing') {
        // Se resuelve la Sala de Encuentros de verdad, via la API real y
        // por las dos personas (nunca escribiendo decision_a/b a mano en la
        // base) -- eso es lo unico que efectivamente crea el proximo
        // encuentro y reinicia decision_a/b como pasaria en un caso real.
        // Antes esto se resolvia con un UPDATE directo a la base, que dejaba
        // el match en un estado que nunca ocurre en la app real (decision
        // "resuelta" pero sin el encuentro nuevo que ese resultado deberia
        // haber generado) -- por eso no aparecia forma de agendar una charla
        // nueva desde Matches.
        await fetch(`${base}/api/citas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authA.access_token }, body: JSON.stringify({ accion: 'decidirSalaEncuentros', matchId: match.id, decision: 'seguir_soul' }) });
        await fetch(`${base}/api/citas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authB.access_token }, body: JSON.stringify({ accion: 'decidirSalaEncuentros', matchId: match.id, decision: 'seguir_soul' }) });
        instrucciones = 'Las dos personas ya eligieron seguir en Soul, asi que el login te manda directo al encuentro NUEVO (activo, vacio) -- esto es lo que realmente pasa despues de esa decision. Tocá "← Salir" y andá a "Ver mis matches": vas a ver los dos encuentros anidados bajo el mismo match -- abrí el más viejo (cerrado) y tocá "Ver debriefing →" para entrar a la reflexión privada post-cita.';
      } else {
        instrucciones = 'Vas a caer directo en la Sala de Encuentros (seguir en Soul / intercambiar datos / cerrar el vínculo) para el encuentro con Alex (preview).';
      }
    }
  }

  return res.status(200).json({ ok: true, email: PREVIEW_EMAIL_A, password: PREVIEW_PASSWORD, instrucciones });
}

// ── Forzar cierre del chat inicial sin depender de que Soul cierre sola ──
// El cierre normal (soul.html, enviarAlChat) dependia 100% de que Soul
// decidiera que ya cubrio los 9 temas del checklist y repitiera una frase
// exacta -- sin ningun limite. El fix del lado del cliente (umbral de
// mensajes que fuerza el cierre) solo se aplica cuando la persona manda un
// mensaje nuevo, no retroactivamente sobre conversaciones ya guardadas --
// asi que las cuentas que ya quedaron trabadas antes de ese fix necesitan
// esto: repite el mismo pipeline (extraer perfil, detectar modulo, armar
// perfiles) a partir de la conversacion ya guardada, sin que la persona
// tenga que volver a entrar.
const EXTRACT_PROMPT_ADMIN = `Sos un sistema de análisis de compatibilidad vincular basado en coaching ontológico. Leé la conversación y extraé un perfil estructurado. Respondé ÚNICAMENTE con JSON válido sin backticks: {"grupo1":{"valores":["v1","v2","v3"],"estilo_comunicacion":"","ritmo_emocional":"","mascara_vs_autentico":"","momento_evolutivo":""},"grupo2":{"tipo_vinculo":"","proyecto_vida":"","necesidades_intimidad":"","no_puede_faltar":"","no_puede_estar":""},"grupo3":{"modo_conflictos":"","capacidad_reparacion":"","reciprocidad":"","flexibilidad":"","patrones_vinculares":""},"grupo4":{"apertura":"","consistencia":"","estabilidad_emocional":"","revision_creencias":"","metalenguaje":"","indice_disponibilidad":5}}

MUY IMPORTANTE -- NO INVENTES: si un campo específico no tiene información real en la conversación (no se tocó, o se tocó de forma demasiado vaga para decir algo concreto), su valor tiene que ser exactamente null -- nunca una inferencia plausible generada sin base. Esto incluye "no_puede_faltar"/"no_puede_estar" (el límite real, narrativo, que la persona haya contado con contexto -- no lo inventes ni lo confundas con una lista genérica) y "reciprocidad" (cómo tiende a darse en sus vínculos pasados). Es preferible un campo en null a uno con contenido inventado -- el sistema de matching necesita saber qué se comparó de verdad y qué no.`;

const MODULO_DETECCION_PROMPT_ADMIN = `Analizá este perfil vincular y la conversación resumida. Elegí el módulo esencial (el que más urge) y el recomendado (el segundo) en base a las señales concretas que aparecen en la charla -- patrones consistentes, no frases aisladas -- no por intuición general.

"modulo_esencial" y "modulo_recomendado" solo pueden ser uno de estos CUATRO (usá el nombre tal cual, con esta capitalización exacta, en tu respuesta). Existe un quinto módulo, "Capacidad de volver a elegir", pero ese NUNCA va en estos dos campos -- se suma siempre después para todos, no compite por este lugar.

"Apertura al compromiso" -- la tensión entre libertad y vínculo, cuando el compromiso se asocia automáticamente con pérdida.
Señales: externaliza los conflictos relacionales ("siempre me tocan personas complicadas"), asocia compromiso con pérdida de libertad ("necesito sentir que nadie me limite"), lenguaje ambiguo y sostenido sobre lo que busca ("que fluya", "no me gusta poner etiquetas"), describe pareja ideal con expectativas contradictorias, entusiasmo por el comienzo pero evita hablar de construir, cambia de tiempo verbal (presente definido para el deseo, futuro vago para el compromiso), usa absolutos ("nunca", "siempre", "nadie").

"Autonomía emocional" -- cuánto depende el bienestar del vínculo, en lugar de sostenerse desde adentro.
Señales: la pareja como fuente principal de bienestar ("con la persona indicada todo se acomoda"), miedo recurrente a la pérdida sin evidencia clara, necesidad elevada de validación y confirmaciones frecuentes, habla del otro como necesidad más que como elección, idealización de la pareja como solución, dificultad para poner límites en relaciones pasadas, identidad muy fusionada (le cuesta hablar de sí sin referirse al otro).

"Poder personal" -- la posición frente a la responsabilidad relacional: verse como protagonista o como receptor de lo que pasa en los vínculos.
Señales: el otro siempre tiene el poder ("siempre me tocó la peor gente"), poco espacio para autorreflexión al narrar conflictos, generalizaciones rígidas ("todos son iguales"), lenguaje de impotencia ("no tenía opción", "no dependía de mí"), explicaciones centradas afuera (suerte, destino, los demás), espera de rescate ("que me haga volver a creer"), dificultad para reconocer agencia ante "¿qué podrías hacer diferente?". El indicador más valioso es la evolución del discurso durante la charla -- de una narrativa rígida a una más compleja -- eso importa más que el punto de partida.

"Coherencia interna" -- la distancia entre valores declarados y conducta real, y sobre todo la conciencia de esa brecha.
Señales: valores declarados vs. ejemplos concretos contradictorios ("la honestidad es fundamental" + "prefiero desaparecer sin explicar"), lo que busca vs. lo que elige no coincide, justificaciones frecuentes ("es que...", "lo que pasa es que..."), cambios bruscos en el discurso sin poder integrarlos, emoción y contenido verbal que no coinciden ("ya lo superé" con tono de enojo intenso), inestabilidad narrativa. Alguien que reconoce su propia incoherencia tiene más potencial de crecimiento que alguien con discurso impecable pero rígido -- eso también es señal a favor de este módulo.

Respondé ÚNICAMENTE con JSON sin backticks: {"modulo_esencial":"nombre del módulo más urgente","modulo_recomendado":"nombre del segundo","senales_detectadas":"descripción concreta, en 2-3 frases, de las señales específicas de la charla que llevaron a elegir el módulo esencial -- para que alguien pueda auditar la elección, no una etiqueta genérica","referencias_culturales":"lista de referencias que mencionó la persona","fortalezas":["fortaleza breve y cálida 1","fortaleza breve y cálida 2","fortaleza breve y cálida 3"],"oportunidades":["oportunidad de crecimiento presentada con cuidado, nunca como critica 1","oportunidad de crecimiento presentada con cuidado 2"]}. En "modulo_esencial" y "modulo_recomendado" usá el nombre EXACTO tal como aparece entre comillas arriba (ej. "Poder personal", no "PODER PERSONAL" ni "poder personal").`;

async function forzarCierrePerfil(req, res, supabaseUrl, headers) {
  const { usuarioId } = req.body;
  if (!usuarioId) return res.status(400).json({ error: 'Falta usuarioId' });

  const convRes = await fetch(`${supabaseUrl}/rest/v1/conversaciones?select=id,historial&usuario_id=eq.${encodeURIComponent(usuarioId)}`, { headers });
  const convs = convRes.ok ? await convRes.json() : [];
  const conv = convs[0];
  if (!conv || !conv.historial || conv.historial.length < 4) {
    return res.status(400).json({ error: 'sin_conversacion', mensaje: 'Esta persona no tiene suficiente conversación guardada para extraer un perfil.' });
  }

  const transcripto = conv.historial.map((m) => (m.role === 'assistant' ? 'Soul: ' : 'Usuario: ') + m.content).join('\n');

  // max_tokens mas alto que el mismo prompt en soul.html (1200/1024): esta
  // herramienta se usa justamente para las conversaciones anormalmente
  // largas (60-90+ mensajes) que se quedaron trabadas -- hay mas contenido
  // real para volcar en el JSON y el limite normal corta la respuesta a
  // mitad, dejandola invalida (esto rompio con Lorena en produccion).
  const { json: perfil, usage: usagePerfil } = await llamarClaudeJSON({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: EXTRACT_PROMPT_ADMIN,
    messages: [{ role: 'user', content: 'Analizá esta conversación:\n\n' + transcripto }]
  });
  await registrarUsoTokens({ usuarioId, endpoint: 'adminForzarCierrePerfil', usage: usagePerfil });

  const { json: moduloInfo, usage: usageModulo } = await llamarClaudeJSON({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: MODULO_DETECCION_PROMPT_ADMIN,
    messages: [{ role: 'user', content: 'Perfil: ' + JSON.stringify(perfil) + '\n\nConversación resumida: ' + conv.historial.slice(-10).map((m) => m.role + ': ' + m.content).join('\n') }]
  });
  await registrarUsoTokens({ usuarioId, endpoint: 'adminForzarCierrePerfil', usage: usageModulo });

  // Mismo shape que guardarPerfil()/continuarTrasValidacion() en soul.html --
  // referencias_culturales solo lleva lo detectado en la charla: lo que la
  // persona haya tipeado en el paso del wizard (pelicula/cancion/libro)
  // vivia solo en el DOM de esa sesion y nunca llego a guardarse en ningun
  // lado, asi que no hay forma de recuperarlo desde aca.
  const perfilRes = await fetch(`${supabaseUrl}/rest/v1/perfiles?on_conflict=usuario_id`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      usuario_id: usuarioId,
      grupo1: perfil.grupo1,
      grupo2: perfil.grupo2,
      grupo3: perfil.grupo3,
      grupo4: perfil.grupo4,
      indice_disponibilidad: (perfil.grupo4 && perfil.grupo4.indice_disponibilidad) || null,
      referencias_culturales: JSON.stringify({ pelicula: null, cancion: null, libro: null, detectado_en_charla: moduloInfo.referencias_culturales || null }),
      sintesis_espejo: JSON.stringify({ fortalezas: moduloInfo.fortalezas || [], oportunidades: moduloInfo.oportunidades || [] }),
      modulo_esencial: moduloInfo.modulo_esencial || null,
      modulo_recomendado: moduloInfo.modulo_recomendado || null,
      modulo_fase: moduloInfo.modulo_esencial ? 'esencial' : null,
      senales_modulo: moduloInfo.senales_detectadas || null
    })
  });
  if (!perfilRes.ok) {
    console.error('Error guardando perfil forzado:', perfilRes.status, await perfilRes.text());
    return res.status(500).json({ error: 'No se pudo guardar el perfil' });
  }

  await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/conversaciones?id=eq.${encodeURIComponent(conv.id)}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ completada: true })
    }),
    fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(usuarioId)}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ etapa_actual: 'modulos' })
    })
  ]);

  return res.status(200).json({ ok: true, moduloEsencial: moduloInfo.modulo_esencial || null });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
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

  const { accion } = req.body;

  try {
    if (accion === 'ranking') {
      return await calcularRanking(req, res, supabaseUrl, headers);
    }
    if (accion === 'activar' || accion === 'pausar') {
      return await cambiarEstado(req, res, supabaseUrl, headers, accion);
    }
    if (accion === 'sembrarPreview') {
      return await sembrarPreview(req, res, supabaseUrl, supabaseKey, headers);
    }
    if (accion === 'forzarCierrePerfil') {
      return await forzarCierrePerfil(req, res, supabaseUrl, headers);
    }
    return res.status(400).json({ error: 'Acción no válida' });
  } catch (error) {
    console.error('Error en /api/admin/matches:', error);
    return res.status(500).json({ error: 'Error procesando la solicitud' });
  }
}
