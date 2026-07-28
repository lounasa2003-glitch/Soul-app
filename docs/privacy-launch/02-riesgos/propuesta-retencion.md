# Propuesta de retención de datos — Soul

> Decisión 6. Este documento **no modifica código ni implementa nada**. Es un análisis de la situación actual (verificada en el código, 2026-07-28) más una propuesta de plazos concretos para que la founder decida. No se redactó ni se modificó ningún documento legal (`legal.html`/`consentimiento.html`). Ningún plazo de acá está implementado — antes de tocar código hace falta aprobación explícita (ver checklist final).

## Cómo leer este documento

Para cada tabla/tipo de dato: qué contiene, para qué sirve, quién puede verlo hoy, cuánto dura hoy (verificado en el código, no supuesto), cuánto debería durar (propuesta razonada, no un número inventado), qué pasaría si se implementara esa purga, y qué depende técnicamente de esos datos antes de poder borrarlos.

Regla seguida en todo el documento: **cuenta activa** y **cuenta eliminada** (`solicitarBorrado` ya tocado) son dos situaciones distintas, con plazos distintos — nunca se mezclan en la misma fila.

---

## 1. `conversaciones` — chat completo con Soul

- **Contenido**: historial completo de la conversación de onboarding + módulos con Soul (ambos lados, persona e IA).
- **Finalidad**: insumo para que Soul construya el perfil vincular (`perfiles`); también es lo que `forzarCierrePerfil` (admin) y ahora las solicitudes de revisión de perfil (Decisión 5) necesitarían releer si hay que reconstruir o revisar algo.
- **Sensibilidad**: **Alta**. Texto libre sin restricción de contenido — puede incluir salud, creencias, orientación, cualquier tema (ver R-11 en `matriz-riesgos.md`).
- **Quién puede verlo hoy**: la propia persona (indirectamente, a través de la charla en curso); la administradora, vía Hoja de Vida (`api/admin/personas.js`, última conversación).
- **Plazo actual**: mientras la cuenta esté activa, **sin ningún tope** — no hay expiración ni siquiera para cuentas inactivas hace mucho. Cuenta eliminada: se borra (`DELETE`) a los 30 días de `solicitarBorrado` (`TABLAS_PERSONALES_A_BORRAR` en `api/cron/diagnostico-diario.js`).
- **Plazo recomendado (propuesta)**: cuenta activa: agregar un tope por inactividad (ej. 12 meses sin `ultima_actividad`) en vez de indefinido — hoy una cuenta que nunca pide baja acumula esto para siempre. Cuenta eliminada: sin cambios, el borrado a 30 días ya es razonable.
- **Qué ocurre al vencer hoy**: nada (no hay purga por inactividad, solo por baja explícita).
- **Impacto si se elimina**: se pierde la base para regenerar el perfil (`forzarCierrePerfil`) y para revisar una solicitud de la Decisión 5 sobre "por qué mi perfil dice esto".
- **Dependencias técnicas**: `forzarCierrePerfil` (admin) y el flujo de solicitudes de revisión (Decisión 5) leen esta tabla indirectamente al reconstruir contexto.
- **Duda de producto**: ¿un tope de inactividad de 12 meses es razonable para este producto, o conviene un plazo más corto/largo? No hay una respuesta técnica única.

---

## 2. `cita_mensajes` — mensajes de la Sala de Encuentros

