# Checklist de lanzamiento — Soul (Agente 4)

> Verificado contra el código real de `Soul-app` y `soul-app-native` al 2026-07-29, y contra los documentos de `00-contexto/` a `03-documentos/`. No declara cumplimiento legal definitivo. Estados: **CUMPLE**, **PARCIAL**, **NO CUMPLE**, **NO CONFIRMADO**, **REVISIÓN LEGAL**.

## 1. Política y código

| ID | Control | Estado | Evidencia | Acción necesaria | Responsable sugerido |
|---|---|---|---|---|---|
| P-01 | Verificación de edad mínima (18+) en cliente | CUMPLE | `soul.html:702,2331-2335,3985-3988` (tope `max` en el date picker + bloqueo de avance de paso) — solo UX, ver P-02/P-03 para el control real | Ninguna | — |
| P-02 | Verificación de edad mínima (18+) en servidor, en el onboarding | CUMPLE | `api/guardar.js` (`EDAD_MINIMA`/`calcularEdad()` de `lib/edad.js`), corre siempre que `fecha_nacimiento` viaje en el alta | Ninguna | — |
| P-03 | Verificación de edad mínima al **editar** la fecha de nacimiento después del onboarding | CUMPLE (2026-07-30, pendiente de deploy) | `api/guardar.js`: el chequeo de `fecha_nacimiento` ya no depende de `etapa_actual==='chat'` — corre también en el PATCH de `guardarMiPerfil()` (`soul.html:3322-3366`) | Ninguna sobre el código; deployar y verificar en vivo | Desarrollo (hecho) |
| P-04 | Declaración jurada explícita y separada de mayoría de edad (más allá de la fecha) | NO CONFIRMADO | `docs/privacy-launch/02-riesgos/decisiones-founder.md` Decisión 1: "La declaración explícita separada... queda pendiente de decidir" — sigue sin decidirse; fuera de alcance de este cambio (solo tocó el control técnico de P-01 a P-03) | Decidir si se agrega una casilla separada, además de la fecha de nacimiento | Producto/Legal |
| P-04b | Cuenta rechazada por edad mínima no queda huérfana (sin vía de autoeliminación) | CUMPLE (2026-07-30, pendiente de deploy) | `api/guardar.js` (`eliminarCuentaPorEdadMinima()`): si el rechazo ocurre en el alta (nunca en una edición de cuenta ya aprobada), borra de inmediato la fila `usuarios` y el usuario de Supabase Auth recién creados, con `SUPABASE_SERVICE_ROLE_KEY`, acotado al propio `usuarioId`/`authId` de quien pidió el guardado — no depende del cron de 30 días | Ninguna sobre el código; deployar y verificar en vivo (confirmar que no queda fila ni usuario de Auth tras el rechazo) | Desarrollo (hecho) |
| P-05 | Inferencias y perfilado (perfil vincular grupo1-4) documentados con su finalidad | CUMPLE | `docs/privacy-launch/01-auditoria/inferencias-ia.md`; `docs/privacy-launch/03-documentos/aviso-ia.md` | Ninguna | — |
| P-06 | Matching automatizado explicado a la persona usuaria | CUMPLE | `aviso-ia.md` secciones "Calcula compatibilidad"; `soul.html` sección 4-5 del consentimiento embebido | Ninguna | — |
| P-07 | Uso de Anthropic (IA) declarado con proveedor identificado, retención y uso para entrenamiento | CUMPLE (con nota) | `docs/privacy-launch/03-documentos/aviso-ia.md`; `docs/privacy-launch/02-riesgos/ficha-proveedores-transferencias.md` | Dato de retención/entrenamiento proviene de configuración de cuenta y documentación pública citada, no del código — no reverificable desde el repo. Mantener el `[REVISIÓN LEGAL]` ya puesto en `aviso-ia.md` | Legal externo |
| P-08 | Acceso administrativo a conversaciones/perfiles documentado y acotado a control de calidad/seguridad | PARCIAL | `soul.html:695-697` (texto del consentimiento); `lib/verificarAdmin.js` (contraseña única, sin 2FA) | El acceso está correctamente documentado, pero sigue protegido por una sola contraseña compartida sin 2FA (R-06, `matriz-riesgos.md`, sin evidencia de corrección posterior) | Desarrollo + Producto |
| P-09 | Retención diferenciada por tipo de dato, documentada | CUMPLE | `docs/privacy-launch/02-riesgos/propuesta-retencion.md`; `api/cron/diagnostico-diario.js` (`TABLAS_PERSONALES_A_BORRAR`, `RETENCION_DIAS`, `purgarCitaMensajesVencidos`) | Ninguna sobre lo implementado; ver P-10 sobre `reportes` | — |
| P-10 | Retención de `reportes` (denuncias) según lo publicado (5 años desde cierre) | NO CUMPLE | Ver `contradicciones.md` C-01 — no existe purga de `reportes` en el código; retención real hoy es indefinida | Corregir el documento público o implementar la purga real | Desarrollo + Legal |
| P-11 | Eliminación de cuenta con ventana de gracia de 30 días | CUMPLE | `api/auth.js` (`solicitarBorrado`); `api/cron/diagnostico-diario.js` (`purgarCuentasVencidas`) | Ninguna | — |
| P-12 | Comunicaciones (email/push) de producto sujetas a opt-in real | CUMPLE | `lib/email.js` (gate `comunicaciones_producto_aceptadas`); `lib/push.js:94-100` (mismo gate) | Ninguna | — |
| P-13 | Fotos: moderación de contenido antes de mostrarse a un match | NO CUMPLE | Ver `contradicciones.md` C-02 — `foto_aprobada` es autoconsentimiento del propio usuario, no revisión de un tercero | Decidir e implementar un mecanismo real de moderación (D-06, sigue abierta) | Producto + Desarrollo |
| P-14 | Reportes y bloqueos entre personas usuarias | CUMPLE | `api/matches.js` (reportar/bloquear); `reportes.estado` (`migracion_retencion_citas.sql`) | Ninguna sobre la existencia del mecanismo | — |
| P-15 | Política de menores: la app declara y valida que es exclusivamente para mayores de 18 | PARCIAL | Ver P-01 a P-04b — control técnico (edad, edición, cuenta huérfana) resuelto; queda abierta P-04 (declaración jurada separada, decisión de Producto/Legal, no técnica) | Cerrar P-04; deployar y verificar P-02/P-03/P-04b en vivo | Producto/Legal (decisión) + Desarrollo (deploy) |
| P-16 | Firebase Cloud Messaging: backend implementado y gateado por consentimiento | CUMPLE (backend) | `lib/push.js`; `migracion_push_tokens.sql` | Ninguna sobre el backend | — |
| P-17 | Firebase Cloud Messaging: artefacto Android actual incluye el cliente nativo | NO CUMPLE | Ver `contradicciones.md` C-04 — el AAB/APK de release en el repo es anterior a la integración de push | Recompilar tras `npx cap sync android` | Desarrollo |
| P-18 | Mecanismo para cuestionar inferencias del perfil | CUMPLE | `docs/privacy-launch/02-riesgos/decisiones-founder.md` Decisión 5; tabla `solicitudes_revision_perfil` en `TABLAS_CON_RLS` (`api/guardar.js:155`) | Ninguna | — |
| P-19 | RLS activo en tablas con datos personales indirectos (`rate_limits`, `uso_tokens`, `eventos_piloto`, `errores_silenciosos`, `diagnosticos_diarios`, `historial_relacional`, `push_tokens`) | CUMPLE (2026-07-30) | Ver `contradicciones.md` C-07 (resuelto) y `bloqueantes-finales.md` #3 — `migracion_rls_tablas_internas.sql` deployada (`a2fba74`), `relrowsecurity=true` confirmado en Supabase, `anon`/`authenticated` probados en vivo con `403 42501` en las 6 tablas, `service_role` confirmado funcionando para 4 de 6 (rate_limits, uso_tokens, eventos_piloto, diagnosticos_diarios); `errores_silenciosos`/`historial_relacional` protegidas por el mismo mecanismo pero sin ejercicio end-to-end del cron (evitado para no forzar purgas fuera de horario) | Ninguna sobre las 6 tablas server-side; opcional confirmar `errores_silenciosos`/`historial_relacional` en la próxima corrida programada del cron | — |

