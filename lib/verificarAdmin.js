// Gate simple de admin -- una sola contraseña compartida via variable de
// entorno, sin usuario/rol en la base. Suficiente para una sola persona
// administradora; si en algun momento hay mas de una, esto se puede
// reemplazar por un flag real en 'usuarios' sin tocar los endpoints que
// ya la usan.
export function verificarAdmin(req) {
  const esperado = process.env.ADMIN_PASSWORD;
  if (!esperado) return false;
  const recibido = req.headers['x-admin-password'];
  return recibido === esperado;
}
