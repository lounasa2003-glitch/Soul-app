# Minimización de datos — Soul

> Agente 2. Este documento identifica, a partir de `inventario-datos.md`, `inferencias-ia.md`, `proveedores.md` y `mapa-flujos.md`, los datos que se recolectan/generan/envían y cuyo alcance, formato o frecuencia parece mayor al estrictamente necesario para la finalidad declarada. No propone texto legal; propone recortes técnicos o de producto concretos, y marca como pregunta lo que no puede resolverse solo con el código.

---

## 1. Datos recolectados de la persona usuaria

### 1.1 — `hora_nacimiento` (hora de nacimiento)
- **Dato**: se guarda desde "Mi perfil", aunque no es parte de los "básicos requeridos" del onboarding.
- **Uso identificado en el código**: ninguno visible más allá de guardarse (`inventario-datos.md`, fila "Fecha y hora de nacimiento"). No aparece referenciada en ningún prompt de IA (`inferencias-ia.md`) ni en el cálculo de matching (`lib/matchCompatible.js`).
- **Observación de minimización**: es un dato de precisión inusualmente alta (hora exacta de nacimiento) sin una finalidad de producto identificable en los documentos de auditoría. Es candidato claro a revisión de necesidad.
- **Pregunta**: ver `preguntas-pendientes.md` P-07 — ¿existe una función activa o planeada que la use (p. ej. algo relacionado con el enfoque "ontológico")? Si no, debería dejar de solicitarse.

### 1.2 — Dos fotografías (cara y cuerpo) embebidas en base64 en la fila principal de `usuarios`
- **Uso**: mostrar el perfil a un match potencial, condicionado a `foto_aprobada`.
- **Observación de minimización**: el problema no es recolectar dos fotos (razonable para una app de vínculos), sino el **formato de almacenamiento**: base64 embebido en la misma fila que el resto del perfil hace que cualquier consulta `select=*` (usadas en varios puntos con la service role key) traiga el binario completo de ambas fotos, incluso cuando la finalidad de esa consulta puntual no requiere las fotos. Esto multiplica innecesariamente qué datos viajan en cada operación interna. (Cruza con R-17 de `matriz-riesgos.md`, que lo trata como riesgo de seguridad; acá se señala también como problema de minimización — se transporta más dato del necesario en cada acceso.)
- **Acción de minimización**: separar las fotos del resto de la fila (storage dedicado con referencia), de forma que las consultas que no necesitan la imagen no la carguen.

### 1.3 — Campos de texto libre "no negociables" / "negociables"
- **Uso**: señal de mayor peso en el cálculo de compatibilidad (`COMPARE_PROMPT`) y se muestran íntegros a la otra persona en la presentación del match.
- **Observación de minimización**: es texto sin ningún límite de contenido ni de longitud declarado en la auditoría, y se reenvía **completo** a Anthropic en cada comparación contra cada candidato compatible (no una sola vez), y se muestra íntegro a cada persona con la que se genera un match. No hay evidencia de que se filtre o resuma antes de esos dos envíos.
- **Acción de minimización a evaluar**: considerar si el envío a Anthropic en cada comparación necesita el texto completo o si alcanzaría con una representación ya procesada una única vez (menos reenvíos del dato crudo a un tercero).

---

## 2. Datos generados por inferencia de IA

### 2.1 — Resumen de cita para uso exclusivo del panel admin (`resumen_ia`)
- **Uso declarado**: que la administradora entienda una cita sin leer todo el chat, para control de calidad/seguridad.
- **Observación de minimización**: además del problema de consentimiento ya señalado en `matriz-riesgos.md` (R-03), cabe preguntarse si la finalidad de "control de calidad y seguridad" realmente requiere un resumen generado por IA sobre el contenido completo de la transcripción, o si una señal más acotada (p. ej. solo detectar patrones de riesgo/reportabilidad) minimizaría el procesamiento de contenido de conversación privada entre dos personas reales.
- **Pregunta de producto**: ver `decisiones-producto.md`.

