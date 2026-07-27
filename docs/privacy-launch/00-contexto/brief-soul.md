# Brief de Soul — contexto técnico para lanzamiento y privacidad

> Documento generado a partir de una lectura directa del código fuente del repositorio `Soul-app` (y del wrapper `soul-app-native`) el 2026-07-27. Todo lo que no pudo verificarse en el código está marcado explícitamente como **"Pendiente de confirmar"**. No se incluye nada inferido de conversaciones, memoria previa ni documentación externa al repo.

---

## 1. Qué es Soul y cuál es su función principal

Soul se autodescribe (`index.html`, `manifest.json`, `consentimiento.html`, `legal.html`) como **"una plataforma de vínculos basada en coaching ontológico"**. La propuesta, tal como está redactada en el propio producto:

- El eslogan público es: *"Antes de ayudarte a conocer a alguien, Soul se toma el tiempo de conocerte a vos."* (`index.html`, meta description y OG tags).
- Antes de presentar a una persona con otra, Soul mantiene una conversación (`api/chat.js`) con quien se registra para construir un **perfil vincular** (rasgos de personalidad, valores, forma de vincularse, patrones de conflicto, etc.), y recién después usa ese perfil para calcular compatibilidad con otras personas de la base (`api/calcularMatches.js`).
- El documento legal (`consentimiento.html`, sección 1) es explícito: *"Soul analiza el contenido de tus respuestas, la forma en que te expresás y los patrones conversacionales (...) para construir un perfil vincular. No analiza ninguna otra información fuera de lo que compartís en la conversación."*
- El mismo documento aclara los límites: *"Soul no realiza diagnósticos psicológicos ni reemplaza a un profesional de la salud mental. No garantiza compatibilidad ni éxito en ningún vínculo."*

En el código, el proyecto está actualmente en etapa de **piloto cerrado** (ver sección 11) — así lo dice el propio texto legal ("Soul está en una etapa piloto cerrada, con un grupo reducido de personas", `consentimiento.html`/`legal.html`, punto 6).

---

## 2. Funciones actuales de la app

Basado en los endpoints de `/api` y en las funciones invocadas desde `soul.html` (el único front-end activo, ver sección 3):

- **Registro, login, recuperación de contraseña y confirmación de cuenta por email** (`api/auth.js`).
- **Onboarding de datos básicos** (Etapa 1): fecha/ciudad/distancia/género/preferencia/tipo de vínculo/hijos/estado civil/ocupación/no-negociables/negociables + dos fotos (`api/guardar.js`, constante `CAMPOS_BASICOS_REQUERIDOS`).
- **Conversación libre con "Soul"** (chat con streaming) para construir el perfil psicológico/vincular (`api/chat.js`).
- **Módulos de profundización** ("modo módulo", con fases) — parte de la extensión paga Soul Pro, salvo el módulo `obligatorio` ("Capacidad de volver a elegir") que es requisito para todos antes de un encuentro (`api/chat.js`).
- **Cálculo de matches**: compara el perfil propio contra el resto de perfiles activos usando IA, filtrando antes por compatibilidad de género/preferencia, tipo de vínculo, distancia e hijos (`api/calcularMatches.js`, `lib/matchCompatible.js`).
- **Decisión sobre un match** (aceptar/rechazar) y **eliminación/reporte de un match** (`api/matches.js`).
- **"Análisis externo"**: pegar una conversación mantenida fuera de la plataforma con otra persona y compararla contra el perfil propio (`api/analisisExterno.js`), con tope de usos free/pro.
- **Sala de Encuentros / citas virtuales asincrónicas**: chat entre las dos personas de un match mutuo, con mensajes, "escribiendo...", lectura, ayuda privada generada por IA, cierre manual o automático por inactividad, y debriefing/reflexión posterior (`api/citas.js`, `lib/cierreCita.js`).
- **Reporte de problemas técnicos** desde pantallas sin sesión válida (`api/auth.js`, acción `reportarProblema`).
- **Solicitud de borrado de cuenta** desde "Mi perfil" (`api/auth.js`, acción `solicitarBorrado`).
- **Panel de administración** (`panel-admin.html` + `api/admin/*.js`): métricas, diagnósticos diarios, ver mensajes de una cita, ver/editar el "perfil"/Hoja de Vida de una persona, ranking manual de compatibilidad, activar/pausar matches, sembrar cuentas de prueba ("Vista Previa"), forzar cierre de perfil, comparar dos personas manualmente.
- **Cron diario** (`api/cron/diagnostico-diario.js`): diagnóstico operativo (errores, reportes, intentos de fuga de prompt, entregabilidad de mails, costo estimado de tokens) + purga real de cuentas cuyo plazo de borrado (30 días) venció.

