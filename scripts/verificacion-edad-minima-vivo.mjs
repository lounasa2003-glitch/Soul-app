#!/usr/bin/env node
// Verificacion en vivo del bloque de edad minima (commit 33e0f37, deployado en
// produccion) -- antes de Test 1-4, hace un diagnostico comparativo: registra
// una cuenta descartable y usa el MISMO access_token recien emitido en TRES
// llamadas -- directo contra Supabase (GET /auth/v1/user con
// SUPABASE_ANON_KEY), contra la operacion minima real de /api/guardar, y
// contra api/diagnosticoTemporal.js (el mismo chequeo que verificarUsuario()
// pero corriendo DENTRO del runtime de Vercel, devolviendo el resultado
// sanitizado en la respuesta en vez de silenciarlo). Ese tercer endpoint esta
// protegido con una firma HMAC-SHA256 sobre un timestamp, usando
// SUPABASE_SERVICE_ROLE_KEY como secreto -- la key nunca viaja en la
// request, solo la firma. Compara los resultados para distinguir si un
// eventual rechazo es del lado de Supabase (token invalido de origen) o del
// lado de Vercel/nuestro codigo (token valido pero rechazado igual). Si
// Supabase directo y /api/guardar aceptan el token, sigue automaticamente
// con las 4 pruebas de edad; si no, aborta todo el resto sin correrlas.
// Corre las 4 pruebas obligatorias contra la API real usando cuentas
// descartables, verifica residuos con acceso administrativo directo a
// Supabase (service_role), y borra fisicamente todo lo que haya creado --
// cuentas Y la fila anti-reuso del diagnostico HMAC -- antes de terminar
// (bloque finally, incluso si alguna prueba o el diagnostico inicial falla).
//
// GARANTIAS DE SEGURIDAD DE ESTE SCRIPT:
// - Nunca imprime ni guarda un access/refresh token, la anon key ni la
//   service role key (solo presencia + longitud para los tokens de sesion;
//   las dos claves de Supabase jamas se imprimen, ni siquiera enmascaradas).
// - No escribe nada a disco -- todo el output va a stdout.
// - Se detiene de entrada si SUPABASE_URL no apunta exactamente al proyecto
//   esperado (kjughqrjyglfxaiunivw.supabase.co).
// - Cada cuenta creada por este script queda registrada en memoria con su
//   authId y usuarioId EXACTOS, capturados inmediatamente de la respuesta
//   de la propia API en el momento en que se crean -- nunca a partir de un
//   argumento, variable de entorno o entrada externa. Una cuenta solo entra
//   a la lista de limpieza despues de que el propio script confirma (status
//   200 + un id con forma de UUID) que la acaba de crear.
// - Todo borrado (verificacion y limpieza) usa exclusivamente esos ids
//   exactos via filtros "id=eq.<uuid>" / "usuario_id=eq.<uuid>" -- nunca una
//   busqueda por prefijo, patron o coincidencia amplia de email.
// - No sube fotos reales: usa una imagen sintetica de 1x1 px (JPEG valido,
//   sin contenido ni persona real).
// - No llama a /api/chat, /api/matches, /api/citas, /api/calcularMatches ni
//   /api/analisisExterno -- ninguna IA ni matching se dispara en ningun
//   punto de este script.
//
// VARIABLES DE ENTORNO NECESARIAS:
//   SOUL_APP_URL              -- URL publica de la app (ej: https://soulapp.love)
//   SUPABASE_URL              -- URL del proyecto de Supabase (debe ser el
//                                 proyecto kjughqrjyglfxaiunivw)
//   SUPABASE_ANON_KEY         -- anon/public key de ese mismo proyecto, SOLO
//                                 para el diagnostico comparativo inicial
//                                 (llamar /auth/v1/user directo, igual que lo
//                                 hace lib/authUtil.js del lado del servidor)
//   SUPABASE_SERVICE_ROLE_KEY -- service role key de ese mismo proyecto,
//                                 SOLO para verificar y limpiar (nunca se
//                                 imprime ni se guarda)
//
// USO (PowerShell, Windows):
//   $env:SOUL_APP_URL = "https://soulapp.love"
//   $env:SUPABASE_URL = "https://kjughqrjyglfxaiunivw.supabase.co"
//   $env:SUPABASE_ANON_KEY = "<pegar la anon key aca, sin comillas extra>"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<pegar la service role key aca>"
//   node verificacion-edad-minima-vivo.mjs
//
// AL TERMINAR, borrar las variables de entorno de la sesion de PowerShell:
//   Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY
//   Remove-Item Env:\SUPABASE_ANON_KEY
//   Remove-Item Env:\SUPABASE_URL
//   Remove-Item Env:\SOUL_APP_URL
//
// Requiere Node 18+ (fetch nativo). No requiere npm install.

