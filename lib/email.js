// Envio de mail transaccional via Resend (API REST directa, sin SDK -- mismo
// criterio de cero dependencias npm que el resto del proyecto). Si no hay
// RESEND_API_KEY configurada, no se envia nada pero tampoco rompe el flujo
// que lo dispara (activar match / mandar mensaje en la cita nunca dependen
// de que el mail salga bien).

import { registrarErrorSilencioso } from './logErrorSilencioso.js';

const RESEND_API_URL = 'https://api.resend.com/emails';
const APP_URL = process.env.APP_URL || 'https://soulapp.love';

// Devuelve true solo si Resend acepto el envio -- quien llama a esto usa
// ese valor para decidir si vale la pena marcar "ya se avisó" (si el envio
// fallo, no hay que silenciar avisos futuros como si hubiera salido bien).
async function enviarEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY no configurada -- no se envio el mail:', subject, 'a', to);
    return false;
  }
  const from = process.env.EMAIL_FROM || 'Soul <onboarding@resend.dev>';
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html })
    });
    if (!res.ok) {
      const texto = await res.text();
      console.error('Error enviando mail via Resend:', res.status, texto);
      await registrarErrorSilencioso({ contexto: 'lib/email: Resend rechazo el envio', error: `HTTP ${res.status}: ${texto}`, meta: { to, subject } });
      return false;
    }
    console.log('Mail enviado via Resend a', to, '-', subject);
    return true;
  } catch (e) {
    console.error('Error enviando mail via Resend:', e);
    await registrarErrorSilencioso({ contexto: 'lib/email: fetch a Resend fallo', error: e, meta: { to, subject } });
    return false;
  }
}

// Cada destinatario recibe su propio nombre/email (para poder identificar
// de cual cuenta es el aviso mientras se prueba con varias cuentas que
// caen en la misma bandeja) y el nombre/email de la otra persona del match.
export async function notificarNuevoMatch(destinatarios) {
  const lista = (destinatarios || []).filter(d => d && d.email);
  await Promise.all(lista.map(d => {
    const otro = lista.find(x => x !== d);
    const propioLabel = d.nombre || d.email;
    const otroLabel = otro ? (otro.nombre || otro.email) : null;
    return enviarEmail({
      to: d.email,
      subject: 'Tenés un nuevo match en Soul' + (otroLabel ? ' con ' + otroLabel : ''),
      html: `<p>Hola ${propioLabel},</p><p>Soul encontró a alguien para vos${otroLabel ? (': <strong>' + otroLabel + '</strong>') : ''}. Entrá a la app para conocerlo.</p><p><a href="${APP_URL}/soul.html">Entrar a Soul</a></p><p style="color:#888;font-size:.8rem;margin-top:1rem">Aviso para la cuenta de ${propioLabel}.</p>`
    });
  }));
}

// Confirmacion de cuenta propia, independiente de la de Supabase Auth --
// con "Confirm email" apagado del lado de Supabase (necesario para que el
// registro de sesion inmediata, sin la demora de deliverability que tenia
// el mailer de Supabase), la cuenta queda marcada como confirmada ahi
// mismo en el momento del alta, sin importar si la persona toco un link
// real. Este es el mecanismo que de verdad trackea la confirmacion --
// usuarios.mail_confirmado, con un token de un solo uso -- y es lo que
// decide si puede avanzar a matches/citas (ver el chequeo en
// lib/authUtil.js y los endpoints que lo usan).
export async function notificarConfirmarMail({ nombre, email, token }) {
  if (!email || !token) return false;
  const propioLabel = nombre || email;
  const link = `${APP_URL}/soul.html?confirmarMail=${encodeURIComponent(token)}`;
  return await enviarEmail({
    to: email,
    subject: 'Confirmá tu cuenta de Soul',
    html: `<p>Hola ${propioLabel},</p><p>Ya podés empezar a usar Soul. Antes de poder conocer a alguien, confirmá tu cuenta tocando este link:</p><p><a href="${link}">Confirmar mi cuenta</a></p><p style="color:#888;font-size:.8rem;margin-top:1rem">Si no creaste esta cuenta, ignorá este mail.</p>`
  });
}

