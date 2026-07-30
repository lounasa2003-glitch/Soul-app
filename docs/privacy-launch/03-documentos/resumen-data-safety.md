# Borrador técnico para el formulario Data Safety de Google Play (uso interno)

> Uso interno, para asistir al llenado del formulario "Seguridad de los datos" de Play Console. No es un documento público. Basado en `01-auditoria/` y `02-riesgos/`. Donde el dato no está confirmado en los documentos fuente, se indica literalmente `[NO CONFIRMADO — verificar antes de completar el formulario]`, tal como exige el encargo de este documento. **Nota transversal importante**: antes de completar el formulario real de Play Console, confirmar que la versión de la app efectivamente publicada refleja todas las correcciones descritas en `plan-correcciones.md` y `decisiones-founder.md` (varias ya implementadas y desplegadas al 2026-07-29, según esos documentos).

## 1. ¿Recolecta o comparte datos del usuario esta app?

Sí.

## 2. Tipos de datos recolectados

### Información personal

| Dato | ¿Se recolecta? | ¿Obligatorio u opcional? | Finalidad | ¿Se comparte con terceros? |
|---|---|---|---|---|
| Nombre | Sí | Obligatorio | Funcionalidad de la app, comunicación entre personas usuarias | Sí — con tu match y con Supabase/Resend/Anthropic como proveedores |
| Email | Sí | Obligatorio | Cuenta/autenticación, comunicaciones | No a otras personas usuarias; sí a Supabase (autenticación) y Resend (envío de emails) como proveedores |
| Fecha de nacimiento | Sí | Obligatorio | Verificación de edad mínima (18+), cálculo de edad mostrada a un match | Se comparte la edad calculada, no la fecha cruda |
| Dirección/ubicación | Sí (ciudad, dato de texto ingresado manualmente — no geolocalización por GPS) | Obligatorio | Filtro de compatibilidad por cercanía | Sí — ciudad visible para un match |
| Otra información de identidad (género, preferencia, estado civil, ocupación, hijos, tipo de vínculo) | Sí | Obligatorio | Perfil, filtro de matching | Sí — visible para un match potencial |

### Fotos

| Dato | ¿Se recolecta? | ¿Obligatorio u opcional? | Finalidad | ¿Se comparte con terceros? |
|---|---|---|---|---|
| Fotos (cara y cuerpo) | Sí | Obligatorio (dos fotos en el onboarding) | Perfil visual | Se muestra al match potencial solo si está aprobada por moderación manual; se almacena en Supabase |

### Mensajes / contenido conversacional

| Dato | ¿Se recolecta? | ¿Obligatorio u opcional? | Finalidad | ¿Se comparte con terceros? |
|---|---|---|---|---|
| Conversación con la IA (onboarding, chat libre, módulos) | Sí | Obligatorio para usar la app | Construcción del perfil vincular | Sí — Anthropic (procesamiento de IA), Supabase (almacenamiento) |
| Mensajes de la Sala de Encuentros | Sí | Obligatorio para usar la función de citas | Comunicación entre las dos personas del match | Compartido entre ambas personas del match; Anthropic (intervenciones de IA); Supabase (almacenamiento) |
| Debriefing privado post-cita | Sí | Opcional (parte del flujo posterior a una cita) | Autopercepción de la persona sobre su encuentro | No se comparte con la otra persona; Anthropic (generación); Supabase (almacenamiento) |
| Texto de "análisis externo" (conversación pegada por el usuario, fuera de la plataforma) | Sí, si el usuario usa esta función | Opcional | Comparar contra el perfil propio | Anthropic (procesamiento); no se persiste en base de datos |

### Actividad dentro de la app

| Dato | ¿Se recolecta? | ¿Obligatorio u opcional? | Finalidad | ¿Se comparte con terceros? |
|---|---|---|---|---|
| Actividad general de uso (última actividad, etapa del proceso) | Sí | N/A (generado por el sistema) | Funcionamiento de la app | No |
| Uso de tokens de IA por función | Sí | N/A | Costo/observabilidad interna | No — tratado como métrica agregada |
| Eventos de embudo de producto | Sí | N/A | Métricas de producto internas | No — tratado como métrica agregada, aunque su clasificación como no identificable está bajo revisión interna |

### Inferencias generadas por IA

| Dato | ¿Se recolecta? | ¿Obligatorio u opcional? | Finalidad | ¿Se comparte con terceros? |
|---|---|---|---|---|
| Perfil vincular estructurado (grupo1-4) | Sí — generado, no aportado directamente | Obligatorio (subyacente al uso de la app) | Motor de matching | Nunca a otra persona usuaria; visible para el equipo de administración; generado con Anthropic |
| Compatibilidad calculada entre dos perfiles | Sí — generado | N/A | Proponer matches | Anthropic (cálculo); resultado parcial visible para las dos personas del match |
| Resumen/análisis de una cita | Sí — generado, solo con consentimiento de ambas personas | Opcional (depende del consentimiento de análisis) | Devolución a la persona (debriefing) y control de calidad interno | Anthropic (generación); resumen interno nunca visible para las personas usuarias |

### Comunicaciones

