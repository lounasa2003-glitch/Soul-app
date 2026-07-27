# Auditoría de privacidad y seguridad — Soul

> Basado en `docs/privacy-launch/00-contexto/brief-soul.md` y en una lectura directa adicional del código fuente de `Soul-app` y `soul-app-native` (2026-07-27). No se modificó ningún archivo de código. Todo hallazgo cita el archivo/línea/comentario concreto que lo sostiene; donde no hay evidencia directa en el repo, se marca **"Pendiente de confirmar"** en vez de asumirse.

## Resumen ejecutivo (críticos y altos primero)

| # | Hallazgo | Nivel |
|---|---|---|
| C1 | No existe ninguna verificación de edad mínima (18+) en registro/perfil, ni en el código ni en el texto legal | **Crítico** |
| C2 | El consentimiento que realmente se muestra y se acepta dentro de `soul.html` es un texto abreviado que omite secciones legalmente relevantes presentes en `legal.html`/`consentimiento.html` | **Crítico** |
| C3 | El checkbox de consentimiento "opcional" no persiste en ningún lado; las comunicaciones "fuera de la plataforma" se envían sin ningún gate de consentimiento | **Crítico** |
| C4 | El resumen automático de cada cita se manda a Anthropic sin chequear el consentimiento de análisis (`consiente_analisis_a/b`), a diferencia de los otros dos análisis de la misma cita | **Crítico** |
| H1 | El rate limit/lockout por IP (incluido el bloqueo de fuerza bruta de la contraseña de administración) es evadible falsificando `X-Forwarded-For` | **Alto** |
| H2 | El panel de administración depende de una única contraseña compartida, sin 2FA, cuyo único freno de fuerza bruta es el mecanismo evadible de H1 | **Alto** |
| H3 | Varias tablas con datos personales reales no tienen RLS activado; su única protección es que la anon key nunca llegue al cliente | **Alto** |

El resto de los hallazgos (medios y bajos) está detallado en las secciones siguientes, organizadas por el mismo temario pedido.

---

## 1. Privacidad y tratamiento de datos personales

### 1.1 — No hay verificación de edad mínima
- **Descripción**: Soul es una plataforma de vínculos/citas entre personas reales, pero en ningún punto del código (cliente o servidor) se valida que quien se registra sea mayor de edad. El campo de fecha de nacimiento es un `<input type="date">` sin atributo `max`, y la única validación es que tenga algún valor.
- **Evidencia**: `soul.html:721` (`<input class="step-in" type="date" id="fnac" onchange="chkStep(0)" oninput="chkStep(0)">`), `soul.html:3633` (`if(s===0)ok=!!document.getElementById('fnac').value;` — solo chequea que no esté vacío). `api/guardar.js` (`CAMPOS_BASICOS_REQUERIDOS`, `campoLleno()`) tampoco valida rango de edad al aceptar `fecha_nacimiento`. Tampoco se encontró ninguna mención de edad mínima en `legal.html` ni `consentimiento.html`.
- **Nivel**: **Crítico**.
- **Impacto**: Riesgo de seguridad infantil real (una persona menor de edad puede completar el onboarding, subir fotos, conversar con la IA y llegar a un encuentro con un adulto real sin ningún control). Es también uno de los motivos más comunes de rechazo/baja de apps de citas en Google Play (política de Contenido restringido / Menores, y requisitos específicos para apps de citas).
- **Corrección recomendada**: Agregar validación de edad mínima (18 años) tanto en el cliente (bloquear el paso del formulario) como, de forma obligatoria, en el servidor (`api/guardar.js`, mismo lugar que `basicosCompletos()`), y declarar explícitamente la política de edad mínima en los documentos legales.

### 1.2 — Retención real de la conversación con Soul y del contenido de la cita
- **Descripción**: El historial completo de la conversación con Soul (`conversaciones`) y los mensajes de la Sala de Encuentros (`cita_mensajes`) se guardan indefinidamente mientras la cuenta esté activa, sin límite de tiempo ni de tamaño, más allá del borrado a 30 días tras solicitar la eliminación de cuenta.
- **Evidencia**: `api/guardar.js` (upsert en `conversaciones`), `api/citas.js` (`enviarMensaje`), ausencia de cualquier rutina de expurgo periódico salvo `api/cron/diagnostico-diario.js` (que solo actúa sobre cuentas con borrado solicitado).
- **Nivel**: Medio.
- **Impacto**: Mayor superficie de exposición ante cualquier incidente de seguridad futuro (más datos vivos, más tiempo).
- **Corrección recomendada**: Definir y documentar una política de retención con límite temporal para conversaciones/mensajes, no solo "mientras la cuenta esté activa".

### 1.3 — "Análisis externo": conversación de un tercero pegada por la persona usuaria
- **Descripción**: `api/analisisExterno.js` procesa texto que la persona usuaria pega de una conversación mantenida fuera de la plataforma con otra persona (no usuaria de Soul), y ese texto se envía a Anthropic y puede quedar reflejado en el perfil derivado. Esa tercera persona nunca dio consentimiento ni es notificada.
- **Evidencia**: `api/analisisExterno.js` (`EXTRACT_PROMPT`, recibe `conversacion` libre desde el body sin ninguna validación de que sea "propia").
- **Nivel**: Medio.
- **Impacto**: Se procesan datos personales (posiblemente sensibles, ver sección 2) de una persona ajena a la plataforma, sin base legal propia respecto de ella.
- **Corrección recomendada**: Advertir explícitamente en la UI que la persona usuaria es responsable de no incluir datos identificables de terceros, y evaluar si corresponde una base legal/aviso específico para este flujo en el documento de privacidad.

---

## 2. Datos sensibles