---

## 3. Flujo principal del usuario

El front-end activo es **`soul.html`** (`manifest.json` define `"start_url": "/soul.html"`). Existen otros HTML en la raíz del repo (`app.html`, `onboarding-soul.html`, `momento-match.html`, `constelacion.html`) que **no están referenciados desde ningún otro archivo del proyecto** (verificado por búsqueda de texto) — parecen prototipos o versiones anteriores, no forman parte del flujo activo. **Pendiente de confirmar** si se siguen usando de alguna forma no detectada en el código.

Flujo reconstruido a partir de `soul.html`, `api/guardar.js` y `lib/authUtil.js` (campo `etapa_actual`):

1. **Landing** (`index.html`) → CTA hacia la app.
2. **Consentimiento** (`consentimiento.html`): lectura obligatoria (con scroll forzado hasta el final) de términos/privacidad antes de poder aceptar, más un checkbox opcional para contribuir datos anonimizados.
3. **Registro** (email + contraseña, vía Supabase Auth) → se crea una fila mínima en `usuarios` (email + nombre) apenas se registra.
4. **Etapa 1 — datos básicos**: formulario con los campos de `CAMPOS_FORMULARIO`/`CAMPOS_BASICOS_REQUERIDOS` + dos fotos (cara y cuerpo, recodificadas a JPEG en el navegador vía `canvas.toDataURL`) + aceptación de consentimiento. Al completarse, `etapa_actual` pasa a `'chat'` y se dispara el email de confirmación de cuenta.
5. **Chat con Soul**: conversación libre para construir el perfil (grupo1-4: valores, estilo de comunicación, tipo de vínculo, proyecto de vida, modo de conflicto, apertura, etc. — ver `EXTRACT_PROMPT` en `api/analisisExterno.js`).
6. **Cálculo de matches**: al pedirlo, se compara contra otros perfiles compatibles; si supera el umbral (compatibilidad_hoy ≥ 60 o potencial_construccion ≥ 75), se crea una fila en `matches` con estado `pendiente`.
7. **Decisión sobre el match**: cada persona elige "acepta" o "rechaza" (requiere email confirmado). Si ambas aceptan → `estado = 'mutuamente_aceptado'`, se crea automáticamente una `cita` y `etapa_actual` pasa a `'cita'` para ambas personas.
8. **Sala de Encuentros**: chat asincrónico entre las dos personas dentro de la cita, con Soul interviniendo ocasionalmente como "directora invisible". Se cierra manualmente o automáticamente a las 24hs de inactividad.
9. **Cierre / debriefing**: al cerrarse la cita, `etapa_actual` pasa a `'debriefing'` para ambas personas; se genera un resumen objetivo de la cita vía IA (uso interno/admin, no visible para las personas).
10. En cualquier momento: **"Mis matches"**, **"Mis citas"**, **"Mi perfil"** (edición de datos/fotos), **eliminar cuenta**.

---

## 4. Tecnologías utilizadas

- **Front-end**: HTML/CSS/JavaScript "vanilla" servido como archivos estáticos (sin framework — no hay `package.json` de front-end, ni bundler, ni React/Vue/etc. en `Soul-app`). Fuentes vía Google Fonts (`Cormorant Garamond`, `Inter`).
- **Back-end**: funciones serverless de **Vercel** en Node.js (carpeta `/api`, cada archivo `.js` exporta un `handler`), sin ningún framework HTTP (no Express/Fastify) — usan `fetch` nativo contra APIs REST externas.
- **PWA**: `manifest.json` + `sw.js` (service worker propio, estrategia "red primero"), iconos en `/icons`.
- **Empaquetado nativo Android**: proyecto separado `soul-app-native`, basado en **Capacitor** (`@capacitor/android`, `@capacitor/cli`, `@capacitor/core` v8.4.2), que envuelve la web (`capacitor.config.json` apunta a `https://www.soulapp.love` como servidor remoto, `webDir: "www"`).
- **Hosting/despliegue**: Vercel (`vercel.json`, carpeta `.vercel`).
- **Sin dependencias npm en el back-end web**: no hay `package.json` en `Soul-app` — los comentarios del código (`lib/email.js`) confirman el criterio explícito de "cero dependencias npm", todo vía `fetch` directo a las APIs REST de los proveedores.