import crypto from 'crypto';

const PROYECTO_ESPERADO = 'kjughqrjyglfxaiunivw';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOUL_APP_URL = process.env.SOUL_APP_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function abortar(msg) {
  console.error('ABORTADO: ' + msg);
  process.exit(1);
}

if (!SOUL_APP_URL) abortar('Falta SOUL_APP_URL (ej: https://soulapp.love).');
if (!SUPABASE_URL) abortar('Falta SUPABASE_URL.');
if (!SUPABASE_ANON_KEY) abortar('Falta SUPABASE_ANON_KEY.');
if (!SERVICE_KEY) abortar('Falta SUPABASE_SERVICE_ROLE_KEY.');

let supabaseHost = '';
try { supabaseHost = new URL(SUPABASE_URL).hostname; } catch { /* queda vacio, falla abajo */ }
if (supabaseHost !== `${PROYECTO_ESPERADO}.supabase.co`) {
  abortar(`SUPABASE_URL no corresponde al proyecto esperado (${PROYECTO_ESPERADO}). Hostname visto: "${supabaseHost || '<invalido>'}".`);
}
console.log(`Proyecto Supabase verificado: ${supabaseHost}`);
console.log(`SUPABASE_ANON_KEY: <presente, nunca se imprime>`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: <presente, nunca se imprime>`);

// Imagen sintetica minima valida (1x1 px, JPEG real) -- no es una foto real
// de ninguna persona, solo satisface fotoValida() en api/guardar.js.
const FOTO_DUMMY =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

function randSuffix(n = 10) {
  return Math.random().toString(36).slice(2, 2 + n);
}
function fmtFecha(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function maskToken(t) {
  return t ? `<presente, ${t.length} caracteres>` : '<ausente>';
}
function decodeJwtSub(token) {
  try {
    const payloadB64 = token.split('.')[1];
    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).sub || null;
  } catch {
    return null;
  }
}

const hoy = new Date();
const Y = hoy.getFullYear();
const M = hoy.getMonth() + 1;
const D = hoy.getDate();

// ---------- llamadas contra la app (SOUL_APP_URL) ----------

async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(SOUL_APP_URL + path, { method: 'POST', headers, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo JSON */ }
  return { status: res.status, ok: res.ok, data };
}
async function apiGet(path, token) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(SOUL_APP_URL + path, { headers });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo JSON */ }
  return { status: res.status, ok: res.ok, data };
}
function registrar(email, password) { return apiPost('/api/auth', { accion: 'registro', email, password }); }
function login(email, password) { return apiPost('/api/auth', { accion: 'login', email, password }); }
function guardar(token, tabla, datos, filtro) {
  const body = { tabla, datos };
  if (filtro) body.filtro = filtro;
  return apiPost('/api/guardar', body, token);
}
function leer(token, tabla, filtro) {
  return apiGet(`/api/leer?tabla=${encodeURIComponent(tabla)}&filtro=${encodeURIComponent(filtro)}`, token);
}
function solicitarBorrado(token) { return apiPost('/api/auth', { accion: 'solicitarBorrado' }, token); }

// ---------- diagnostico: mismo access_token directo contra Supabase ----------
// Usa SUPABASE_ANON_KEY (no service_role) -- es exactamente la misma llamada
// que hace lib/authUtil.js (verificarUsuario) del lado del servidor: GET
// /auth/v1/user con el apikey del proyecto + el Authorization del usuario.
// Se llama directo contra Supabase, sin pasar por soulapp.love, para poder
// distinguir un token invalido de origen (Supabase tambien lo rechaza) de un
// problema especifico de nuestro backend (Supabase lo acepta, pero
// /api/guardar no).
async function supabaseAuthUserDirecto(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo JSON */ }
  return { status: res.status, ok: res.ok, data };
}

// ---------- diagnostico server-side temporal (api/diagnosticoTemporal.js) ----------
// Firma HMAC-SHA256 de un timestamp usando SERVICE_KEY como secreto -- la
// clave nunca viaja en la request, el servidor la conoce por su propia
// variable de entorno y recalcula la misma firma para verificar. Cada
// timestamp usado se registra para poder borrar despues, en la limpieza,
// la fila anti-reuso que crea el propio endpoint en 'rate_limits'.
const timestampsDiagnosticoUsados = [];

async function diagnosticoTemporalServerSide(token) {
  const timestamp = String(Date.now());
  const firma = crypto.createHmac('sha256', SERVICE_KEY).update(timestamp).digest('hex');
  timestampsDiagnosticoUsados.push(timestamp);

  const headers = { 'X-Diagnostico-Timestamp': timestamp, 'X-Diagnostico-Firma': firma };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(`${SOUL_APP_URL}/api/diagnosticoTemporal`, { headers });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo JSON */ }
  return { status: res.status, ok: res.ok, data };
}

async function limpiarNoncesDiagnostico() {
  for (const timestamp of timestampsDiagnosticoUsados) {
    const r = await restDeletePorId('rate_limits', 'email', `diag_${timestamp}`);
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} borrar nonce anti-reuso rate_limits (email=diag_${timestamp}) -> status=${r.status}`);
  }
}

