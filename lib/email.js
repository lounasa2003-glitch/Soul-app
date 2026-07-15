// Envio de mail transaccional via Resend (API REST directa, sin SDK -- mismo
// criterio de cero dependencias npm que el resto del proyecto). Si no hay
// RESEND_API_KEY configurada, no se envia nada pero tampoco rompe el flujo
// que lo dispara (activar match / mandar mensaje en la cita nunca dependen
// de que el mail salga bien).

const RESEND_API_URL = 'https://api.resend.com/emails';
const APP_URL = process.env.APP_URL || 'https://soul-app-tau.vercel.app';

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
      console.error('Error enviando mail via Resend:', res.status, await res.text());
      return false;
    }
    console.log('Mail enviado via Resend a', to, '-', subject);
    return true;
  } catch (e) {
    console.error('Error enviando mail via Resend:', e);
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

export async function notificarMensajeCita({ nombre, email, remitenteNombre }) {
  if (!email) return false;
  const propioLabel = nombre || email;
  return await enviarEmail({
    to: email,
    subject: (remitenteNombre ? remitenteNombre + ' te escribió' : 'Tenés un mensaje nuevo') + ' en tu cita',
    html: `<p>Hola ${propioLabel},</p><p>${remitenteNombre ? '<strong>' + remitenteNombre + '</strong> te' : 'Te'} está esperando con un mensaje nuevo en tu cita de Soul.</p><p><a href="${APP_URL}/soul.html">Entrar a Soul</a></p><p style="color:#888;font-size:.8rem;margin-top:1rem">Aviso para la cuenta de ${propioLabel}.</p>`
  });
}
