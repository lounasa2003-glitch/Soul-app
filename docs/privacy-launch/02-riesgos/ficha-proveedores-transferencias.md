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
Para una organización de la API sin acuerdo especial: **30 días**. Cita textual: *"For Anthropic API users, we automatically delete inputs and outputs on our backend within 30 days of receipt or generation."*
- Evidencia: [How long do you store my organization's data?](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) (consultado 2026-07-28).
- Nota técnica adicional: la documentación de retención de la API (`platform.claude.com`) aclara que, dentro del marco de ZDR, "conversation content is not retained by default; the exception is Covered Models, which require 30-day retention" — los **Covered Models** son específicamente **Claude Fable 5 y Claude Mythos 5**. Ninguno de los dos modelos que usa Soul (`claude-sonnet-4-6`, `claude-haiku-4-5-20251001`) es un Covered Model, así que no aplica esa obligación particular; el régimen relevante para Soul es el estándar de 30 días citado arriba (salvo que se confirme un acuerdo de ZDR, ver abajo).
- Excepción legal: contenido marcado por los sistemas de seguridad de Anthropic (ej. sospecha de violación de políticas de uso) puede retenerse hasta 2 años. No hay forma de saber desde acá si algún mensaje de Soul disparó esto alguna vez.

### ¿Tiene Soul Zero Data Retention (ZDR) u otro acuerdo especial?
**PENDIENTE DE CONFIRMACIÓN — no hay evidencia de que exista, y no se afirma que exista.** ZDR es un acuerdo que **se solicita explícitamente contactando al equipo de ventas de Anthropic** y se habilita por organización desde Claude Console; no es algo que se active solo ni que se pueda inferir del uso normal de la API. No hay ningún rastro en el código, el repositorio o las variables de entorno de que se haya solicitado. Dado que Soul es un piloto cerrado sin relación comercial enterprise conocida con Anthropic, **lo más probable es que NO tenga ZDR** — pero esto se marca como pendiente en vez de afirmarlo, porque no es verificable desde este entorno.
- Cómo confirmarlo: entrar a [Claude Console → Settings → Privacy](https://platform.claude.com/settings/privacy) con la cuenta que administra la API key de Soul, o revisar el contrato/términos aceptados al crear la cuenta.
- Evidencia de cómo se confirma (no de que exista): *"Check your contract terms or contact your Anthropic account representative to confirm whether your organization has ZDR arrangements in place."* — [API and data retention, FAQ](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) (consultado 2026-07-28).

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
**PENDIENTE DE CONFIRMACIÓN.** La URL del proyecto (`<project-ref>.supabase.co`) **no codifica la región** de forma visible ni verificable públicamente — Supabase no expone la región vía la URL para el pooler estándar. La región es un dato que solo se ve en el dashboard del proyecto.
- Cómo confirmarlo: entrar al [dashboard de Supabase](https://supabase.com/dashboard) → proyecto de Soul → **Project Settings → General → Region**.
- Evidencia de que cada proyecto tiene una única región primaria fija: *"Each Supabase project is deployed to one primary region."* — [Available regions, Supabase Docs](https://supabase.com/docs/guides/platform/regions) (consultado 2026-07-28). Las regiones disponibles incluyen ubicaciones en Norteamérica, Europa, Asia-Pacífico y Sudamérica (17 regiones AWS específicas, más 3 "regiones generales" simplificadas).

### ¿Existen réplicas o servicios en otras regiones?
**PENDIENTE DE CONFIRMACIÓN.** Por defecto un proyecto Supabase vive en una única región (ver cita arriba); las réplicas de lectura son una funcionalidad opcional que se activa explícitamente, no algo que ocurra por default en el plan estándar. No hay ninguna evidencia en el código de que Soul use réplicas (no hay ninguna configuración de múltiples endpoints de base de datos en el repo).
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
**PENDIENTE DE CONFIRMACIÓN.** Resend permite elegir una "región de envío" por dominio (Norte de Virginia/EE.UU., Irlanda/UE, São Paulo, Tokio) al crear el dominio — no es visible desde el código ni desde `.env.local` cuál se eligió para `soulapp.love`.
- Cómo confirmarlo: [dashboard de Resend](https://resend.com/domains) → dominio `soulapp.love` → configuración de región.
- Evidencia de las regiones disponibles: *"Resend offers regions in Europe (Ireland), South America (Brazil), and North America (US)"* (y Tokio según la documentación oficial) — [Choosing a Region, Resend Docs](https://resend.com/docs/dashboard/domains/regions) (consultado 2026-07-28).

### Tratamiento principal en Estados Unidos (confirmado, sin importar la región elegida)
**Este punto SÍ está confirmado con evidencia oficial, independientemente de qué región de envío tenga configurada el dominio de Soul**: *"Region selection controls where your emails are routed and sent from. It does not control where customer data is stored"* y *"All account data, including email metadata, logs, and API records, is stored in the United States regardless of the sending region you select."*
- Esto significa que, aunque `soulapp.love` estuviera configurado para enviar desde Irlanda (UE), los metadatos, logs y registros de la cuenta de Resend de Soul **siguen almacenándose en Estados Unidos** de todas formas.
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
| **Anthropic** (Claude API) | Conversación completa con Soul, perfiles estructurados (grupo1-4), texto libre de "no negociables"/"negociables", transcripciones de citas, conversaciones externas pegadas por el usuario | **No** por defecto (API comercial) | **30 días** estándar (sin ZDR confirmado); modelos usados no son "Covered Models" | EE.UU. y otros países fuera del EEE (con SCC/adecuación para transferencias UE) | AWS y Google, LLC confirmados; lista completa no verificada | [Data training](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training), [Retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [API retention docs](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention), [Privacy Policy](https://www.anthropic.com/legal/privacy) — todas consultadas 2026-07-28 | **¿Tiene Soul un acuerdo de ZDR?** (no hay evidencia de que exista); organización/workspace exacto de la API key; lista completa de subprocesadores |
| **Supabase** (DB + Auth) | Prácticamente todo el inventario de datos de Soul (credenciales, perfiles, conversaciones, matches, citas, fotos, etc.) | No aplica (no es proveedor de IA) | Definida por Soul, no por Supabase (ver Decisión 6) | No determinable desde el código — proyecto en `kjughqrjyglfxaiunivw.supabase.co` | AWS (infraestructura principal) y Google, LLC confirmados; lista completa (~20) no verificada en texto legible | [Regions docs](https://supabase.com/docs/guides/platform/regions), [DPA](https://supabase.com/legal/dpa) — consultadas 2026-07-28 | **Región exacta del proyecto** (dashboard); **si hay réplicas en otras regiones** (dashboard); lista completa de subprocesadores (PDF del DPA) |
| **Resend** (email transaccional) | Email y nombre del destinatario (y a veces de la otra persona del match); asunto y cuerpo de cada notificación — nunca contenido real de conversaciones | No aplica (no es proveedor de IA) | No documentada públicamente para el plan usado por Soul (no confirmado) | **Metadatos/logs de cuenta: EE.UU., confirmado, sin importar la región de envío elegida**. Región de envío del dominio `soulapp.love`: no determinable desde el código | AWS, Google, Supabase, Vercel + ~16 más, todos EE.UU. (lista pública completa) | [Regions docs](https://resend.com/docs/dashboard/domains/regions), [Subprocessors](https://resend.com/legal/subprocessors) — consultadas 2026-07-28 | **Región de envío elegida para el dominio `soulapp.love`** (dashboard) |

---

## Resumen de qué quedó confirmado con evidencia oficial

1. **Anthropic**: Soul usa la API comercial, no una cuenta personal (confirmado por diseño técnico). Los datos **no** se usan para entrenar modelos por defecto. Retención estándar de **30 días** sin acuerdo especial. Procesamiento en EE.UU./fuera del EEE con mecanismos de transferencia estándar (SCC/adecuación).
2. **Supabase**: infraestructura corre sobre AWS (confirmado como subprocesador), con Google también como subprocesador. No hay política de entrenamiento aplicable (no es proveedor de IA).
3. **Resend**: confirmado con cita textual que los metadatos/logs de la cuenta se almacenan en EE.UU. **sin importar la región de envío elegida** para el dominio. Lista completa de subprocesadores (todos en EE.UU.) confirmada. Los datos concretos que Soul envía (email, nombre, contenido de la notificación) están verificados directamente en el código.

## Qué sigue pendiente (requiere acceso a dashboard/consola, no verificable desde acá)

1. **Anthropic**: si Soul tiene un acuerdo de Zero Data Retention (muy probablemente no, pero no confirmado) — se verifica en Claude Console → Settings → Privacy, o revisando el contrato aceptado.
2. **Supabase**: región exacta del proyecto (dashboard → Project Settings → General → Region) y si hay réplicas en otras regiones (dashboard → Infrastructure/Replication).
3. **Resend**: región de envío configurada para el dominio `soulapp.love` (dashboard → Domains).
4. Lista completa (no solo los principales) de subprocesadores de Anthropic y Supabase — ambas requieren abrir la página/PDF directamente desde un navegador, no se pudo extraer en texto legible desde este entorno.

## ¿Alcanza esta información para redactar el aviso de transferencias y completar Data Safety?

**Todavía no del todo.** Hay evidencia sólida y bien citada para las afirmaciones *generales* (EE.UU. como destino de transferencia para los tres proveedores, ausencia de entrenamiento con datos de Anthropic, retención estándar de 30 días de Anthropic) — eso ya alcanza para mejorar la precisión de lo que hoy dice `legal.html` sección 7 sobre transferencias internacionales.

Pero **no alcanza para completar el formulario de Data Safety de Play Console con precisión total**, porque ese formulario pide la región/país específico donde se almacenan los datos, y eso sigue **PENDIENTE DE CONFIRMACIÓN** para Supabase (la región exacta del proyecto) y Resend (la región de envío del dominio). Recomiendo resolver esos dos datos puntuales (5 minutos en cada dashboard) antes de completar Data Safety — el resto de la información ya está lista.
