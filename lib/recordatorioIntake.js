import { notificarDatosIncompletos } from './email.js';
import { registrarErrorSilencioso } from './logErrorSilencioso.js';

// Recordatorio por mail para quien se registro y dejo la Etapa 1 (datos
// basicos) a medias -- se dispara "oportunistamente" aprovechando el
// trafico normal de la app en vez de un cron dedicado: el unico cron de
// este proyecto corre una vez por dia (ver vercel.json), lo que dejaria el
// aviso salir entre 2 y 24hs despues segun la hora del dia, no cerca de
// las 2hs pedidas. Se llama (sin esperar, fire-and-forget) desde
// verificarUsuario en lib/authUtil.js, que corre en CADA request
// autenticado -- mismo criterio que ya usa esa funcion para
// ultima_actividad. Throttleado a como maximo una corrida cada 15 min
// (via rate_limits, mismo mecanismo que verificarAdmin) para no salir a
// buscar candidatos en cada request.
const LIMITE_ESPERA_MS = 2 * 60 * 60 * 1000;
const THROTTLE_CHEQUEO_MS = 15 * 60 * 1000;

export async function chequearRecordatoriosIntake(supabaseUrl, supabaseKey) {
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  try {
    const throttleRes = await fetch(
      `${supabaseUrl}/rest/v1/rate_limits?select=ventana_inicio&email=eq.sistema&endpoint=eq.recordatorio_intake`,
      { headers }
    );
    const throttleFilas = throttleRes.ok ? await throttleRes.json() : [];
    const ultimaCorrida = throttleFilas[0] ? new Date(throttleFilas[0].ventana_inicio).getTime() : 0;
    if (Date.now() - ultimaCorrida < THROTTLE_CHEQUEO_MS) return;

    // Se marca ANTES de hacer el trabajo -- si dos requests llegan casi
    // juntas, la segunda ve el throttle recien puesto y no duplica la
    // corrida. Si el proceso se corta antes de terminar de mandar los
    // mails, el peor caso es esperar otros 15 min para el proximo intento
    // -- no hay perdida real, esto no es sensible al segundo.
    await fetch(`${supabaseUrl}/rest/v1/rate_limits?on_conflict=email,endpoint`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: 'sistema', endpoint: 'recordatorio_intake', ventana_inicio: new Date().toISOString(), contador: 1 })
    });

    const limite = new Date(Date.now() - LIMITE_ESPERA_MS).toISOString();
    const res = await fetch(
      `${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email&etapa_actual=eq.nuevo&recordatorio_datos_enviado_en=is.null&created_at=lt.${encodeURIComponent(limite)}`,
      { headers }
    );
    const pendientes = res.ok ? await res.json() : [];
    for (const u of pendientes) {
      if (!u.email) continue;
      const enviado = await notificarDatosIncompletos({ nombre: u.nombre, email: u.email });
      if (enviado) {
        await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(u.id)}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ recordatorio_datos_enviado_en: new Date().toISOString() })
        });
      }
    }
  } catch (e) {
    console.error('Error chequeando recordatorios de intake:', e);
    await registrarErrorSilencioso({ contexto: 'lib/recordatorioIntake', error: e });
  }
}