### 2.2 — `historial_relacional` (patrones entre citas, "Nivel 2")
- **Uso**: acumula señales de las últimas ~10 citas de una persona, a través de cualquier match, para detectar un patrón consistente cada 5 citas analizadas con consentimiento.
- **Observación de minimización**: es una segunda copia de contenido inferido (además de `citas.insights_debriefing_a/b`) que además no tiene migración de RLS (ver R-07). Antes de resolver solo el problema de RLS, vale evaluar si necesita existir como tabla separada de largo plazo o si podría derivarse bajo demanda a partir de `citas.insights_debriefing_a/b` sin persistir una copia adicional acumulativa.

### 2.3 — `diagnosticos_diarios` con nombres/emails reales en el cuerpo del reporte
- **Uso**: reporte operativo diario enviado por email a la administradora (cuentas trabadas sin confirmar, errores, etc.).
- **Observación de minimización**: el reporte identifica personas por nombre/email en texto plano dentro de un HTML que además se envía por correo (Resend) y se persiste en la tabla. Para la finalidad operativa (saber cuántas cuentas están trabadas, priorizar seguimiento) podría alcanzar con un identificador interno en el cuerpo del email, revelando nombre/email solo si la administradora necesita actuar sobre un caso puntual (p. ej. mediante un enlace al panel admin en vez de imprimir el dato directamente).

### 2.4 — Mensaje de "intentos de fuga de prompt" (hasta 2000 caracteres textuales)
- **Uso**: seguridad/monitoreo de intentos de jailbreak.
- **Observación de minimización**: se guarda el texto literal del mensaje del usuario que matcheó un patrón sospechoso. Es razonable guardar evidencia para ajustar el filtro, pero 2000 caracteres es un tope generoso frente a la finalidad (detectar patrones, no auditar la conversación completa). Vale reevaluar si un tope menor, o el patrón matcheado en vez del mensaje completo, cumple la misma finalidad con menos dato retenido.

---

## 3. Frecuencia y alcance de envíos a terceros (Anthropic)

- Cada cálculo de matches reenvía los **dos perfiles completos** (grupo1-4) más el texto libre de "no negociables"/"negociables" de ambas personas, por cada candidato compatible evaluado (`api/calcularMatches.js`). Si una persona tiene muchos candidatos compatibles, su perfil completo se retransmite una vez por cada comparación.
- La Sala de Encuentros reenvía hasta 20 mensajes previos como contexto en cada intervención de Soul (`promptGenerarTema`, `promptSalirIncomodidad`), lo cual es razonable para el propósito conversacional, pero es otro punto donde el volumen de contenido privado transmitido a un tercero podría revisarse si el costo/exposición se vuelve significativo a mayor escala.
- **Observación general**: no se encontró en el código ningún mecanismo de resumen o reducción antes de reenviar contenido repetidamente al mismo proveedor para operaciones repetitivas (matching contra múltiples candidatos). No se afirma que esto sea excesivo en el volumen actual de un piloto cerrado, pero es un punto a revisar si crece la base de usuarios (más candidatos → más reenvíos del mismo perfil completo).

---

## 4. Datos que ya están bien acotados (verificado, no requieren minimización)

- El perfil del "análisis externo" (tercero no usuario) no se persiste — se descarta tras el request. Correcto desde minimización, aunque el problema de consentimiento de esa tercera persona sigue abierto (ver R-10).
- La bio de presentación de la otra persona del match se genera al vuelo y no se cachea ni persiste — correcto.
- El perfil psicológico completo (grupo1-4) nunca se envía a la otra persona del match — filtrado correctamente por `curarMatch`/`curarCita`.
- `uso_tokens`/`eventos_piloto` se declaran explícitamente como agregados y no se persisten con contenido, solo conteos (aunque su clasificación como "no identificable" pese a referenciar `usuario_id` amerita revisión — ver R-21 en la matriz).
