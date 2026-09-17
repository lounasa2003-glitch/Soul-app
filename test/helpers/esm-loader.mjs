// Este repo no tiene package.json (no hay "type": "module"), pero todo el
// codigo fuente en api/ y lib/ ya esta escrito en sintaxis ESM (import/export)
// -- en produccion, el builder de Vercel lo transpila antes de correrlo, asi
// que nunca hizo falta declarar el tipo de modulo. Para poder correr ese
// mismo codigo tal cual con "node --test" en local, este loader fuerza a que
// cualquier archivo .js del proyecto se interprete como ESM, sin tocar
// ningun archivo fuente ni agregar un package.json al repo.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.js')) {
    return nextLoad(url, { ...context, format: 'module' });
  }
  return nextLoad(url, context);
}
