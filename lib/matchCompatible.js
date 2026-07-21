// Compartido entre api/calcularMatches.js (motor real) y
// api/admin/matches.js (ranking manual) -- ninguno de los dos filtraba por
// genero/preferencia antes de comparar perfiles con Claude, asi que podian
// (y llegaron a) crear matches que cruzaban lo que la persona eligio en
// "¿Con quien queres conectar?" (ej. dos mujeres matcheadas aunque una haya
// elegido solo "Hombres"). Este filtro corre ANTES de gastar ninguna llamada
// a Claude, asi que ademas ahorra costo en vez de sumarlo.
const MAPA_GENERO_A_PREFERENCIA = { 'Mujer': 'Mujeres', 'Hombre': 'Hombres' };
const PREFERENCIAS_ABIERTAS = new Set(['Cualquier género', 'Todavía lo estoy definiendo']);

// "quien" acepta a "candidato" segun lo que "quien" eligio -- una preferencia
// puntual (Mujeres/Hombres) solo acepta ese genero exacto; sin preferencia
// cargada, o con una preferencia abierta ("Cualquier género" / "Todavía lo
// estoy definiendo"), no restringe.
function acepta(quien, candidato) {
  const pref = quien && quien.preferencia_genero;
  if (!pref || PREFERENCIAS_ABIERTAS.has(pref)) return true;
  return MAPA_GENERO_A_PREFERENCIA[candidato && candidato.genero] === pref;
}

// La compatibilidad tiene que ser MUTUA: no alcanza con que una persona
// acepte a la otra si la otra no la habria elegido.
export function generosCompatibles(personaA, personaB) {
  // Si a alguna de las dos le falta el genero propio, no hay forma
  // confiable de decidir compatibilidad -- antes esto caia en el mismo
  // caso que "sin restriccion" en acepta() de arriba, dejando matchear a
  // alguien cuyo genero ni siquiera se conoce. Un par de cuentas reales
  // llegaron a ese estado antes de que existiera el chequeo server-side
  // que ahora lo evita hacia adelante (ver CAMPOS_BASICOS_REQUERIDOS en
  // api/guardar.js) -- esto es la red de seguridad para las que ya existian.
  if (!personaA || !personaA.genero || !personaB || !personaB.genero) return false;
  return acepta(personaA, personaB) && acepta(personaB, personaA);
}
