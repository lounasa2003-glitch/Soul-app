# Hallazgos técnicos — Soul

> Agente 1 (Auditor técnico de datos). Estos son hallazgos **técnicos y verificables en el código**, no evaluaciones jurídicas ni recomendaciones de política legal (fuera del alcance de este encargo). Cada uno indica descripción, evidencia, impacto técnico, estado y qué información falta para cerrarlo. Varios de estos hallazgos coinciden en el fondo con los de `auditoria-privacidad-seguridad.md` (documento previo, de alcance más amplio) — acá se reportan de forma independiente, verificados directamente contra el código durante esta auditoría, con foco estricto en tratamiento de datos.

---

### H1 — Sin verificación de edad mínima en el registro

**Descripción**: Ningún punto del código (cliente o servidor) valida que la fecha de nacimiento ingresada corresponda a una persona mayor de edad. El input es un `<input type="date">` sin atributo `max`, y la única validación, tanto en cliente como en servidor, es que el campo no esté vacío.

**Evidencia**: `soul.html:721` (input sin `max`), `soul.html:3633` (`if(s===0)ok=!!document.getElementById('fnac').value` — solo chequea presencia), `api/guardar.js:47-58` (`CAMPOS_BASICOS_REQUERIDOS`/`campoLleno()` no validan rango de edad).

**Impacto técnico**: Una fecha de nacimiento que implique cualquier edad (incluida una persona menor de edad) pasa la validación de intake y permite completar el perfil, aparecer en matching y llegar a un encuentro con otra persona real.

**Estado**: Confirmado en el código actual.

**Información pendiente**: Ninguna — es directamente verificable. (No se evalúa acá si corresponde agregar una validación; eso excede el alcance de esta auditoría.)

---

### H2 — El documento de consentimiento que se acepta en el flujo real es más corto que `legal.html`/`consentimiento.html`, y no enlaza a ellos

**Descripción**: `soul.html` embebe su propio texto de "Términos y condiciones" dentro del modal de consentimiento (`#con-c2`/`#legalBox`), con 8 secciones. `legal.html` y `consentimiento.html` tienen 9 secciones y contenido adicional. Comparando ambos, el texto que efectivamente se acepta en el registro **no incluye**: identidad y contacto del responsable del tratamiento, base legal del tratamiento, la sección específica de "Datos sensibles" (aparece como sección 2 en `legal.html`, ausente por completo en el texto embebido), transferencias internacionales de datos, aviso de incidentes de seguridad, y 3 de los 6 derechos listados en `legal.html` (portabilidad de datos y reclamo ante la AAIP no aparecen en el listado embebido). Tampoco hay, dentro del modal de consentimiento, ningún link hacia `/legal.html` para leer el documento completo.

**Evidencia**: comparación directa `soul.html:643-668` vs. `legal.html:40-104` y `consentimiento.html:113-177`. Búsqueda de referencias: `grep "consentimiento.html"` en todo el repo solo encuentra menciones en `docs/` y en un comentario de una migración SQL, nunca un enlace real (`migracion_rls_cita_reflexiones.sql:8`); `grep "legal.html"` en archivos HTML solo encuentra el link en `index.html:209-210` (footer de la landing pública, no del flujo de alta).

**Impacto técnico**: El texto que la persona usuaria efectivamente scrollea y acepta (gate técnico: `scrollOk`/`mainOk` en `soul.html:3608-3624`) es un subconjunto del documento más completo que la app referencia como su política "oficial" en otros lugares (`index.html`).

**Estado**: Confirmado en el código actual.

**Información pendiente**: Ninguna para el hecho técnico en sí. Si esta diferencia de contenido es o no relevante para la validez del consentimiento es una evaluación jurídica, fuera del alcance de este documento.

---

### H3 — El checkbox "opcional" de datos anonimizados no se persiste en ningún lugar

**Descripción**: En el modal de consentimiento de `soul.html`, el checkbox opcional ("Acepto contribuir con datos anonimizados") solo alterna una clase CSS al hacer clic — no tiene ninguna variable JS asociada (a diferencia del checkbox principal, que sí usa `mainOk`), nunca se lee su estado, y nunca viaja al backend.