- **Contenido**: chat completo entre las dos personas de un match durante un encuentro, más las intervenciones de Soul.
- **Finalidad**: la conversación real entre dos personas reales; base de los análisis de dinámica relacional y del resumen admin.
- **Sensibilidad**: **Alta**. Puede incluir cualquier tema de una conversación real entre dos personas.
- **Quién puede verlo hoy**: las dos personas del match (mientras y después del encuentro, vía "Mis citas"); la administradora, una vez cerrada la cita.
- **Plazo actual**: **nunca se borra**, ni siquiera cuando una de las dos personas elimina su cuenta — decisión de diseño explícita y documentada en el código (no destruir el registro de la otra persona que no pidió baja).
- **Plazo recomendado (propuesta)**: mantener la lógica de "no depende de que una sola persona se dé de baja" (es correcta), pero definir un tope temporal único ligado al cierre de la cita (ej. 24 meses desde que la cita quedó `cerrada`), no a la cuenta de ninguna de las dos personas. Esto evita que mensajes de citas cerradas hace años queden para siempre solo porque nadie pidió la baja.
- **Qué ocurre al vencer hoy**: nada, no hay ningún mecanismo de expiración.
- **Impacto si se elimina**: **Riesgo funcional real** — "Mis citas" y el historial de encuentros de la persona que SÍ sigue activa dejarían de mostrar contenido real si se borra sin cuidado. Cualquier purga acá tiene que ser por antigüedad de la cita, nunca por cuenta individual.
- **Dependencias técnicas**: pantalla "Mis citas"/Sala de Encuentros (ambas personas), Hoja de Vida del panel admin, y los campos derivados de la sección 8 (viven en `citas`, no acá, pero se calculan a partir de esto).
- **Duda de producto**: ¿24 meses es razonable, o el piloto todavía es tan chico que no vale la pena definir esto ahora? Marcar como pendiente si el volumen actual no lo justifica todavía.

---

## 3. `cita_reflexiones` — debriefing privado (chat real)

- **Contenido**: columna `historial`, la conversación real de debriefing de cada persona con Soul después de una cita — nunca compartida con la otra parte.
- **Finalidad**: autopercepción de la persona sobre su propio encuentro.
- **Sensibilidad**: **Alta**. Contenido de reflexión personal, potencialmente muy íntimo.
- **Quién puede verlo hoy**: **solo la propia persona**. Verificado: ni `panel-admin.html` ni `api/admin/personas.js` leen esta tabla en ningún punto — hoy ni siquiera la administradora la ve a través del producto (sí sería técnicamente accesible con la service role key directo en Supabase, como cualquier tabla).
- **Plazo actual**: **nunca se borra, tampoco al eliminar la cuenta** — no está en `TABLAS_PERSONALES_A_BORRAR` (`api/cron/diagnostico-diario.js`), y a diferencia de `cita_mensajes`/`matches`/`citas` esta exclusión **no tiene ningún comentario que la explique** en el código. Esto ya estaba señalado como hallazgo (R-16/H7 en auditorías previas) y sigue sin resolverse.
- **Plazo recomendado (propuesta)**: **sumar esta tabla a `TABLAS_PERSONALES_A_BORRAR`** — se borra a los 30 días de `solicitarBorrado`, igual que `conversaciones`/`perfiles`. Es contenido estrictamente propio, nadie más lo usa ni lo necesita después de que la persona se va. Cuenta activa: no hace falta un tope adicional — es contenido personal de autopercepción sin la fricción de "pertenece a otra persona también" que sí tiene `cita_mensajes`.
- **Qué ocurre al vencer hoy**: nada.
- **Impacto si se elimina** (al implementar la purga a 30 días): ninguno para terceros — es estrictamente propio. Confirmado que `historial_relacional` (que sí se purga) es lo que alimenta el patrón "Nivel 2", no esta tabla directamente — o sea, borrar `cita_reflexiones` no rompe ningún cálculo posterior.
- **Dependencias técnicas**: ninguna fuera de la propia pantalla de debriefing de la persona.
- **Sin duda legal/producto relevante** — este es el caso más claro de "hay que corregirlo", no depende de una decisión de negocio.

---

## 4. `cita_ayudas` — registro de uso de "ayuda privada" en una cita