---

## 5. Servicios externos y APIs

Identificados por las variables de entorno usadas (`.env.local`, sólo nombres de clave, sin valores) y las URLs llamadas en el código:

| Servicio | Uso | Evidencia en código |
|---|---|---|
| **Supabase** (Postgres + Auth) | Base de datos, autenticación de usuarios, Row Level Security | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, llamadas a `/rest/v1/*` y `/auth/v1/*` en todos los `api/*.js` |
| **Anthropic (Claude)** | Motor de IA conversacional y de matching | `ANTHROPIC_API_KEY`, `lib/anthropicClient.js`, llamadas a `https://api.anthropic.com/v1/messages`. Modelos usados: `claude-sonnet-4-6` (chat principal, módulos, matching, análisis, resúmenes) y `claude-haiku-4-5-20251001` (modo "rápido" del chat informal) |
| **Resend** | Envío de emails transaccionales | `RESEND_API_KEY`, `EMAIL_FROM`, `lib/email.js`, llamadas a `https://api.resend.com/emails` |
| **Vercel Cron** | Disparo diario del diagnóstico/purga | `vercel.json` (`0 11 * * *`), `CRON_SECRET` para autenticar la llamada |

No se detectaron integraciones con: pasarelas de pago (hay lógica de plan `free`/`pro` pero **sin cobro real conectado** — ver sección 11), redes sociales, analítica de terceros (Google Analytics, Meta Pixel, etc.), mapas/geolocalización, ni SDKs de push notifications activos en el código web. **Pendiente de confirmar** si existe algún servicio adicional configurado únicamente en las variables de entorno de producción de Vercel (no accesibles desde este repo local).

---

## 6. Datos personales que se solicitan, guardan o procesan

### Datos de identidad y cuenta
- Email y contraseña (vía Supabase Auth).
- Nombre.

### Datos de perfil / intake (tabla `usuarios`, campos requeridos en `api/guardar.js`)
- Fecha de nacimiento y **hora de nacimiento** (`fecha_nacimiento`, `hora_nacimiento` — este último no forma parte de los "básicos requeridos" pero se guarda desde "Mi perfil", `soul.html`).
- Ciudad y distancia máxima preferida.
- Género y preferencia de género.
- Tipo de vínculo buscado (array: ej. "Romántico", "Compañía").
- Hijos (propio) y preferencia sobre hijos de la otra persona.
- Estado civil.
- Ocupación.
- "No negociables" y "negociables" (texto libre).
- **Dos fotografías** (cara y cuerpo), recodificadas en el navegador a JPEG base64 antes de subirse; se valida formato y tamaño en el servidor (`FOTO_REGEX`, `FOTO_MAX_CHARS` en `api/guardar.js`). Hay un flag `foto_aprobada` que controla si la foto se muestra a un match.

### Datos sensibles (explícitamente reconocidos como tales en `consentimiento.html`/`legal.html`, sección 2)
- Orientación / preferencias de vínculo e intimidad, inferidas de la conversación libre con Soul. El propio texto legal dice: *"puede revelar información sobre tu orientación o tu vida íntima. La ley considera esto un dato sensible (...) Soul lo trata con ese mismo cuidado extra: nunca se muestra a un match ni a nadie fuera de la administración de la plataforma."*

### Perfil psicológico/vincular generado por IA (tabla `perfiles`, grupos 1 a 4 — ver `EXTRACT_PROMPT` en `api/analisisExterno.js`)
- Valores, estilo de comunicación, ritmo emocional, "máscara vs. auténtico", momento evolutivo.
- Tipo de vínculo, proyecto de vida, necesidades de intimidad, límites relacionales.
- Modo de conflicto, capacidad de reparación, reciprocidad, flexibilidad, patrones vinculares.
- Apertura, consistencia, estabilidad emocional, revisión de creencias, índice de disponibilidad.