### 2.1 — El aviso de "datos sensibles" es más angosto que lo que la conversación puede capturar
- **Descripción**: `legal.html`/`consentimiento.html` (sección 2) reconocen como dato sensible únicamente "orientación" y "vida íntima". Pero el chat libre con Soul y los campos de texto libre (`no_negociables`, `negociables`) no tienen ninguna restricción de contenido — pueden capturar salud (física o mental), creencias religiosas, opiniones políticas u otra categoría especial de dato sin que el aviso legal lo mencione.
- **Evidencia**: `api/analisisExterno.js` (`EXTRACT_PROMPT`, sin ninguna instrucción de excluir categorías especiales de dato más allá de vínculo/orientación), `api/guardar.js` (`no_negociables`/`negociables` como texto libre sin validación de contenido), `legal.html` sección 2 (texto acotado a "orientación"/"vida íntima").
- **Nivel**: Medio.
- **Impacto**: Posible brecha entre lo declarado (base legal/alcance del tratamiento de datos sensibles) y lo efectivamente recolectado.
- **Corrección recomendada**: Ampliar el texto legal para cubrir cualquier categoría especial de dato que pueda surgir de una conversación abierta, o acotar técnicamente qué puede capturarse.

### 2.2 — El perfil psicológico (grupo1-4) sí está bien resguardado del otro match
- **Descripción**: Se verificó positivamente que `curarMatch`/`curarCita` (`api/matches.js`, `api/citas.js`) excluyen explícitamente el perfil psicológico y los campos de análisis privados al enviar datos al navegador de la otra persona del match.
- **Evidencia**: `CAMPOS_MATCH_CLIENTE` (`api/matches.js:36-40`), `CAMPOS_CITA_CLIENTE` (`api/citas.js:40-45`), con comentario explícito documentando una fuga real corregida ("antes de esto, el spread de la fila completa mandaba insights_debriefing_b...").
- **Nivel**: Informativo (no es un hallazgo negativo, se incluye porque estaba dentro del alcance pedido — "Datos sensibles").

---

## 3. Consentimiento

### 3.1 — `consentimiento.html` es un archivo huérfano; el flujo real usa un texto abreviado dentro de `soul.html`
- **Descripción**: El documento completo (`consentimiento.html`) no está enlazado desde ningún otro archivo del proyecto (ni `soul.html`, ni `index.html`, ni ningún `.js`) — solo aparece en el índice de git. El flujo de consentimiento que efectivamente corre en producción está **embebido dentro de `soul.html`** (bloque `#con-c2` / `#legalBox`), con un texto **materialmente más corto** que `legal.html`. Comparando ambos documentos, faltan en la versión que el usuario realmente lee y acepta:
  - Identidad del responsable del tratamiento y contacto (`legal.html` sección 7: "Lourdes Satragno, CABA, Argentina, contacto@soulapp.love").
  - Base legal del tratamiento.
  - La sección específica de "Datos sensibles" (orientación/vida íntima) que sí está en `legal.html` sección 2 — en `soul.html` esa idea no aparece en ningún punto del texto embebido.
  - Transferencias internacionales de datos (Supabase/Anthropic fuera de Argentina, incluido EE.UU.).
  - Compromiso de aviso ante incidentes de seguridad.
  - Derecho a portabilidad de datos y derecho a reclamo ante la AAIP (Agencia de Acceso a la Información Pública) — el listado embebido en `soul.html` tiene solo 3 derechos contra los 6 de `legal.html`.
  - Tampoco hay, dentro del modal de consentimiento de `soul.html`, ningún link hacia `/legal.html` para leer el documento completo — el único link a `/legal.html` en toda la app está en el footer de `index.html`, la landing pública, no en el flujo de alta.
- **Evidencia**: Comparación directa `soul.html:639-689` vs. `legal.html:1-110` y `consentimiento.html:1-286`; búsqueda de referencias (`grep -rn "consentimiento.html"` y `grep -n "legal.html" soul.html`) sin resultados de enlace real dentro del flujo de registro.
- **Nivel**: **Crítico**.
- **Impacto**: La persona usuaria nunca ve ni acepta el documento legal completo que la plataforma exhibe como su política de privacidad "oficial" — esto compromete la validez del consentimiento informado exigido por la normativa de protección de datos (y por las políticas de datos de Google Play), y deja a Soul sin evidencia de que la persona conoció puntos clave como quién es el responsable del tratamiento o que sus datos pueden salir de Argentina.
- **Corrección recomendada**: Unificar en una sola fuente de verdad el texto legal (idealmente que `soul.html` cargue/enlace el mismo documento que `legal.html`, no una copia paralela), incluir las secciones faltantes en la versión que se acepta, o linkear el documento completo desde el modal de consentimiento antes de habilitar el botón de aceptar.

### 3.2 — El consentimiento "opcional" no se guarda en ningún lado
- **Descripción**: En el modal de consentimiento real (`soul.html`), el checkbox opcional ("Acepto contribuir con datos anonimizados (opcional)") solo alterna una clase CSS al hacer clic (`onclick="this.classList.toggle('on')"`) — no existe ninguna variable JS asociada (a diferencia de `mainOk` para el checkbox principal), nunca se lee su estado, y nunca se envía al backend. El objeto que sí se persiste (`api/guardar.js`, campo `consentimiento_aceptado`) solo refleja el checkbox obligatorio.
- **Evidencia**: `soul.html:675-677` (`<div class="check-row" id="chkOpt" onclick="this.classList.toggle('on')">`), ausencia total de `chkOpt`/`optOk` en cualquier otra parte de `soul.html` (`grep -n "chkOpt|optOk" soul.html` → un solo resultado, la propia definición del checkbox), `soul.html:2024` (`consentimiento_aceptado: mainOk` — no incluye ningún campo del checkbox opcional).
- **Nivel**: **Crítico**.
- **Impacto**: Es imposible saber, para cualquier persona usuaria, si efectivamente aceptó u optó por no participar de "contribuir con datos anonimizados" o "recibir comunicaciones fuera de la plataforma" — el sistema no tiene ese dato en ningún lado. Además, como se detalla en 3.3, esto no es solo un problema de registro: las comunicaciones que la propia plataforma describe como "opcionales" se envían igual.
- **Corrección recomendada**: Persistir el estado real del checkbox opcional (columna propia en `usuarios`, con marca de tiempo) y usarlo efectivamente para gatear cualquier función que dependa de él.