- **Contenido**: `tipo_ayuda`, `resuelto` — no es contenido conversacional, es un contador de uso.
- **Finalidad**: aplicar el límite de 5 usos de ayuda por persona por cita (`LIMITE_AYUDA_POR_CITA`).
- **Sensibilidad**: **Baja**. Metadata de uso, no texto libre.
- **Quién puede verlo hoy**: nadie a través del producto — ni la propia persona ni la administradora tienen una pantalla que lo muestre; solo se consulta internamente para contar usos.
- **Plazo actual**: nunca se borra, tampoco al eliminar la cuenta (mismo hallazgo que `cita_reflexiones`: no está en `TABLAS_PERSONALES_A_BORRAR`, sin comentario que lo explique).
- **Plazo recomendado (propuesta)**: sumar a `TABLAS_PERSONALES_A_BORRAR` (borrado a los 30 días). Es el caso más simple de todos: una vez que la cita está `cerrada`, el límite ya no aplica más (no se puede pedir ayuda en una cita cerrada), así que ni siquiera hace falta esperar al borrado de cuenta — técnicamente se podría purgar apenas la cita cierra. Se propone igual mantenerlo simple y sumarlo al mismo lote de borrado por baja de cuenta.
- **Qué ocurre al vencer hoy**: nada.
- **Impacto si se elimina**: ninguno.
- **Dependencias técnicas**: ninguna, solo se lee para contar usos de una cita en curso.
- **Sin duda legal/producto relevante.**

---

## 5. `citas` (campos generados por IA) — resumen admin, debriefing, compatibilidad de la cita

- **Contenido**: viven dentro de la fila compartida `citas` (no en una tabla aparte): `resumen_ia` (Decisión 3, admin), `insights_debriefing_a/b`, `refinamiento_a/b`, `perfil_cita_a/b`, `compatibilidad_cita_a/b`.
- **Finalidad**: debriefing narrado para cada persona + resumen operativo para la administradora.
- **Sensibilidad**: **Alta** — son análisis interpretativos sobre el vínculo y la conducta de dos personas reales.
- **Quién puede verlo hoy**: `refinamiento_a/b` — cada persona, solo su propio lado (curado por `curarCita`). `resumen_ia`/`insights_debriefing_a/b`/`perfil_cita_a/b`/`compatibilidad_cita_a/b` — solo la administradora (nunca viajan al cliente, ver `CAMPOS_CITA_CLIENTE` en `api/citas.js`).
- **Plazo actual**: igual que `cita_mensajes` — la fila `citas` nunca se borra, ni al eliminar una cuenta (misma razón: es compartida entre dos personas).
- **Plazo recomendado (propuesta)**: mismo criterio que `cita_mensajes` (sección 2) — un tope por antigüedad de la cita, no por cuenta individual, ya que están en la misma fila.
- **Qué ocurre al vencer hoy**: nada.
- **Impacto si se elimina**: mismo riesgo que `cita_mensajes` — no se puede borrar por cuenta individual sin romper el historial de la otra persona.
- **Dependencias técnicas**: pantalla de debriefing de cada persona, Hoja de Vida del panel admin.
- **Duda de producto**: la misma que en la sección 2 — decidir si vale la pena definir esto ya o esperar a que el volumen lo justifique.

---

## 6. `reportes` — reportes entre personas usuarias (moderación)

- **Contenido**: `match_id`, `usuario_reporta`, `usuario_reportado`, `motivo` (categórico, sin texto libre).
- **Finalidad**: seguridad — detectar patrones de conducta reportada.
- **Sensibilidad**: **Media** — no hay texto libre, pero vincula a dos personas con una acusación.
- **Quién puede verlo hoy**: la administradora (Hoja de Vida de la persona reportada). La política RLS solo deja ver a quien reportó sus propios reportes hechos, no al reportado.
- **Plazo actual**: nunca se borra, ni al eliminar la cuenta de ninguna de las dos personas involucradas.
- **Plazo recomendado (propuesta)**: **este es el caso donde retener más tiempo tiene una razón de seguridad real** — a diferencia del resto, acortar el plazo acá tiene un costo de seguridad concreto (perder la única señal de patrones de mal comportamiento). Se propone **no tratarlo igual que el resto**: conservar mientras la persona **reportada** siga con una cuenta activa en la plataforma, y recién ahí definir un plazo posterior (ej. 12-24 meses tras la baja de la persona reportada). No se propone un número cerrado — es la fila de esta tabla donde más vale la pena una revisión legal antes de fijar un plazo.
- **Qué ocurre al vencer hoy**: nada.
- **Impacto si se elimina antes de tiempo**: pérdida real de capacidad de detectar patrones de conducta repetida.
- **Dependencias técnicas**: ninguna automatizada — hoy es revisión manual de la administradora.
- **Duda legal explícita**: si el reporte debe conservarse incluso después de que la persona *reportante* elimina su cuenta (parece razonable que sí, ya que el dato relevante es la conducta de la persona *reportada*) es una pregunta que amerita opinión legal, no solo de producto.