### Contenido conversacional
- Historial completo de la conversación con Soul (tabla `conversaciones`).
- Mensajes de la Sala de Encuentros con el match (tabla `cita_mensajes`), incluyendo transcripciones que la IA resume para uso interno del panel admin.
- Conversaciones externas pegadas voluntariamente para "análisis externo" (no se especifica retención aparte en el código revisado — **pendiente de confirmar**).

### Metadatos de uso y seguridad
- Última actividad, etapa del funnel, plan (free/pro), cantidad de análisis usados.
- Intentos de fuga/inyección de prompt (`intentos_fuga_prompt`, guarda el mensaje textual).
- Reportes entre usuarios (motivo categórico, sin texto libre) y reportes técnicos (contexto + email opcional).
- Uso de tokens de IA por endpoint (`uso_tokens`) y eventos de embudo (`eventos_piloto`) — el código aclara explícitamente que estas dos tablas son "métricas agregadas (conteos, no contenido), no dato personal identificable" y por eso no se purgan al borrar la cuenta.
- Errores técnicos silenciosos (`errores_silenciosos`), con redacción automática de secretos conocidos antes de guardarse.

### Retención y borrado
- Al pedir el borrado de cuenta (`solicitarBorrado`), el acceso se corta inmediatamente, pero el borrado real de datos personales ocurre **30 días después**, ejecutado por el cron diario (`api/cron/diagnostico-diario.js`, `purgarCuentasVencidas`).
- Se borran directamente: `perfiles`, `conversaciones`, `historial_relacional`, `intentos_fuga_prompt`.
- La fila de `usuarios` **no se borra** (para no romper referencias con matches/citas de la otra persona involucrada): se anonimiza in-place (nombre, email, fecha de nacimiento, fotos, etc. se ponen en `null`, email se reemplaza por `borrada-{id}@soul-app.eliminado`, `cuenta_eliminada = true`).
- El borrado de la identidad en Supabase Auth (login real) depende de que `SUPABASE_SERVICE_ROLE_KEY` esté configurada; el propio código advierte que sin esa variable "los datos de la app se borraron pero el usuario sigue existiendo en Supabase Auth". **Esta variable no está presente en `.env.local`** (sólo `SUPABASE_ANON_KEY`/`SUPABASE_URL`) — **pendiente de confirmar** si está configurada en el entorno de producción de Vercel, dato no accesible desde este repo.
- Las tablas compartidas con otra persona (`matches`, `citas`, `cita_mensajes`) no se destruyen al borrar una cuenta, para no eliminar el historial de la otra parte de un vínculo real.

---

## 7. Uso de inteligencia artificial

Todo el uso de IA pasa por **Anthropic Claude**, vía `lib/anthropicClient.js`, sin frameworks intermedios (llamadas HTTP directas a la API de Mensajes de Anthropic). Usos concretos verificados en el código:

1. **Chat conversacional** con la persona usuaria (onboarding, charla libre, módulos de profundización) — con streaming de respuesta (`api/chat.js`).
2. **Extracción de perfil estructurado** a partir de la conversación (`EXTRACT_PROMPT`).
3. **Cálculo de compatibilidad entre dos perfiles** (`COMPARE_PROMPT`, `lib/comparePrompt.js`), usado tanto por el matching automático como por el ranking manual del panel admin.
4. **Análisis de una conversación externa** pegada por la persona, comparándola contra su propio perfil (`api/analisisExterno.js`).
5. **Generación de bio de presentación** de la otra persona antes de decidir sobre un match (`PRESENTACION_PERFIL_PROMPT`, `api/matches.js`).
6. **Intervenciones dentro de la Sala de Encuentros** ("directora invisible" que interviene puntualmente en la charla entre las dos personas, `api/citas.js`).
7. **Resumen objetivo de una cita** para uso exclusivo del panel de administración (`RESUMEN_CITA_PROMPT`, `lib/cierreCita.js`) — nunca visible para las personas usuarias.
8. **Optimización de costo/latencia**: prompt caching (`cache_control: ephemeral`) tanto para el system prompt como para el historial de mensajes en conversaciones de ida y vuelta (`lib/anthropicClient.js`).
9. **Mitigación de prompt injection / jailbreak**: filtro server-side por patrones de texto (`lib/seguridadPrompt.js`) más un bloque de "blindaje" incluido al final de los system prompts conversacionales (`BLINDAJE_PROMPT`, duplicado en `soul.html` y `api/citas.js` porque cliente y servidor no comparten módulos).