### 3.3 — Las "comunicaciones fuera de la plataforma" se envían sin ningún control de consentimiento
- **Descripción**: Todas las funciones de `lib/email.js` que notifican eventos de producto (nuevo match, encuentro pendiente, match sin decisión, cita sin mensaje, mensaje nuevo en la cita) se disparan incondicionalmente desde `api/admin/matches.js`, `api/matches.js`, `api/citas.js` y `lib/recordatorioMatches.js`, sin verificar ningún flag de consentimiento — lo cual es consistente con el hallazgo 3.2 (ese flag no existe en ningún lado para consultar).
- **Evidencia**: `lib/email.js` (`notificarNuevoMatch`, `notificarSalaEncuentrosPendiente`, `notificarMatchSinDecision`, `notificarCitaSinMensaje`, `notificarMensajeCita`) — ninguna de estas funciones ni sus invocadores consulta un campo de "acepta comunicaciones".
- **Nivel**: **Crítico** (consecuencia directa de 3.2).
- **Impacto**: Contradice el texto legal, que presenta "recibir comunicaciones fuera de la plataforma" como una función opcional, activable/desactivable "en cualquier momento desde tu perfil" — esa opción no existe ni en el consentimiento inicial ni en la pantalla de perfil.
- **Corrección recomendada**: Diferenciar comunicaciones transaccionales indispensables (confirmación de cuenta, recuperación de contraseña) de comunicaciones de producto/engagement (avisos de match, recordatorios), y gatear estas últimas con el consentimiento real de 3.2, exponiendo además un toggle real en "Mi perfil".

### 3.4 — El consentimiento no queda versionado ni con fecha
- **Descripción**: `consentimiento_aceptado` es un booleano simple; no se guarda cuándo se aceptó ni qué versión del texto legal se aceptó.
- **Evidencia**: `api/guardar.js:57` (`datos.consentimiento_aceptado === true`), sin columna de fecha/versión en ninguna llamada relacionada.
- **Nivel**: Medio.
- **Impacto**: Si el texto legal cambia en el futuro, no hay forma de saber qué versión aceptó cada persona, ni de exigir re-consentimiento ante cambios materiales.
- **Corrección recomendada**: Guardar fecha de aceptación y un identificador de versión del documento aceptado.

---

## 4. Registro, autenticación y recuperación de cuenta

### 4.1 — Se puede registrar y usar la app con un email que no se controla
- **Descripción**: Con "Confirm email" desactivado en Supabase (según el propio comentario del código), el registro entrega sesión inmediata sin probar titularidad del email. El gate propio (`mail_confirmado`) solo se exige antes de decidir sobre un match o calcular matches — **no** antes de completar todo el onboarding (fotos, datos personales) ni antes de sostener una conversación completa con la IA.
- **Evidencia**: `lib/email.js:60-68` ("Con 'Confirm email' apagado del lado de Supabase... la cuenta queda marcada como confirmada ahí mismo en el momento del alta, sin importar si la persona tocó un link real"), `lib/authUtil.js` (`emailConfirmado` solo bloquea en `api/matches.js`/`api/calcularMatches.js`, no en `api/chat.js`/`api/guardar.js`).
- **Nivel**: Medio.
- **Impacto**: Alguien puede crear una cuenta con el email de otra persona real (sin que esa persona lo sepa ni lo autorice) y empezar a generar/almacenar datos personales y conversación con la IA bajo esa dirección, antes de que exista cualquier prueba de titularidad.
- **Corrección recomendada**: Evaluar exigir confirmación de email antes de habilitar el chat/onboarding completo, no solo antes de matchear con otra persona real.

### 4.2 — Comparación de secretos sin tiempo constante
- **Descripción**: `ADMIN_PASSWORD` y `CRON_SECRET` se comparan con operadores `===`/`!==` estándar de JavaScript, no con una comparación en tiempo constante.
- **Evidencia**: `lib/verificarAdmin.js:78` (`if (recibido === esperado) return true;`), `api/cron/diagnostico-diario.js:210` (`if (recibido !== secretoEsperado)`).
- **Nivel**: Bajo.
- **Impacto**: Teóricamente permite un ataque de timing para inferir el secreto carácter por carácter; en la práctica, la variabilidad de latencia de red hacia Vercel hace este ataque muy poco práctico, pero es una desviación de buena práctica estándar (`crypto.timingSafeEqual` o equivalente).
- **Corrección recomendada**: Usar comparación en tiempo constante para ambos secretos.

### 4.3 — Sesión solo en memoria (verificado, buena práctica)
- **Descripción**: El token de sesión no se persiste en `localStorage`/`sessionStorage`; vive solo en variables JS de la carga actual, y se fuerza recarga si el navegador restaura la página desde bfcache.
- **Evidencia**: `soul.html:2215-2225` (comentario explícito + `pageshow`/`e.persisted` → `location.reload()`).
- **Nivel**: Informativo — mitiga el impacto de un XSS (no hay token persistente que robar de storage), aunque tiene el costo de requerir login en cada carga nueva.

