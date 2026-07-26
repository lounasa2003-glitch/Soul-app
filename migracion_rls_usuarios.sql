-- NO CORRER TODAVIA -- primero hay que deployar el codigo que reenvia el
-- token propio o la service role key segun corresponda (lib/authUtil.js,
-- api/auth.js, api/citas.js, api/matches.js, api/guardar.js, api/leer.js,
-- api/calcularMatches.js, lib/cierreCita.js, lib/recordatorioIntake.js) y
-- confirmar que todo sigue funcionando igual con RLS todavia apagado.
--
-- Esta es la tabla mas critica de todas las migradas hasta ahora:
-- verificarUsuario() en lib/authUtil.js lee 'usuarios' por email en CADA
-- request autenticado -- si esta politica queda mal escrita, no es una fuga
-- de datos, es que nadie puede loguearse hasta revertir.
--
-- Una sola politica FOR ALL cubre los tres casos que necesita el dueño de la
-- fila: SELECT (USING), INSERT en el registro -- api/guardar.js ya manda
-- auth_id: usuario.authId en el insert (WITH CHECK), y UPDATE de los propios
-- datos (USING sobre la fila vieja + WITH CHECK sobre la fila nueva). Nunca
-- hay una politica para el rol 'anon' a proposito -- reenviarConfirmacion y
-- confirmarMail (api/auth.js) no tienen sesion todavia, y en vez de abrir un
-- hueco anon van con la service role key, que bypasea RLS siempre.
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY usuarios_propia_fila ON usuarios
  FOR ALL
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- Verificacion obligatoria despues de correr esto (la vez pasada con
-- 'matches' la politica se creo pero ENABLE ROW LEVEL SECURITY no habia
-- quedado activo, y no se noto hasta la prueba negativa):
-- select relrowsecurity from pg_class where relname = 'usuarios';
-- tiene que dar 'true'.

-- Prueba positiva: loguearse con una cuenta real (o qa-*@soul-app.test) y
-- confirmar que la app entra normal (login, ver perfil, editar datos).
-- Prueba negativa: con el token de sesion de una cuenta, pegarle directo a
-- Supabase (no a traves del codigo de la app) pidiendo la fila de OTRA
-- persona por id -- tiene que devolver 0 filas, nunca los datos ajenos.
-- IMPORTANTE: pegarle a https://www.soulapp.love directo (soulapp.love sin
-- www redirige y curl -L descarta el header Authorization en el salto).

-- Rollback si algo se rompe (login roto para todo el piloto -- maxima
-- prioridad, revertir esto antes que cualquier otra cosa):
-- DROP POLICY usuarios_propia_fila ON usuarios;
-- ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;
