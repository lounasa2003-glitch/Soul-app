// Pruebas de la gracia de cancelacion dentro de verificarUsuario()
// (lib/authUtil.js). Ninguna prueba de este archivo hace una llamada de red
// real: se instala UN SOLO mock de fetch para todo el archivo (ver
// crearFetchMockDinamico en test/helpers/fetchMock.mjs) y nunca se restaura
// el fetch real durante el proceso -- si se reemplazara global.fetch por
// test y se restaurara el original en afterEach, una promesa "fire and
// forget" de un test ya terminado (los chequearRecordatorios* que
// verificarUsuario dispara sin await) podria terminar llamando al fetch REAL
// despues del restore. Con un solo mock persistente eso nunca pasa: toda
// llamada tardia sigue cayendo en el mismo mock. Cualquier URL que no sea
// BASE_URL revienta la prueba de todos modos.
//
// Variables de entorno FALSAS, seteadas antes de importar lib/authUtil.js
// (CUENTA_PRUEBA_FREE_EMAIL se lee una sola vez, a nivel de modulo).
process.env.SUPABASE_URL = 'https://fake-supabase.test';
process.env.SUPABASE_ANON_KEY = 'fake-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
process.env.CUENTA_PRUEBA_FREE_EMAIL = '';

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearFetchMockDinamico, respuestaJson } from './helpers/fetchMock.mjs';
import { verificarUsuario } from '../lib/authUtil.js';

const BASE_URL = 'https://fake-supabase.test';
const TOKEN_SESION = 'token-de-sesion-falso';
const EMAIL = 'persona@test.com';
const AUTH_ID = 'auth-id-1';

let handlersActuales = [];
const mockFetch = crearFetchMockDinamico(BASE_URL, () => handlersActuales);
global.fetch = mockFetch;

afterEach(() => {
  handlersActuales = [];
});

function req() {
  return { headers: { authorization: 'Bearer ' + TOKEN_SESION } };
}

function handlerAuthUser() {
  return {
    test: (url) => url.startsWith(BASE_URL + '/auth/v1/user'),
    respond: () => respuestaJson(200, { id: AUTH_ID, email: EMAIL })
  };
}

function handlerSelectUsuarios(fila) {
  const patron = BASE_URL + '/rest/v1/usuarios?select=';
  return {
    test: (url, opciones) =>
      url.startsWith(patron) &&
      url.includes('email=eq.' + encodeURIComponent(EMAIL)) &&
      (!opciones || opciones.method === undefined),
    respond: () => respuestaJson(200, fila ? [fila] : [])
  };
}

function urlPatchGracia(filaId) {
  return (
    `${BASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(filaId)}` +
    '&plan=eq.pro&plan_origen=eq.mercadopago&mp_status=eq.cancelled&plan_auto_renueva=eq.false'
  );
}

function handlerPatchGracia(filaId, respuesta) {
  const url = urlPatchGracia(filaId);
  return {
    test: (u, opciones) => u === url && opciones && opciones.method === 'PATCH',
    respond: respuesta
  };
}

// mockFetch.llamadas es UNICO para todo el archivo (ver mas arriba) -- cada
// prueba usa un fila.id distinto (ver filaBase) para que su URL de PATCH de
// gracia nunca choque con la de otra prueba, y este filtro solo cuenta las
// llamadas relevantes a ESE id.
function llamadasPatchGracia(filaId) {
  const url = urlPatchGracia(filaId);
  return mockFetch.llamadas.filter((l) => l.url === url && l.opciones && l.opciones.method === 'PATCH');
}

let contadorFila = 0;
function filaBase(overrides) {
  contadorFila += 1;
  return {
    id: 'usuario-' + contadorFila,
    analisis_usados: 0,
    // 'ahora' para que el throttle de ultima_actividad no dispare un PATCH
    // extra que no es el foco de esta prueba.
    ultima_actividad: new Date().toISOString(),
    mail_confirmado: true,
    etapa_actual: 'completa',
    plan: 'pro',
    plan_origen: 'mercadopago',
    mp_status: 'cancelled',
    plan_auto_renueva: false,
    plan_vencimiento: null,
    eliminacion_solicitada_en: null,
    ...overrides
  };
}

