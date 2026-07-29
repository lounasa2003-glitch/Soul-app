# Decisiones para la founder — Soul

> Agente 2. Este documento no toma ninguna decisión: convierte los riesgos y preguntas ya identificados en `matriz-riesgos.md`, `minimizacion-datos.md`, `decisiones-producto.md` y `preguntas-pendientes.md` en una lista corta de decisiones que la responsable de Soul (Lourdes) tiene que resolver antes de que el Agente 3 redacte cualquier política pública. No se modificó código. No se redactó ninguna política pública. No se afirma ninguna obligación legal definitiva — donde hace falta, se marca "revisión legal recomendada" en vez de decirlo como un hecho.

---

## Decisión 1 — Verificación de edad mínima

- **ID relacionado**: R-01, D-01, P-12
- **Tema**: Verificar que quien se registra sea mayor de 18 años
- **Situación actual comprobada**: Hoy no hay ningún control de edad, ni en la pantalla ni en el servidor. El campo de fecha de nacimiento acepta cualquier valor, con tal de que no esté vacío.
- **Opciones posibles**:
  - **A.** Bloquear en el servidor cualquier registro de menos de 18 años, solo con la fecha que la persona ya escribe.
  - **B.** Igual que A, más una frase separada donde la persona declara explícitamente que es mayor de edad.
  - **C.** Pedir verificación con documento de identidad (servicio externo).
- **Recomendación técnica y de producto**: Para el piloto cerrado actual, A o B alcanza y es rápido de implementar. C solo se justifica si Soul se prepara para un lanzamiento público en Play Store.
- **Consecuencia de cada opción**:
  - A: Barato y rápido, pero no evita que alguien escriba una fecha falsa.
  - B: Igual que A, y deja un registro más claro de que la persona lo declaró.
  - C: Más fricción y costo, pero es lo que suele esperar Google Play de una app de citas.
- **¿Bloquea el lanzamiento?**: **Sí.**
- **¿Requiere revisión legal?**: Recomendable, para confirmar qué nivel alcanza.
- **Decisión final**: Decisión final: Opción A implementada. Soul valida la edad mínima de 18 años en el cliente y obligatoriamente en el servidor antes de habilitar el chat. La declaración explícita separada de mayoría de edad queda pendiente de decidir.

---

## Decisión 2 — Consentimiento real (lo que la persona lee y acepta)

- **ID relacionado**: R-02
- **Tema**: El texto que se muestra y se acepta al registrarse es más corto que el documento legal completo
- **Situación actual comprobada**: Falta en ese texto: quién es responsable del tratamiento, la base legal, la sección de datos sensibles, las transferencias internacionales, el aviso de incidentes, y varios de los derechos que sí aparecen en el documento largo. Tampoco hay un enlace al documento completo desde esa pantalla.
- **Opciones posibles**:
  - **A.** Que la pantalla de registro muestre el mismo documento completo que ya existe (`legal.html`).
  - **B.** Mantener un texto corto, pero agregar un enlace obligatorio al documento completo antes de poder aceptar.
  - **C.** Dejarlo como está.
- **Recomendación técnica y de producto**: A o B. C no se recomienda porque debilita la validez de todo el consentimiento sobre el que se apoya el resto del tratamiento de datos.
- **Consecuencia de cada opción**:
  - A: Más prolijo, requiere ajustar la pantalla de registro.
  - B: Menos trabajo técnico, pero depende de que la persona realmente abra el enlace.
  - C: El riesgo de un consentimiento incompleto se mantiene.
- **¿Bloquea el lanzamiento?**: **Sí.**
- **¿Requiere revisión legal?**: Sí, imprescindible.
- **Decisión final**: Decisión final: Opción B implementada, migrada, desplegada y verificada en producción. El consentimiento resumido enlaza al documento completo, incluye los puntos esenciales y registra inmediatamente fecha y versiones aceptadas.

---

## Decisión 3 — Resumen de cita para uso del panel admin

- **ID relacionado**: R-03, D-02
- **Tema**: El resumen de cada cita se genera y se manda a la IA sin revisar si las dos personas dieron su consentimiento de análisis
- **Situación actual comprobada**: A diferencia de otros dos análisis de la misma cita, este resumen se genera siempre, con o sin ese consentimiento.
- **Opciones posibles**:
  - **A.** Aplicarle el mismo control de consentimiento que a los otros dos análisis.
  - **B.** Declarar este resumen como una función necesaria para la seguridad del piloto, distinta del análisis de perfil, y explicarlo así con claridad.