---

## 7. `reportes_tecnicos` — "algo no funciona" / soporte

- **Contenido**: `contexto`, `email` (opcional), a veces sin `usuario_id` (se puede mandar sin sesión).
- **Finalidad**: soporte técnico y debug.
- **Sensibilidad**: **Baja-Media** (puede incluir un email).
- **Quién puede verlo hoy**: la administradora. Nota aparte (no es parte de esta decisión, ya documentada en `matriz-riesgos.md` R-08/H6): la política RLS permite leer cualquier fila con `usuario_id IS NULL` con el anon key, no solo la propia — un gap de seguridad, no de retención.
- **Plazo actual**: nunca se borra.
- **Plazo recomendado (propuesta)**: retención corta — una vez resuelto el problema técnico, el valor cae a casi cero. Propuesta: 6 meses desde la creación, después purgar.
- **Qué ocurre al vencer hoy**: nada.
- **Impacto si se elimina**: ninguno relevante — es diagnóstico operativo, no tiene valor histórico de producto.
- **Dependencias técnicas**: ninguna.
- **Sin duda legal relevante** más allá de la ya documentada en R-08 (fuera de alcance de esta decisión).

---

## 8. `feedback_piloto` — feedback estructurado del piloto

- **Contenido**: calificaciones numéricas (comprensión, comodidad, recomendación) + comentarios de texto libre (`comentario_conversacion`, `comentario_modulos`, `problemas_tecnicos`, `que_cambiarias`).
- **Finalidad**: aprendizaje de producto durante el piloto.
- **Sensibilidad**: **Media** — texto libre, puede incluir opiniones personales sobre la experiencia (a veces sensible, ej. si menciona por qué se sintió incómoda con algo).
- **Quién puede verlo hoy**: la administradora (Hoja de Vida); la propia persona (`leerTabla('feedback_piloto', ...)` en soul.html, para no mostrar el formulario dos veces).
- **Plazo actual**: nunca se borra.
- **Plazo recomendado (propuesta)**: a diferencia de otras tablas, acá el valor **no cae con el tiempo** — es aprendizaje de producto que puede seguir siendo útil después del piloto. Se propone **no borrar el contenido**, sino **desvincular `usuario_id`** (poner en null) pasado un plazo razonable tras el cierre formal del piloto o tras la baja de la cuenta (ej. a los 30 días de `solicitarBorrado`, igual que el resto de lo personal) — se conserva el aprendizaje, se pierde el vínculo con la persona.
- **Qué ocurre al vencer hoy**: nada.
- **Impacto si se anonimiza en vez de borrar**: ninguno funcional (nada más lee `usuario_id` de esta tabla salvo para no repetir el formulario, y eso ya no aplica si la cuenta se eliminó).
- **Dependencias técnicas**: ninguna crítica.
- **Duda de producto**: ¿anonimizar (recomendado acá) o tratarlo igual que el resto de las tablas personales (borrado completo a los 30 días)? Es una decisión de qué tan importante es preservar el feedback agregado del piloto.

---

## 9. `errores_silenciosos` — log técnico interno