El texto legal (`consentimiento.html`/`legal.html`) aclara: *"Soul genera inferencias, no diagnósticos. Sus análisis son probabilísticos y pueden ser incompletos o equivocados"* y que *"Soul puede modificar sus modelos de análisis (...) Esto puede generar cambios en las inferencias obtenidas con el tiempo."*

---

## 8. Sistema de autenticación

- **Proveedor**: Supabase Auth (email + contraseña), vía llamadas REST directas a `/auth/v1/signup`, `/auth/v1/token?grant_type=password`, `/auth/v1/recover`, `/auth/v1/token?grant_type=refresh_token`, `/auth/v1/user` (`api/auth.js`, `lib/authUtil.js`).
- **Sesión**: token Bearer emitido por Supabase, verificado en cada request autenticado contra `/auth/v1/user` (`verificarUsuario` en `lib/authUtil.js`). No se detectó persistencia de sesión del lado del cliente más allá de lo gestionado por `soul.html` (hay un comentario en el código sobre limitaciones de bfcache/localStorage, pero el detalle exacto de dónde se guarda el token en el navegador **no fue revisado en profundidad — pendiente de confirmar** si conviene auditarlo aparte).
- **Confirmación de cuenta**: mecanismo propio (no el de Supabase) — columna `mail_confirmado` + `token_confirmacion` de un solo uso, porque "Confirm email" está desactivado en Supabase (da sesión inmediata al registrarse). Requerido antes de poder decidir sobre un match (no antes de chatear con Soul).
- **Rate limiting anti fuerza-bruta**: login limitado a 8 intentos / 10 min por email; registro, recuperación y reenvío de confirmación a 5 / hora por email (`api/auth.js`, tabla `rate_limits`).
- **Borrado de cuenta**: invalida la sesión de inmediato tratando `eliminacion_solicitada_en` como sesión inválida, aunque el purgado real de datos ocurra a los 30 días (ver sección 6).
- **Autenticación de administración**: contraseña única compartida vía variable de entorno `ADMIN_PASSWORD`, sin usuario/rol en base de datos, con bloqueo (lockout) tras 5 intentos fallidos en 15 minutos por IP (`lib/verificarAdmin.js`). El propio comentario del código dice que es "suficiente para una sola persona administradora".
- **Cron**: autenticado por header `Authorization: Bearer $CRON_SECRET`, comparado contra la variable de entorno `CRON_SECRET`.

---

## 9. Base de datos y almacenamiento

- **Motor**: Supabase (Postgres gestionado + API REST autogenerada PostgREST + Supabase Auth).
- **Acceso**: siempre vía HTTP REST (`/rest/v1/<tabla>`), nunca mediante un SDK/ORM. Hay dos niveles de credencial usados según el caso:
  - **Token propio de la persona** (el JWT de su sesión), para tablas con política RLS real, de forma que `auth.uid()` resuelva la fila correcta.
  - **Service role key** (`SUPABASE_SERVICE_ROLE_KEY`), para lecturas/escrituras cruzadas legítimas que necesitan bypasear RLS (ej. leer el nombre de la otra persona de un match, comparar contra todos los perfiles para matching, tareas de sistema sin sesión de nadie como los recordatorios y el cron).