- **Recomendación técnica y de producto**: A es lo más coherente con lo que la app ya promete hoy. B solo tiene sentido si Soul decide que supervisar la seguridad del piloto pesa más que respetar ese consentimiento puntual, y lo explica bien.
- **Consecuencia de cada opción**:
  - A: La administradora se queda sin resumen en las citas donde no hubo consentimiento.
  - B: El resumen se sigue generando siempre, pero hay que explicarlo con cuidado para no contradecir lo que la persona entendió al aceptar o rechazar el análisis.
- **¿Bloquea el lanzamiento?**: **Sí.**
- **¿Requiere revisión legal?**: Recomendable si se elige la opción B.
- **Decisión final**: Decisión final: Opción A. El resumen administrativo de la cita solo se generará cuando ambas personas hayan consentido el análisis. Si alguna no consiente, no se enviará la transcripción a la IA ni se generará el resumen. Los reportes de seguridad deberán funcionar por un canal separado y no depender de este análisis.
- **Estado real de implementación**: Implementado, desplegado y verificado en producción (2026-07-28). `generarResumenCitaEnSegundoPlano` (`lib/cierreCita.js`) ahora chequea `consiente_analisis_a === true && consiente_analisis_b === true` en la propia `cita` antes de leer `cita_mensajes` o llamar a Anthropic. Si no se cumple, no se lee la transcripción, no hay llamada a la IA, y `resumen_ia` queda en `{estado:'no_generado', motivo:'Sin consentimiento de análisis de ambas personas'}` -- un valor explícito, no null ni un resumen vacío. `panel-admin.html` muestra ese estado con un mensaje claro en vez de listar los campos como "no explorado". De paso se corrigió el `select` de citas en el modo `citaMensajes` de `api/admin/personas.js`, que no traía `consiente_analisis_a/b` -- sin eso, el nuevo chequeo hubiera bloqueado el resumen por error en cualquier cierre disparado desde ese camino admin, aunque el consentimiento real fuera `true/true`. Probado en producción con las cuentas de Vista Previa (`preview@soul-app.test`/`preview-alex@soul-app.test`, excluidas del matching real): caso ambas-consienten generó el resumen real; caso una-no-consiente mostró el estado "No generado" sin llamar a la IA. No se tocaron reportes, denuncias ni bloqueos.
Decisión final: Opción A implementada, desplegada y verificada en producción. El resumen administrativo solo se genera cuando ambas personas consienten el análisis. Si una no consiente, no se lee la transcripción ni se envían datos a Anthropic, y el panel muestra “No generado por falta de consentimiento”.
---

## Decisión 4 — Comunicaciones "opcionales"

- **ID relacionado**: R-04, D-03
- **Tema**: Las comunicaciones que el texto legal presenta como opcionales se envían siempre, a todas las personas
- **Situación actual comprobada**: El checkbox opcional no guarda nada en ningún lado. Ningún envío de email de producto (nuevo match, recordatorios, etc.) revisa ningún consentimiento.
- **Opciones posibles**:
  - **A.** Guardar el estado del checkbox y usarlo para frenar esos envíos.
  - **B.** Separar comunicaciones esenciales (confirmación de cuenta) de comunicaciones de producto, y frenar solo estas últimas con un consentimiento real.
  - **C.** Cambiar el texto legal para ya no prometer esa opción.
- **Recomendación técnica y de producto**: B. Es la que más se ajusta a lo que hoy se le promete a la persona usuaria.
- **Consecuencia de cada opción**:
  - A: Simple, pero no distingue qué comunicaciones son realmente esenciales.
  - B: Más trabajo (una columna nueva, una pantalla en "Mi perfil"), pero es lo más consistente.
  - C: Menos trabajo técnico, pero cambia lo que se le dice a la persona usuaria.
