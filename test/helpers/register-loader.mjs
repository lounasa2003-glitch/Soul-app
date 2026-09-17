// Punto de entrada para "node --import test/helpers/register-loader.mjs".
// Registra esm-loader.mjs (ver ese archivo) antes de que corra cualquier
// prueba, para que los import de lib/*.js y api/*.js funcionen en local.
import { register } from 'node:module';

register('./esm-loader.mjs', import.meta.url);
