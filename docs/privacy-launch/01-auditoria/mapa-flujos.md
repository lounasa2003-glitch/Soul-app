# Mapa de flujos reales de datos — Soul

> Agente 1 (Auditor técnico de datos). Flujos reconstruidos a partir del código (`soul.html`, `api/*.js`, `lib/*.js`), no de documentación de producto. Cada paso cita su evidencia.

## 1. Registro y consentimiento

```
Usuario (front-end soul.html)
  → Etapa 2: modal de consentimiento embebido en soul.html (texto abreviado, 8 secciones)
  → checkbox obligatorio (mainOk) + checkbox opcional "datos anonimizados" (solo clase CSS, sin variable JS asociada)
  → POST /api/auth {accion:'registro'} → Supabase Auth /auth/v1/signup
  → POST /api/guardar {tabla:'usuarios', datos:{email, nombre}} → Supabase REST (fila mínima)
```
Evidencia: `soul.html:639-689` (modal), `soul.html:675,3608-3624` (checkboxes), `api/auth.js:205-210`, `api/guardar.js:100-124`.

Nota verificada: el documento legal completo (`legal.html`/`consentimiento.html`) **no está enlazado** desde ningún punto del flujo de alta — solo `index.html` (landing pública) enlaza a `/legal.html` en su footer (`index.html:209-210`); `consentimiento.html` no aparece referenciado desde ningún archivo del proyecto salvo comentarios y documentación (`grep` sin resultados de enlace real).

## 2. Etapa 1 — datos básicos + fotos

```
Usuario
  → formulario (fecha nacimiento, ciudad, distancia, género, preferencia, tipo de vínculo,
     hijos, estado civil, ocupación, no-negociables, negociables) + 2 fotos
  → fotos recodificadas a JPEG base64 en el navegador (canvas.toDataURL)
  → POST /api/guardar {tabla:'usuarios', datos:{...todo, etapa_actual:'chat'}}
  → validación server-side de campos completos + formato/tamaño de foto (FOTO_REGEX)
  → Supabase REST (PATCH usuarios, con token propio — RLS activo)
  → dispara email de confirmación de cuenta (vía Resend)
```
Evidencia: `soul.html:2008-2022,3013,3633`, `api/guardar.js:32-58,110-124,163-188`, `lib/email.js:69-78`.

## 3. Chat con Soul (construcción del perfil)

```
Usuario ⇄ soul.html (streaming)
  → POST /api/chat {system, messages, stream:true}
  → filtro server-side de intentos de fuga/inyección (lib/seguridadPrompt.js)
     → si matchea: NO se llama a Anthropic, se registra en intentos_fuga_prompt
  → Anthropic API (claude-sonnet-4-6 o claude-haiku-4-5, con prompt caching)
  → respuesta en streaming al navegador
  → historial completo persistido en Supabase (tabla conversaciones)
  → registro de uso de tokens (uso_tokens) y eventos de embudo (eventos_piloto)
```
Evidencia: `api/chat.js:126-234`, `lib/seguridadPrompt.js:44-75`, `lib/anthropicClient.js`, `lib/logUso.js`, `lib/logEvento.js`.

## 4. Extracción del perfil estructurado

```
Conversación completa (tabla conversaciones)
  → Anthropic API (EXTRACT_PROMPT)
  → JSON estructurado (grupo1-4)
  → Supabase REST (upsert perfiles)
```
Disparado normalmente durante el flujo de chat (detección de cierre) o forzado por la administradora vía `forzarCierrePerfil`. Evidencia: `api/analisisExterno.js:15-17` (prompt compartido), `api/admin/matches.js:554-628`.

## 5. Cálculo de matches