- **Tablas identificadas** (por las migraciones SQL y por las llamadas REST en el código): `usuarios`, `perfiles`, `conversaciones`, `matches`, `citas`, `cita_mensajes`, `cita_reflexiones`, `cita_ayudas`, `feedback_piloto`, `reportes`, `reportes_tecnicos`, `intentos_fuga_prompt`, `rate_limits`, `uso_tokens`, `eventos_piloto`, `errores_silenciosos`, `diagnosticos_diarios`, `historial_relacional`.
- **Row Level Security (RLS)**: según los archivos `migracion_rls_*.sql` presentes en el repo, **todas las tablas con dato personal identificado ya tienen RLS activado** (`usuarios`, `perfiles`, `conversaciones`, `matches`, `citas`, `cita_mensajes`, `cita_reflexiones`, `cita_ayudas`, `feedback_piloto`, `reportes`, `reportes_tecnicos`, `intentos_fuga_prompt`), con políticas de "solo el dueño" o "las dos personas del match/cita" según corresponda.
- **Fotos**: no se usa Supabase Storage ni ningún bucket de archivos — las fotos se guardan como **base64 embebido directamente en la fila de `usuarios`** (columnas `foto_cara`/`foto_cuerpo`), con validación de formato/tamaño en el servidor.
- **Rate limiting**: implementado con una tabla propia (`rate_limits`) en Supabase, sin Redis ni estado en memoria — el propio código lo describe como "best-effort", no atómico bajo concurrencia extrema.

---

## 10. Funciones de seguridad existentes

- **RLS en todas las tablas sensibles** (ver sección 9), migrado tabla por tabla, con comentarios en el código documentando qué se rompió y cómo se corrigió en cada paso.
- **Rate limiting** por email/IP en: login, registro, recuperación, reenvío de confirmación, reporte de problemas, chat (por ráfaga y por tope diario de 80 mensajes), cálculo de matches (general y específico para plan free), ayuda privada dentro de una cita, y contraseña de administración.
- **Filtro server-side de intentos de jailbreak/fuga de prompt** (`lib/seguridadPrompt.js`) con patrones de detección en español e inglés, más un bloque de "blindaje" repetido al final de todos los system prompts conversacionales. Los intentos se registran en `intentos_fuga_prompt` para revisión de la administradora.
- **Validación server-side independiente del cliente**: completitud de datos básicos antes de pasar a `etapa_actual='chat'`, validación de formato/tamaño de fotos (incluyendo protección contra inyección de HTML/atributo vía `FOTO_REGEX`, documentada explícitamente en el código como corrección de una vulnerabilidad real detectada), validación de fase de módulo contra lo guardado en base (no lo que declare el cliente).
- **Curado de campos expuestos al cliente**: funciones dedicadas (`curarMatch`, `curarCita`) que filtran explícitamente qué columnas de `matches`/`citas` viajan al navegador de cada persona, para no filtrar el análisis privado de la otra parte (el código documenta que antes de este cambio existía una fuga real de datos, no solo hipotética).
- **Confirmación de email obligatoria** antes de poder decidir sobre un match o calcular matches (no antes de onboarding/chat, que no involucran a otra persona real).
- **Escape de HTML** (`esc()`) antes de insertar contenido generado por usuarios en el HTML del panel admin/diagnóstico diario, para evitar XSS almacenado.
- **Redacción automática de secretos** en cualquier log de error silencioso antes de guardarlo (`lib/logErrorSilencioso.js`), como red de seguridad adicional.
- **Cierre defensivo de citas abiertas** al solicitar borrado de cuenta o al purgar una cuenta vencida, para no dejar a la otra persona esperando una conversación que nunca va a continuar.
- **Moderación básica de reportes**: motivos categóricos predefinidos (sin texto libre) para reportar un match, más un mecanismo de "eliminar/bloquear" unilateral que corta mensajes nuevos entre las dos partes.
- **Auditoría diaria automatizada** (cron `diagnostico-diario`): errores silenciosos, reportes, intentos de fuga, entregabilidad de emails, cuentas trabadas sin confirmar, y ejecución real de los borrados vencidos — enviada por email a `ADMIN_EMAIL`.

---

## 11. Estado actual del proyecto para lanzamiento en Google Play Store

Evidencia concreta encontrada en `soul-app-native` (el wrapper Android, vía Capacitor):

