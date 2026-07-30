// Edad minima para usar Soul -- requisito de las guias de ambas tiendas para
// una app de vinculos/citas, y coincide con la mayoria de edad en Argentina.
export const EDAD_MINIMA = 18;

const FECHA_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function esBisiesto(anio) {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

function diasEnMes(anio, mes) {
  return mes === 2 && esBisiesto(anio) ? 29 : DIAS_POR_MES[mes - 1];
}

// Parsea "YYYY-MM-DD" a mano, sin pasar nunca por new Date(fechaString) --
// ese constructor interpreta una fecha sin hora como medianoche UTC, y "hoy"
// se lee en la zona horaria local del proceso: si el servidor corriera en
// una zona detras de UTC, esa mezcla le suma un dia de mas a la fecha de
// nacimiento y puede computar como ya-18 a alguien que todavia es menor.
// Comparar unicamente los componentes enteros (anio/mes/dia) evita depender
// de cualquier zona horaria, tanto para parsear la fecha de nacimiento como
// para leer la fecha de hoy.
function parsearFecha(fechaStr) {
  if (typeof fechaStr !== 'string') return null;
  const m = FECHA_REGEX.exec(fechaStr);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > diasEnMes(anio, mes)) return null;
  return { anio, mes, dia };
}

function fechaHoy() {
  const hoy = new Date();
  return { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1, dia: hoy.getDate() };
}

function esFutura(fecha, hoy) {
  if (fecha.anio !== hoy.anio) return fecha.anio > hoy.anio;
  if (fecha.mes !== hoy.mes) return fecha.mes > hoy.mes;
  return fecha.dia > hoy.dia;
}

export function calcularEdad(fechaNacimiento) {
  const nacimiento = parsearFecha(fechaNacimiento);
  if (!nacimiento) return null;

  const hoy = fechaHoy();
  if (esFutura(nacimiento, hoy)) return null;

  let edad = hoy.anio - nacimiento.anio;
  const noCumplioAun = hoy.mes < nacimiento.mes ||
    (hoy.mes === nacimiento.mes && hoy.dia < nacimiento.dia);
  if (noCumplioAun) edad--;
  return edad;
}