function horasDesdeAhora(horas) {
  return new Date(Date.now() + horas * 3600 * 1000).toISOString();
}

test('verificarUsuario: cancelada con vencimiento futuro NO hace PATCH a free', async () => {
  const fila = filaBase({ plan_vencimiento: horasDesdeAhora(24 * 10) });
  handlersActuales = [handlerAuthUser(), handlerSelectUsuarios(fila)];

  const resultado = await verificarUsuario(req());

  assert.equal(resultado.plan, 'pro');
  assert.equal(llamadasPatchGracia(fila.id).length, 0);
});

test('verificarUsuario: cancelada y vencida hace PATCH condicional con service role y devuelve free solo si Supabase confirma una fila', async () => {
  const fila = filaBase({ plan_vencimiento: horasDesdeAhora(-24) });
  let headersRecibidos = null;
  let cuerpoRecibido = null;
  handlersActuales = [
    handlerAuthUser(),
    handlerSelectUsuarios(fila),
    handlerPatchGracia(fila.id, (url, opciones) => {
      headersRecibidos = opciones.headers;
      cuerpoRecibido = JSON.parse(opciones.body);
      return respuestaJson(200, [{ id: fila.id, plan: 'free' }]);
    })
  ];

  const resultado = await verificarUsuario(req());

  assert.equal(resultado.plan, 'free');
  assert.equal(llamadasPatchGracia(fila.id).length, 1);
  // Service role key, nunca el token de la persona ni el anon key.
  assert.equal(headersRecibidos.apikey, 'fake-service-key');
  assert.equal(headersRecibidos.Authorization, 'Bearer fake-service-key');
  assert.equal(cuerpoRecibido.plan, 'free');
  assert.equal(cuerpoRecibido.plan_vencimiento, null);
});

test('verificarUsuario: si Supabase responde error HTTP al PATCH, lanza excepcion y no afirma free', async () => {
  const fila = filaBase({ plan_vencimiento: horasDesdeAhora(-24) });
  handlersActuales = [
    handlerAuthUser(),
    handlerSelectUsuarios(fila),
    handlerPatchGracia(fila.id, () => respuestaJson(500, { message: 'fallo interno simulado' }))
  ];

  await assert.rejects(() => verificarUsuario(req()), /HTTP 500/);
});

test('verificarUsuario: si el PATCH devuelve cero filas (reactivacion concurrente), no afirma free', async () => {
  const fila = filaBase({ plan_vencimiento: horasDesdeAhora(-24) });
  handlersActuales = [
    handlerAuthUser(),
    handlerSelectUsuarios(fila),
    handlerPatchGracia(fila.id, () => respuestaJson(200, []))
  ];

  const resultado = await verificarUsuario(req());

  // fila.plan seguia en 'pro' antes del PATCH -- al no confirmarse ninguna
  // fila actualizada, verificarUsuario no lo pisa a 'free' por su cuenta.
  assert.equal(resultado.plan, 'pro');
  assert.equal(llamadasPatchGracia(fila.id).length, 1);
});

test('verificarUsuario: un Pro de otro origen (no mercadopago) nunca dispara el PATCH de gracia', async () => {
  const fila = filaBase({
    plan_origen: 'google_play',
    mp_status: null,
    plan_auto_renueva: null,
    plan_vencimiento: horasDesdeAhora(-24)
  });
  handlersActuales = [handlerAuthUser(), handlerSelectUsuarios(fila)];

  const resultado = await verificarUsuario(req());

  assert.equal(resultado.plan, 'pro');
  assert.equal(llamadasPatchGracia(fila.id).length, 0);
});
