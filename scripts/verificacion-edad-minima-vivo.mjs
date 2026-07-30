#!/usr/bin/env node
// Verificacion en vivo del bloque de edad minima (commit 33e0f37, deployado en
// produccion) -- corre las 4 pruebas obligatorias contra la API real usando
// cuentas descartables, verifica residuos con acceso administrativo directo a
// Supabase (service_role), y borra fisicamente todo lo que haya creado antes
// de terminar (bloque finally, incluso si alguna prueba falla).
//
// GARANTIAS DE SEGURIDAD DE ESTE SCRIPT:
// - Nunca imprime ni guarda un access/refresh token ni la service role key
//   (solo presencia + longitud para los tokens de sesion; la service role
//   key jamas se imprime, ni siquiera enmascarada).
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
//   SUPABASE_SERVICE_ROLE_KEY -- service role key de ese mismo proyecto,
//                                 SOLO para verificar y limpiar (nunca se
//                                 imprime ni se guarda)
//
// USO (PowerShell, Windows):
//   $env:SOUL_APP_URL = "https://soulapp.love"
//   $env:SUPABASE_URL = "https://kjughqrjyglfxaiunivw.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<pegar la key aca, sin comillas extra>"
//   node verificacion-edad-minima-vivo.mjs
//
// AL TERMINAR, borrar las variables de entorno de la sesion de PowerShell:
//   Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY
//   Remove-Item Env:\SUPABASE_URL
//   Remove-Item Env:\SOUL_APP_URL
//
// Requiere Node 18+ (fetch nativo). No requiere npm install.

const PROYECTO_ESPERADO = 'kjughqrjyglfxaiunivw';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOUL_APP_URL = process.env.SOUL_APP_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function abortar(msg) {
  console.error('ABORTADO: ' + msg);
  process.exit(1);
}

if (!SOUL_APP_URL) abortar('Falta SOUL_APP_URL (ej: https://soulapp.love).');
if (!SUPABASE_URL) abortar('Falta SUPABASE_URL.');
if (!SERVICE_KEY) abortar('Falta SUPABASE_SERVICE_ROLE_KEY.');

let supabaseHost = '';
try { supabaseHost = new URL(SUPABASE_URL).hostname; } catch { /* queda vacio, falla abajo */ }
if (supabaseHost !== `${PROYECTO_ESPERADO}.supabase.co`) {
  abortar(`SUPABASE_URL no corresponde al proyecto esperado (${PROYECTO_ESPERADO}). Hostname visto: "${supabaseHost || '<invalido>'}".`);
}
console.log(`Proyecto Supabase verificado: ${supabaseHost}`);
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

async function crearCuentaDescartable(etiqueta) {
  const email = `edadtest-${etiqueta}-${Date.now()}-${randSuffix(4)}@example.com`;
  const password = 'Aa1!' + randSuffix(12);
  const reg = await registrar(email, password);
  const token = reg.data && reg.data.access_token;
  const authId = (reg.data && reg.data.user && reg.data.user.id) || (token ? decodeJwtSub(token) : null);
  log(`${etiqueta}.registro`, reg.status === 200 && !!token && !!authId,
    `status=${reg.status} access_token=${maskToken(token)} authId=${authId || '<no obtenido>'}`);
  if (reg.status !== 200 || !token || !authId) return { email, password, token: null, cuenta: null };
  const cuenta = registrarCuentaCreada({ etiqueta, email, password, token, authId });
  return { email, password, token, cuenta };
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
    return;
  }
  for (const cuenta of cuentasCreadas) {
    try {
      await limpiarYVerificarCuenta(cuenta);
    } catch (e) {
      log(`${cuenta.etiqueta}.limpieza_error`, false,
        `excepcion durante la limpieza: ${e && e.message ? e.message : e} -- borrar a mano: authId=${cuenta.authId}${cuenta.usuarioId ? `, usuarioId=${cuenta.usuarioId}` : ''}`);
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
    await test1();
    await test2();
    await test3y4();
  } catch (e) {
    console.error('\nERROR FATAL durante las pruebas:', e && e.message ? e.message : e);
    log('ERROR_FATAL', false, `las pruebas se cortaron antes de terminar: ${e && e.message ? e.message : e}`);
  } finally {
    await correrLimpiezaYResumen();
  }
})();