- **¿Bloquea el lanzamiento?**: **Sí.**
- **¿Requiere revisión legal?**: Sí, si se elige la opción C.
- **Decisión final**: Decisión final: Opción B implementada, desplegada y verificada en producción. Soul separa las comunicaciones esenciales de las comunicaciones de producto. Las comunicaciones de producto solo se envían cuando comunicaciones_producto_aceptadas === true, y la persona puede cambiar esta preferencia desde “Mi perfil”. Las comunicaciones esenciales continúan funcionando independientemente de esta elección.
- **Estado real de implementación**: Implementado, desplegado y verificado en producción (2026-07-28) siguiendo la Opción B. Se agregaron `comunicaciones_producto_aceptadas` (boolean, default `false`) y `comunicaciones_producto_fecha` (timestamptz) a `usuarios`. Las seis funciones de `lib/email.js` que notifican eventos de producto (`notificarNuevoMatch`, `notificarDatosIncompletos`, `notificarSalaEncuentrosPendiente`, `notificarMatchSinDecision`, `notificarCitaSinMensaje`, `notificarMensajeCita`) ahora cortan antes de armar el mail o llamar a Resend si `comunicaciones_producto_aceptadas !== true` (cualquier `false`/`null`/`undefined` bloquea el envío). `notificarConfirmarMail` (confirmación de cuenta) y la recuperación de contraseña de Supabase Auth no se tocaron -- siguen saliendo siempre, sin depender de esta preferencia. El checkbox opcional del consentimiento (`soul.html`, antes sin ninguna variable asociada, y con un texto que ni siquiera hablaba de comunicaciones) ahora arranca desmarcado, se guarda con fecha en el mismo PATCH inmediato del resto del consentimiento, y su texto se corrigió para reflejar lo que realmente controla. Se agregó el mismo control, cargado y editable, en "Mi perfil". Probado en producción con una cuenta de prueba real: aceptar en el consentimiento guardó `true` con fecha; desmarcar y guardar desde "Mi perfil" lo volvió a `false` con fecha actualizada -- verificado leyendo la fila directamente vía `/api/leer` con el token propio de la cuenta (no requiere admin, a diferencia de la Decisión 3). No se tocó `consiente_analisis_a/b` (Decisión 3) ni ningún otro bloqueante. Nota aparte, no bloqueante: se encontró una columna preexistente `consentimiento_datos_anonimos` en `usuarios` (el otro punto opcional del texto legal, "contribuir con datos anonimizados") que no tiene ningún control en la UI -- quedó fuera del alcance de esta decisión.

---

## Decisión 5 — Corrección de inferencias del perfil

- **ID relacionado**: R-13, D-04
- **Tema**: El texto legal promete que la persona puede cuestionar o pedir revisión de una inferencia sobre su perfil, pero eso no existe hoy
- **Situación actual comprobada**: Solo hay una herramienta interna, de uso exclusivo de la administradora, que reconstruye todo el perfil desde cero. No hay ninguna forma de que la persona pida corregir un dato puntual.
- **Opciones posibles**:
  - **A.** Crear un mecanismo simple, aunque sea manual (por ejemplo, un botón "no estoy de acuerdo con mi perfil" que active una revisión de la administradora).
  - **B.** Quitar esa promesa del texto legal hasta tener un mecanismo real.
- **Recomendación técnica y de producto**: A, aunque sea manual al principio, para sostener lo que ya se promete.
- **Consecuencia de cada opción**:
  - A: Implica trabajo de producto y de operación (alguien tiene que atender esos pedidos).
  - B: Menos trabajo, pero Soul le ofrece menos control a la persona sobre su propio perfil.
- **¿Bloquea el lanzamiento?**: No bloquea el piloto actual, pero conviene resolverlo antes de un lanzamiento más amplio.
- **¿Requiere revisión legal?**: Recomendable.
- **Decisión final**:Decisión final: Opción A. Soul ofrecerá un mecanismo manual para cuestionar inferencias del perfil desde “Mi perfil”. La solicitud quedará registrada y será revisada por la administradora, con estado y respuesta trazables. 

---

## Decisión 6 — Retención de conversaciones y mensajes

- **ID relacionado**: R-15, R-16, D-10
- **Tema**: No hay un tiempo límite definido para guardar conversaciones, y varias tablas con contenido personal nunca se borran
- **Situación actual comprobada**: Las conversaciones se guardan "mientras la cuenta esté activa", sin tope. Siete tablas con contenido personal (incluido el debriefing privado que la persona nunca comparte con nadie) no están en la lista de borrado de los 30 días.
- **Opciones posibles**:
  - **A.** Definir un límite concreto de retención y aplicarlo también a esas siete tablas.
  - **B.** Mantener la retención actual, pero documentar por qué se conserva cada una (igual que ya está explicado para los mensajes compartidos con el match).
- **Recomendación técnica y de producto**: A para el debriefing privado y las tablas sin ninguna razón documentada; B solo donde ya existe un motivo real (como no borrar el historial de la otra persona de un match).
- **Consecuencia de cada opción**:
  - A: Menos datos guardados, menor exposición si hay un problema de seguridad más adelante.
  - B: Se mantiene todo como está, pero queda un vacío sin explicar.
