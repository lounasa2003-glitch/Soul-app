import crypto from 'crypto';
import { verificarUsuario, TABLAS_PERMITIDAS, filtroDeEscrituraValido, parsearFiltro } from '../lib/authUtil.js';
import { registrarEvento } from '../lib/logEvento.js';
import { notificarConfirmarMail } from '../lib/email.js';
import { registrarErrorSilencioso } from '../lib/logErrorSilencioso.js';

// Tablas con relacion 1:1 con el usuario -- el insert se resuelve como upsert
// atomico para no depender de un check-then-act del lado del cliente, que
// puede duplicar filas con dos pestanas o un doble click. Requiere una
// constraint UNIQUE en la columna indicada.
// 'usuarios' entra por un motivo distinto al de 'perfiles': el nombre se
// tipea una sola vez, en la pantalla de registro, ANTES de que exista fila
// en 'usuarios' -- y como la sesion nunca se persiste (ver comentario en
// soul.html sobre bfcache/localStorage), si la persona no termina la capa 1
// de un tiron, un login posterior no tenia de donde recuperarlo. Ahora se
// guarda una fila minima (email+nombre) apenas se registra, y
// guardarUsuarioYContinuar() upsertea sobre esa misma fila al terminar la
// capa 1 en vez de intentar un insert nuevo que chocaria con la constraint.
const UPSERT_CONFLICT_COLUMN = { perfiles: 'usuario_id', usuarios: 'email' };

// El cliente (soul.html) siempre manda estos campos ya re-codificados por
// su propio canvas.toDataURL('image/jpeg', ...) -- nunca el archivo crudo
// que la persona subio. Pero nada impide que alguien llame a este endpoint
// directo (sin pasar por el navegador) con un string armado a mano: sin
// este chequeo, ese string se guarda tal cual y despues se inserta como
// atributo src="..." en panel-admin.html (perfilAHtml/renderHojaDeVida) --
// un valor con comillas dobles rompe el atributo e inyecta HTML/JS en el
// navegador de la administradora. El patron exige exactamente lo que un
// canvas real produce (nunca comillas, angulos, ni nada fuera del alfabeto
// base64), y el limite de tamaño corta cualquier intento de mandar un
// payload gigante para agotar recursos.
const FOTO_REGEX = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const FOTO_MAX_CHARS = 3_000_000; // ~2.2MB decodificados -- de sobra para 800px de lado a calidad .75
function fotoValida(valor) {
  return typeof valor === 'string' && valor.length <= FOTO_MAX_CHARS && FOTO_REGEX.test(valor);
}

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
    // navigator.sendBeacon (usado por soul.html para guardar la charla al
    // cerrar/refrescar/navegar afuera, ver guardarConversacionBeacon) no
    // permite mandar headers propios -- no hay forma de que ese pedido
    // lleve el Authorization de siempre. Como alternativa SOLO para ese
    // caso, el token viaja en el cuerpo (accessTokenBeacon); si no vino
    // ningun header, se usa ese valor de la misma forma que verificarUsuario
    // ya validaria un Bearer normal (mismo chequeo contra Supabase Auth,
    // ninguna confianza ciega en el valor).
    if (!req.headers.authorization && req.body && req.body.accessTokenBeacon) {
      req.headers.authorization = `Bearer ${req.body.accessTokenBeacon}`;
    }

    const usuario = await verificarUsuario(req);
    if (!usuario) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const { tabla, datos, filtro } = req.body;
    if (!Object.prototype.hasOwnProperty.call(TABLAS_PERMITIDAS, tabla)) {
      return res.status(403).json({ error: 'Tabla no permitida' });
    }
    if (tabla !== 'usuarios' && !usuario.usuarioId) {
      return res.status(403).json({ error: 'Todavía no existe tu fila de usuario' });
    }

    let datosFinales = datos;
    let esUpsert = false;
    if (!filtro) {
      // INSERT: el dueño de la fila lo decide el servidor, no el cliente.
      if (tabla === 'usuarios') datosFinales = { ...datos, email: usuario.email };
      else if (tabla === 'matches') datosFinales = { ...datos, usuario_a: usuario.usuarioId };
      else datosFinales = { ...datos, usuario_id: usuario.usuarioId };
      esUpsert = Object.prototype.hasOwnProperty.call(UPSERT_CONFLICT_COLUMN, tabla);
    } else if (!(await filtroDeEscrituraValido(tabla, filtro, usuario))) {
      return res.status(403).json({ error: 'No autorizado para modificar estos datos' });
    }

    if (tabla === 'usuarios') {
      for (const campo of ['foto_cara', 'foto_cuerpo']) {
        if (datosFinales[campo] != null && !fotoValida(datosFinales[campo])) {
          return res.status(400).json({ error: 'foto_invalida', mensaje: 'La foto no tiene un formato válido.' });
        }
      }
    }

    // Mismo motivo que en /api/leer: reconstruir con el valor re-codificado
    // en vez de inyectar el filtro crudo -- un "+" sin re-codificar (comun
    // en emails de gmail con subaddressing) viaja como espacio literal y
    // PostgREST no encuentra la fila a actualizar.
    let url = supabaseUrl + '/rest/v1/' + tabla;
    if (filtro) {
      const { campo, operador, valor } = parsearFiltro(filtro);
      url += `?${campo}=${operador}.${encodeURIComponent(valor)}`;
    }
    if (esUpsert) url += `?on_conflict=${UPSERT_CONFLICT_COLUMN[tabla]}`;

    const response = await fetch(url, {
      method: filtro ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': esUpsert ? 'resolution=merge-duplicates,return=representation' : 'return=representation'
      },
      body: JSON.stringify(datosFinales)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    // La fila de 'usuarios' ahora se escribe dos veces: una minima al
    // registrarse (sin etapa_actual) y otra al terminar la capa 1
    // (guardarUsuarioYContinuar manda etapa_actual:'chat') -- el evento de
    // embudo y el mail de confirmacion tienen que salir una sola vez, en
    // este segundo momento, igual que antes de que existiera el guardado
    // temprano.
    if (!filtro && tabla === 'usuarios' && data[0] && datos.etapa_actual === 'chat') {
      await registrarEvento({ usuarioId: data[0].id, tipo: 'registro' });
      // Token propio de confirmacion (independiente del de Supabase Auth --
      // ver notificarConfirmarMail en lib/email.js sobre por que). Best-
      // effort: si el mail no sale, la cuenta queda creada igual y puede
      // pedir el reenvio desde la pantalla de "Revisá tu email".
      try {
        const token = crypto.randomBytes(24).toString('hex');
        await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(data[0].id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=minimal' },
          body: JSON.stringify({ token_confirmacion: token })
        });
        await notificarConfirmarMail({ nombre: data[0].nombre, email: data[0].email, token });
      } catch (e) {
        console.error('Error generando/enviando confirmacion de mail:', e);
        await registrarErrorSilencioso({ contexto: 'api/guardar: confirmacion de mail', error: e, meta: { usuarioId: data[0].id } });
      }
    } else if (tabla === 'perfiles' && esUpsert) {
      await registrarEvento({ usuarioId: usuario.usuarioId, tipo: 'onboarding_completado' });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error en /api/guardar:', error);
    await registrarErrorSilencioso({ contexto: 'api/guardar', error, meta: { tabla } });
    return res.status(500).json({ error: 'Error al guardar en base de datos' });
  }
}