// ---------- llamadas administrativas directas a Supabase (service_role) ----------
// Todas reciben el id EXACTO a usar en el filtro -- ninguna arma un filtro
// por prefijo ni por patron de email.

function adminHeaders(extra) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

async function authAdminGetById(authId) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(authId)}`, { headers: adminHeaders() });
  return { existe: res.status === 200, status: res.status };
}
async function authAdminDelete(authId) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(authId)}`, { method: 'DELETE', headers: adminHeaders() });
  return { ok: res.ok, status: res.status };
}
async function restGetPorId(tabla, columnaId, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=id&${columnaId}=eq.${encodeURIComponent(id)}`, { headers: adminHeaders() });
  const data = res.ok ? await res.json() : [];
  return { existe: Array.isArray(data) && data.length > 0, cantidad: Array.isArray(data) ? data.length : 0, status: res.status };
}
async function restDeletePorId(tabla, columnaId, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${columnaId}=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: adminHeaders({ Prefer: 'return=minimal' })
  });
  return { ok: res.ok, status: res.status };
}
async function restDeleteMatches(usuarioId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?or=(usuario_a.eq.${encodeURIComponent(usuarioId)},usuario_b.eq.${encodeURIComponent(usuarioId)})`,
    { method: 'DELETE', headers: adminHeaders({ Prefer: 'return=minimal' }) }
  );
  return { ok: res.ok, status: res.status };
}
async function restGetMatches(usuarioId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?select=id&or=(usuario_a.eq.${encodeURIComponent(usuarioId)},usuario_b.eq.${encodeURIComponent(usuarioId)})`,
    { headers: adminHeaders() }
  );
  const data = res.ok ? await res.json() : [];
  return { existe: Array.isArray(data) && data.length > 0, cantidad: Array.isArray(data) ? data.length : 0, status: res.status };
}

function datosOnboardingCompletos(fechaNacimiento, nombre) {
  return {
    nombre, fecha_nacimiento: fechaNacimiento, ciudad: 'TEST', distancia_max: 25,
    genero: 'test', preferencia_genero: 'test', tipo_vinculo: ['test'], hijos: 'test',
    preferencia_hijos: 'test', estado_civil: 'test', ocupacion: 'TEST',
    no_negociables: 'test', negociables: 'test',
    foto_cara: FOTO_DUMMY, foto_cuerpo: FOTO_DUMMY, foto_aprobada: true,
    consentimiento_aceptado: true, etapa_actual: 'chat'
  };
}

// ---------- registro de resultados y cuentas creadas ----------

const resultados = [];
function log(nombre, ok, detalle) {
  resultados.push({ nombre, ok, detalle });
  console.log((ok ? 'OK  ' : 'FAIL') + ' | ' + nombre + ' | ' + detalle);
}

// Cada elemento de esta lista representa una cuenta que ESTE script confirmo
// haber creado en ESTA ejecucion (ver registrarCuentaCreada). El bloque
// finally al final del archivo es el UNICO lugar que borra datos, y solo
// itera sobre esta lista -- nunca recibe ids por fuera de ella.
const cuentasCreadas = [];

// Solo se llama despues de confirmar status 200 + un authId con forma de
// UUID devuelto por la propia respuesta de /api/auth -- nunca a partir de
// un valor provisto externamente.
function registrarCuentaCreada({ etiqueta, email, password, token, authId }) {
  if (!UUID_REGEX.test(authId)) {
    log(`${etiqueta}.id_invalido`, false, `authId con formato inesperado, no se registra para limpieza: "${authId}"`);
    return null;
  }
  const cuenta = { etiqueta, email, password, token, authId, usuarioId: null };
  cuentasCreadas.push(cuenta);
  return cuenta;
}
function fijarUsuarioId(cuenta, usuarioId) {
  if (cuenta && UUID_REGEX.test(usuarioId)) cuenta.usuarioId = usuarioId;
}
function actualizarToken(cuenta, nuevoToken) {
  if (cuenta && nuevoToken) cuenta.token = nuevoToken;
}

// api/auth.js (accion 'registro') reenvia tal cual la respuesta de
// POST /auth/v1/signup de Supabase -- el formato "de fabrica" de GoTrue es
// plano (access_token/refresh_token/user en la raiz), y es exactamente lo
// que soul.html lee (accessToken=data.access_token, ver linea ~2601). Se
// prueba primero esa forma; si no esta, se prueba la forma anidada bajo
// "session" (algunas versiones/configuraciones de GoTrue devuelven
// {user, session:{access_token,...}} en vez de plano) antes de darse por
// vencido -- asi el script no falla en silencio si la forma real difiere de
// lo que asume soul.html.
function extraerSesion(data) {
  if (!data) return { token: null, userId: null };
  const token = data.access_token || (data.session && data.session.access_token) || null;
  const userId = (data.user && data.user.id) || (data.session && data.session.user && data.session.user.id) || null;
  return { token, userId };
}

async function crearCuentaDescartable(etiqueta) {
  const email = `edadtest-${etiqueta}-${Date.now()}-${randSuffix(4)}@example.com`;
  const password = 'Aa1!' + randSuffix(12);
  const reg = await registrar(email, password);
  const { token, userId } = extraerSesion(reg.data);
  const authId = userId || (token ? decodeJwtSub(token) : null);
  log(`${etiqueta}.registro`, reg.status === 200 && !!token && !!authId,
    `status=${reg.status} access_token=${maskToken(token)} authId=${authId || '<no obtenido>'}`);
  if (reg.status !== 200 || !token || !authId) return { email, password, token: null, cuenta: null };
  const cuenta = registrarCuentaCreada({ etiqueta, email, password, token, authId });
  return { email, password, token, cuenta };
}

// ---------- diagnostico comparativo de sesion ----------
//
// Registra una cuenta descartable propia (independiente de las de Test 1-4)
// y usa el MISMO access_token recien emitido en dos llamadas separadas:
//   1. Directo contra Supabase (supabaseAuthUserDirecto) -- exactamente lo
//      que hace lib/authUtil.js del lado del servidor, pero sin pasar por
//      soulapp.love.
//   2. La operacion minima real de /api/guardar (crear la fila minima con
//      el nombre -- lo mismo que hace soul.html apenas alguien se registra).
//
// Compara los dos resultados para distinguir si un eventual rechazo es del
// lado de Supabase (token invalido de origen) o especifico de nuestro
// backend (Supabase acepta el token, pero /api/guardar no):
//   A. Supabase=200 y /api/guardar=401 -> el token es valido; el problema
//      esta en Vercel/lib/authUtil.js/variables de produccion o el deploy
//      activo. Se abortan las pruebas de edad.
//   B. Supabase=401 y /api/guardar=401 -> el token emitido no es aceptado
//      por Supabase mismo; hay que revisar configuracion Auth/JWT del
//      proyecto. Se abortan las pruebas de edad.
//   C. Ambos=200 -> se continua automaticamente con Test 1-4.
//   D. Cualquier otra combinacion (incluye Supabase=401 pero
//      /api/guardar=200, que no deberia poder pasar nunca) -> se abortan
//      las pruebas de edad con diagnostico sanitizado.
// En los casos A/B/D se corta antes de generar la cascada de fallos
// enganosos que produjo la corrida anterior (donde los 401 en Test 1-4 eran
// todos sintoma de esto, no de un problema real en el chequeo de edad).
async function diagnosticoComparativoDeSesion() {
  console.log('\n--- Diagnostico comparativo: mismo access_token, Supabase directo vs /api/guardar ---');
  const { cuenta } = await crearCuentaDescartable('diagnostico-sesion');
  if (!cuenta) {
    log('DIAGNOSTICO.abortado', false, 'no se pudo registrar la cuenta de prueba inicial (ver DIAGNOSTICO.registro arriba)');
    return false;
  }

  const supa = await supabaseAuthUserDirecto(cuenta.token);
  const supaUserId = supa.data && supa.data.id;
  const supaIdCoincide = supaUserId === cuenta.authId;
  const supaOk = supa.status === 200 && supaIdCoincide;
  log('DIAGNOSTICO.supabase_directo', supaOk,
    `status=${supa.status} error=${supa.data && (supa.data.error || supa.data.msg || supa.data.error_description) || '<ninguno>'} user.id_esperado_coincide=${supaIdCoincide}`);

  const guardarRes = await guardar(cuenta.token, 'usuarios', { nombre: 'Test Diagnostico Sesion' });
  fijarUsuarioId(cuenta, guardarRes.status === 200 && guardarRes.data && guardarRes.data[0] && guardarRes.data[0].id);
  const guardarOk = guardarRes.status === 200;
  log('DIAGNOSTICO.api_guardar', guardarOk,
    `status=${guardarRes.status} error=${guardarRes.data && guardarRes.data.error || '<ninguno>'}`);

  // Vista desde ADENTRO de Vercel: el endpoint temporal repite la misma
  // llamada que hace verificarUsuario() (GET /auth/v1/user con el mismo
  // token), pero corriendo en el runtime real de produccion en vez de desde
  // la red del runner -- si hay una diferencia de comportamiento especifica
  // de Vercel, esta es la evidencia que la va a mostrar.
  const diagServer = await diagnosticoTemporalServerSide(cuenta.token);
  log('DIAGNOSTICO.servidor_vercel', diagServer.status === 200,
    `status=${diagServer.status} respuesta=${JSON.stringify(diagServer.data)}`);

  let caso, interpretacion, continuar;
  if (supaOk && guardarOk) {
    caso = 'C'; continuar = true;
    interpretacion = 'Supabase directo y /api/guardar aceptan el mismo token -- se continua automaticamente con Test 1 a 4.';
  } else if (supaOk && !guardarOk) {
    caso = 'A'; continuar = false;
    interpretacion = 'Supabase directo acepto el token pero /api/guardar lo rechazo -- el token es valido, el problema esta en Vercel/lib/authUtil.js/variables de produccion o el deploy activo, no en Supabase. Se abortan las pruebas de edad.';
  } else if (!supaOk && !guardarOk) {
    caso = 'B'; continuar = false;
    interpretacion = 'Supabase directo tambien rechazo el token -- el token emitido no es aceptado por Supabase mismo; revisar configuracion Auth/JWT o inconsistencia de proyecto. Se abortan las pruebas de edad.';
  } else {
    caso = 'D'; continuar = false;
    interpretacion = 'Combinacion inesperada (Supabase directo rechazo el token pero /api/guardar lo acepto). Se abortan las pruebas de edad.';
  }
  log(`DIAGNOSTICO.interpretacion_caso_${caso}`, continuar, interpretacion);
  return continuar;
}

// ---------- TEST 1: menor de 18 en onboarding ----------

async function test1() {
  console.log('\n--- Test 1: menor de 18 anios en onboarding ---');
  const { email, password, token, cuenta } = await crearCuentaDescartable('menor');
  if (!cuenta) { log('T1.abortado', false, 'no se pudo registrar la cuenta de prueba'); return; }

  const filaMin = await guardar(token, 'usuarios', { nombre: 'Test Menor' });
  const usuarioId = filaMin.status === 200 && filaMin.data && filaMin.data[0] && filaMin.data[0].id;
  fijarUsuarioId(cuenta, usuarioId);
  log('T1.fila_minima_creada', filaMin.status === 200 && !!usuarioId, `status=${filaMin.status} usuarioId=${usuarioId || '<no obtenido>'}`);

  const consent = await guardar(token, 'usuarios', {
    consentimiento_aceptado: true, consentimiento_fecha: new Date().toISOString(),
    consentimiento_version: 'test', politica_privacidad_version: 'test', comunicaciones_producto_aceptadas: false
  });
  log('T1.consentimiento_guardado', consent.status === 200, `status=${consent.status}`);

  const fecha17 = fmtFecha(Y - 17, M, D);
  const rechazo = await guardar(token, 'usuarios', datosOnboardingCompletos(fecha17, 'Test Menor'));
  log('T1.rechazo_403_edad_minima',
    rechazo.status === 403 && rechazo.data && rechazo.data.error === 'edad_minima',
    `status=${rechazo.status} error=${rechazo.data && rechazo.data.error}`);
  log('T1.mensaje_bloqueante',
    !!(rechazo.data && rechazo.data.mensaje && rechazo.data.mensaje.includes('mayores de 18')),
    `mensaje="${rechazo.data && rechazo.data.mensaje}"`);

  // Confirmacion de UX: el login con las mismas credenciales deberia fallar.
  const loginTrasRechazo = await login(email, password);
  log('T1.login_posterior_falla (señal de UX)', loginTrasRechazo.status !== 200, `status=${loginTrasRechazo.status}`);

  // Verificacion REAL de residuos -- acceso administrativo directo, por los
  // ids EXACTOS capturados arriba (authId de la respuesta de registro,
  // usuarioId de la respuesta de la fila minima). No se infiere nada.
  const authCheck = await authAdminGetById(cuenta.authId);
  log('T1.auth_realmente_eliminado', !authCheck.existe, `GET admin/users/{authId} -> status=${authCheck.status} (existe=${authCheck.existe})`);

  let usuariosCheck = { existe: false, status: null };
  let perfilesCheck = { existe: false, status: null };
  if (usuarioId) {
    usuariosCheck = await restGetPorId('usuarios', 'id', usuarioId);
    perfilesCheck = await restGetPorId('perfiles', 'usuario_id', usuarioId);
  }
  log('T1.fila_usuarios_realmente_eliminada', !usuariosCheck.existe,
    usuarioId ? `usuarios?id=eq.${usuarioId} -> ${usuariosCheck.cantidad} fila(s)` : 'no se pudo capturar usuarioId, ver T1.fila_minima_creada');
  log('T1.sin_perfiles_asociados', !perfilesCheck.existe,
    usuarioId ? `perfiles?usuario_id=eq.${usuarioId} -> ${perfilesCheck.cantidad} fila(s)` : 'no se pudo capturar usuarioId');

  const sinResiduos = !authCheck.existe && !usuariosCheck.existe && !perfilesCheck.existe;
  log('T1.SIN_RESIDUOS (resultado final de la prueba)', sinResiduos,
    sinResiduos
      ? 'Auth, fila de usuarios (con sus fotos/consentimiento) y perfiles: los tres confirmados ausentes.'
      : 'RESIDUO REAL DETECTADO -- ver el detalle de arriba. La limpieza final del script va a intentar borrar lo que haya quedado.');
}

// ---------- TEST 2: fecha futura / invalida ----------

async function test2() {
  console.log('\n--- Test 2: fecha futura / invalida ---');
  const { email, password, token, cuenta } = await crearCuentaDescartable('futura');
  if (!cuenta) { log('T2.abortado', false, 'no se pudo registrar la cuenta de prueba'); return; }

  const filaMin = await guardar(token, 'usuarios', { nombre: 'Test Futura' });
  fijarUsuarioId(cuenta, filaMin.status === 200 && filaMin.data && filaMin.data[0] && filaMin.data[0].id);
  await guardar(token, 'usuarios', {
    consentimiento_aceptado: true, consentimiento_fecha: new Date().toISOString(),
    consentimiento_version: 'test', politica_privacidad_version: 'test', comunicaciones_producto_aceptadas: false
  });

  const fechaFutura = fmtFecha(Y + 5, 1, 1);
  const intentoFutura = await guardar(token, 'usuarios', datosOnboardingCompletos(fechaFutura, 'Test Futura'));
  log('T2.futura_400_fecha_invalida',
    intentoFutura.status === 400 && intentoFutura.data && intentoFutura.data.error === 'fecha_invalida',
    `status=${intentoFutura.status} error=${intentoFutura.data && intentoFutura.data.error}`);

  const intentoImposible = await guardar(token, 'usuarios', datosOnboardingCompletos('2020-02-30', 'Test Futura'));
  log('T2.imposible_400_fecha_invalida',
    intentoImposible.status === 400 && intentoImposible.data && intentoImposible.data.error === 'fecha_invalida',
    `status=${intentoImposible.status} error=${intentoImposible.data && intentoImposible.data.error}`);

  const loginTrasRechazos = await login(email, password);
  log('T2.cuenta_no_eliminada (login debe funcionar)',
    loginTrasRechazos.status === 200 && !!loginTrasRechazos.data.access_token,
    `status=${loginTrasRechazos.status} access_token=${maskToken(loginTrasRechazos.data && loginTrasRechazos.data.access_token)}`);
  const tokenVigente = (loginTrasRechazos.data && loginTrasRechazos.data.access_token) || token;
  actualizarToken(cuenta, tokenVigente);

  const fechaValida = fmtFecha(Y - 30, M, D);
  const reintento = await guardar(tokenVigente, 'usuarios', datosOnboardingCompletos(fechaValida, 'Test Futura'));
  log('T2.reintento_corregido_aceptado', reintento.status === 200,
    `status=${reintento.status} error=${reintento.data && reintento.data.error}`);
  if (reintento.status === 200 && reintento.data && reintento.data[0]) {
    fijarUsuarioId(cuenta, reintento.data[0].id);
  }
}

// ---------- TEST 3 (exactamente 18) + TEST 4 (edicion de perfil) ----------

async function test3y4() {
  console.log('\n--- Test 3: exactamente 18 anios ---');
  const { email, password, token, cuenta } = await crearCuentaDescartable('dieciocho');
  if (!cuenta) { log('T3.abortado', false, 'no se pudo registrar la cuenta de prueba'); return; }

  await guardar(token, 'usuarios', { nombre: 'Test Dieciocho' });
  await guardar(token, 'usuarios', {
    consentimiento_aceptado: true, consentimiento_fecha: new Date().toISOString(),
    consentimiento_version: 'test', politica_privacidad_version: 'test', comunicaciones_producto_aceptadas: false
  });

  const fecha18 = fmtFecha(Y - 18, M, D);
  const aceptado = await guardar(token, 'usuarios', datosOnboardingCompletos(fecha18, 'Test Dieciocho'));
  log('T3.aceptado_200_puede_continuar', aceptado.status === 200,
    `status=${aceptado.status} error=${aceptado.data && aceptado.data.error}`);

  const usuarioId = aceptado.status === 200 && aceptado.data && aceptado.data[0] && aceptado.data[0].id;
  fijarUsuarioId(cuenta, usuarioId);

  console.log('\n--- Test 4: edicion de perfil (cuenta aprobada) a edad menor, PATCH directo ---');
  if (!usuarioId) { log('T4.abortado', false, 'test 3 no dejo una cuenta aprobada'); return; }

  const fecha17 = fmtFecha(Y - 17, M, D);
  const edicionRechazada = await guardar(token, 'usuarios', { fecha_nacimiento: fecha17 }, `id=eq.${usuarioId}`);
  log('T4.rechazo_403_edad_minima',
    edicionRechazada.status === 403 && edicionRechazada.data && edicionRechazada.data.error === 'edad_minima',
    `status=${edicionRechazada.status} error=${edicionRechazada.data && edicionRechazada.data.error}`);

  const loginTrasEdicion = await login(email, password);
  log('T4.cuenta_no_eliminada (login debe funcionar)',
    loginTrasEdicion.status === 200 && !!loginTrasEdicion.data.access_token, `status=${loginTrasEdicion.status}`);
  const tokenVigente = (loginTrasEdicion.data && loginTrasEdicion.data.access_token) || token;
  actualizarToken(cuenta, tokenVigente);

  const lectura = await leer(tokenVigente, 'usuarios', `id=eq.${usuarioId}`);
  const fechaEnDb = lectura.ok && Array.isArray(lectura.data) && lectura.data[0] && lectura.data[0].fecha_nacimiento;
  log('T4.fecha_original_intacta', fechaEnDb === fecha18,
    `fecha_en_db=${fechaEnDb} esperada=${fecha18} (el intento de PATCH a ${fecha17} no debe haber quedado guardado)`);

  // Verificacion directa (service_role) de que el PATCH rechazado tampoco
  // dejo la fecha menor guardada, independiente de lo que devuelva /api/leer.
  const usuariosDirecto = await restGetPorId('usuarios', 'id', usuarioId);
  log('T4.fila_sigue_existiendo (no se elimino por el rechazo de edicion)', usuariosDirecto.existe,
    `usuarios?id=eq.${usuarioId} -> ${usuariosDirecto.cantidad} fila(s)`);
}

// ---------- limpieza fisica + reverificacion ----------

async function borrarDatosRelacionados(usuarioId) {
  const resultadosBorrado = [];
  for (const [tabla, columna] of [['perfiles', 'usuario_id'], ['conversaciones', 'usuario_id'], ['push_tokens', 'usuario_id']]) {
    const r = await restDeletePorId(tabla, columna, usuarioId);
    resultadosBorrado.push({ tabla, ok: r.ok, status: r.status });
  }
  const rMatches = await restDeleteMatches(usuarioId);
  resultadosBorrado.push({ tabla: 'matches', ok: rMatches.ok, status: rMatches.status });
  return resultadosBorrado;
}

async function limpiarYVerificarCuenta(cuenta) {
  console.log(`\n-- Limpiando ${cuenta.etiqueta} (authId=${cuenta.authId}${cuenta.usuarioId ? `, usuarioId=${cuenta.usuarioId}` : ''}) --`);

  if (cuenta.usuarioId) {
    const relacionados = await borrarDatosRelacionados(cuenta.usuarioId);
    relacionados.forEach((r) => console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} borrar ${r.tabla} de usuario_id=${cuenta.usuarioId} -> status=${r.status}`));

    const borUsuarios = await restDeletePorId('usuarios', 'id', cuenta.usuarioId);
    console.log(`  ${borUsuarios.ok ? 'OK  ' : 'FAIL'} borrar usuarios?id=eq.${cuenta.usuarioId} -> status=${borUsuarios.status}`);
  } else {
    console.log('  (sin usuarioId capturado -- no hay fila de usuarios que borrar por esta via)');
  }

  const borAuth = await authAdminDelete(cuenta.authId);
  console.log(`  ${borAuth.ok || borAuth.status === 404 ? 'OK  ' : 'FAIL'} borrar identidad de Auth authId=${cuenta.authId} -> status=${borAuth.status}`);

  // Re-verificacion obligatoria: volver a consultar con los mismos ids
  // exactos y confirmar cero residuos.
  const authCheck = await authAdminGetById(cuenta.authId);
  let usuariosCheck = { existe: false, cantidad: 0 };
  let matchesCheck = { existe: false, cantidad: 0 };
  if (cuenta.usuarioId) {
    usuariosCheck = await restGetPorId('usuarios', 'id', cuenta.usuarioId);
    matchesCheck = await restGetMatches(cuenta.usuarioId);
  }

  const sinResiduos = !authCheck.existe && !usuariosCheck.existe && !matchesCheck.existe;
  log(`${cuenta.etiqueta}.limpieza_confirmada_sin_residuos`, sinResiduos,
    sinResiduos
      ? 'Auth y usuarios confirmados ausentes tras el borrado.'
      : `RESIDUO TRAS LA LIMPIEZA -- borrar a mano: authId=${cuenta.authId}` + (cuenta.usuarioId ? `, usuarioId=${cuenta.usuarioId}` : ''));
}

