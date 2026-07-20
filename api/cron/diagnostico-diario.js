import { notificarDiagnosticoDiario } from '../../lib/email.js';

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
// contable.
const USD_POR_MILLON_INPUT = 3;
const USD_POR_MILLON_OUTPUT = 15;

function haceHoras(horas) {
  return new Date(Date.now() - horas * 3600 * 1000).toISOString();
}

async function leerSupabase(tabla, params) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
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
      return res.status(401).json({ error: 'No autorizado', debugLenEsperado: secretoEsperado.length, debugLenRecibido: recibido.length });
    }
  }

  try {
    const desde = haceHoras(VENTANA_HORAS);

    const [errores, reportes, fugas, tokens, resend, sinConfirmar] = await Promise.all([
      leerSupabase('errores_silenciosos', `select=contexto,mensaje,creado_en&creado_en=gte.${encodeURIComponent(desde)}&order=creado_en.desc&limit=500`),
      leerSupabase('reportes', `select=id,usuario_reporta,usuario_reportado,motivo,created_at&created_at=gte.${encodeURIComponent(desde)}`),
      leerSupabase('intentos_fuga_prompt', `select=id,usuario_id,mensaje,endpoint,created_at&created_at=gte.${encodeURIComponent(desde)}`),
      leerSupabase('uso_tokens', `select=endpoint,input_tokens,output_tokens&created_at=gte.${encodeURIComponent(desde)}`),
      chequearResend(desde),
      leerSupabase('usuarios', `select=id,nombre,email,ultima_actividad&etapa_actual=eq.chat&mail_confirmado=eq.false&created_at=lte.${encodeURIComponent(haceHoras(UMBRAL_SIN_CONFIRMAR_HORAS))}`)
    ]);

    const erroresPorContexto = {};
    errores.forEach(e => { erroresPorContexto[e.contexto] = (erroresPorContexto[e.contexto] || 0) + 1; });

    let totalInput = 0, totalOutput = 0;
    tokens.forEach(t => { totalInput += t.input_tokens || 0; totalOutput += t.output_tokens || 0; });
    const costoEstimado = (totalInput / 1e6) * USD_POR_MILLON_INPUT + (totalOutput / 1e6) * USD_POR_MILLON_OUTPUT;

    const resumen = {
      ventanaHoras: VENTANA_HORAS,
      erroresSilenciosos: { total: errores.length, porContexto: erroresPorContexto },
      reportes: { total: reportes.length, filas: reportes },
      intentosFuga: { total: fugas.length, filas: fugas },
      resend,
      cuentasSinConfirmar: { total: sinConfirmar.length, filas: sinConfirmar },
      tokens: { totalInput, totalOutput, costoEstimadoUsd: Number(costoEstimado.toFixed(2)) }
    };

    const lineas = [];
    lineas.push(`<h2>Diagnóstico diario de Soul</h2>`);
    lineas.push(`<p>Ventana: últimas ${VENTANA_HORAS}hs.</p>`);

    lineas.push(`<h3>Errores silenciosos: ${errores.length}</h3>`);
    if (errores.length) {
      lineas.push('<ul>' + Object.entries(erroresPorContexto).map(([c, n]) => `<li>${c}: ${n}</li>`).join('') + '</ul>');
    } else {
      lineas.push('<p>Ninguno. 👍</p>');
    }

    lineas.push(`<h3>Reportes de usuarios: ${reportes.length}</h3>`);
    lineas.push(`<h3>Intentos de fuga de prompt: ${fugas.length}</h3>`);

    lineas.push(`<h3>Mails con problemas de entrega (Resend): ${resend.problematicos.length} de ${resend.totalEnviados} enviados</h3>`);
    if (resend.problematicos.length) {
      lineas.push('<ul>' + resend.problematicos.map(p => `<li>${p.to} — ${p.estado} (${p.asunto})</li>`).join('') + '</ul>');
    }

    lineas.push(`<h3>Cuentas trabadas sin confirmar mail (+${UMBRAL_SIN_CONFIRMAR_HORAS}hs): ${sinConfirmar.length}</h3>`);
    if (sinConfirmar.length) {
      lineas.push('<ul>' + sinConfirmar.map(u => `<li>${u.nombre || '(sin nombre)'} — ${u.email}</li>`).join('') + '</ul>');
    }

    lineas.push(`<h3>Uso de tokens (24hs)</h3>`);
    lineas.push(`<p>Input: ${totalInput.toLocaleString()} | Output: ${totalOutput.toLocaleString()} | Costo estimado: ~$${costoEstimado.toFixed(2)} USD (aproximado, no es el numero de facturacion real)</p>`);

    const html = lineas.join('\n');

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
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
        asunto: `Diagnóstico diario de Soul — ${errores.length} errores, ${reportes.length} reportes, ${resend.problematicos.length} mails con problema`,
        html
      });
    }

    return res.status(200).json({ ok: true, mailEnviado, resumen });
  } catch (error) {
    console.error('Error en /api/cron/diagnostico-diario:', error);
    return res.status(500).json({ error: 'Error generando el diagnostico' });
  }
}