**Evidencia**: `soul.html:675-678` (definición del checkbox, `onclick="this.classList.toggle('on')"`); búsqueda de `chkOpt`/`optOk` en todo `soul.html` devuelve un único resultado (la propia definición del elemento, línea 675) — ninguna otra referencia en el archivo; `soul.html:2024` (`consentimiento_aceptado: mainOk`) no incluye ningún campo derivado del checkbox opcional. La tabla `usuarios` tampoco tiene, en las migraciones revisadas, una columna que registre este consentimiento opcional por separado.

**Impacto técnico**: No existe ningún registro, en base de datos, de si una persona marcó o no ese checkbox — el estado se pierde apenas se recarga o avanza la pantalla.

**Estado**: Confirmado en el código actual.

**Información pendiente**: Ninguna.

---

### H4 — El resumen objetivo de cita (uso exclusivo admin) se genera sin chequear el consentimiento de análisis, a diferencia de los otros dos análisis de la misma cita

**Descripción**: De las tres inferencias que Soul genera a partir de la transcripción real de una cita, dos (`DINAMICA_RELACIONAL_PROMPT` y `PERFIL_Y_COMPATIBILIDAD_CITA_PROMPT`, en `api/citas.js`) verifican explícitamente `cita.consiente_analisis_a === true && cita.consiente_analisis_b === true` antes de llamar a Anthropic. La tercera, `RESUMEN_CITA_PROMPT` (`lib/cierreCita.js`), se dispara **siempre** que hay transcripción, desde `finalizarCita()` — llamada tanto en el cierre manual como en el cierre automático por inactividad y en el cierre forzado por la administradora — sin ningún chequeo de esos mismos campos.

**Evidencia**: `api/citas.js:766-770` (`if (cita.consiente_analisis_a !== true || cita.consiente_analisis_b !== true) return null;`) y `api/citas.js:826-828` (mismo chequeo), contra `lib/cierreCita.js:30-62` (`generarResumenCitaEnSegundoPlano`, sin ningún chequeo equivalente) y `lib/cierreCita.js:67-78` (`finalizarCita`, que la llama incondicionalmente en la línea 78).

**Impacto técnico**: El resumen que lee la administradora sobre una cita (`citas.resumen_ia`) se genera y persiste con o sin el consentimiento de análisis de las personas, mientras que las otras dos inferencias sobre la misma transcripción respetan ese consentimiento.

**Estado**: Confirmado en el código actual.

**Información pendiente**: Ninguna para el hecho técnico. Si esto es o no consistente con lo prometido en `legal.html`/`consentimiento.html` es una evaluación fuera de alcance.

---

### H5 — Varias tablas con datos personales no tienen archivo de migración de RLS en el repo

**Descripción**: El repo incluye migraciones `migracion_rls_*.sql` para: `usuarios`, `perfiles`, `conversaciones`, `matches`, `citas`, `cita_mensajes`, `cita_reflexiones`, `cita_ayudas`, `feedback_piloto`, `reportes`, `reportes_tecnicos`, `intentos_fuga_prompt`. **No existe** en el repo ninguna migración equivalente para `historial_relacional`, `rate_limits`, `uso_tokens`, `eventos_piloto`, `errores_silenciosos` ni `diagnosticos_diarios`. De estas, al menos dos contienen dato personal identificable: `historial_relacional` (señales de dinámica vincular ligadas a `usuario_id`, ver `api/citas.js:801-809`) y `rate_limits` (clave `email`, usada para todo el rate limiting de la app, ver `lib/rateLimit.js:18`).

**Evidencia**: listado completo de `migracion_*.sql` en la raíz del repo (`Bash: find`, ejecutado durante esta auditoría); `api/citas.js:801-809` (insert a `historial_relacional` usando las cabeceras anon que llegan por parámetro, no el token propio ni la service role key); `lib/rateLimit.js:12-50`.

**Impacto técnico**: Si estas tablas no tienen RLS activado en la base real (no verificable desde el repo, ver más abajo), cualquier llamada hecha con el anon key —incluida la que ya hace el propio código en `api/citas.js:801-809`— puede leer o escribir filas de cualquier persona en esas tablas, no solo las propias.

**Estado**: Confirmado que faltan las migraciones en el repo. El estado real de RLS en la base de producción **no es verificable desde el código**.

**Información pendiente**: **PENDIENTE DE CONFIRMAR** si estas tablas tienen RLS activado directamente en el panel de Supabase (fuera de las migraciones versionadas en este repo) o si de verdad están sin protección.