- **Contenido**: `contexto`, `mensaje`/error, `meta` (con redacción automática de secretos conocidos, ver `lib/logErrorSilencioso.js`).
- **Finalidad**: debug técnico.
- **Sensibilidad**: **Media** — los secretos conocidos se redactan, pero `meta` puede incluir IDs de usuario u otro dato incidental no contemplado en la lista de redacción.
- **Quién puede verlo hoy**: **nadie a través del producto** — verificado que ni `panel-admin.html` ni `api/admin/personas.js` exponen el contenido completo de esta tabla; el diagnóstico diario solo manda conteos por `contexto`, nunca el mensaje ni el `meta`. Solo accesible directo en Supabase con la service role key.
- **Plazo actual**: nunca se borra.
- **Plazo recomendado (propuesta)**: retención corta — 90 días es más que suficiente para diagnóstico técnico; nada en el código sugiere que se necesite más que eso.
- **Qué ocurre al vencer hoy**: nada.
- **Impacto si se elimina**: ninguno — es un log técnico, no un registro de producto.
- **Dependencias técnicas**: ninguna.
- **Sin duda legal relevante.**

---

## 10. `diagnosticos_diarios` — snapshot operativo diario

- **Contenido**: `resumen` (JSON agregado) + `texto_resumen` (HTML), que **incluye nombres y emails reales en texto plano** (cuentas trabadas sin confirmar, mails con problemas de entrega).
- **Finalidad**: reporte operativo diario a la administradora.
- **Sensibilidad**: **Alta**, por un motivo distinto al resto: el nombre/email queda **embebido como texto dentro del HTML**, no como referencia a la fila de `usuarios`. Esto significa que **anonimizar la cuenta de origen (borrado a 30 días) no borra este dato** — el nombre y el email de esa persona, tal como eran en el momento del diagnóstico, quedan igual en `diagnosticos_diarios` para siempre.
- **Quién puede verlo hoy**: la administradora (panel admin, últimas 30 corridas) + llega también por email a `ADMIN_EMAIL` cada vez que se genera.
- **Plazo actual**: nunca se borra — el panel solo muestra las últimas 30 corridas, pero eso es un límite de consulta (`limit=30`), no de retención: las filas más viejas siguen en la base.
- **Plazo recomendado (propuesta)**: retención corta — es un reporte operativo que se reemplaza todos los días; 90 días alcanza de sobra para tener historial reciente. Es la tabla con **mayor urgencia relativa** de las que hoy no tienen ningún plazo, justamente porque el borrado de cuenta no la alcanza.
- **Qué ocurre al vencer hoy**: nada.
- **Impacto si se elimina**: ninguno funcional — el panel ya solo muestra las últimas 30 corridas.
- **Dependencias técnicas**: ninguna.
- **Sin duda legal relevante** — es el caso más claro, junto con `cita_reflexiones`/`cita_ayudas`, de que corregirlo no depende de una decisión de negocio compleja.

---

## 11. `historial_relacional` — señales acumuladas entre citas ("Nivel 2")

- **Contenido**: `usuario_id`, `cita_id`, `match_id`, `senales` (patrones de vínculo extraídos por IA, propios de cada persona).
- **Finalidad**: detectar patrones consistentes a lo largo de varias citas (de cualquier match) de la misma persona.
- **Sensibilidad**: **Alta** — es análisis interpretativo sobre patrones de conducta relacional.
- **Quién puede verlo hoy**: nadie directamente — se lee internamente para generar el mensaje de "Nivel 2" que sí ve la propia persona (dentro de `cita_reflexiones`, no acá).
- **Plazo actual**: cuenta activa: sin tope. Cuenta eliminada: se borra a los 30 días (ya está en `TABLAS_PERSONALES_A_BORRAR`). **Correcto, sin cambios propuestos.**
- **Plazo recomendado (propuesta)**: sin cambios — es coherente que dure lo mismo que `perfiles`/`conversaciones`, ya que es insumo directo del mismo sistema de matching/análisis.
- **Qué ocurre al vencer**: se borra correctamente hoy.
- **Impacto si se elimina** (ya implementado): ninguno reportado.
- **Dependencias técnicas**: `NIVEL2_PROMPT` (cada 5 citas analizadas con consentimiento).
- **Sin duda relevante** — este es un ejemplo de "ya está bien", se incluye por completitud ya que estaba en la lista a revisar.

---

## 12. `perfiles` — inferencias y perfil vincular (grupo1-4)