---

## 5. Supabase, RLS y permisos

### 5.1 — RLS activo y correctamente acotado en las tablas con dato personal directo
- **Descripción**: Se leyeron directamente las políticas SQL (no solo los comentarios) de las 11 tablas migradas: `usuarios`, `perfiles`, `conversaciones`, `matches`, `citas`, `cita_mensajes`, `cita_ayudas`, `cita_reflexiones`, `intentos_fuga_prompt`, `reportes`, `reportes_tecnicos`, `feedback_piloto`. Todas usan `FOR ALL USING (...) WITH CHECK (...)` acotado por `auth_id = auth.uid()` (directo o vía subconsulta a `usuarios`), sin ninguna política permisiva de más (`USING (true)`).
- **Evidencia**: Todos los `migracion_rls_*.sql` del repo.
- **Nivel**: Informativo (positivo).

### 5.2 — Tablas con dato personal real sin RLS
- **Descripción**: No se encontró migración de RLS para `rate_limits`, `uso_tokens`, `eventos_piloto`, `errores_silenciosos`, `diagnosticos_diarios` ni `historial_relacional`. Estas tablas no son alcanzables por los endpoints propios del cliente (`/api/leer`, `/api/guardar` solo permiten `usuarios, perfiles, conversaciones, matches, feedback_piloto, reportes_tecnicos` vía `TABLAS_PERMITIDAS` en `lib/authUtil.js`), pero si la `SUPABASE_ANON_KEY` alguna vez se filtrara (log, error mal armado, variable de entorno expuesta por error), cualquiera podría leer/escribir esas tablas directamente contra la API pública de Supabase (`https://<proyecto>.supabase.co/rest/v1/<tabla>`) sin ninguna restricción de fila. En particular:
  - `diagnosticos_diarios.texto_resumen` contiene nombres y emails reales de personas del piloto (generado por el propio cron, ver `api/cron/diagnostico-diario.js`).
  - `rate_limits` usa el email como clave (`email=eq....`), quedando una tabla de emails reales sin RLS.
  - `errores_silenciosos` guarda mensajes de error (con redacción de secretos conocidos, pero no necesariamente de otros datos personales que pudieran aparecer en un `meta`).
- **Evidencia**: Ausencia de archivos `migracion_rls_rate_limits.sql`, `migracion_rls_uso_tokens.sql`, etc. (no existen en el repo); confirmado que `SUPABASE_ANON_KEY`/`SUPABASE_URL` no aparecen en ningún archivo servido al cliente (`grep -i supabase soul.html panel-admin.html index.html` solo devuelve comentarios, nunca la key real).
- **Nivel**: **Alto**.
- **Impacto**: Hoy la única barrera para estas tablas es que la anon key nunca llegue al navegador — no hay una segunda capa de defensa (RLS) si eso falla.
- **Corrección recomendada**: Agregar RLS también a estas tablas (aunque sea una política restrictiva "solo service_role", ya que hoy dependen 100% del server-side) para tener defensa en profundidad real, siguiendo el mismo patrón ya usado en el resto del proyecto.

### 5.3 — Lógica de autorización a nivel de aplicación con "código muerto" potencialmente peligroso si RLS se desactivara
- **Descripción**: `filtroDeLecturaValido` (`lib/authUtil.js`) permite explícitamente un filtro `neq` sobre `perfiles` (pensado para "todos los perfiles menos el mío"), usado hoy únicamente por el motor de matching con la service role key — nunca por el cliente vía `/api/leer`. La política RLS real de `perfiles` (`usuario_id IN (SELECT id FROM usuarios WHERE auth_id = auth.uid())`) hace que, aunque alguien llame directo a `/api/leer?tabla=perfiles&filtro=usuario_id=neq.<miId>` con su propio token, Postgres solo devuelva su propia fila igual (la RLS y el filtro se intersectan), por lo que hoy **no es explotable**.
- **Evidencia**: `lib/authUtil.js:150-151` (`if (operador === 'neq') return tabla === 'perfiles' && valor === usuario.usuarioId;`), `migracion_rls_perfiles.sql` (política `USING`/`WITH CHECK` estrictamente propia).
- **Nivel**: Bajo (hoy) / **Alto si alguna vez se relaja RLS de `perfiles`** sin notar esta permisividad a nivel de aplicación.
- **Impacto**: Es una capa de autorización a nivel de aplicación más permisiva de lo necesario, que solo es inocua porque otra capa (RLS) la compensa. Si algún día se corrige/regresa RLS de `perfiles` sin revisar este archivo, cualquier cuenta autenticada podría leer el perfil psicológico completo (grupo1-4) de todas las demás personas.
- **Corrección recomendada**: Restringir `filtroDeLecturaValido` para `perfiles` a únicamente `eq` sobre el propio id (el `neq` de matching ya no pasa por acá, usa la service role key directo), eliminando la permisividad innecesaria.

### 5.4 — Fotos embebidas en la tabla, no en un storage con URLs firmadas
- **Descripción**: Ver detalle en sección 7. Se menciona acá porque es también un tema de "permisos": cualquier lectura de la fila de `usuarios` (incluida cualquier consulta con service role key, o cualquier fuga futura de esa key) devuelve el binario completo de la foto, no una referencia revocable.
- **Nivel**: Medio (cruzado con sección 7).

---

## 6. Uso de Anthropic y envío de datos a IA

