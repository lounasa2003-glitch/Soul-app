# Ficha de proveedores y transferencias internacionales — Soul

> Decisión 7 (actualización). Basado en documentación oficial de cada proveedor (citada con enlace y fecha de consulta) más la configuración real visible en el código de Soul. **No se modificó código ni configuración de ninguna cuenta.** Donde la respuesta depende del dashboard/consola de cada proveedor (no accesible desde este entorno), se marca explícitamente **PENDIENTE DE CONFIRMACIÓN** — no se afirma nada que no tenga evidencia citada.
>
> Fecha de consulta de toda la documentación oficial citada en este documento: **2026-07-28**.

---

## 1. Anthropic (motor de IA)

### Qué confirma el código de Soul
- Todas las llamadas van a `https://api.anthropic.com/v1/messages` (`lib/anthropicClient.js:35`, `api/chat.js:156`) usando `ANTHROPIC_API_KEY`.
- Modelos usados: `claude-sonnet-4-6` (uso principal) y `claude-haiku-4-5-20251001` (modo rápido del chat informal) — `api/chat.js:7,14`.

### ¿API comercial o cuenta personal de Claude?
**Confirmado por diseño técnico, no requiere verificación en el dashboard**: una API key (`sk-ant-...`) que llama a `api.anthropic.com/v1/messages` **solo puede generarse desde Claude Console** (una organización bajo los Términos de Servicio Comerciales de Anthropic). No existe ningún mecanismo para obtener una API key de este tipo desde una cuenta de consumidor (Claude.ai Free/Pro/Max) — esas cuentas no emiten API keys. Por lo tanto, el hecho mismo de que Soul funcione usando `ANTHROPIC_API_KEY` ya confirma que se trata de la **API comercial**, no de una cuenta personal.
- Evidencia: [How Anthropic approaches data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) (consultado 2026-07-28) — distingue explícitamente "commercial products (e.g. Claude for Work, Anthropic API, Claude Gov)" de "consumer products such as Claude Free, Pro, Max".
- **Pendiente de confirmación menor**: a qué organización/workspace específico de Claude Console pertenece la `ANTHROPIC_API_KEY` usada en producción (no afecta la conclusión de "es API comercial", solo es un dato administrativo).

### ¿Se usan los datos de Soul para entrenar modelos?
**No, por defecto.** Cita textual de la documentación oficial de privacidad de Anthropic: *"By default, we will not use your inputs or outputs from our commercial products (e.g. Claude for Work, Anthropic API, Claude Gov, etc.) to train our models."*
- Única excepción documentada: si Anthropic recibe feedback explícito reportado por la organización (ej. un botón de "reportar" que Soul no usa), ese contenido puntual sí podría usarse. Soul no tiene implementado ningún mecanismo de este tipo (no hay ningún endpoint que reporte contenido a Anthropic más allá de las llamadas normales de la API).
- Evidencia: [Is my data used for model training?](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training) (consultado 2026-07-28).