- **¿Bloquea el lanzamiento?**: No, pero está en el plan inmediato.
- **¿Requiere revisión legal?**: Recomendable, para fijar el límite concreto.
- **Decisión final**: Aprobada con plazos diferenciados por tabla (no un único plazo para todo): `cita_reflexiones`, `cita_ayudas` y `solicitudes_revision_perfil` se suman a la purga de 30 días tras eliminar la cuenta. `conversaciones`, `perfiles` e `historial_relacional` se mantienen igual (activos mientras la cuenta esté activa, 30 días tras la baja). `reportes_tecnicos` se purga automáticamente a los 6 meses. `errores_silenciosos` y `diagnosticos_diarios` se purgan automáticamente a los 90 días. `feedback_piloto` se anonimiza (no se borra el contenido) al eliminar la cuenta. `cita_mensajes` y `citas` (compartidos entre dos personas) quedan **PENDIENTE DE REVISIÓN** el plazo por antigüedad de la cita -- se conservan por ahora. `reportes` queda **PENDIENTE DE REVISIÓN LEGAL** -- se conserva por ahora por motivos de seguridad.
- **Estado real de implementación**: Implementado y pendiente de despliegue (2026-07-28) -- ver detalle de archivos, migración y pruebas en el resumen de esta conversación. `TABLAS_PERSONALES_A_BORRAR` (`api/cron/diagnostico-diario.js`) suma `cita_reflexiones`, `cita_ayudas` y `solicitudes_revision_perfil` (mismo mecanismo de siempre: DELETE por `usuario_id`, corrido por el cron diario a los 30 días de `solicitarBorrado`). `feedback_piloto` se anonimiza con un PATCH (`usuario_id: null`) en vez de un DELETE, en el mismo punto del flujo de borrado. Se agregó `purgarPorAntiguedad()`, una purga nueva e independiente de la baja de cuenta, que corre en cada corrida del cron diario y borra filas de `reportes_tecnicos` (180 días), `errores_silenciosos` (90 días) y `diagnosticos_diarios` (90 días) por su propia fecha (`creado_en`), sin importar si la cuenta relacionada sigue activa o no. `cita_mensajes`, `citas` y `reportes` no se tocaron -- quedan explícitamente marcados como pendientes en `propuesta-retencion.md`, tal como se aprobó. Migración `migracion_retencion_datos.sql` (`ALTER TABLE feedback_piloto ALTER COLUMN usuario_id DROP NOT NULL`) pendiente de correr en Supabase antes del deploy.
Decisión final: Opción A implementada y desplegada. Soul conserva conversaciones, perfiles e historial relacional mientras la cuenta está activa y los elimina 30 días después de la baja. También elimina a los 30 días cita_reflexiones, cita_ayudas y solicitudes_revision_perfil; anonimiza feedback_piloto; y aplica purga automática de 180 días para reportes_tecnicos y 90 días para errores_silenciosos y diagnosticos_diarios. Quedan pendientes de revisión los plazos de cita_mensajes, citas y reportes.

---

## Decisión 7 — Proveedores de IA y transferencia de datos al exterior

- **ID relacionado**: R-12, P-02, P-03, P-09
- **Tema**: No está confirmado si Anthropic puede usar los datos de Soul para entrenar sus modelos, ni en qué país procesan los datos Supabase/Resend/Anthropic
- **Situación actual comprobada**: No hay evidencia de un acuerdo de "no usar estos datos para entrenar modelos" con Anthropic. Tampoco está confirmada la región de ninguno de los tres proveedores.
- **Opciones posibles**:
  - **A.** Consultar directamente a cada proveedor y reflejar la respuesta con precisión.
  - **B.** Dejarlo como está (aviso genérico, sin detalle por proveedor).
- **Recomendación técnica y de producto**: A. Es información que se puede conseguir preguntando, sin ningún cambio de código.
- **Consecuencia de cada opción**:
  - A: Da certeza real sobre qué pasa con los datos más sensibles (perfiles psicológicos, transcripciones de citas) fuera de Soul.
  - B: El texto legal sigue siendo impreciso en este punto.