```
Usuario pide "calcular matches"
  → POST /api/calcularMatches
  → lee el propio perfil (token propio) + TODOS los demás perfiles activos (service role key)
  → filtro previo sin IA: género/preferencia, tipo de vínculo, distancia, hijos (lib/matchCompatible.js)
  → por cada candidato compatible: Anthropic API (COMPARE_PROMPT) con los dos perfiles completos
     + no_negociables/negociables de ambos en texto plano
  → si compatibilidad_hoy≥60 o potencial_construccion≥75: INSERT en matches (estado:'pendiente')
  → si no supera el umbral: se guarda igual (estado:'descartado') para uso interno del panel admin
```
Evidencia: `api/calcularMatches.js:69-222`, `lib/comparePrompt.js`.

## 6. Decisión sobre un match y presentación

```
Usuario A pide ver la presentación de B (antes de aceptar/rechazar)
  → GET /api/matches?presentacionMatchId=...
  → lee usuarios+perfiles de B con service role key
  → Anthropic API (PRESENTACION_PERFIL_PROMPT) → bio breve, generada al vuelo, no se guarda
  → responde a A: nombre, edad calculada, bio, foto (solo si foto_aprobada=true), ciudad,
     ocupación, tipo de vínculo, hijos, estado civil, no_negociables, negociables de B
     (nunca el perfil psicológico grupo1-4 de B)

Usuario A/B elige "acepta"/"rechaza"
  → POST /api/matches {accion:'elegir'}
  → requiere email confirmado si elige "acepta"
  → si ambas partes aceptan: estado='mutuamente_aceptado', se crea fila en citas
     y primer mensaje de apertura ("No busquen impresionar..."), etapa_actual='cita' para ambas
```
Evidencia: `api/matches.js:140,159-226,228-330`.

## 7. Sala de Encuentros (cita virtual)

```
Persona A ⇄ Persona B, vía cita_mensajes (chat compartido, RLS "las dos personas del match")
  → Soul interviene ocasionalmente (generar_tema / salir_incomodidad) SOLO en el primer encuentro
     → Anthropic API con transcripción reciente + referencias culturales de ambas
  → aviso por email al destinatario si no está activo en ese momento (avisarSiDesconectado, con
     cooldown de 20 min)
  → cierre manual (botón "salir") o automático a las 24hs de inactividad (cerrarSiInactiva)
  → al cerrar: Anthropic API (RESUMEN_CITA_PROMPT) → resumen objetivo guardado en citas.resumen_ia,
     NUNCA visible para las personas, solo para el panel admin — sin chequeo de consiente_analisis_a/b
```
Evidencia: `api/citas.js:287-350,381-476`, `lib/cierreCita.js:12-98`.

## 8. Debriefing / reflexión privada

```
Persona (individual, nunca comparte esto con su match)
  → GET /api/citas?reflexionCitaId=...
  → primera vez: SI ambas personas dieron consiente_analisis=true
       → Anthropic API x2 (DINAMICA_RELACIONAL_PROMPT, PERFIL_Y_COMPATIBILIDAD_CITA_PROMPT)
       → guardado en citas.insights_debriefing_a/b, perfil_cita_a/b, compatibilidad_cita_a/b
       → copia de las señales en historial_relacional (una fila por persona)
  → Anthropic API (debriefingAperturaPrompt) → primer mensaje, guardado en cita_reflexiones
  → conversación de ida y vuelta vía /api/chat directo (streaming)
  → al cerrar: Anthropic API (CIERRE_DEBRIEFING_CORTO_PROMPT)
       → combina lo que la persona contó + los análisis de arriba (si existen)
       → guardado en citas.refinamiento_a/b
  → cada 5 citas analizadas con consentimiento: Anthropic API (NIVEL2_PROMPT) sobre
     historial_relacional de las últimas ~10 citas de esa persona (de cualquier match)
```
Evidencia: `api/citas.js:688-1151`.

## 9. Análisis externo (conversación de un tercero)