### 6.1 — El resumen de la cita (`resumen_ia`) ignora el consentimiento de análisis
- **Descripción**: `generarResumenCitaEnSegundoPlano` (`lib/cierreCita.js`) arma el transcript completo de `cita_mensajes` y lo manda a Claude para generar un resumen destinado al panel admin, **sin verificar `cita.consiente_analisis_a`/`consiente_analisis_b`**. Se dispara siempre que se cierra una cita (`finalizarCita`), incluyendo cierre manual, cierre por inactividad (24hs) y cierre por borrado de cuenta. En cambio, los otros dos análisis que corren sobre la misma transcripción — `extraerDinamicaRelacionalEnSegundoPlano` y `extraerPerfilYCompatibilidadEnSegundoPlano` (ambos en `api/citas.js`) — sí verifican explícitamente `if (cita.consiente_analisis_a !== true || cita.consiente_analisis_b !== true) return null;` antes de llamar a Claude.
- **Evidencia**: `lib/cierreCita.js:30-62` (función `generarResumenCitaEnSegundoPlano`, sin ningún chequeo de consentimiento) vs. `api/citas.js:770` y `api/citas.js:828` (mismo chequeo presente en los otros dos análisis). El propio comentario de `api/citas.js:688-691` dice que la extracción de dinámica relacional "SOLO se dispara si las dos personas dieron su consentimiento explícito"; el resumen de cierreCita.js no respeta ese mismo criterio pese a operar sobre el mismo dato (la transcripción real de la cita).
- **Nivel**: **Crítico**.
- **Impacto**: Contradice el propio diseño de privacidad documentado en el código ("el default es siempre no-analizar, nunca al revés" — comentario en `api/citas.js:272`) y probablemente el espíritu de lo que la app comunica a la persona usuaria al pedirle ese consentimiento en la Sala de Encuentros (la persona puede razonablemente asumir que negarlo evita que su conversación se analice, cuando en los hechos un análisis sí ocurre igual). También implica que la transcripción llega a Anthropic (proveedor de IA en EE.UU.) sin ese consentimiento específico.
- **Corrección recomendada**: Aplicar el mismo chequeo de `consiente_analisis_a/b` a `generarResumenCitaEnSegundoPlano`, o bien — si se considera que el resumen operativo para control de calidad/seguridad del piloto es una "función indispensable" distinta del análisis de perfil — documentarlo explícitamente como tal en el texto legal, en vez de dejar la distinción sin explicar.

### 6.2 — Todo el contenido conversacional (incluida la charla entre dos personas reales) pasa por un tercero (Anthropic)
- **Descripción**: No solo la conversación de onboarding, sino también los mensajes de la Sala de Encuentros entre dos personas reales, se procesan mediante llamadas a Claude en múltiples puntos: generación de tema (`promptGenerarTema`), manejo de incomodidad (`promptSalirIncomodidad`), y los análisis de cierre. Esto es coherente con el rol declarado de Soul ("directora invisible"), pero implica que cada mensaje de una charla privada entre dos personas puede terminar, indirectamente (vía el transcript enviado como contexto), en manos de un proveedor externo.
- **Evidencia**: `api/citas.js` (`pedirAyuda`, `promptGenerarTema`, `promptSalirIncomodidad` — ambas mandan hasta 20 mensajes previos como contexto).
- **Nivel**: Bajo (ya divulgado en términos generales por el texto legal — "Soul analiza... los patrones conversacionales", y las transferencias internacionales están mencionadas en `legal.html`), pero vale la pena que el texto legal sea explícito sobre que esto incluye la charla con la otra persona del match, no solo la charla con Soul.
- **Corrección recomendada**: Aclarar explícitamente en el texto legal que los mensajes de la Sala de Encuentros (entre dos personas) también son procesados por el proveedor de IA, no solo la charla de onboarding.

### 6.3 — Mitigación de prompt injection (verificado, razonable para el estado del proyecto)
- **Descripción**: Existe un filtro server-side (`lib/seguridadPrompt.js`) más un bloque de blindaje en los prompts, con registro de intentos en `intentos_fuga_prompt` (con RLS propio). Es una mitigación básica por patrones (no un modelo de detección), por lo que puede tener falsos negativos ante variantes no cubiertas por las expresiones regulares.
- **Evidencia**: `lib/seguridadPrompt.js`.
- **Nivel**: Bajo (mitigación razonable para el volumen de un piloto cerrado; no es una garantía robusta a escala).

---

## 7. Fotografías almacenadas en base64

### 7.1 — Fotos como base64 embebido en la fila de `usuarios`, no en un storage dedicado
- **Descripción**: No se usa Supabase Storage ni ningún bucket de archivos: las fotos de cara y cuerpo se guardan directamente como texto base64 en las columnas `foto_cara`/`foto_cuerpo` de la tabla `usuarios`.
- **Evidencia**: `api/guardar.js` (`FOTO_REGEX`, `FOTO_MAX_CHARS`, columnas `foto_cara`/`foto_cuerpo`), sin ninguna referencia a `storage/v1` en todo el repo.
- **Nivel**: Medio.
- **Impacto**: (a) Cualquier consulta a `usuarios` con `select=*` (hay varias, con service role key, a lo largo del código) trae el binario completo de las dos fotos "de regalo", multiplicando el tamaño de cada respuesta y la superficie de exposición de cualquier fuga futura de esa key. (b) No hay forma de revocar acceso a una foto ya compartida sin reescribir la fila completa (a diferencia de una URL firmada con expiración). (c) Es más difícil aplicar controles de acceso más finos (por ejemplo, servir la foto de cara pero no la de cuerpo a determinado consumidor) sin tener que filtrar columnas manualmente en cada endpoint (lo cual sí se hace hoy, ver `api/matches.js`, pero es una responsabilidad extra por cada nuevo endpoint que toque `usuarios`).
- **Corrección recomendada**: Migrar a Supabase Storage (o equivalente) con URLs firmadas de corta duración, sirviendo las fotos por referencia y no por valor.

