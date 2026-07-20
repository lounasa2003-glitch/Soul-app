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
  return acepta(personaA, personaB) && acepta(personaB, personaA);
}