- **Contenido**: perfil psicológico/vincular estructurado, generado por IA a partir de `conversaciones`.
- **Finalidad**: motor de matching; lo que ve la administradora en la Hoja de Vida.
- **Sensibilidad**: **Alta** — es el dato más sensible del sistema (puede reflejar orientación, vida íntima, patrones de conducta).
- **Quién puede verlo hoy**: nunca la otra persona del match (filtrado explícitamente); la propia persona no lo ve en forma estructurada hoy tampoco (solo indirectamente, vía compatibilidad); la administradora, sí, completo.
- **Plazo actual**: cuenta activa: sin tope. Cuenta eliminada: se borra a los 30 días (ya está en `TABLAS_PERSONALES_A_BORRAR`). **Correcto, sin cambios propuestos.**
- **Plazo recomendado (propuesta)**: sin cambios en el borrado por baja. Igual que `conversaciones` (sección 1): evaluar un tope de inactividad para cuentas activas que nunca vuelven, ya que hoy ese perfil sensible queda indefinidamente accesible para la administradora sin ningún límite de tiempo mientras la cuenta exista.
- **Qué ocurre al vencer**: se borra correctamente al eliminar la cuenta.
- **Impacto si se acorta el plazo de cuenta activa**: si se implementa un tope de inactividad, se perdería la posibilidad de recalcular matches para una cuenta que "vuelve" después de mucho tiempo sin haber pedido la baja — tendría que rehacer el chat con Soul.
- **Dependencias técnicas**: motor de matching (`api/calcularMatches.js`), presentación de match, panel admin.
- **Duda de producto**: la misma que en la sección 1 (tope de inactividad, no un número definitivo).

---

## Nota fuera de la lista pedida: `solicitudes_revision_perfil` (Decisión 5, ya en producción)

No estaba en la lista de tablas a revisar (es nueva, se creó recién con la Decisión 5), pero como contiene texto libre personal (`texto_cuestionado`, `explicacion`) y hoy **tampoco está en `TABLAS_PERSONALES_A_BORRAR`**, queda con el mismo problema que `cita_reflexiones`/`cita_ayudas`: nunca se borra, ni al eliminar la cuenta. Se marca acá para que la founder la incluya en la misma decisión, ya que es exactamente el mismo tipo de gap.

---

## Tabla resumen de plazos propuestos

| Tabla / dato | Plazo actual (cuenta activa) | Plazo actual (cuenta eliminada) | Propuesta (cuenta activa) | Propuesta (cuenta eliminada) |
|---|---|---|---|---|
| `conversaciones` | Sin tope | 30 días | Tope de inactividad a definir (ej. 12 meses) | Sin cambios (30 días) |
| `cita_mensajes` | Sin tope (compartido) | Nunca se borra (por diseño) | Tope por antigüedad de la cita, no por cuenta (ej. 24 meses desde el cierre) | Igual que cuenta activa (es compartido) |
| `cita_reflexiones` | Sin tope | **Nunca se borra (gap)** | Sin cambios | **Sumar a purga de 30 días** |
| `cita_ayudas` | Sin tope | **Nunca se borra (gap)** | Sin cambios | **Sumar a purga de 30 días** |
| `citas` (campos IA) | Sin tope (compartido) | Nunca se borra (por diseño) | Mismo criterio que `cita_mensajes` | Igual que cuenta activa |
| `reportes` | Sin tope | Nunca se borra | Mientras la persona reportada esté activa + margen post-baja (a definir, revisión legal recomendada) | — |
| `reportes_tecnicos` | Sin tope | Nunca se borra | 6 meses desde creación | Igual |
| `feedback_piloto` | Sin tope | Nunca se borra | Sin cambios en contenido; evaluar anonimizar (`usuario_id → null`) | Anonimizar a los 30 días en vez de mantener el vínculo |
| `errores_silenciosos` | Sin tope | Nunca se borra | 90 días | Igual |
| `diagnosticos_diarios` | Sin tope | **Nunca se borra (PII embebida en texto, gap)** | 90 días | Igual (no depende de la cuenta) |
| `historial_relacional` | Sin tope | 30 días | Sin cambios | Sin cambios |
| `perfiles` | Sin tope | 30 días | Tope de inactividad a definir (ej. 12 meses) | Sin cambios (30 días) |
| `solicitudes_revision_perfil` | Sin tope | **Nunca se borra (gap nuevo)** | Sin cambios | **Sumar a purga de 30 días** |