- **Capacitor** `@capacitor/android`/`@capacitor/core`/`@capacitor/cli` v8.4.2, `appId: "love.soulapp.app"`, `appName: "Soul"`.
- La app carga el sitio remoto `https://www.soulapp.love` (no bundlea la web dentro del APK) — `capacitor.config.json`, `server.url`.
- `android/app/build.gradle`: `applicationId "love.soulapp.app"`, **`versionCode 1`, `versionName "1.0"`** (nunca incrementado).
- **Único APK generado es de tipo `debug`** (`android/app/build/outputs/apk/debug/app-debug.apk`); no se encontró ningún artefacto `release` ni `.aab` (Android App Bundle), que es el formato que exige Google Play.
- **No se encontró ningún keystore** (`.keystore`/`.jks`) en el proyecto ni configuración de `signingConfig` en `build.gradle` — no hay firma de release configurada.
- **Único permiso declarado en `AndroidManifest.xml`: `android.permission.INTERNET`**. No hay permisos de cámara, ubicación, contactos, almacenamiento ni notificaciones push declarados (aunque la app pide fotos, lo hace vía `<input type="file">` del navegador/WebView, no vía API nativa de cámara).
- El wrapper `soul-app-native` **no tiene control de versiones propio** (no es un repo git, a diferencia de `Soul-app`), y `google-services.json` (necesario para Firebase/push) se maneja como opcional (`try/catch` en `build.gradle`) y no se encontró el archivo en el repo.
- Existe una integración de `@capacitor/assets`/`sharp` en `devDependencies`, usada típicamente para generar íconos/splash — **pendiente de confirmar** si ya se generaron assets finales de store (no se encontró carpeta de assets de listing, capturas de pantalla ni feature graphic en el repo).

En el proyecto web (`Soul-app`):
- El código funciona sobre datos reales de un **piloto cerrado** ("Soul está en una etapa piloto cerrada, con un grupo reducido de personas" — texto legal vigente en `consentimiento.html`/`legal.html`).
- El **plan Pro/pago no está conectado**: existe la columna `plan` y toda la lógica de límites free/pro en el código, pero un flag explícito (`TODOS_PRO_TEMPORAL = true` en `lib/authUtil.js`) trata a todas las cuentas como Pro "mientras tanto nadie debería quedar afuera de nada por plan", con el comentario explícito de que **falta integrar StoreKit/IAP** (facturación in-app, requisito de Google Play para contenido de pago).
- Existen documentos de privacidad y términos publicados y enlazados (`legal.html`, `consentimiento.html`) con responsable del tratamiento identificado (Lourdes Satragno, CABA, Argentina) y contacto (`contacto@soulapp.love`) — insumo directo para completar el formulario de "Seguridad de los datos" / política de privacidad de Play Console.
- El propio texto legal admite transferencia internacional de datos (infraestructura de base de datos e IA fuera de Argentina, incluido EE.UU.), dato relevante para el data safety form de Play Store.
- **Repositorio Git de `Soul-app`**: commits recientes muestran migración activa de RLS (completada en todas las tablas identificadas) y ajustes de producto (paywall, plan Free/Pro temporal) — actividad de desarrollo continua a fecha del análisis, no una versión congelada para release.

**En síntesis**, el estado verificable es: **PWA funcional en producción web** (`soulapp.love`), con un **wrapper Android en etapa de desarrollo/debug**, sin build de release firmado, sin versión incrementada más allá de la inicial, sin pasarela de pago conectada pese a existir lógica de planes, y sin evidencia en el repo de assets de ficha de Play Store ya preparados. Cualquier afirmación sobre fecha de sumisión, cuenta de desarrollador de Google Play, o estado de revisión ante Google, es **pendiente de confirmar** — no hay rastro de eso en el código.

---

## Notas metodológicas

- Este documento se basa en la lectura de: todos los archivos de `/api` y `/lib`, `manifest.json`, `sw.js`, `vercel.json`, `.gitignore`, los nombres (no valores) de `.env.local`, todas las migraciones `migracion_*.sql`, `consentimiento.html`, `legal.html`, `index.html`, secciones relevantes de `soul.html` (formulario de intake, funciones de pantalla), `package.json`/`capacitor.config.json`/`AndroidManifest.xml`/`build.gradle` de `soul-app-native`, y el historial de commits de `Soul-app`.
- No se leyó línea por línea la totalidad de `soul.html` (4869 líneas) ni de `panel-admin.html`/`api/citas.js` completos — se revisaron mediante búsquedas dirigidas. Es posible que existan funciones adicionales no documentadas aquí; ante cualquier afirmación puntual que dependa de una parte no revisada de esos archivos, tratarla como **pendiente de confirmar** hasta verificarla directamente.
