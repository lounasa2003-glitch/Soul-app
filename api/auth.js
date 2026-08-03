import crypto from 'crypto';
import { chequearLimite } from '../lib/rateLimit.js';
import { notificarConfirmarMail } from '../lib/email.js';
import { registrarErrorSilencioso } from '../lib/logErrorSilencioso.js';
import { verificarUsuario } from '../lib/authUtil.js';
import { finalizarCita } from '../lib/cierreCita.js';

const REDIRECT_URL = 'https://soulapp.love/soul.html';

// Sin ningun freno, login/registro/recuperar quedaban abiertos a fuerza
// bruta y creacion masiva de cuentas -- se limita por email (misma clave
// que usa chequearLimite en el resto de la app) antes de mandar nada a
// Supabase. login queda mas ajustado que el resto porque es el vector mas
// directo de fuerza bruta contra una cuenta puntual; registro y recuperar
// se limitan por hora, que alcanza para uso legitimo (nadie necesita
// registrarse o pedir recuperar contraseña muchas veces seguidas para el
// mismo email).
const LIMITES_AUTH = {
  login: { limite: 8, ventanaSegundos: 600 },
  registro: { limite: 5, ventanaSegundos: 3600 },
  recuperar: { limite: 5, ventanaSegundos: 3600 },
  reenviarConfirmacion: { limite: 5, ventanaSegundos: 3600 }
};

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
    const { accion, email, password, refresh_token } = req.body;

    // Unico caso que no requiere sesion ni email -- se usa desde las
    // pantallas de login/registro/recuperar cuando algo falla ahi mismo,
    // antes de que exista ninguna sesion valida (ver reportarProblema en
    // soul.html; los casos con sesion ya activa van por
    // guardarTabla('reportes_tecnicos',...) en api/guardar.js en vez de
    // por aca). Se limita por IP, no por email, porque puede no haber
    // ningun email cargado todavia en pantalla.
    if (accion === 'reportarProblema') {
      const { contexto } = req.body;
      if (!contexto) return res.status(400).json({ error: 'Falta contexto' });
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'ip_desconocida';
      const limiteInfo = await chequearLimite(ip, 'reportarProblema', 10, 3600);
      if (!limiteInfo.permitido) {
        return res.status(429).json({ error: 'limite_alcanzado' });
      }
      await fetch(`${supabaseUrl}/rest/v1/reportes_tecnicos`, {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ contexto: String(contexto).slice(0, 200), email: email ? String(email).slice(0, 200) : null })
      });
      return res.status(200).json({ ok: true });
    }

    // Anotarse para probar la app (landing de reclutamiento de testers,
    // ver reclutamiento-testers.html) -- publico, sin sesion. La tabla
    // 'lista_espera_testers' es aparte de 'usuarios' a proposito: esto es
    // solo interes, no una cuenta real, y no tiene NINGUNA policy (RLS
    // activado sin policies = invisible para anon/authenticated) -- se
    // escribe con la service role key, que bypasea RLS por diseño de
    // Supabase. La proteccion real de este endpoint publico es el rate
    // limit por IP de aca abajo, no una policy. on_conflict+ignore-
    // duplicates trata un mail repetido como exito silencioso -- no hace
    // falta que la persona sepa si ya estaba anotada o no.
    if (accion === 'registrarInteresado') {
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: 'email_invalido' });
      }
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceKey) return res.status(500).json({ error: 'Supabase no configurado' });
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'ip_desconocida';
      const limiteInfo = await chequearLimite(ip, 'registrarInteresado', 10, 3600);
      if (!limiteInfo.permitido) {
        return res.status(429).json({ error: 'limite_alcanzado' });
      }
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/lista_espera_testers?on_conflict=email`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=ignore-duplicates' },
        body: JSON.stringify({ email: String(email).trim().toLowerCase().slice(0, 200) })
      });
      if (!insertRes.ok) {
        await registrarErrorSilencioso({ contexto: 'api/auth: registrarInteresado', error: new Error(await insertRes.text()) });
        return res.status(500).json({ error: 'No se pudo guardar' });
      }
      return res.status(200).json({ ok: true });
    }

    const limiteConfig = LIMITES_AUTH[accion];
    if (limiteConfig) {
      if (!email) return res.status(400).json({ error: 'Falta email' });
      const limiteInfo = await chequearLimite(email, 'auth_' + accion, limiteConfig.limite, limiteConfig.ventanaSegundos);
      if (!limiteInfo.permitido) {
        return res.status(429).json({
          error: 'limite_alcanzado',
          mensaje: 'Demasiados intentos. Esperá un toque y volvé a intentar.',
          segundosParaReset: limiteInfo.segundosParaReset
        });
      }
    }

    // Borrado de cuenta pedido desde adentro de la app (Mi perfil ->
    // Eliminar mi cuenta, ver soul.html). El acceso se corta AHORA MISMO
    // (verificarUsuario en lib/authUtil.js trata eliminacion_solicitada_en
    // como sesion invalida) -- el purgado real de datos (perfiles,
    // conversaciones, historial, y el usuario en Supabase Auth) pasa recien
    // a los 30 dias, corrido por el cron de api/cron/diagnostico-diario.js,
    // igual que promete legal.html. Antes de cortar el acceso, se cierran
    // con calidez los encuentros que sigan abiertos -- no tiene sentido
    // dejar a alguien esperando una respuesta que nunca va a llegar.
    if (accion === 'solicitarBorrado') {
      const usuario = await verificarUsuario(req);
      if (!usuario || !usuario.usuarioId) {
        return res.status(401).json({ error: 'Sesión inválida o expirada' });
      }
      const headersSb = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      // 'matches' y 'citas' ya tienen politica RLS real -- token propio de
      // quien esta pidiendo el borrado (sigue siendo miembro legitimo hasta
      // este mismo momento).
      const headersPropios = { ...headersSb, Authorization: `Bearer ${usuario.token}` };

      const matchesRes = await fetch(
        `${supabaseUrl}/rest/v1/matches?select=id,usuario_a,usuario_b&or=(usuario_a.eq.${encodeURIComponent(usuario.usuarioId)},usuario_b.eq.${encodeURIComponent(usuario.usuarioId)})`,
        { headers: headersPropios }
      );
      const matches = matchesRes.ok ? await matchesRes.json() : [];
      if (matches.length) {
        const idsMatches = matches.map((m) => encodeURIComponent(m.id)).join(',');
        const citasRes = await fetch(
          `${supabaseUrl}/rest/v1/citas?select=*&match_id=in.(${idsMatches})&estado=in.(pendiente,activa,chequeo_cierre)`,
          { headers: headersPropios }
        );
        const citasAbiertas = citasRes.ok ? await citasRes.json() : [];
        for (const cita of citasAbiertas) {
          const match = matches.find((m) => m.id === cita.match_id);
          if (!match) continue;
          await finalizarCita(
            supabaseUrl, headersPropios, cita.id, cita, match,
            'Esta persona decidió dejar Soul. No hace falta decidir el resto de la historia hoy -- lo que vivieron hasta acá sigue siendo real.'
          ).catch((e) => registrarErrorSilencioso({ contexto: 'api/auth: cerrar cita al borrar cuenta', error: e, meta: { citaId: cita.id } }));
        }
      }

      // 'usuarios' ya tiene politica RLS real -- token propio, la persona
      // sigue siendo dueña legitima de su fila hasta este mismo momento.
      await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(usuario.usuarioId)}`, {
        method: 'PATCH',
        headers: { ...headersPropios, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ eliminacion_solicitada_en: new Date().toISOString() })
      });

      return res.status(200).json({ ok: true, mensaje: 'Tu cuenta va a eliminarse dentro de los próximos 30 días.' });
    }

    // El link de recuperación llega con el token de sesión de la persona
    // (no el apikey) -- se reenvía tal cual a Supabase con el metodo PUT
    // que espera /auth/v1/user, distinto del resto de las acciones.
    if (accion === 'actualizarPassword') {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Falta el token de sesión' });
      }
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': authHeader
        },
        body: JSON.stringify({ password })
      });
      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json(data);
      }
      return res.status(200).json({ email: data.email });
    }

    // Confirmacion de cuenta propia (independiente de la de Supabase Auth --
    // ver el comentario en lib/email.js sobre por que). No requieren la
    // sesion de la persona: reenviarConfirmacion se pide desde la pantalla
    // "Revisá tu email" sin sesion valida todavia en algunos casos, y
    // confirmarMail llega desde el link del mail, que puede abrirse en un
    // dispositivo distinto al que se registro.
    // 'usuarios' ya tiene politica RLS real de "solo el dueño" (auth.uid() =
    // auth_id), y estas dos acciones no tienen ningun token de usuario para
    // forwardear (ver el comentario arriba sobre por que no requieren
    // sesion). Service role key, mismo criterio que
    // lib/recordatorioIntake.js/recordatorioMatches.js para los barridos sin
    // sesion de nadie -- una politica anon permisiva hubiera expuesto toda
    // la tabla, no solo este caso puntual.
    if (accion === 'reenviarConfirmacion') {
      const headersService = { apikey: supabaseKey, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
      const rowRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=id,nombre,email,mail_confirmado,token_confirmacion&email=eq.${encodeURIComponent(email)}`, { headers: headersService });
      const rows = rowRes.ok ? await rowRes.json() : [];
      const fila = rows[0];
      // Misma respuesta exista o no la cuenta, o ya este confirmada -- este
      // endpoint no es un lugar para confirmar si un mail esta registrado.
      if (fila && !fila.mail_confirmado) {
        // Si ya habia un token sin usar, se reutiliza en vez de pisarlo por
        // uno nuevo -- generar uno distinto en cada reenvio invalidaba
        // cualquier mail anterior que siguiera sin abrirse (el link de un
        // mail viejo tirando "ya no es valido" apenas se pedia otro).
        const token = fila.token_confirmacion || crypto.randomBytes(24).toString('hex');
        if (!fila.token_confirmacion) {
          await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(fila.id)}`, {
            method: 'PATCH',
            headers: { ...headersService, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ token_confirmacion: token })
          });
        }
        await notificarConfirmarMail({ nombre: fila.nombre, email: fila.email, token });
      }
      return res.status(200).json({ ok: true });
    }

    if (accion === 'confirmarMail') {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Falta token' });
      const headersService = { apikey: supabaseKey, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
      const rowRes = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=id&token_confirmacion=eq.${encodeURIComponent(token)}`, { headers: headersService });
      const rows = rowRes.ok ? await rowRes.json() : [];
      const fila = rows[0];
      if (!fila) {
        return res.status(400).json({ error: 'token_invalido', mensaje: 'Este link ya no es válido -- puede que ya lo hayas usado, o que hayas pedido uno nuevo después.' });
      }
      await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(fila.id)}`, {
        method: 'PATCH',
        headers: { ...headersService, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ mail_confirmado: true, token_confirmacion: null })
      });
      return res.status(200).json({ ok: true });
    }

    let endpoint = '';
    let bodyData;
    if (accion === 'registro') {
      endpoint = '/auth/v1/signup';
      bodyData = { email, password };
    } else if (accion === 'login') {
      endpoint = '/auth/v1/token?grant_type=password';
      bodyData = { email, password };
    } else if (accion === 'recuperar') {
      endpoint = '/auth/v1/recover?redirect_to=' + encodeURIComponent(REDIRECT_URL);
      bodyData = { email };
    } else if (accion === 'refrescar') {
      endpoint = '/auth/v1/token?grant_type=refresh_token';
      bodyData = { refresh_token };
    } else {
      return res.status(400).json({ error: 'Acción no válida' });
    }

    const response = await fetch(`${supabaseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey
      },
      body: JSON.stringify(bodyData)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error en /api/auth:', error);
    await registrarErrorSilencioso({ contexto: 'api/auth', error, meta: { accion: req.body?.accion } });
    return res.status(500).json({ error: 'Error de autenticación' });
  }
}