### 7.2 — Validación de formato de foto (verificado, buena práctica ya implementada)
- **Descripción**: `FOTO_REGEX` exige exactamente el formato que produce `canvas.toDataURL('image/jpeg'|'png'|'webp', ...)`, rechazando comillas, ángulos o cualquier caracter fuera del alfabeto base64 — corrige explícitamente (según el propio comentario) una vulnerabilidad real de inyección de HTML/atributo al renderizar la foto en `panel-admin.html`.
- **Evidencia**: `api/guardar.js:22-36`.
- **Nivel**: Informativo (positivo) — se incluye porque la sección fue pedida explícitamente y esta protección es relevante para "fotografías en base64".

### 7.3 — Límite de tamaño y ausencia de escaneo de contenido
- **Descripción**: Se valida tamaño máximo (`FOTO_MAX_CHARS`, ~2.2MB decodificado) y formato, pero no hay ningún escaneo de contenido (por ejemplo, detección de material inapropiado/CSAM) antes de guardar o antes de mostrarle la foto a un match.
- **Evidencia**: `api/guardar.js` (sin llamada a ningún servicio de moderación de imágenes).
- **Nivel**: Medio (dado que hay revisión manual del panel admin durante el piloto — `foto_aprobada` — pero no automatizada).
- **Impacto**: Relevante en particular junto con C1 (ausencia de verificación de edad): sin moderación automatizada de imagen, el único control es la revisión manual de la administradora antes de aprobar la foto (`foto_aprobada`).
- **Corrección recomendada**: Evaluar un servicio de moderación de imágenes antes de habilitar `foto_aprobada`, especialmente de cara a una audiencia más amplia que un piloto cerrado.

---

## 8. Eliminación de cuenta y borrado de datos

### 8.1 — El borrado real en Supabase Auth depende de una variable no confirmada en este repo
- **Descripción**: `purgarUsuario` (`api/cron/diagnostico-diario.js`) borra el usuario real de Supabase Auth (login) solo si `SUPABASE_SERVICE_ROLE_KEY` está configurada; el propio código arma un mensaje de advertencia en el mail de diagnóstico diario para el caso en que no lo esté ("los datos de la app se borraron pero el usuario sigue existiendo en Supabase Auth"). Esa variable **no está presente en `.env.local`** (solo `SUPABASE_ANON_KEY`/`SUPABASE_URL`). Dicho esto, otras funciones centrales (matching, panel admin, lectura cruzada de perfiles) dependen de la misma variable y aparentan estar operativas según el historial de commits — por lo que es razonablemente probable que sí esté configurada en el entorno de producción de Vercel, solo que no en la copia local de `.env.local`.
- **Evidencia**: `api/cron/diagnostico-diario.js:74-103`, `.env.local` (nombres de variables, sin `SUPABASE_SERVICE_ROLE_KEY`).
- **Nivel**: Medio (por la incertidumbre; sería **Crítico** si se confirmara ausente en producción, ya que invalidaría directamente la promesa de borrado de `legal.html`).
- **Impacto**: Si faltara en producción, una persona que "eliminó su cuenta" seguiría pudiendo iniciar sesión con su email/contraseña original 30+ días después, aunque sus datos de perfil ya estén anonimizados — contradice literalmente "tus datos se borran dentro de los 30 días posteriores a la solicitud".
- **Corrección recomendada**: Confirmar en el panel de Vercel que `SUPABASE_SERVICE_ROLE_KEY` está configurada en producción, y revisar el resultado real (`authBorrados` vs `purgadas`) del último diagnóstico diario disponible.

### 8.2 — Diseño de borrado por lo demás consistente y razonable (verificado)
- **Descripción**: El resto del mecanismo de borrado está bien pensado: corte de acceso inmediato al solicitar borrado (`eliminacion_solicitada_en` tratado como sesión inválida), cierre defensivo de citas abiertas antes de cortar el acceso, ventana de gracia de 30 días documentada y efectivamente implementada por el cron, anonimización in-place de `usuarios` (en vez de borrado duro) para no romper referencias de `matches`/`citas` de la otra persona involucrada, y decisión correcta de no tocar `uso_tokens`/`eventos_piloto` (datos agregados, no identificables).
- **Evidencia**: `api/auth.js` (`solicitarBorrado`), `lib/authUtil.js` (chequeo de `eliminacion_solicitada_en`), `api/cron/diagnostico-diario.js` (`purgarCuentasVencidas`, `purgarUsuario`).
- **Nivel**: Informativo (positivo).

### 8.3 — Sin mecanismo automatizado de portabilidad de datos
- **Descripción**: El derecho de portabilidad que promete el texto legal ("pedir una copia de tus datos en un formato que puedas reutilizar") se resuelve exclusivamente por proceso manual, escribiendo a `contacto@soulapp.love` — no existe ningún endpoint de exportación de datos en el código.
- **Evidencia**: Ausencia de cualquier endpoint tipo `exportarDatos` en `/api`.
- **Nivel**: Bajo (es una carga operativa, no una falla de seguridad, y el propio texto legal ya deja claro que el canal es manual).

---

## 9. Panel administrador

