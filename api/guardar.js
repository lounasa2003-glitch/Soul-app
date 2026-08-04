import crypto from 'crypto';
import { verificarUsuario, TABLAS_PERMITIDAS, filtroDeEscrituraValido, parsearFiltro } from '../lib/authUtil.js';
import { registrarEvento } from '../lib/logEvento.js';
import { notificarConfirmarMail } from '../lib/email.js';
import { registrarErrorSilencioso } from '../lib/logErrorSilencioso.js';
import { calcularEdad, EDAD_MINIMA } from '../lib/edad.js';

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

// Se dispara solo desde el alta (sin filtro, ver mas abajo) cuando el
// rechazo es por edad minima -- en ese momento la fila de 'usuarios' todavia
// no tiene ninguna otra fila que dependa de ella (nunca llego a 'chat': sin
// perfiles, matches ni conversaciones), asi que se puede borrar de una en
// vez de dejarla huerfana. Importa porque "Eliminar mi cuenta" vive dentro
// de "Mi perfil" (soul.html), pantalla inalcanzable para quien nunca paso el
// gate de edad -- sin esto, esa persona quedaria con cuenta de Auth + fila
// usuarios + consentimiento aceptado sin ninguna via de autoeliminacion.
// Nunca se llama para una edicion de perfil ya aprobado (con filtro): ahi
// solo se rechaza el cambio, no se toca la cuenta.
async function eliminarCuentaPorEdadMinima(supabaseUrl, usuario) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada');
    const headersService = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    if (usuario.usuarioId) {
      await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(usuario.usuarioId)}`, {
        method: 'DELETE',
        headers: { ...headersService, Prefer: 'return=minimal' }
      });
    }
    if (usuario.authId) {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(usuario.authId)}`, {
        method: 'DELETE',
        headers: headersService
      });
    }
  } catch (e) {
    await registrarErrorSilencioso({
      contexto: 'api/guardar: eliminar cuenta rechazada por edad minima',
      error: e,
      meta: { usuarioId: usuario.usuarioId, authId: usuario.authId }
    });
  }
}

// Mismo listado que CAMPOS_FORMULARIO en soul.html -- ahi solo se usa para
// calcular un porcentaje informativo, nunca bloqueaba nada. Se encontraron
// cuentas reales (Ezequiel, Marcela) que llegaron a etapa 'chat'/'match' con
// todo esto en null pese a tener perfil y conversacion completos -- el
// chequeo por-paso del formulario (chkStep en soul.html) nunca deberia
// dejar pasar eso, pero lo que sea que haya pasado ahi, esto lo cierra del
// lado del servidor: nadie puede terminar el intake (etapa_actual:'chat')
// sin que estos campos + fotos + consentimiento esten realmente cargados,
// sin importar que mande el cliente.
const CAMPOS_BASICOS_REQUERIDOS = ['fecha_nacimiento', 'ciudad', 'distancia_max', 'genero', 'preferencia_genero', 'tipo_vinculo', 'hijos', 'preferencia_hijos', 'estado_civil', 'ocupacion', 'no_negociables', 'negociables'];
function campoLleno(valor) {
  if (valor == null) return false;
  if (typeof valor === 'string') return valor.trim().length > 0;
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}
function basicosCompletos(datos) {
  return CAMPOS_BASICOS_REQUERIDOS.every((c) => campoLleno(datos[c]))
    && campoLleno(datos.foto_cara) && campoLleno(datos.foto_cuerpo)
    && datos.consentimiento_aceptado === true;
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
      if (tabla === 'usuarios') datosFinales = { ...datos, email: usuario.email, auth_id: usuario.authId };
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
      // Requisito de las tiendas para una app de vinculos/citas -- el
      // selector de fecha del cliente ya limita el rango, pero eso es solo
      // UX (se puede mandar cualquier fecha directo al endpoint), asi que la
      // edad real se valida aca, del lado del servidor. Corre siempre que
      // fecha_nacimiento viaje en el pedido (alta O edicion posterior desde
      // "Mi perfil"), no solo al terminar el onboarding -- una cuenta ya
      // aprobada no puede despues cambiar su fecha de nacimiento a una edad
      // menor sin que el servidor lo note.
      if (Object.prototype.hasOwnProperty.call(datosFinales, 'fecha_nacimiento')) {
        const edad = calcularEdad(datosFinales.fecha_nacimiento);
        if (edad === null) {
          return res.status(400).json({ error: 'fecha_invalida', mensaje: 'La fecha de nacimiento no es válida.' });
        }
        if (edad < EDAD_MINIMA) {
          // Solo en el alta (sin filtro) la cuenta todavia no tiene historia
          // real -- ver el comentario de eliminarCuentaPorEdadMinima.
          if (!filtro) {
            await eliminarCuentaPorEdadMinima(supabaseUrl, usuario);
          }
          return res.status(403).json({ error: 'edad_minima', mensaje: `Soul es exclusivamente para personas mayores de ${EDAD_MINIMA} años.` });
        }
      }

      // Solo se valida en el momento exacto de terminar el intake (pasar a
      // etapa 'chat') -- guardarUsuarioYContinuar() en soul.html siempre
      // manda todos estos campos juntos en un solo pedido en ese momento,
      // asi que datosFinales ya trae todo lo necesario para verificar sin
      // tener que leer el estado previo de la fila.
      if (datosFinales.etapa_actual === 'chat' && !basicosCompletos(datosFinales)) {
        return res.status(400).json({ error: 'datos_incompletos', mensaje: 'Faltan datos básicos antes de poder empezar a hablar con Soul.' });
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

    // Mismo criterio que en api/leer.js: estas tablas ya tienen politica RLS
    // real, asi que necesitan el token propio de la persona para que
    // auth.uid() resuelva -- 'usuarios' incluida (ver
    // migracion_rls_usuarios.sql): tanto el INSERT inicial de registro
    // (auth_id ya viaja en datosFinales, ver mas arriba) como el PATCH de
    // etapa_actual/datos basicos son siempre sobre la fila propia. El resto
    // sigue con el anon key.
    const TABLAS_CON_RLS = ['conversaciones', 'matches', 'feedback_piloto', 'reportes_tecnicos', 'perfiles', 'usuarios', 'solicitudes_revision_perfil', 'push_tokens'];
    const bearer = TABLAS_CON_RLS.includes(tabla) ? usuario.token : supabaseKey;
    const response = await fetch(url, {
      method: filtro ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${bearer}`,
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
        if (!data[0].mail_confirmado) {
          // guardarUsuarioYContinuar (soul.html) reintenta este mismo
          // guardado si la primera respuesta se pierde en el camino (ej.
          // conexion mobile inestable) -- con esto siendo un upsert, ese
          // reintento vuelve a pasar por aca. Reutilizar el token si ya
          // habia uno (mismo criterio que api/auth.js reenviarConfirmacion)
          // evita que la repeticion invalide el mail que ya se mando antes.
          const token = data[0].token_confirmacion || crypto.randomBytes(24).toString('hex');
          if (!data[0].token_confirmacion) {
            // 'usuarios' ya tiene politica RLS real -- token propio, misma
            // persona que se acaba de insertar en este mismo request.
            await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(data[0].id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${usuario.token}`, Prefer: 'return=minimal' },
              body: JSON.stringify({ token_confirmacion: token })
            });
          }
          await notificarConfirmarMail({ nombre: data[0].nombre, email: data[0].email, token });
        }
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