async function limpiarTodo() {
  console.log('\n=== LIMPIEZA FISICA (todas las cuentas que este script confirmo haber creado) ===');
  if (cuentasCreadas.length === 0) {
    console.log('No hay cuentas registradas para limpiar.');
  } else {
    for (const cuenta of cuentasCreadas) {
      try {
        await limpiarYVerificarCuenta(cuenta);
      } catch (e) {
        log(`${cuenta.etiqueta}.limpieza_error`, false,
          `excepcion durante la limpieza: ${e && e.message ? e.message : e} -- borrar a mano: authId=${cuenta.authId}${cuenta.usuarioId ? `, usuarioId=${cuenta.usuarioId}` : ''}`);
      }
    }
  }

  if (timestampsDiagnosticoUsados.length > 0) {
    console.log('\n-- Limpiando nonces anti-reuso del diagnostico temporal (tabla rate_limits) --');
    try {
      await limpiarNoncesDiagnostico();
    } catch (e) {
      log('DIAGNOSTICO.limpieza_nonces_error', false, `excepcion limpiando nonces: ${e && e.message ? e.message : e}`);
    }
  }
}

// process.exitCode (no process.exit()) para que el proceso termine con un
// codigo distinto de 0 ante cualquier FAIL o error fatal, sin cortar
// abruptamente al I/O de stdout que todavia este por flushear -- Node sale
// solo una vez que el event loop se vacia, ya con este codigo puesto.
function imprimirResumen() {
  console.log('\n=== RESUMEN ===');
  if (resultados.length === 0) {
    console.log('No se registro ningun resultado -- las pruebas no llegaron a correr (ver el error de arriba). Nada que reportar como aprobado.');
    process.exitCode = 1;
    return;
  }
  resultados.forEach((r) => console.log((r.ok ? 'OK  ' : 'FAIL') + ' ' + r.nombre));
  const fallos = resultados.filter((r) => !r.ok);
  console.log(fallos.length === 0
    ? '\nTodas las verificaciones pasaron, sin residuos.'
    : `\n${fallos.length} verificacion(es) fallaron -- revisar el detalle e ids sanitizados arriba.`);
  process.exitCode = fallos.length === 0 ? 0 : 1;
}