### 9.1 — Autenticación de un solo factor, con el freno de fuerza bruta evadible
- **Descripción**: El panel admin (acceso a perfiles psicológicos completos, fotos, transcripciones de citas y conversación con Soul de cualquier persona) se protege con una única contraseña compartida (`ADMIN_PASSWORD`) sin usuario/rol, sin 2FA, enviada en un header custom (`X-Admin-Password`) en cada request. El único freno contra fuerza bruta es el lockout de 5 intentos fallidos / 15 min por IP (`lib/verificarAdmin.js`), que a su vez es evadible (ver hallazgo 10.1/H1).
- **Evidencia**: `lib/verificarAdmin.js` completo; `panel-admin.html:197-211` (contraseña guardeada solo en memoria del cliente, reenviada en cada `fetchAdmin`).
- **Nivel**: **Alto**.
- **Impacto**: Es, en los hechos, el único control de acceso a todos los datos personales/sensibles del piloto — un compromiso de esa única contraseña (o el bypass del lockout) expone la totalidad de la base de personas usuarias.
- **Corrección recomendada**: Corregir primero el bypass de IP (10.1); evaluar a mediano plazo un esquema de autenticación con identidad real (no un secreto compartido) y 2FA, dado el nivel de acceso que otorga.

### 9.2 — El panel puede ver contenido "estrictamente privado" con fines de control de calidad (documentado, pero vale remarcarlo)
- **Descripción**: `api/admin/personas.js` (modo `citaMensajes`, modo `perfil`) usa la service role key para leer, entre otras cosas, la transcripción de la cita y el perfil psicológico completo de cualquier persona. Esto es consistente con lo que promete el propio texto legal ("la persona administradora del proyecto puede revisar conversaciones... exclusivamente para control de calidad y seguridad"), así que no es una discrepancia — se documenta acá porque la sección de auditoría lo pedía explícitamente y porque concentra, junto con 9.1, el nivel de exposición real de un compromiso de la contraseña de admin.
- **Nivel**: Medio (riesgo inherente al modelo "administradora única con acceso total durante el piloto", ya divulgado; el nivel de riesgo real depende de 9.1).

### 9.3 — Contraseña hardcodeada en el repositorio para cuentas de prueba reales
- **Descripción**: `sembrarPreview` (`api/admin/matches.js`) crea o loguea cuentas reales de Supabase Auth (`preview@soul-app.test`, `preview-alex@soul-app.test`) usando una contraseña fija escrita literalmente en el código fuente.
- **Evidencia**: `api/admin/matches.js:311` (`const PREVIEW_PASSWORD = 'PreviewSoul2026!';`).
- **Nivel**: Bajo-Medio.
- **Impacto**: Es una credencial real committeada en texto plano al repositorio (y por lo tanto a su historial de git). El impacto directo es acotado porque son cuentas sintéticas explícitamente excluidas del matching real (dominio `@soul-app.test`, filtrado en `api/calcularMatches.js`), pero sigue siendo una mala práctica y una credencial expuesta si el repositorio llegara a filtrarse o hacerse público.
- **Corrección recomendada**: Mover a variable de entorno, aunque sea de bajo riesgo real.

---

## 10. Logs, secretos y variables de entorno

### 10.1 — Rate limit/lockout por IP evadible falsificando `X-Forwarded-For`
- **Descripción**: Tanto el lockout de fuerza bruta del panel admin (`lib/verificarAdmin.js`) como el rate limit de `reportarProblema` (`api/auth.js`) obtienen la IP tomando el **primer** valor de la cabecera `X-Forwarded-For` (`.split(',')[0].trim()`). En una cadena de proxies, el primer valor es históricamente el que puede llegar ya establecido por quien hace el pedido (el valor confiable agregado por el borde de Vercel es normalmente el más cercano al origen, no el primero de la lista) — es decir, quien ataca puede enviar su propio header `X-Forwarded-For` con un valor distinto en cada intento y aparecer como una IP nueva cada vez, evadiendo el conteo.
- **Evidencia**: `lib/verificarAdmin.js:21-25` (`function obtenerIp(req){ const fwd = req.headers['x-forwarded-for']; if (fwd) return String(fwd).split(',')[0].trim(); ...}`), `api/auth.js:50` (mismo patrón: `(req.headers['x-forwarded-for'] || '').split(',')[0].trim()`).
- **Nivel**: **Alto** (por la combinación con 9.1: el impacto más severo es el bypass del lockout de la contraseña de administración, que da acceso a toda la base).
- **Impacto**: Permite fuerza bruta ilimitada contra `ADMIN_PASSWORD` (sin límite de intentos reales) y contra el límite de `reportarProblema` (spam de bajo daño en `reportes_tecnicos`).
- **Corrección recomendada**: Tomar el **último** valor de `x-forwarded-for` (el más cercano al proxy de confianza de Vercel) o, preferentemente, usar la cabecera específica que Vercel expone para la IP real del cliente, en vez de confiar en el primer valor de una cabecera que el propio cliente puede establecer.

