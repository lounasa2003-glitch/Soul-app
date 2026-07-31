// Snapshot canonico de "la conclusion de Soul" (ver Pantalla B en soul.html,
// mostrarConclusionSoul) y su comparacion, compartidos entre el gate real
// del servidor (api/calcularMatches.js) y las funciones equivalentes del
// cliente (construirSnapshotConclusion/conclusionesIguales en soul.html --
// soul.html no puede importar este archivo, asi que esas dos DEBEN quedar
// sincronizadas a mano con las de aca; cualquier cambio a esta logica tiene
// que reflejarse tambien ahi).
//
// Campos incluidos -- los unicos que calcularMatches.js manda a Claude como
// señal real de compatibilidad (ver lib/comparePrompt.js): grupo1-4 (la
// sintesis interpretativa) e indice_disponibilidad (viven en 'perfiles'),
// mas no_negociables/negociables (texto declarado directo por la persona,
// viven en 'usuarios' -- por eso se reciben aparte, como datosUsuario).
// Nunca timestamps, plan, estado online, ni ninguna otra columna ajena a lo
// que realmente compara el matching.
export function construirSnapshotConclusion(perfil, datosUsuario) {
  perfil = perfil || {};
  datosUsuario = datosUsuario || {};
  return {
    grupo1: perfil.grupo1 ?? null,
    grupo2: perfil.grupo2 ?? null,
    grupo3: perfil.grupo3 ?? null,
    grupo4: perfil.grupo4 ?? null,
    indice_disponibilidad: perfil.indice_disponibilidad ?? (perfil.grupo4 && perfil.grupo4.indice_disponibilidad) ?? null,
    no_negociables: datosUsuario.no_negociables ?? null,
    negociables: datosUsuario.negociables ?? null
  };
}

// Comparacion profunda, campo por campo -- independiente del orden de
// claves (jsonb en Postgres no preserva el orden de insercion, asi que
// comparar JSON.stringify crudo daba falsos "cambio detectado" incluso sin
// ningun cambio real) y trata "clave ausente" igual que "null" en
// cualquier nivel de profundidad.
export function conclusionesIguales(a, b) {
  const na = a === undefined ? null : a;
  const nb = b === undefined ? null : b;
  if (na === nb) return true;
  if (na === null || nb === null) return false;
  if (typeof na !== 'object' || typeof nb !== 'object') return false;
  if (Array.isArray(na) || Array.isArray(nb)) {
    if (!Array.isArray(na) || !Array.isArray(nb)) return false;
    if (na.length !== nb.length) return false;
    return na.every((v, i) => conclusionesIguales(v, nb[i]));
  }
  const claves = new Set([...Object.keys(na), ...Object.keys(nb)]);
  for (const k of claves) {
    if (!conclusionesIguales(na[k], nb[k])) return false;
  }
  return true;
}