// ---------- main ----------

// Cuando corre sin intervencion humana (ej. un runner de CI con timeout),
// el proceso puede recibir SIGTERM/SIGINT a mitad de una prueba -- Node no
// corre los bloques finally pendientes por si solo ante una señal, asi que
// sin este handler una limpieza interrumpida podria dejar cuentas sin
// borrar. limpiezaEnCurso evita que la limpieza normal (bloque finally de
// abajo) y la de emergencia (por señal) corran las dos a la vez si la señal
// llega justo mientras la limpieza normal ya esta en marcha.
let limpiezaEnCurso = false;
async function correrLimpiezaYResumen() {
  if (limpiezaEnCurso) return;
  limpiezaEnCurso = true;
  await limpiarTodo();
  imprimirResumen();
}
function instalarHandlerDeSenal(señal) {
  process.on(señal, async () => {
    console.error(`\nSeñal ${señal} recibida -- cortando pruebas y forzando limpieza antes de salir.`);
    log('INTERRUMPIDO_POR_SENAL', false, `el proceso recibio ${señal} antes de terminar todas las pruebas`);
    await correrLimpiezaYResumen();
    process.exit(1);
  });
}
instalarHandlerDeSenal('SIGTERM');
instalarHandlerDeSenal('SIGINT');

(async () => {
  console.log(`=== Verificacion en vivo -- bloque de edad minima (commit 33e0f37) contra ${SOUL_APP_URL} ===`);
  try {
    const sesionOk = await diagnosticoComparativoDeSesion();
    if (!sesionOk) {
      console.error('\nEl diagnostico comparativo de sesion no continua -- se abortan Test 1 a 4 sin ejecutarlos (ver DIAGNOSTICO arriba para el detalle e interpretacion).');
    } else {
      await test1();
      await test2();
      await test3y4();
    }
  } catch (e) {
    console.error('\nERROR FATAL durante las pruebas:', e && e.message ? e.message : e);
    log('ERROR_FATAL', false, `las pruebas se cortaron antes de terminar: ${e && e.message ? e.message : e}`);
  } finally {
    await correrLimpiezaYResumen();
  }
})();
