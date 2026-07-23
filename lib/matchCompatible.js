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

// A diferencia de genero/preferencia (una persona tiene un atributo, la
// otra una preferencia sobre ese atributo), tipo_vinculo es lo que CADA
// una busca para el vinculo en si -- la compatibilidad es que las dos
// busquen lo mismo, no que una acepte el atributo de la otra. "Todavía no
// lo sé" no restringe (esta abierta) porque todavia no decidio; el resto
// exige coincidencia exacta -- cruzar "Romántico" con "Amistad profunda"
// es exactamente el tipo de match que no tiene sentido generar.
const TIPO_VINCULO_ABIERTO = 'Todavía no lo sé';
export function tipoVinculoCompatible(personaA, personaB) {
  const a = personaA && personaA.tipo_vinculo;
  const b = personaB && personaB.tipo_vinculo;
  if (!a || !b) return false;
  if (a === TIPO_VINCULO_ABIERTO || b === TIPO_VINCULO_ABIERTO) return true;
  return a === b;
}

// Sin geocodificacion real en el proyecto, "ciudad" es texto libre y
// "distancia_max" son franjas (no km reales) -- lo unico que se puede
// verificar con certeza es "Mi ciudad" (misma ciudad, comparacion textual
// exacta salvo mayusculas/espacios). "Hasta 50 km" y "Mismo país" exigirian
// datos que no se piden hoy (coordenadas o país), asi que no restringen --
// mejor no filtrar que filtrar mal y descartar gente compatible por error.
// "Cualquier lugar" nunca restringe, por definicion.
function normalizarCiudad(c) {
  return (c || '').trim().toLowerCase();
}
function aceptaDistancia(quien, candidato) {
  const distancia = quien && quien.distancia_max;
  if (!distancia || distancia === 'Cualquier lugar') return true;
  if (distancia === 'Mi ciudad') {
    const miCiudad = normalizarCiudad(quien.ciudad);
    const suCiudad = normalizarCiudad(candidato && candidato.ciudad);
    if (!miCiudad || !suCiudad) return false;
    return miCiudad === suCiudad;
  }
  return true; // 'Hasta 50 km' / 'Mismo país' -- no verificable con los datos actuales
}
export function distanciaCompatible(personaA, personaB) {
  return aceptaDistancia(personaA, personaB) && aceptaDistancia(personaB, personaA);
}

// Mismo patron que genero/preferencia_genero: "hijos" es el atributo propio
// (No tengo / Sí, pequeños / adolescentes / adultos), "preferencia_hijos"
// es lo que la persona busca en la OTRA (No me importa / Prefiero que no
// tenga / Prefiero que sí tenga). Sin preferencia cargada, o "No me
// importa", no restringe. Si hay preferencia puntual pero no se puede
// verificar el atributo de el/la candidata (dato faltante), no se
// considera compatible -- mismo criterio "fail closed" que generosCompatibles.
const PREFERENCIA_HIJOS_ABIERTA = 'No me importa';
function tieneHijos(valor) {
  return valor === 'Sí, pequeños' || valor === 'Sí, adolescentes' || valor === 'Sí, adultos';
}
function aceptaHijos(quien, candidato) {
  const pref = quien && quien.preferencia_hijos;
  if (!pref || pref === PREFERENCIA_HIJOS_ABIERTA) return true;
  if (!candidato || !candidato.hijos) return false;
  const candidatoTiene = tieneHijos(candidato.hijos);
  if (pref === 'Prefiero que no tenga') return !candidatoTiene;
  if (pref === 'Prefiero que sí tenga') return candidatoTiene;
  return true;
}
export function hijosCompatibles(personaA, personaB) {
  return aceptaHijos(personaA, personaB) && aceptaHijos(personaB, personaA);
}