## 2. Onboarding y consentimiento

| ID | Control | Estado | Evidencia | Acción necesaria | Responsable sugerido |
|---|---|---|---|---|---|
| O-01 | Texto visible antes de aceptar (resumen breve) | CUMPLE | `soul.html:675-717` (modal de consentimiento con 9 secciones) | Ninguna | — |
| O-02 | Enlace a la política completa desde el propio flujo de registro | CUMPLE | `soul.html:676` (enlace a `legal.html`) — corrige el hallazgo previo H2/R-02 | Ninguna | — |
| O-03 | Checkbox principal no premarcado | CUMPLE | `soul.html:3851` (`mainOk=false` por defecto), `chkMain` clase `locked` hasta scrollear | Ninguna | — |
| O-04 | Checkbox opcional no premarcado | CUMPLE | `soul.html:3851,3871-3874` (`optOk=false` por defecto, "se deja desmarcado en cada carga") | Ninguna | — |
| O-05 | Registro inmediato del consentimiento | CUMPLE | `api/guardar.js` (`consentimiento_aceptado` viaja en el mismo PATCH que el resto del onboarding) | Ninguna | — |
| O-06 | Fecha y versión del consentimiento registradas | CUMPLE | `soul.html:3897-3899` (`consentimiento_fecha`, `consentimiento_version`, `politica_privacidad_version`) | Ninguna | — |
| O-07 | Aviso de datos sensibles dentro del flujo de consentimiento | PARCIAL | `soul.html` texto embebido no tiene una sección "datos sensibles" tan explícita como `docs/privacy-launch/03-documentos/consentimiento-datos-sensibles.md`, que está redactado como pantalla aparte pero **no confirmado si está integrado al flujo real de `soul.html`** | Confirmar si `consentimiento-datos-sensibles.md` ya se implementó como pantalla separada o sigue siendo solo un borrador de `03-documentos/` | Desarrollo + Producto |
| O-08 | Aviso de uso de IA dentro del consentimiento | CUMPLE | `soul.html` sección de IA en el texto embebido; `aviso-ia.md` como documento ampliado | Ninguna | — |
| O-09 | Transferencias internacionales mencionadas | CUMPLE | `soul.html:701` ("pueden procesar datos fuera de Argentina, incluido Estados Unidos") | Ninguna | — |
| O-10 | Declaración de mayoría de edad dentro del consentimiento | CUMPLE | `soul.html:702` (texto reescrito 2026-07-30 para reflejar exactamente lo que valida el código: "al registrarla y cada vez que la modificás", sin afirmar verificación de identidad ni documental) | Ver P-04 sobre si además se quiere una casilla separada | Producto/Legal |
| O-11 | Comunicaciones opcionales (email + push) con opt-in real y revocable | CUMPLE | `soul.html:724-727,3893-3900`; "Mi perfil" (`mpComsProducto`) | Ninguna | — |
| O-12 | Consentimiento de datos sensibles como pantalla separada, opt-in explícito, no inferible del uso continuado | NO CONFIRMADO | `consentimiento-datos-sensibles.md` (03-documentos) está redactado para eso, pero no se encontró en `soul.html` una pantalla separada equivalente — el consentimiento de datos sensibles hoy parece estar fusionado dentro del modal general (`chkMain`) | Confirmar con Producto/Desarrollo si esta pantalla separada está planeada o ya implementada en una parte del código no revisada | Producto + Desarrollo |

