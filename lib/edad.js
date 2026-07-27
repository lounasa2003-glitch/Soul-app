// Edad minima para usar Soul -- requisito de las guias de ambas tiendas para
// una app de vinculos/citas, y coincide con la mayoria de edad en Argentina.
export const EDAD_MINIMA = 18;

export function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const nacimiento = new Date(fechaNacimiento);
  if (isNaN(nacimiento.getTime())) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const noCumplioAun = hoy.getMonth() < nacimiento.getMonth() ||
    (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate());
  if (noCumplioAun) edad--;
  return edad;
}