| Dato | ¿Se recolecta? | ¿Obligatorio u opcional? | Finalidad | ¿Se comparte con terceros? |
|---|---|---|---|---|
| Comunicaciones esenciales (confirmación de cuenta, recuperación de contraseña) | Sí | Obligatorio | Funcionamiento de la cuenta | Resend (proveedor de envío) |
| Comunicaciones de producto (avisos de match, recordatorios) | Sí, solo si el usuario lo autoriza | Opcional, opt-in, desactivado por defecto | Notificaciones de producto | Resend (proveedor de envío) |
| Notificaciones push (nuevo match, mensaje en la Sala de Encuentros, cierre de cita) | Sí, si el usuario dio permiso de notificaciones en su dispositivo **y** activó "comunicaciones de producto" en "Mi perfil" (misma preferencia que gatea el email de producto) | Opcional, opt-in, desactivado por defecto | Avisos en tiempo real | Firebase Cloud Messaging / Google (token del dispositivo, texto de la notificación) |

### Menores de edad

No está dirigida a menores de 18 años. La app valida edad mínima de 18 años en cliente y servidor antes de habilitar el uso de las funciones principales.

### Publicidad

No hay publicidad ni SDKs de redes publicitarias en la app.

### Analytics

No hay herramientas de analítica de terceros (Google Analytics, Meta Pixel u otras). Se registran métricas internas agregadas propias, almacenadas en la base de datos propia de Soul (Supabase), sin envío a servicios externos de analítica.

### Pagos

No hay pasarela de pago ni facturación in-app conectada actualmente. Existe lógica de planes Free/Pro en el código, pero sin cobro real activo. [NO CONFIRMADO — verificar antes de completar el formulario si esto cambia antes de la publicación en Play Store, ya que activar cobros reales requeriría declarar el mecanismo de pago en el formulario.]

### Ubicación

Solo se recolecta ciudad como texto ingresado manualmente por la persona usuaria. No se usa geolocalización precisa (GPS) ni ningún servicio de mapas.

## 3. ¿Los datos se cifran en tránsito?

Todas las llamadas a proveedores externos identificadas en la revisión técnica (Supabase, Anthropic, Resend) usan endpoints HTTPS. [NO CONFIRMADO — verificar antes de completar el formulario la configuración específica de certificados/TLS de Vercel para el dominio de producción, ya que esto no se confirma a nivel de código sino de configuración de infraestructura.]

## 4. ¿Los usuarios pueden pedir la eliminación de sus datos?

Sí. Ver `eliminacion-cuenta.md` para el proceso y los plazos completos (corte de acceso inmediato, borrado real a los 30 días, con excepciones documentadas para contenido compartido con otra persona, purgado a los 12 meses del cierre de una cita).

**Excepción — reportes de seguridad entre personas usuarias**: el reporte y sus metadatos (motivo, fecha, quién reportó a quién, estado) no se eliminan junto con la cuenta ni a los 12 meses de la cita. Se conservan **5 años desde la fecha de cierre del reporte** (el plazo no corre mientras el reporte esté abierto), como excepción de seguridad frente al resto de los datos de la cuenta. Este plazo aplica solo al reporte y sus metadatos, no a la conversación asociada, que sigue su propia retención de 12 meses. [REVISIÓN LEGAL — validar la validez jurídica definitiva de este plazo de 5 años.]

**Credencial de acceso (Supabase Auth)**: la eliminación de cuenta no solo anonimiza los datos de aplicación — también intenta borrar la credencial real de acceso (usuario/contraseña) del sistema de autenticación. La clave de administración necesaria para esto está confirmada en el ambiente de producción, y el proceso automático diario que lo ejecuta corre sin errores. [PENDIENTE DE PRODUCTO — queda pendiente verificar, sobre un caso real completo, que la credencial efectivamente terminó borrada.]

## 5. Proveedores con los que se comparten datos

| Proveedor | Tipo de dato compartido | Región confirmada |
|---|---|---|
| Anthropic | Conversaciones, perfil vincular, transcripciones de citas (con consentimiento) | Estados Unidos y otros países fuera del EEE |
| Supabase | Prácticamente todos los datos (almacenamiento primario) | São Paulo, Brasil (`sa-east-1`) |
| Resend | Email, nombre, contenido de notificaciones (nunca conversaciones reales) | Envío desde São Paulo, Brasil (`sa-east-1`); metadatos/logs de cuenta en Estados Unidos |
| Vercel | Tráfico técnico de la aplicación | [NO CONFIRMADO — verificar antes de completar el formulario la región específica de las funciones serverless de Vercel usadas en producción] |
| Google Fonts | Dirección IP del navegador (al cargar la tipografía) | [NO CONFIRMADO — verificar antes de completar el formulario] |
| Firebase Cloud Messaging (Google) | Token de notificación del dispositivo, texto de la notificación push | [NO CONFIRMADO — verificar antes de completar el formulario la región específica de procesamiento] |

## 6. Datos sensibles

Orientación sexual/afectiva y vida íntima, que pueden surgir del contenido libre de las conversaciones con la IA. Requiere consentimiento específico y separado — ver `consentimiento-datos-sensibles.md`.

---

**Nota final para quien complete el formulario real**: este borrador refleja el estado documentado en la auditoría técnica y las decisiones ya tomadas por la founder al 2026-07-29. Antes de enviar el formulario de Play Console, verificar que no haya cambios de producto posteriores a esta fecha que no estén reflejados acá.