## 3. Eliminación de cuenta

| ID | Control | Estado | Evidencia | Acción necesaria | Responsable sugerido |
|---|---|---|---|---|---|
| E-01 | Opción de eliminar cuenta dentro de la app | CUMPLE | `api/auth.js` (`solicitarBorrado`); "Mi perfil" en `soul.html` | Ninguna | — |
| E-02 | Página web pública o mecanismo externo de eliminación (fuera de la app) | NO CONFIRMADO | No se encontró una página web pública standalone de solicitud de borrado (requisito habitual de Google Play para apps que permiten registro sin la app, o como alternativa) | Confirmar si Google Play exige esto para Soul (depende de si el registro es posible solo desde la app o también desde la web — Soul es una PWA, el registro es vía `soul.html`, accesible desde navegador) — [VERIFICAR EN POLÍTICA DE GOOGLE PLAY] | Producto |
| E-03 | Plazo de 30 días documentado y aplicado | CUMPLE | `eliminacion-cuenta.md`; `api/cron/diagnostico-diario.js` (`purgarCuentasVencidas`) | Ninguna | — |
| E-04 | Borrado de Supabase Auth (credencial real) | PARCIAL | `api/cron/diagnostico-diario.js:74-103` — depende de `SUPABASE_SERVICE_ROLE_KEY`; `eliminacion-cuenta.md:25` dice "la configuración... está confirmada en producción" pero también deja `[PENDIENTE DE PRODUCTO — confirmar sobre un caso real completo]" | Verificar en un caso real de borrado completo que la cuenta de Supabase Auth efectivamente desaparece | Producto (verificación directa) |
| E-05 | Anonimización de la fila de `usuarios` | CUMPLE | `api/cron/diagnostico-diario.js` (anonimización in-place, tombstone `borrada-{id}@soul-app.eliminado`) | Ninguna | — |
| E-06 | Citas compartidas: identidad anonimizada para la otra persona | CUMPLE | `lib/authUtil.js` (`nombreMostrable()`), aplicado en `api/citas.js`, `api/matches.js`, `api/admin/personas.js`, `api/admin/comparar.js`, `lib/email.js` según `decisiones-founder.md` (Decisión 6, nota 2026-07-29) | Ninguna | — |
| E-07 | Retención por reportes abiertos (frena purga) | CUMPLE | `api/cron/diagnostico-diario.js:242-247` (`purgarCitaMensajesVencidos` consulta `reportes` con `estado=eq.abierto` por `match_id`) | Ninguna | — |
| E-08 | Confirmación al usuario de que la eliminación fue solicitada/procesada | NO CONFIRMADO | No se verificó en el código un email o pantalla de confirmación explícita post-solicitud (más allá del corte de acceso inmediato) | Confirmar si existe un email/mensaje de confirmación de la solicitud de borrado | Desarrollo |
| E-09 | Cancelación del pedido de eliminación durante el período de gracia | NO CUMPLE | `eliminacion-cuenta.md:16`: "no está confirmado si existe hoy una forma de arrepentirte y cancelar el pedido" — no se encontró ningún endpoint de cancelación en `api/auth.js` | Decidir si se implementa un mecanismo de cancelación o se documenta que no existe (solo canal manual por email) | Producto + Desarrollo |

## 4. Google Play — Data Safety

Ver `borrador-data-safety.md` para el detalle completo por tipo de dato. Resumen de cobertura:

| ID | Categoría | Estado | Nota |
|---|---|---|---|
| D-01 | Fotos | CUMPLE (declarado) | Ver P-13 sobre moderación — no es un problema de declaración, sino de producto |
| D-02 | Chats/mensajes | CUMPLE (declarado) | — |
| D-03 | Inferencias/perfilado | CUMPLE (declarado) | — |
| D-04 | Actividad dentro de la app | CUMPLE (declarado) | — |
| D-05 | Datos de contacto (email, nombre) | CUMPLE (declarado) | — |
| D-06 | Identificadores (ID interno) | CUMPLE (declarado) | — |
| D-07 | Diagnósticos técnicos | CUMPLE (declarado) | — |
| D-08 | Reportes | PARCIAL | Ver C-01/P-10 — retención declarada no coincide con el código |
| D-09 | Comunicaciones | CUMPLE (declarado) | — |
| D-10 | Ubicación | CUMPLE (declarado, ciudad manual, sin GPS) | — |
| D-11 | Pagos | CUMPLE (declarado: sin pagos activos) | `lib/authUtil.js` (`TODOS_PRO_TEMPORAL = true`), sin StoreKit/IAP integrado |
| D-12 | Publicidad | CUMPLE (declarado: sin publicidad) | Sin SDKs de ads detectados |
| D-13 | Analytics | CUMPLE (declarado: sin analítica de terceros) | Métricas propias agregadas (`uso_tokens`, `eventos_piloto`) |

## 5. Google Play — requisitos de app de citas

| ID | Control | Estado | Evidencia | Acción necesaria |
|---|---|---|---|---|
| G-01 | Restricción para menores (declaración + control técnico) | PARCIAL | Ver P-01 a P-04b — control técnico resuelto; falta cerrar P-04 (decisión de Producto/Legal) y completar en Play Console la sección "Público objetivo y contenido" (marcar únicamente "18 años o más", habilitar "Restringir acceso a menores") además del cuestionario IARC | Cerrar P-04; completar la sección de audiencia en Play Console |
| G-02 | Controles y reportes entre usuarios | CUMPLE | `api/matches.js`; `reportes` | Ninguna |
| G-03 | Bloqueos | CUMPLE | Mecanismo de "eliminar/bloquear" descrito en `01-auditoria/auditoria-privacidad-seguridad.md` sección 10 | Confirmar que sigue vigente (no re-verificado línea por línea en esta ronda) |
| G-04 | Moderación de contenido generado por usuarios (fotos, texto) | NO CUMPLE (fotos) / PARCIAL (texto) | Ver P-13; filtro de prompt injection existe para el chat con la IA (`lib/seguridadPrompt.js`) pero no hay moderación de contenido de fotos ni de texto libre entre personas | [VERIFICAR EN POLÍTICA DE GOOGLE PLAY] el nivel de moderación exigido; decidir e implementar |
| G-05 | Eliminación de cuenta accesible y funcional | CUMPLE (con notas) | Ver sección 3 | Cerrar E-04/E-08/E-09 |
| G-06 | Política pública accesible desde la ficha/app | PARCIAL | `legal.html` accesible y enlazado; no confirmado si la URL pública está cargada en el campo correspondiente de Play Console (dato fuera del repo) | Confirmar en Play Console | Producto |
| G-07 | Consistencia entre ficha de Play Store, app y política | PARCIAL | Ver `contradicciones.md` C-09 sobre el `ficha-play-store.md` desactualizado en la raíz del repo | Usar `04-play-store/ficha-play-store.md` (este encargo) como fuente | Producto |

## 6. Android

| ID | Control | Estado | Evidencia | Acción necesaria |
|---|---|---|---|---|
| A-01 | Permisos declarados mínimos | CUMPLE (fuente) / NO CONFIRMADO (build actual) | `AndroidManifest.xml` fuente solo declara `INTERNET`; el manifest fusionado del build de release actual tampoco agrega `POST_NOTIFICATIONS` porque es anterior a la integración de push (ver C-04) | Recompilar y reverificar el manifest fusionado |
| A-02 | Firebase Cloud Messaging correctamente integrado en el build | NO CUMPLE | Ver C-04/P-17 | Recompilar tras `npx cap sync android` |
| A-03 | INTERNET declarado | CUMPLE | `AndroidManifest.xml:34` | Ninguna |
| A-04 | Cámara/galería | CUMPLE (no aplica) | Fotos vía `<input type="file">` del WebView, sin permiso nativo de cámara | Ninguna |
| A-05 | Ubicación | CUMPLE (no aplica) | Sin permiso de ubicación; ciudad es texto manual | Ninguna |
| A-06 | Almacenamiento | CUMPLE (no aplica) | Sin permiso de almacenamiento declarado; fotos van embebidas en base64 vía la app web | Ninguna |
| A-07 | Notificaciones | PARCIAL | Backend listo, cliente Android no recompilado con el plugin (ver A-02) | Recompilar |
| A-08 | versionCode/versionName | NO CUMPLE | `build.gradle:19-20`: `versionCode 1`, `versionName "1.0"`, sin incrementar desde el estado "debug" original | Incrementar en el mismo paso de recompilación |
| A-09 | APK/AAB de release generado | CUMPLE (artefacto existe, desactualizado) | `android/app/build/outputs/bundle/release/app-release.aab` existe — resuelve el hallazgo previo de "solo hay debug" — pero ver C-04 | Regenerar |
| A-10 | Firma de producción / keystore | CUMPLE | `soul-app-native/keystore/soul-release.jks`, `android/keystore.properties`, `build.gradle:28-37` (signingConfig condicional), ambos correctamente excluidos de git (`android/.gitignore`) | Ninguna sobre la configuración; asegurar backup seguro del keystore (irrecuperable si se pierde) |
| A-11 | target SDK | CUMPLE (a confirmar vigencia) | `variables.gradle`: `targetSdkVersion = 36`, `minSdkVersion = 24` | [VERIFICAR EN POLÍTICA DE GOOGLE PLAY] si 36 es el mínimo vigente al momento de subir |
| A-12 | Nombre de paquete consistente | CUMPLE | `love.soulapp.app` en `capacitor.config.json`, `build.gradle` (`applicationId`/`namespace`) | Ninguna |
| A-13 | Enlaces profundos (deep links) | CUMPLE (no aplica) | Sin `intent-filter` de datos/esquema declarado; no se identificó una necesidad de deep link (ej. reset de contraseña resuelve vía web) | Ninguna, salvo que Producto decida agregar uno |
| A-14 | Política de privacidad enlazada desde la app | CUMPLE | `soul.html:676`, `index.html` footer | Ninguna |
| A-15 | Política de privacidad enlazada desde la ficha de Play Console | NO CONFIRMADO | Dato de configuración de Play Console, fuera del repo | Confirmar al cargar la ficha | Producto |

## 7. Coherencia de proveedores

| ID | Proveedor | Estado | Nota |
|---|---|---|---|
| V-01 | Anthropic | CUMPLE (declarado, no verificable en código) | Región/retención/entrenamiento confirmados por la founder + documentación pública citada (`ficha-proveedores-transferencias.md`), no por el repo |
| V-02 | Supabase | CUMPLE (declarado, no verificable en código) | Región `sa-east-1` confirmada por la founder en el dashboard, no verificable desde el código |
| V-03 | Resend | CUMPLE (declarado, no verificable en código) | Región de envío confirmada por la founder; metadatos/subprocesadores en EE.UU. según documentación pública citada |
| V-04 | Vercel | NO CONFIRMADO | Región de las funciones serverless no confirmada en ningún documento (`resumen-data-safety.md` lo marca `[NO CONFIRMADO]`) |
| V-05 | Firebase Cloud Messaging | PARCIAL | Backend implementado; ver C-04 sobre el build Android; región de procesamiento no confirmada |
| V-06 | Google Fonts | CUMPLE (declarado) | `politica-cookies-tecnologias.md`; sin control de consentimiento de cookies (no aplica, Google Fonts no usa cookies de terceros para esto, pero sí comparte IP) |
| V-07 | SDKs adicionales no detectados | CUMPLE | No se detectaron pasarelas de pago, analítica de terceros, publicidad ni geolocalización activos |

---

Ver `bloqueantes-finales.md` para la lista consolidada de qué impide hoy cargar Soul en Play Console.
