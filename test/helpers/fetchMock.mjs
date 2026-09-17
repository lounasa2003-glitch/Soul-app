// Reemplazo controlado de global.fetch para las pruebas de cancelacion con
// gracia. Nunca hay red real: cualquier URL que no empiece con baseUrl revienta
// la prueba de inmediato (ver mockFetch mas abajo) -- esa es la unica forma de
// garantizar "sin llamada externa real" sin depender de que cada prueba
// recuerde mockear todo a mano.
//
// 'obtenerHandlers()' se llama en cada request y devuelve la lista de
// handlers ACTIVA en ese momento (cada uno con test()/respond()); el primero
// cuyo test() da true resuelve la llamada. Si ninguno matchea pero la URL SI
// es interna (dentro de baseUrl), se devuelve una respuesta vacia inofensiva
// -- esto cubre trafico de fondo que no es el foco de la prueba (los
// recordatorios que verificarUsuario dispara sin esperar, ver
// lib/authUtil.js) sin abrir la puerta a red real.
//
// Se instala UN SOLO mock para todo el archivo de prueba (ver como se usa en
// test/authUtilCancelacionGracia.test.mjs) y cada test solo cambia que
// devuelve 'obtenerHandlers' -- nunca se reemplaza global.fetch por test ni
// se restaura el original entre pruebas. Motivo: alguna llamada de
// verificarUsuario queda "colgada" sin esperarse (los chequearRecordatorios*,
// fire-and-forget) -- si cada test reemplazara global.fetch y lo restaurara
// al original al terminar, una de esas promesas pendientes de un test ya
// finalizado podria terminar pegandole al fetch REAL despues del restore.
// Con un solo mock persistente para todo el archivo eso nunca pasa: toda
// llamada tardia sigue cayendo en este mismo mock, sin importar cuando
// resuelva.
export function crearFetchMockDinamico(baseUrl, obtenerHandlers) {
  const llamadas = [];

  async function mockFetch(url, opciones) {
    const urlTexto = String(url);
    llamadas.push({ url: urlTexto, opciones });

    if (!urlTexto.startsWith(baseUrl)) {
      throw new Error('Llamada de red externa inesperada en prueba (no deberia pasar): ' + urlTexto);
    }

    const handlers = obtenerHandlers() || [];
    for (const handler of handlers) {
      if (handler.test(urlTexto, opciones)) {
        return handler.respond(urlTexto, opciones);
      }
    }

    return respuestaJson(200, []);
  }

  mockFetch.llamadas = llamadas;
  return mockFetch;
}

export function respuestaJson(status, cuerpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo)
  };
}