### 10.2 — Redacción de secretos en logs (verificado, buena práctica)
- **Descripción**: `lib/logErrorSilencioso.js` redacta activamente cualquier valor de `ANTHROPIC_API_KEY`, `SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `ADMIN_PASSWORD` y `CRON_SECRET` antes de guardar el mensaje/stack de cualquier error, incluso aunque hoy ningún catch conocido los incluya (según el propio comentario, es una red de seguridad a futuro).
- **Evidencia**: `lib/logErrorSilencioso.js:13-30`.
- **Nivel**: Informativo (positivo). Nota: esta lista no incluye `SUPABASE_SERVICE_ROLE_KEY` ni `EMAIL_FROM`/`RESEND_API_KEY` variantes — **pendiente de confirmar** si `SUPABASE_SERVICE_ROLE_KEY` debería sumarse a `valoresSecretos()` (hoy no figura en la lista) como capa adicional, dado que es la credencial más poderosa del sistema.

### 10.3 — `.gitignore` correcto (verificado)
- **Descripción**: `.env*` y `.vercel` están excluidos de git.
- **Evidencia**: `.gitignore` (`.vercel`, `.env*`).
- **Nivel**: Informativo (positivo).

### 10.4 — Errores de proveedores externos reenviados al cliente
- **Descripción**: Varias rutas (`api/auth.js`, el camino no-streaming de `api/chat.js`) reenvían el `status`/body de error crudo de Supabase o Anthropic directo al cliente (`return res.status(response.status).json(data)` / `return res.status(error.status).json(error.data)`), en vez de normalizarlo a un mensaje propio.
- **Evidencia**: `api/auth.js` (login/registro/recuperar), `api/chat.js:245-247`.
- **Nivel**: Bajo.
- **Impacto**: Posible fuga menor de detalles internos del proveedor (nombres de campo, códigos de error específicos) al cliente; no se identificó ningún caso de fuga de credenciales o secretos por esta vía.
- **Corrección recomendada**: Normalizar las respuestas de error antes de reenviarlas, especialmente para los proveedores de IA.

---

## 11. Riesgos para Google Play Store

(Ver también `00-contexto/brief-soul.md` sección 11 para el estado general del empaquetado.)

### 11.1 — Ausencia de verificación de edad (crítico también para Play)
- Ver hallazgo C1 (sección 1.1). Google Play tiene políticas específicas y estrictas para apps de citas/relacionamiento (verificación de edad, categoría de contenido, requisitos de moderación) — la ausencia total de cualquier control es el riesgo más alto identificado para la aprobación/permanencia en la tienda.

### 11.2 — Formulario de "Seguridad de los datos" (Data Safety) de Play Console
- **Descripción**: El formulario de Play exige declarar con precisión qué datos se recolectan, con qué fin, si se comparten con terceros y si se pueden borrar. Dado lo relevado en este documento, ese formulario tendría que declarar como mínimo: datos de ubicación aproximada (ciudad), fotos, datos de salud/orientación potencialmente presentes en texto libre (sección 2.1), mensajes, y el hecho de que datos personales se envían a un proveedor de IA en EE.UU. (Anthropic) y a un proveedor de email en EE.UU. (Resend).
- **Nivel**: Alto (no por un bug de código, sino porque completar ese formulario con precisión requiere primero resolver 3.1-3.3, ya que hoy no hay una única fuente de verdad de qué se declara vs. qué se hace).
- **Corrección recomendada**: Completar el formulario recién después de resolver las discrepancias de la sección 3 y 6.1, para que lo declarado ante Google coincida con el comportamiento real del código.

### 11.3 — Sin build de release firmado (recordatorio desde el brief)
- El wrapper `soul-app-native` solo tiene un APK `debug` generado, sin keystore ni `signingConfig`, `versionCode 1` sin incrementar. No es un hallazgo de privacidad/seguridad de datos en sí, pero bloquea cualquier submisión real a Play (que exige un `.aab` firmado).

### 11.4 — Permisos mínimos (verificado, positivo)
- Solo se declara `android.permission.INTERNET` en el manifest — no hay sobre-solicitud de permisos, lo cual simplifica la revisión de Play en ese aspecto puntual.

---

## 12. Diferencias entre lo que dicen los documentos legales y lo que realmente hace el código

Consolidado de las discrepancias ya detalladas arriba, para lectura rápida:

| Promesa en `legal.html`/`consentimiento.html` | Lo que hace el código | Sección |
|---|---|---|
| El documento completo se puede leer y se exige scrollearlo entero antes de aceptar | El texto que se muestra y se acepta de verdad (`soul.html`) es una versión abreviada que omite responsable del tratamiento, base legal, sección de datos sensibles, transferencias internacionales, aviso de incidentes y 3 de los 6 derechos listados | 3.1 |
| "Podés activar o desactivar [comunicaciones fuera de la plataforma / contribuir datos anonimizados] en cualquier momento desde tu perfil" | No existe ningún campo que registre esa elección, en el consentimiento ni en "Mi perfil"; el checkbox opcional no persiste nada | 3.2 |
| Comunicaciones fuera de la plataforma son "opcionales" | Se envían siempre, sin ningún gate de consentimiento | 3.3 |
| El debriefing/reflexión y el análisis de vínculo requieren consentimiento explícito de las dos personas | Un tercer análisis sobre la misma transcripción (`resumen_ia`, para uso del panel admin) se genera siempre, sin chequear ese consentimiento | 6.1 |
| "Tus datos se borran dentro de los 30 días posteriores a la solicitud" | El borrado de datos de producto sí ocurre a los 30 días; el borrado de la cuenta de login en Supabase Auth depende de una variable de entorno cuya presencia en producción no pudo confirmarse desde este repo | 8.1 |
| No se menciona ninguna restricción de edad | No existe ninguna verificación de edad mínima en ningún punto del producto | 1.1 / 11.1 |

---

## Notas metodológicas

- Este documento parte de `docs/privacy-launch/00-contexto/brief-soul.md` y agrega una segunda pasada de lectura dirigida sobre: todas las políticas SQL de RLS (contenido completo, no solo nombres), `lib/authUtil.js`, `lib/cierreCita.js`, `lib/verificarAdmin.js`, `lib/rateLimit.js`, `lib/email.js`, `api/citas.js` completo, `api/admin/matches.js` (función `sembrarPreview`), el bloque de consentimiento embebido en `soul.html` comparado línea por línea contra `legal.html`/`consentimiento.html`, y los campos de formulario relacionados con fecha de nacimiento.
- No se modificó ningún archivo de código ni de configuración como parte de esta auditoría.
- No se leyeron ni se citan valores reales de secretos — donde se necesitó confirmar la *presencia* de una variable de entorno (`.env.local`), solo se verificaron los nombres de clave, nunca los valores.
- Cualquier hallazgo que dependa de configuración de producción no accesible desde este repo local (ej. variables de entorno de Vercel, contenido real de `ADMIN_PASSWORD`) está marcado explícitamente como "Pendiente de confirmar".