- **¿Bloquea el lanzamiento?**: No bloquea el piloto actual, pero es necesario antes de completar el formulario de Play Store.
- **¿Requiere revisión legal?**: Sí.
- **Decisión final**: Opción A completada. Se confirmó que Supabase opera en São Paulo (sa-east-1), Resend envía desde São Paulo (sa-east-1) y Anthropic conserva entradas y salidas durante 30 días, sin Zero Data Retention activado. Esta información deberá reflejarse en la política de privacidad, el aviso de IA y el expediente para Play Store.
- **Estado real de investigación (2026-07-28)**: Actualizada con documentación oficial vigente de los tres proveedores más la configuración real confirmada por la founder en cada cuenta -- ver detalle completo y citas en `ficha-proveedores-transferencias.md`. Confirmado con evidencia oficial + configuración real (no inferido): (1) **Anthropic** -- Soul usa la API comercial, no una cuenta de consumidor (confirmado por diseño técnico: una API key de `api.anthropic.com` no puede emitirse desde una cuenta Claude.ai Free/Pro/Max); los datos **no** se usan para entrenar modelos por defecto; **retención activada por 30 días, sin Zero Data Retention** (confirmado directamente en la cuenta). (2) **Supabase** -- **región confirmada: `sa-east-1` (São Paulo, Brasil)**; corre sobre infraestructura AWS, con Google también como subprocesador. (3) **Resend** -- **región de envío del dominio `soulapp.love` confirmada: `sa-east-1` (São Paulo, Brasil)**; aclaración importante: eso es solo la región desde donde se despachan los correos -- los metadatos/logs de la cuenta y la mayoría de los subprocesadores de Resend (lista completa confirmada) siguen operando en Estados Unidos de todas formas, sin importar la región de envío elegida; los datos concretos que Soul le envía (email, nombre, contenido de la notificación -- nunca el contenido real de una conversación) están verificados en el código. Con esto, ya hay información suficiente para reflejar transferencias internacionales en el texto legal, redactar el aviso de IA y completar Data Safety de Play Console. Queda pendiente, no bloqueante: si Supabase tiene réplicas en otras regiones además de `sa-east-1`, y la lista completa (no solo los principales) de subprocesadores de Anthropic y Supabase. No se modificó código ni configuración de ninguna cuenta.

---

## Decisión 8 — Datos que quizás no hace falta pedir

- **ID relacionado**: minimización 1.1, P-07, D-05
- **Tema**: Se pide la hora exacta de nacimiento sin que se haya encontrado ninguna función que la use
- **Situación actual comprobada**: Se guarda desde "Mi perfil", pero no aparece usada en ningún análisis de IA ni en el cálculo de compatibilidad.
- **Opciones posibles**:
  - **A.** Confirmar si hay una función real (actual o planeada) que la necesite.
  - **B.** Si no la hay, dejar de pedirla.
- **Recomendación técnica y de producto**: B, salvo que exista una razón de producto concreta todavía no documentada.
- **Consecuencia de cada opción**:
  - A: Si hay un uso real, se mantiene el campo y se documenta para qué sirve.
  - B: Se deja de pedir un dato personal sin finalidad clara.
- **¿Bloquea el lanzamiento?**: No.
- **¿Requiere revisión legal?**: No es indispensable, pero ayuda a justificar por qué se pide cada dato.
- **Decisión final**: Opción B implementada. Soul deja de solicitar y guardar la hora de nacimiento porque no existe una finalidad actual comprobada. La columna histórica queda temporalmente en la base de datos, sin nuevos datos, hasta una futura migración de limpieza.
- **Estado real de implementación (2026-07-28)**: Implementado y pendiente de despliegue. Se confirmó por búsqueda exhaustiva en todo el repositorio que `hora_nacimiento` no se usa en ningún prompt de IA, en el matching (`lib/matchCompatible.js`), en la compatibilidad (`lib/comparePrompt.js`), en ningún filtro, en el panel admin (`panel-admin.html`/`api/admin/*.js`) ni en reportes -- tampoco estaba nunca en `CAMPOS_BASICOS_REQUERIDOS` (`api/guardar.js`) ni en `CAMPOS_FORMULARIO` (`soul.html`), es decir, nunca fue obligatoria ni contaba para el porcentaje de perfil completo. Se eliminaron los 5 puntos donde el código la pedía/guardaba/mostraba: el campo del formulario de onboarding (Etapa 1), el campo de "Mi perfil", y los tres puntos de JS que la enviaban o cargaban (`guardarUsuarioYContinuar`, `mostrarMiPerfil`, `guardarMiPerfil`) en `soul.html`. La columna en Supabase **no se borra** -- se agregó `migracion_hora_nacimiento_obsoleta.sql` (`COMMENT ON COLUMN usuarios.hora_nacimiento IS 'OBSOLETA...'`), que solo documenta la columna como obsoleta en el esquema sin tocar ningún valor. El único lugar del código que todavía menciona `hora_nacimiento` es la anonimización al eliminar una cuenta (`api/cron/diagnostico-diario.js`), que sigue poniéndola en `null` junto con el resto de los datos personales -- eso es borrado, no una escritura nueva, así que se dejó igual a propósito.