---

## Decisiones que le corresponden a la founder

1. **Confirmar los 3 gaps de "nunca se borra al eliminar cuenta"** (`cita_reflexiones`, `cita_ayudas`, `solicitudes_revision_perfil`) — son los de menor ambigüedad: contenido estrictamente propio, sin ninguna razón funcional identificada para retenerlo tras la baja. Si se aprueban, se suman a `TABLAS_PERSONALES_A_BORRAR`.
2. **Definir si corresponde un tope de inactividad para cuentas activas** (`conversaciones`, `perfiles`) — hoy no hay ningún límite mientras la cuenta exista, sin importar cuánto tiempo pasó. Elegir un número (12 meses es solo una propuesta de referencia) o decidir que no hace falta todavía dado el tamaño del piloto.
3. **Definir el plazo de `cita_mensajes`/`citas`** — el más delicado porque es contenido compartido entre dos personas; no puede depender de la baja de una sola cuenta. Requiere decidir un tope por antigüedad de la cita.
4. **Definir el plazo de `reportes`** — es el único caso donde acortar el plazo tiene un costo de seguridad real. Se recomienda revisión legal antes de fijar un número, no solo una decisión de producto.
5. **Elegir entre borrar o anonimizar `feedback_piloto`** — decisión de cuánto valor tiene preservar el feedback agregado del piloto sin el vínculo a la persona.
6. **Aprobar plazos cortos (90 días / 6 meses) para las tablas puramente operativas** (`errores_silenciosos`, `reportes_tecnicos`, `diagnosticos_diarios`) — las de menor sensibilidad de decisión, pero con mayor urgencia relativa porque `diagnosticos_diarios` en particular contiene PII que hoy no tiene ningún mecanismo de expiración.

## Riesgos de pérdida funcional a tener en cuenta

- **`cita_mensajes`/`citas`**: cualquier purga mal implementada acá puede romper "Mis citas"/Sala de Encuentros para la persona que sigue activa, si se borra por cuenta individual en vez de por antigüedad de la cita compartida.
- **`conversaciones`/`perfiles`**: un tope de inactividad demasiado agresivo obligaría a una persona que vuelve después de mucho tiempo a rehacer todo el chat con Soul desde cero.
- **`reportes`**: acortar demasiado el plazo reduce la capacidad real de detectar patrones de mal comportamiento repetido — es el único caso donde "menos retención" no es automáticamente mejor.
- El resto de los cambios propuestos (`cita_reflexiones`, `cita_ayudas`, `solicitudes_revision_perfil`, `errores_silenciosos`, `reportes_tecnicos`, `diagnosticos_diarios`) no tiene ningún riesgo funcional identificado — son los de implementación más simple y segura si se aprueban.

## Checklist de cierre

- [x] No se modificó código.
- [x] No se usó un único plazo para todas las tablas.
- [x] No se inventó una necesidad de conservación (cada plazo recomendado está atado a una finalidad ya verificada en el código).
- [x] Se diferenció cuenta activa de cuenta eliminada en cada fila.
- [x] Se identificaron los 3 datos que deberían borrarse de inmediato al eliminar la cuenta (`cita_reflexiones`, `cita_ayudas`, `solicitudes_revision_perfil`) y los que ya tienen demora técnica correcta (30 días: `conversaciones`, `perfiles`, `historial_relacional`, `intentos_fuga_prompt`).
- [x] Se mantuvieron separados los mensajes/campos que también pertenecen a otra persona (`cita_mensajes`, `citas`) del resto.
- [x] No se implementó ninguna purga — queda pendiente de tu aprobación.
- [x] No se modificó ningún documento legal.

**Quedo a la espera de tu aprobación (plazo por plazo, o en bloque) antes de tocar cualquier código de purga.**