---

### H6 — La política RLS de `reportes_tecnicos` permite leer cualquier fila con `usuario_id IS NULL`, sin importar quién pregunta

**Descripción**: La política `reportes_tecnicos_propio` (`FOR ALL USING (usuario_id IS NULL OR usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid()))`) fue escrita así a propósito para permitir el caso de `reportarProblema` en `api/auth.js`, que escribe **antes** de que exista sesión (con `usuario_id: null`). Pero la misma condición `usuario_id IS NULL` en el `USING` (parte de lectura) no distingue quién pregunta: cualquier request contra PostgREST que posea el anon key puede leer **todas** las filas de `reportes_tecnicos` con `usuario_id` nulo (que incluyen `contexto` y, opcionalmente, `email`), no solo la propia.

**Evidencia**: `migracion_rls_reportes_tecnicos.sql:9-18`; `api/auth.js:47-60` (`reportarProblema`, siempre escribe con `usuario_id: null` y con el anon key, nunca con un token propio).

**Impacto técnico**: Cualquier poseedor del anon key de Supabase podría, en teoría, listar todos los reportes técnicos enviados sin sesión (potencialmente con email). Se verificó específicamente que el anon key **no está embebido en ningún archivo cliente de este repo** (`soul.html`, `soul-app-native/www/index.html`) — todo el tráfico del navegador pasa por los endpoints propios de Soul (`/api/*`), que mantienen el anon key solo en el entorno serverless. La explotabilidad real depende entonces de si el anon key está expuesto por algún otro medio no verificable desde acá.

**Estado**: Confirmado el diseño de la política. No confirmado ningún vector de exposición real del anon key en este repo.

**Información pendiente**: **PENDIENTE DE CONFIRMAR** si el anon key de este proyecto está expuesto por algún canal fuera del código revisado (paneles públicos, otro cliente, logs).

---

### H7 — Varias tablas con contenido personal no están en la lista de purga del cron de borrado

**Descripción**: El cron diario (`purgarUsuario` en `api/cron/diagnostico-diario.js`) borra (`DELETE`) únicamente las filas de `perfiles`, `conversaciones`, `historial_relacional` e `intentos_fuga_prompt` (constante `TABLAS_PERSONALES_A_BORRAR`), y anonimiza la fila de `usuarios`. Las siguientes tablas, que también contienen contenido ligado a `usuario_id`, no aparecen en esa lista ni se tocan en ningún otro punto del código de borrado revisado: `cita_reflexiones` (debriefing privado, contenido real de la reflexión), `cita_ayudas`, `reportes`, `reportes_tecnicos`, `feedback_piloto`, `errores_silenciosos`, `diagnosticos_diarios`.

**Evidencia**: `api/cron/diagnostico-diario.js:37-45` (`TABLAS_PERSONALES_A_BORRAR`, con el comentario explícito de por qué se excluyen `cita_mensajes`/`matches`/`citas`, pero sin mención de las siete tablas listadas arriba).

**Impacto técnico**: Contenido personal en esas siete tablas permanece en la base indefinidamente después de que una cuenta se anonimiza a los 30 días, mientras siga existiendo el `usuario_id` que las referencia (o incluso después, como fila huérfana).

**Estado**: Confirmado en el código actual.

**Información pendiente**: **PENDIENTE DE CONFIRMAR** si esta exclusión es una decisión de diseño ya evaluada (como sí está documentada explícitamente para `cita_mensajes`/`matches`/`citas`, por ser contenido compartido con otra persona) o un vacío no cubierto todavía — para las siete tablas de esta lista el código no incluye ningún comentario que explique la exclusión, a diferencia de las tablas compartidas.

---

### H8 — El contenido compartido con otra persona (`cita_mensajes`, `matches`, `citas`) nunca se borra, por diseño

**Descripción**: A diferencia del hallazgo anterior, esta exclusión sí está documentada explícitamente en el código: borrar por completo estas tablas destruiría el registro de la otra persona de un vínculo real que no pidió el borrado. En su lugar, la fila de `usuarios` se anonimiza (nombre, email, fecha de nacimiento, fotos → null) pero sigue existiendo como referencia para las filas de `matches`/`citas`/`cita_mensajes` que la otra persona todavía puede ver.