```
Usuario pega texto de una conversación mantenida fuera de la plataforma
  → POST /api/analisisExterno
  → Anthropic API (EXTRACT_PROMPT) sobre el texto pegado → perfil del tercero, SOLO EN MEMORIA
  → Anthropic API (COMPARE_EXTERNO_PROMPT) contra el perfil propio real
  → responde compatibilidad_hoy/potencial_construccion/veredicto
  → NADA del perfil del tercero se persiste en base
  → consume 1 de los usos free(2)/pro(10) solo si el resultado no fue todo null
```
Evidencia: `api/analisisExterno.js:51-114`.

## 10. Panel de administración

```
Administradora (contraseña única compartida, ADMIN_PASSWORD)
  → X-Admin-Password header en cada request a /api/admin/*
  → verificarAdmin.js: lockout de 5 intentos fallidos / 15 min por IP
  → todas las lecturas usan la service role key (bypasea RLS por diseño)
  → puede: ver listado de personas, Hoja de Vida completa (perfil, conversación, matches,
     intentos de fuga, reportes recibidos, feedback), transcripción de una cita (solo si ya
     cerró), ranking manual de compatibilidad, comparar dos personas a mano, activar/pausar
     matches, cambiar plan free/pro, archivar personas, sembrar cuentas de prueba ("Vista Previa",
     dominio @soul-app.test), forzar recierre de perfil
  → cada activación de match dispara Anthropic (si corresponde) + email a las dos personas (Resend)
```
Evidencia: `lib/verificarAdmin.js`, `api/admin/personas.js`, `api/admin/matches.js`, `api/admin/comparar.js`.

## 11. Cron diario (diagnóstico + purga)

```
Vercel Cron (0 11 * * *, autenticado con CRON_SECRET)
  → PRIMERO: purgarCuentasVencidas — recorre usuarios con eliminacion_solicitada_en
     vencida hace ≥30 días
       → cierra cualquier cita abierta que hubiera quedado
       → DELETE en perfiles, conversaciones, historial_relacional, intentos_fuga_prompt
       → intenta borrar el usuario real de Supabase Auth (requiere SUPABASE_SERVICE_ROLE_KEY)
       → anonimiza (no borra) la fila de usuarios (nombre/email/fecha_nacimiento/fotos → null,
         email → borrada-{id}@soul-app.eliminado, cuenta_eliminada=true)
  → LUEGO (solo lectura): junta errores silenciosos, reportes, intentos de fuga, uso de tokens
     (últimas 24hs), estado de entregabilidad de Resend, cuentas trabadas sin confirmar mail
  → guarda el resumen en diagnosticos_diarios (incluye HTML con nombres/emails)
  → envía el resumen por email a ADMIN_EMAIL (vía Resend)
```
Evidencia: `api/cron/diagnostico-diario.js` completo, `vercel.json:2-7`.

## 12. Solicitud de borrado de cuenta (disparada por el usuario)

```
Usuario → "Eliminar mi cuenta" (Mi perfil)
  → POST /api/auth {accion:'solicitarBorrado'}
  → cierra cualquier cita abierta con mensaje de despedida
  → PATCH usuarios SET eliminacion_solicitada_en = ahora
  → verificarUsuario() trata esto como sesión inválida desde ESE MISMO MOMENTO
     (acceso cortado de inmediato)
  → el borrado real de datos ocurre 30 días después, ejecutado por el cron (paso 11)
```
Evidencia: `api/auth.js:76-127`, `lib/authUtil.js:54-60`.

## Diagrama simplificado (flujo general)

```
Usuario
  → soul.html (front-end estático, sin framework)
  → /api/* (funciones serverless Vercel, Node.js, sin Express)
       ├─→ Supabase Auth (login/registro/recuperación)
       ├─→ Supabase REST/PostgREST (todas las tablas)
       ├─→ Anthropic API (chat, extracción de perfil, matching, presentación,
       │     intervención en citas, debriefing, resúmenes admin)
       └─→ Resend API (emails transaccionales y notificaciones)
  → respuesta al navegador
  → panel-admin.html (solo administradora, mismo backend con service role key)
```