// Recordatorio para quien se registró pero dejó la Etapa 1 (datos básicos)
// a medias -- se manda una sola vez por cuenta (ver recordatorio_datos_
// enviado_en en lib/recordatorioIntake.js). El link es el mismo login
// normal: como el gate de Etapa 1 ya vuelve ahí solo apenas la persona
// vuelve a entrar (ver cargarProgreso en soul.html), no hace falta un
// token especial -- cualquier acceso normal la deja exactamente donde
// quedó.
export async function notificarDatosIncompletos({ nombre, email }) {
  if (!email) return false;
  const propioLabel = nombre || email;
  return await enviarEmail({
    to: email,
    subject: 'Te faltó completar tus datos en Soul',
    html: `<p>Hola ${propioLabel},</p><p>Empezaste a registrarte en Soul pero no llegaste a completar tus datos básicos -- sin eso, Soul todavía no puede conocerte ni presentarte a nadie.</p><p><a href="${APP_URL}/soul.html">Entrar a Soul</a></p><p style="color:#888;font-size:.8rem;margin-top:1rem">Al entrar vas a seguir exactamente donde lo dejaste.</p>`
  });
}

// Se manda SOLO cuando alguien elige "seguir en Soul" en la Sala de
// Encuentros y la otra persona todavia no contesto nada -- las dos partes
// tienen que aceptar para que se abra el proximo encuentro, y sin este
// aviso la otra persona podia no enterarse nunca de que hay una decision
// esperandola. No se manda para "intercambiar"/"cerrar": ver
// decidirSalaEncuentros en api/citas.js.
export async function notificarSalaEncuentrosPendiente({ nombre, email, remitenteNombre }) {
  if (!email) return false;
  const propioLabel = nombre || email;
  return await enviarEmail({
    to: email,
    subject: (remitenteNombre ? remitenteNombre + ' quiere' : 'Alguien quiere') + ' seguir hablando con vos en Soul',
    html: `<p>Hola ${propioLabel},</p><p>${remitenteNombre ? '<strong>' + remitenteNombre + '</strong>' : 'Tu match'} eligió seguir hablando con vos en Soul. Entrá para decidir si también querés seguir -- el próximo encuentro se abre solo si las dos partes eligen lo mismo.</p><p><a href="${APP_URL}/soul.html">Entrar a Soul</a></p><p style="color:#888;font-size:.8rem;margin-top:1rem">Aviso para la cuenta de ${propioLabel}.</p>`
  });
}

// Reporte diario del cron de diagnostico (ver api/cron/diagnostico-diario.js)
// -- va siempre a ADMIN_EMAIL, nunca a una persona del piloto.
export async function notificarDiagnosticoDiario({ email, asunto, html }) {
  if (!email) return false;
  return await enviarEmail({ to: email, subject: asunto, html });
}

export async function notificarMensajeCita({ nombre, email, remitenteNombre }) {
  if (!email) return false;
  const propioLabel = nombre || email;
  return await enviarEmail({
    to: email,
    subject: (remitenteNombre ? remitenteNombre + ' te escribió' : 'Tenés un mensaje nuevo') + ' en tu cita',
    html: `<p>Hola ${propioLabel},</p><p>${remitenteNombre ? '<strong>' + remitenteNombre + '</strong> te' : 'Te'} está esperando con un mensaje nuevo en tu cita de Soul.</p><p><a href="${APP_URL}/soul.html">Entrar a Soul</a></p><p style="color:#888;font-size:.8rem;margin-top:1rem">Aviso para la cuenta de ${propioLabel}.</p>`
  });
}