**Evidencia**: `api/cron/diagnostico-diario.js:37-45` (comentario explícito), `api/cron/diagnostico-diario.js:105-119` (anonimización in-place).

**Impacto técnico**: El contenido de una conversación (`cita_mensajes`) y los datos de compatibilidad (`matches`) de una persona que eliminó su cuenta permanecen indefinidamente en la base, visibles para la otra parte del vínculo y para la administradora, aunque la fila de `usuarios` ya esté anonimizada.

**Estado**: Confirmado como comportamiento intencional y documentado en el propio código.

**Información pendiente**: Ninguna sobre el hecho técnico. Se incluye acá porque es directamente relevante para entender el alcance real de "tus datos se borran a los 30 días" frente a lo que el código efectivamente hace — sin evaluar si eso es o no correcto/suficiente, lo cual excede este encargo.

---

### H9 — `SUPABASE_SERVICE_ROLE_KEY` ausente en `.env.local`; el borrado de la identidad de Auth depende de esa variable

**Descripción**: El propio código de `purgarUsuario()` advierte explícitamente que, sin `SUPABASE_SERVICE_ROLE_KEY` configurada, "los datos de la app se borraron pero el usuario sigue existiendo en Supabase Auth" (es decir, técnicamente podría seguir iniciando sesión con ese email/contraseña, aunque ya no tenga ninguna fila de datos accesible). Este archivo local (`.env.local`) solo tiene `SUPABASE_URL` y `SUPABASE_ANON_KEY` — no `SUPABASE_SERVICE_ROLE_KEY`.

**Evidencia**: `api/cron/diagnostico-diario.js:74-103` (lógica condicionada a `serviceKey`), `api/cron/diagnostico-diario.js:299-300` (el propio diagnóstico diario lo señala como advertencia visible para la administradora: "⚠ Falta SUPABASE_SERVICE_ROLE_KEY..."); `.env.local` (solo nombres verificados, valores no reproducidos por la regla 7 de este encargo).

**Impacto técnico**: Si esta variable tampoco está configurada en el entorno de producción de Vercel, el borrado de cuenta nunca elimina la credencial real de acceso (Supabase Auth), solo los datos de aplicación.

**Estado**: Confirmado que la variable no está en el `.env.local` de este checkout local.

**Información pendiente**: **PENDIENTE DE CONFIRMAR** si `SUPABASE_SERVICE_ROLE_KEY` está configurada en las variables de entorno de producción de Vercel — no accesible desde este repo.

---

## Checklist de cobertura de esta auditoría

- [x] Revisadas todas las tablas identificadas en el código y las migraciones (`usuarios`, `perfiles`, `conversaciones`, `matches`, `citas`, `cita_mensajes`, `cita_reflexiones`, `cita_ayudas`, `feedback_piloto`, `reportes`, `reportes_tecnicos`, `intentos_fuga_prompt`, `rate_limits`, `uso_tokens`, `eventos_piloto`, `errores_silenciosos`, `diagnosticos_diarios`, `historial_relacional`).
- [x] Revisados los buckets de almacenamiento — **no existe ninguno**: las fotos se guardan como base64 embebido en `usuarios.foto_cara`/`foto_cuerpo` (`api/guardar.js:32-36`, `migracion_*` no crean ningún bucket, no se encontró referencia a Supabase Storage en el código).
- [x] Revisados todos los prompts y llamadas de IA (`lib/anthropicClient.js` y los 11 prompts distintos identificados en `api/*.js`/`lib/*.js`).
- [x] Identificados SDKs y analítica — ninguno encontrado salvo Google Fonts (ver `proveedores.md`); sin Google Analytics/Meta Pixel/Sentry/Mixpanel/etc.
- [x] Identificados logs con datos personales (`errores_silenciosos`, `diagnosticos_diarios`, `intentos_fuga_prompt`).
- [x] Identificados datos sensibles (ver `inventario-datos.md`, columna "Sensible").
- [x] Identificadas las inferencias de IA (ver `inferencias-ia.md`).
- [x] Identificadas las transferencias a terceros (ver `proveedores.md`).
- [x] Marcado explícitamente todo dato no confirmado (`PENDIENTE DE CONFIRMAR` en cada archivo).
- [x] No se modificó ningún archivo de código durante esta auditoría.