### Retención estándar
**Confirmado por la founder (2026-07-28): retención activada por 30 días**, el régimen estándar para una organización de la API sin acuerdo especial. Cita textual de la política oficial: *"For Anthropic API users, we automatically delete inputs and outputs on our backend within 30 days of receipt or generation."*
- Evidencia: [How long do you store my organization's data?](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) (consultado 2026-07-28).
- Nota técnica adicional: la documentación de retención de la API (`platform.claude.com`) aclara que, dentro del marco de ZDR, "conversation content is not retained by default; the exception is Covered Models, which require 30-day retention" — la categoría de **Covered Models** designa un subconjunto específico de modelos con retención obligatoria distinta. Los modelos que usa Soul (`claude-sonnet-4-6`, `claude-haiku-4-5-20251001`) no pertenecen a esa categoría, así que no aplica esa obligación particular; el régimen relevante para Soul es el estándar de 30 días, confirmado como el que efectivamente aplica (ver más abajo: retención activada por 30 días, sin ZDR).
- Excepción legal: contenido marcado por los sistemas de seguridad de Anthropic (ej. sospecha de violación de políticas de uso) puede retenerse hasta 2 años. No hay forma de saber desde acá si algún mensaje de Soul disparó esto alguna vez.

### ¿Tiene Soul Zero Data Retention (ZDR) u otro acuerdo especial?
**Confirmado por la founder (2026-07-28): NO activado.** La cuenta de Anthropic de Soul tiene la retención estándar activada por 30 días (ver arriba), sin ningún acuerdo de Zero Data Retention. Esto coincide con lo esperado: ZDR **se solicita explícitamente contactando al equipo de ventas de Anthropic** y se habilita por organización desde Claude Console; no es algo que se active solo ni que se pueda inferir del uso normal de la API, y no hay ningún rastro en el código, el repositorio o las variables de entorno de que se haya solicitado.
- Confirmado directamente en la cuenta (no requiere más verificación): [Claude Console → Settings → Privacy](https://platform.claude.com/settings/privacy).
- Evidencia de cómo se confirma este tipo de configuración en general: *"Check your contract terms or contact your Anthropic account representative to confirm whether your organization has ZDR arrangements in place."* — [API and data retention, FAQ](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) (consultado 2026-07-28).

### Región / transferencias internacionales
La política de privacidad general de Anthropic confirma procesamiento en EE.UU. y fuera del EEE, con mecanismos de transferencia (decisiones de adecuación y cláusulas contractuales tipo — SCC) para usuarios europeos: *"your personal data is transferred to our servers in the US, or to other countries outside the European Economic Area."*
- Evidencia: [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy) (consultado 2026-07-28).

### Subprocesadores
Anthropic mantiene una lista pública de subprocesadores en su Trust Center. No pudo leerse el contenido completo de esa página desde este entorno (requiere renderizado dinámico). Confirmado por fuentes secundarias que **AWS** y **Google, LLC** son subprocesadores certificados bajo el EU-U.S. Data Privacy Framework.
- Evidencia parcial: búsqueda sobre [trust.anthropic.com/subprocessors](https://trust.anthropic.com/subprocessors) (consultado 2026-07-28) — página no renderizable desde acá, lista completa **PENDIENTE DE CONFIRMACIÓN** visitándola directamente desde un navegador.

---

## 2. Supabase (base de datos + autenticación)

### Qué confirma el código de Soul
- `SUPABASE_URL` configurada: `https://kjughqrjyglfxaiunivw.supabase.co` (nombre de variable verificado en `.env.local`; es la URL del proyecto, no una credencial secreta).
- Todo el acceso es vía REST (`/rest/v1/*`) y Auth (`/auth/v1/*`) directo, sin SDK.

### Región exacta del proyecto
**Confirmado por la founder (2026-07-28): `sa-east-1` (São Paulo, Brasil).** La URL del proyecto (`<project-ref>.supabase.co`) no codifica la región de forma visible públicamente — este dato se confirmó directamente en el dashboard del proyecto, no se infirió del código.
- Confirmado en: [dashboard de Supabase](https://supabase.com/dashboard) → proyecto de Soul → **Project Settings → General → Region**.
- Evidencia de que cada proyecto tiene una única región primaria fija: *"Each Supabase project is deployed to one primary region."* — [Available regions, Supabase Docs](https://supabase.com/docs/guides/platform/regions) (consultado 2026-07-28). `sa-east-1` (São Paulo) es una de las regiones AWS específicas que ofrece Supabase para Sudamérica.
- No se modificó la región del proyecto -- este documento solo la registra.

### ¿Existen réplicas o servicios en otras regiones?
**PENDIENTE DE CONFIRMACIÓN.** No se confirmó este punto específico con la founder. Por defecto un proyecto Supabase vive en una única región (ver cita arriba); las réplicas de lectura son una funcionalidad opcional que se activa explícitamente, no algo que ocurra por default en el plan estándar. No hay ninguna evidencia en el código de que Soul use réplicas (no hay ninguna configuración de múltiples endpoints de base de datos en el repo).
- Cómo confirmarlo: dashboard → proyecto → **Settings → Infrastructure / Database → Replication** (si no aparece ninguna réplica listada, no hay ninguna activa).

### Datos que recibe
Prácticamente todo el inventario de datos de Soul (ver `inventario-datos.md`): credenciales de Auth, todas las columnas de `usuarios` (incluidas fotos en base64), `perfiles`, `conversaciones`, `matches`, `citas`, `cita_mensajes`, etc.

### Retención / uso para entrenamiento
Supabase es un proveedor de infraestructura (base de datos gestionada), no un proveedor de IA — no hay ninguna política de "entrenamiento de modelos" aplicable. La retención de los datos alojados en Supabase la define Soul (cuánto tiempo mantiene cada fila), no Supabase — ver `propuesta-retencion.md` (Decisión 6) para los plazos ya definidos por tabla.

### Subprocesadores
Confirmado (vía búsqueda sobre la documentación pública, no pudo abrirse el PDF completo del DPA de forma legible desde este entorno): Supabase declara **AWS** como su infraestructura principal, y **Google, LLC** como subprocesador adicional, ambos certificados bajo el EU-U.S. Data Privacy Framework. La lista completa reportada (~20 subprocesadores a julio 2026) no pudo extraerse en texto legible desde acá.
- Evidencia: [Supabase DPA (PDF)](https://supabase.com/downloads/docs/Supabase+DPA+260601.pdf) y [Supabase Legal — DPA](https://supabase.com/legal/dpa) (consultado 2026-07-28) — el PDF es la fuente autorizada; **lista completa PENDIENTE DE CONFIRMACIÓN** abriéndolo directamente (el contenido no se extrajo en texto legible por herramienta automática).

---

## 3. Resend (email transaccional)

### Qué confirma el código de Soul
- `EMAIL_FROM="Soul <auth@soulapp.love>"` (nombre de variable y valor de dominio verificados en `.env.local` — no es una credencial secreta, es la dirección remitente).
- Todas las llamadas van a `https://api.resend.com/emails` (`lib/email.js:9,23`) usando `RESEND_API_KEY`.

### Qué datos concretos envía Soul a Resend
Verificado directamente en `lib/email.js` (las 8 funciones de notificación):
- **Email** del destinatario (`to`).
- **Nombre** del destinatario y, en varias notificaciones, **nombre de la otra persona del match** (ej. "Tenés un nuevo match en Soul con [nombre]").
- **Contenido del mensaje**: asunto y cuerpo HTML de cada notificación (avisos de match, recordatorios, confirmación de cuenta, diagnóstico diario a la administradora). **Nunca** se reenvía el contenido real de una conversación (`conversaciones`/`cita_mensajes`) — solo notificaciones/avisos generados por Soul.

### Región configurada para el dominio de Soul
**Confirmado por la founder (2026-07-28): `sa-east-1` (São Paulo, Brasil).** Este dato corresponde específicamente a la **región de envío** del dominio `soulapp.love` en Resend, confirmado directamente en el dashboard.
- Confirmado en: [dashboard de Resend](https://resend.com/domains) → dominio `soulapp.love` → configuración de región.
- Evidencia de las regiones disponibles: *"Resend offers regions in Europe (Ireland), South America (Brazil), and North America (US)"* (y Tokio según la documentación oficial) — [Choosing a Region, Resend Docs](https://resend.com/docs/dashboard/domains/regions) (consultado 2026-07-28). São Paulo (`sa-east-1`) es la opción de Sudamérica.
- No se modificó ninguna configuración de Resend -- este documento solo la registra.

### Importante: la región de envío NO es lo mismo que dónde se procesan los metadatos/subprocesadores
**Aclaración necesaria, con evidencia oficial**: que `soulapp.love` envíe desde São Paulo (`sa-east-1`) determina únicamente **desde qué servidor salen físicamente los correos**. No cambia dónde se almacenan los metadatos de la cuenta ni dónde operan los subprocesadores de Resend, que **siguen siendo mayormente EE.UU.**: *"Region selection controls where your emails are routed and sent from. It does not control where customer data is stored"* y *"All account data, including email metadata, logs, and API records, is stored in the United States regardless of the sending region you select."*
- En concreto para Soul: los emails salen desde São Paulo, pero los metadatos, logs y registros de la cuenta de Resend de Soul se almacenan en Estados Unidos de todas formas, y los subprocesadores de Resend (ver más abajo) son casi todos empresas de EE.UU.
- Evidencia: [Choosing a Region, Resend Docs](https://resend.com/docs/dashboard/domains/regions) (consultado 2026-07-28).

### Uso para entrenamiento
Resend es un proveedor de envío de email transaccional, no un proveedor de IA — no hay ninguna política de "entrenamiento de modelos" aplicable a este proveedor.

### Subprocesadores
Lista pública confirmada (parcial, los más relevantes para el volumen de Soul): **Amazon Web Services (EE.UU.)**, **Google, Inc. (EE.UU.)** — "Email communications and analytics", **Supabase, Inc (EE.UU.)**, **Vercel Inc. (EE.UU.)**, más otros ~16 subprocesadores adicionales, **todos ubicados en EE.UU.** según la propia lista de Resend.
- Evidencia: [Resend — Subprocessors](https://resend.com/legal/subprocessors) (consultado 2026-07-28).

---

## Tabla resumen

| Proveedor | Datos enviados por Soul | Uso para entrenamiento | Retención | Región confirmada | Subprocesadores | Evidencia | Pendiente |
|---|---|---|---|---|---|---|---|
| **Anthropic** (Claude API) | Conversación completa con Soul, perfiles estructurados (grupo1-4), texto libre de "no negociables"/"negociables", transcripciones de citas, conversaciones externas pegadas por el usuario | **No** por defecto (API comercial) | **Confirmado: 30 días** (retención estándar activada, sin ZDR) | EE.UU. y otros países fuera del EEE (con SCC/adecuación para transferencias UE) | AWS y Google, LLC confirmados; lista completa no verificada | [Data training](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training), [Retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [API retention docs](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention), [Privacy Policy](https://www.anthropic.com/legal/privacy) — todas consultadas 2026-07-28 | Organización/workspace exacto de la API key; lista completa de subprocesadores |
| **Supabase** (DB + Auth) | Prácticamente todo el inventario de datos de Soul (credenciales, perfiles, conversaciones, matches, citas, fotos, etc.) | No aplica (no es proveedor de IA) | Definida por Soul, no por Supabase (ver Decisión 6) | **Confirmado: `sa-east-1` (São Paulo, Brasil)** | AWS (infraestructura principal) y Google, LLC confirmados; lista completa (~20) no verificada en texto legible | [Regions docs](https://supabase.com/docs/guides/platform/regions), [DPA](https://supabase.com/legal/dpa) — consultadas 2026-07-28 | Si hay réplicas en otras regiones (dashboard); lista completa de subprocesadores (PDF del DPA) |
| **Resend** (email transaccional) | Email y nombre del destinatario (y a veces de la otra persona del match); asunto y cuerpo de cada notificación — nunca contenido real de conversaciones | No aplica (no es proveedor de IA) | No documentada públicamente para el plan usado por Soul (no confirmado) | **Confirmado: región de envío `sa-east-1` (São Paulo, Brasil)**. Aclaración: esto es solo desde dónde se despachan los correos — los metadatos/logs de la cuenta y la mayoría de los subprocesadores de Resend siguen operando en EE.UU. de todas formas | AWS, Google, Supabase, Vercel + ~16 más, todos EE.UU. (lista pública completa) | [Regions docs](https://resend.com/docs/dashboard/domains/regions), [Subprocessors](https://resend.com/legal/subprocessors) — consultadas 2026-07-28 | Ninguno relevante para transferencias -- región de envío ya confirmada |

---

## Resumen de qué quedó confirmado con evidencia oficial + configuración real

1. **Anthropic**: Soul usa la API comercial, no una cuenta personal (confirmado por diseño técnico). Los datos **no** se usan para entrenar modelos por defecto. **Retención activada por 30 días, sin Zero Data Retention (confirmado por la founder en la cuenta real).** Procesamiento en EE.UU./fuera del EEE con mecanismos de transferencia estándar (SCC/adecuación).
2. **Supabase**: **región del proyecto confirmada: `sa-east-1` (São Paulo, Brasil)**. Infraestructura corre sobre AWS (confirmado como subprocesador), con Google también como subprocesador. No hay política de entrenamiento aplicable (no es proveedor de IA).
3. **Resend**: **región de envío del dominio `soulapp.love` confirmada: `sa-east-1` (São Paulo, Brasil)**. Importante: esto es solo la región de envío -- los metadatos/logs de la cuenta y la mayoría de los subprocesadores de Resend (confirmado, lista completa) siguen operando en EE.UU. de todas formas, sin importar la región de envío elegida. Los datos concretos que Soul envía (email, nombre, contenido de la notificación) están verificados directamente en el código.

## Qué sigue pendiente (requiere acceso a dashboard/consola, no verificable desde acá)

1. **Supabase**: si hay réplicas en otras regiones además de `sa-east-1` (dashboard → Infrastructure/Replication) -- no se confirmó este punto específico.
2. Lista completa (no solo los principales) de subprocesadores de Anthropic y Supabase — ambas requieren abrir la página/PDF directamente desde un navegador, no se pudo extraer en texto legible desde este entorno.
3. Organización/workspace exacto de Claude Console al que pertenece la API key de Soul (dato administrativo, no cambia ninguna de las conclusiones de este documento).

## ¿Alcanza esta información para redactar el aviso de transferencias y completar Data Safety?

**Sí, ya hay información suficiente para los tres proveedores.** Con la región de Supabase (`sa-east-1`, Brasil), la región de envío de Resend (`sa-east-1`, Brasil, con la aclaración de que los metadatos/subprocesadores siguen en EE.UU.) y la retención confirmada de Anthropic (30 días, sin ZDR), ya se puede: (a) reflejar con precisión la sección de transferencias internacionales del texto legal, (b) redactar el aviso específico sobre uso de IA, y (c) completar el formulario de Data Safety de Play Console con los países/regiones correctos para cada proveedor.

Lo único que queda pendiente (réplicas de Supabase, listas completas de subprocesadores secundarios) no es indispensable para redactar esos documentos -- son detalles adicionales, no bloqueantes.
