# Propuesta técnica para cerrar la Decisión 6 — `cita_mensajes` y `citas`

> Solo diseño. **No se modificó código ni se corrió ninguna migración.** Este documento evalúa la propuesta base que diste (4 puntos) contra el esquema y el comportamiento real actuales, señala qué ya existe, qué falta, y qué decisiones concretas hay que tomar antes de implementar. Queda esperando tu aprobación.

## Resumen de la propuesta base evaluada

1. Mientras ambas cuentas estén activas: conservar la cita y sus mensajes.
2. Si una persona elimina su cuenta: a los 30 días anonimizar su identidad dentro de la cita; la otra persona conserva acceso, sin ver datos identificatorios de quien se fue.
3. A los 12 meses desde el cierre de la cita: borrar `cita_mensajes`; conservar solo datos mínimos no identificatorios para historial funcional.
4. Si hay un reporte de seguridad abierto sobre esa cita/match: suspender la purga hasta que se cierre el caso.

**Veredicto general**: los puntos 1 y 2 son mayormente compatibles con lo que ya existe (con un ajuste puntual, no una funcionalidad nueva). Los puntos 3 y 4 requieren funcionalidad que **no existe hoy** -- no son solo "correr una purga más", necesitan una columna nueva cada uno como mínimo. Detalle abajo.

---

## 1. Columnas afectadas

### Ya existen (verificado en el código, sin cambios de esquema)
- `citas`: `id`, `match_id`, `estado`, `created_at`, `ultima_actividad`, `notas`, `eleccion_a`/`eleccion_b`, `leido_hasta_a`/`leido_hasta_b`, `escribiendo_a`/`escribiendo_b`, `consiente_analisis_a`/`consiente_analisis_b`, `refinamiento_a`/`refinamiento_b`, `insights_debriefing_a`/`insights_debriefing_b`, `perfil_cita_a`/`perfil_cita_b`, `compatibilidad_cita_a`/`compatibilidad_cita_b`, `resumen_ia`.
- `cita_mensajes`: `id`, `cita_id`, `usuario_id` (nulo cuando el mensaje es de Soul), `tipo`, `contenido`, `created_at`.
- `usuarios`: `nombre`, `email`, `foto_cara`, `foto_cuerpo`, `cuenta_eliminada`, `eliminacion_solicitada_en` -- estas ya se anonimizan hoy a los 30 días de `solicitarBorrado` (`api/cron/diagnostico-diario.js`, función `purgarUsuario`, sin cambios desde el commit `f8b3e8b`).
- `reportes`: `match_id`, `usuario_reporta`, `usuario_reportado`, `motivo`, `created_at`.

### No existen hoy -- necesarias para esta propuesta
- **`citas.cerrada_en`** (timestamptz) -- hoy `finalizarCita()` (`lib/cierreCita.js`) solo escribe `estado: 'cerrada'`, **nunca guarda cuándo**. Sin esta columna no hay forma de calcular "12 meses desde el cierre" con precisión. `ultima_actividad` no sirve como reemplazo confiable: no está garantizado que deje de actualizarse exactamente en el momento del cierre para todos los caminos (cierre manual, por inactividad, forzado por baja de cuenta).
- **`reportes.estado`** (text, `abierto`/`cerrado`) -- hoy `reportes` **no tiene ningún campo de estado**. Es un log plano: se inserta un reporte y ahí queda, sin ningún flujo de "resolver el caso" en ningún lado del producto (ni en el panel admin, que solo lo lista). El punto 4 de tu propuesta ("hasta que se cierre el caso") asume un concepto de caso abierto/cerrado que hoy simplemente no existe.

---

## 2. Qué se anonimiza (punto 2 de tu propuesta)

**Buena noticia**: la anonimización de identidad ya ocurre hoy, en gran parte, por un mecanismo que ya está desplegado y que no es específico de citas -- es el mismo tombstone que corre para cualquier baja de cuenta desde antes de esta ronda (commit `f8b3e8b`, 2026-07-25): a los 30 días de `solicitarBorrado`, `usuarios.nombre` pasa a `null`, `usuarios.email` pasa a `borrada-{id}@soul-app.eliminado`, y las fotos se ponen en `null`.

**El problema real no es que falte anonimizar -- es un bug de visualización que hace que la anonimización no se note.** En `api/citas.js:155`, la función que arma `otra_persona_nombre` para "Mis citas" hace:
```js
nombrePorId[u.id] = u.nombre || u.email || null;
```
Cuando `nombre` es `null` (ya anonimizado), este fallback cae en `u.email` -- que para una cuenta eliminada es literalmente el string `borrada-{id}@soul-app.eliminado`. Ese string termina mostrándose en "Mis citas" como si fuera el nombre de la persona, en vez de mostrar algo neutro. El mismo patrón aparece en `api/citas.js:943` (vista de debriefing) y hay que revisar si `api/matches.js` tiene una resolución equivalente para el nombre de la otra persona en la pantalla de Matches.

**Cambio necesario (código, no migración)**: reemplazar ese fallback por algo así:
```js
nombrePorId[u.id] = u.cuenta_eliminada ? 'Persona que eliminó su cuenta' : (u.nombre || u.email || null);
```
en cada uno de los puntos donde hoy se arma ese nombre. Esto es lo que efectivamente cumple "preservar el acceso de la otra persona sin mostrar datos identificatorios de quien se fue" -- ya no depende de una purga nueva, depende de corregir cómo se muestra un dato que ya está anonimizado.

**Lo que NO se toca**: el contenido de los mensajes (`cita_mensajes.contenido`) de la persona que se fue. Tu propuesta pide anonimizar identidad, no borrar contenido a los 30 días -- eso es el punto 3, a los 12 meses. Si se borrara el contenido a los 30 días, "Mis citas" quedaría con una conversación incompleta para quien se queda, mucho antes de lo que pide tu propio punto 1 ("mientras ambas cuentas estén activas, conservar la cita y sus mensajes" -- una persona activa con la otra ya eliminada sigue siendo una cita legítima para quien se queda).

---

## 3. Qué se elimina (punto 3 de tu propuesta -- 12 meses desde el cierre)

Esto sí requiere una purga nueva, sin equivalente hoy. Ámbito propuesto de "borrar `cita_mensajes`, conservar solo datos mínimos no identificatorios":

- **Se borra completo**: todas las filas de `cita_mensajes` de esa cita (mensajes de ambas personas y de Soul). Esto responde directamente al objetivo que planteaste: dejar de conservar indefinidamente conversaciones íntimas.
- **Se recomienda borrar también** (no estaba explícito en tu propuesta, pero son análisis derivados de la misma transcripción que ya no existiría): `citas.resumen_ia`, `insights_debriefing_a/b`, `perfil_cita_a/b`, `compatibilidad_cita_a/b`. Conservarlos sin la transcripción que los originó sería guardar una interpretación de algo que ya no se puede verificar ni corregir -- y siguen siendo contenido sensible en sí mismos (ver `matriz-riesgos.md`, sección 5).
- **Punto abierto, necesita tu confirmación**: `refinamiento_a/b` (el debriefing narrado que cada persona ya leyó sobre su propia experiencia) -- ¿se borra junto con el resto, o se conserva porque es contenido que la propia persona ya vio y podría querer volver a leer? Ninguna opción es automáticamente correcta; lo marco como decisión, no lo resuelvo acá.
- **Se conserva** (esto es el "historial mínimo funcional" que permite que "Mis citas" siga mostrando que el encuentro existió): `citas.id`, `match_id`, `created_at`, `cerrada_en`, `estado`. Ninguno de estos campos identifica contenido de la conversación ni requiere texto libre.

---

## 4. Impacto en "Mis citas"

- **Mientras ambas cuentas están activas** (punto 1): sin cambios, sigue mostrando todo tal como hoy.
- **Después de que una persona elimina su cuenta** (punto 2, con el fix de visualización): la persona que se queda sigue viendo la cita completa (mensajes incluidos) en su historial, pero la etiqueta de "con quién fue" pasa a un texto genérico en vez del nombre real o el email tombstone.
- **Después de los 12 meses del cierre** (punto 3): la entrada de "Mis citas" para esa cita deja de mostrar la conversación -- queda como un registro de que el encuentro existió (fecha, con quién si la cuenta sigue activa, resultado si se guarda en `eleccion_a/b`), pero sin poder reabrir el chat para releerlo. Esto es un cambio de comportamiento real y visible para la persona usuaria, no solo un detalle interno -- posiblemente amerite un aviso en el producto (“las conversaciones de encuentros cerrados hace más de un año ya no se pueden releer”), lo cual es una decisión de producto/UX que excede este documento técnico.

---

## 5. Impacto en matching e historial relacional

- **Matching (`api/calcularMatches.js`)**: **ningún impacto**. El cálculo de compatibilidad lee `perfiles`, nunca `citas` ni `cita_mensajes` directamente. Purgar contenido de citas viejas no afecta la capacidad de matchear a nadie, ni ahora ni en el futuro.
- **`historial_relacional`**: **ningún impacto si el orden de eventos es el que ya existe hoy**. Las señales que alimentan el patrón "Nivel 2" se extraen una sola vez, en el momento del debriefing (`extraerDinamicaRelacionalEnSegundoPlano`, `api/citas.js`), y se guardan de forma independiente en `historial_relacional.senales` -- no se vuelven a leer desde `cita_mensajes` después de eso. Como esa extracción ocurre mucho antes de los 12 meses (pasa apenas se completa el debriefing), purgar `cita_mensajes` a los 12 meses **no le quita nada a `historial_relacional`**, que ya tiene su propia copia independiente y su propio plazo de retención (30 días tras baja de cuenta, ya resuelto).
- **Advertencia real**: si alguna vez se quisiera **reprocesar** una cita vieja (por ejemplo, para una solicitud de revisión de perfil -- Decisión 5 -- que pidiera "revisar qué pasó en tal encuentro"), eso ya no sería posible después de los 12 meses, porque la transcripción original ya no existiría. Es una consecuencia directa y esperable del objetivo que planteaste, no un efecto colateral inesperado -- se menciona para que quede documentado como una limitación aceptada, no como un bug futuro.

---

## 6. Cómo detectar reportes abiertos (punto 4)

**Hoy no se puede**, porque `reportes` no tiene ningún campo de estado. Dos caminos, con distinto costo:

### Opción A -- mínima, sin nuevo flujo de trabajo admin
Tratar la sola existencia de un reporte como una suspensión indefinida: antes de purgar, `SELECT id FROM reportes WHERE match_id = <match_id de la cita>` -- si devuelve alguna fila, no se purga esa cita, nunca, hasta que alguien decida lo contrario a mano (por ejemplo, borrando el reporte desde Supabase directamente, algo que hoy no tiene ninguna pantalla). Simple de implementar, pero sin ninguna forma de "cerrar el caso" real -- cualquier cita alguna vez reportada queda retenida para siempre, lo cual podría no ser la intención.

### Opción B -- con flujo real de apertura/cierre (recomendada si de verdad se quiere que la purga se reanude al resolver el caso)
1. Agregar `reportes.estado` (`abierto`/`cerrado`, default `abierto`).
2. Agregar una acción en el panel admin (Hoja de Vida → Seguridad, que hoy solo lista reportes sin ninguna acción posible) para que la administradora pueda marcar un reporte como cerrado.
3. Antes de purgar: `SELECT id FROM reportes WHERE match_id = <match_id> AND estado = 'abierto'`.

### Ambigüedad a resolver en cualquiera de las dos opciones
`reportes.match_id` apunta a un **match**, no a una **cita puntual** -- y un match puede tener varias citas (la Sala de Encuentros permite reabrir un encuentro nuevo). Hoy no hay forma de saber a cuál de las citas de ese match se refiere un reporte específico. Se propone, mientras no se resuelva esto: **si hay un reporte abierto sobre el match, suspender la purga de TODAS las citas de ese match**, no solo la más reciente -- es la opción más conservadora, y errar hacia "no purgar" ante la duda es lo razonable para algo etiquetado como reporte de seguridad. Si se quiere precisión por cita, haría falta sumar `reportes.cita_id` (nullable, para no romper los reportes existentes que no la tienen).

---

## 7. Migraciones necesarias (para cuando se apruebe)

```sql
-- 1. Timestamp de cierre real (necesario para el punto 3)
ALTER TABLE citas ADD COLUMN IF NOT EXISTS cerrada_en timestamptz;

-- 2. Estado del reporte (necesario para el punto 4, Opción B)
ALTER TABLE reportes ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'abierto'
  CHECK (estado IN ('abierto', 'cerrado'));

-- 3. Opcional -- solo si se quiere granularidad por cita en vez de por match (ver seccion 6)
ALTER TABLE reportes ADD COLUMN IF NOT EXISTS cita_id uuid REFERENCES citas(id);
```

**Backfill pendiente de decidir**: las citas que ya están `cerrada` hoy no tienen ningún registro de cuándo cerraron. Opciones: (a) dejar `cerrada_en` en `null` para esas y excluirlas de la purga de 12 meses hasta que se resuelva a mano, o (b) aproximar con `ultima_actividad` como mejor estimación disponible, aceptando que no es exacto. No se recomienda ninguna de las dos sin que lo confirmes -- afecta directamente cuántas citas reales entrarían en la primera corrida de esta purga.

---

## 8. Riesgos técnicos

- **Ambigüedad match vs. cita en `reportes`** (ya detallada en la sección 6): sin resolverla, cualquier implementación puede suspender de más (conservador, más seguro) o de menos (si se decide ignorar el match completo y solo mirar la cita puntual, sin tener esa columna).
- **Backfill de `cerrada_en`**: sin una fecha de cierre confiable para citas ya cerradas, la primera corrida de la purga de 12 meses puede no purgar nada (si se opta por excluir las que tienen `cerrada_en = null`) o purgar con una fecha aproximada que no es exacta (si se opta por usar `ultima_actividad`).
- **El fix de visualización (`u.nombre || u.email`) tiene más de un punto de impacto**: se identificaron dos (`api/citas.js:155` y `:943`); hace falta una revisión específica de `api/matches.js` y de cualquier otro lugar que arme el nombre de "la otra persona" a partir de `usuarios`, para no dejar ninguno con el mismo bug.
- **Los dos ciclos de purga (30 días de identidad, 12 meses de contenido) corren de forma independiente y no deberían pisarse** -- pero conviene que la implementación real los mantenga como dos pasos separados y explícitos en el cron, no combinados en una sola función, para que un error en uno no bloquee al otro (mismo patrón ya usado para `purgarCuentasVencidas`/`purgarPorAntiguedad`).
- **Volumen**: con el tamaño actual del piloto, un `DELETE` de `cita_mensajes` por cita vencida es trivial. Si la base crece mucho, purgar en lote (muchas citas en una sola corrida) podría necesitar paginación -- no es un problema hoy, se deja anotado para el futuro.

---

## 9. Alternativas si 12 meses resulta excesivo o insuficiente

| Alternativa | Cuándo tendría sentido |
|---|---|
| **6 meses** (mismo plazo ya usado para `reportes_tecnicos`) | Si se prioriza minimización por sobre la posibilidad de que alguien quiera releer una charla de hace medio año. |
| **24 meses** (la propuesta original de `propuesta-retencion.md`) | Si el piloto es chico y no hay urgencia real -- da más margen antes de perder contenido que alguien podría todavía querer consultar. |
| **Escalonado**: mantener el contenido completo unos meses, después anonimizar identidad (si no se hizo ya por baja de cuenta) manteniendo el contenido, y recién más tarde borrar el contenido | Si se quiere una transición más gradual en vez de un único corte a los 12 meses. Más complejo de implementar (tres estados en vez de dos). |
| **Condicional a actividad, no a calendario fijo**: purgar contenido solo cuando *ambas* personas del match ya no tengan cuenta activa | Evita borrar algo que una persona todavía activa podría querer conservar indefinidamente -- pero reintroduce el problema original que motivó esta decisión (retención indefinida mientras alguien siga activo, sin ningún tope real). |
| **No purgar contenido, solo anonimizar identidad para siempre** (descartar el punto 3 entero) | Si se decide que el riesgo de conservar contenido indefinidamente es aceptable una vez resuelta la identidad -- pero no cumple el objetivo que vos misma planteaste de reducir la conservación indefinida de conversaciones íntimas. |

---

## Checklist de cierre

- [x] No se modificó código.
- [x] No se corrió ninguna migración.
- [x] Se identificaron las columnas afectadas, existentes y nuevas.
- [x] Se separó claramente qué se anonimiza (identidad, ya en gran parte resuelto por un bug de visualización a corregir) de qué se elimina (contenido, purga nueva).
- [x] Se evaluó el impacto en "Mis citas", matching e `historial_relacional` con evidencia del código, no supuestos.
- [x] Se identificó que la detección de "reporte abierto" no es posible hoy sin un cambio de esquema, y se plantearon dos caminos sin elegir uno.
- [x] Se listaron las migraciones necesarias, sin correrlas.
- [x] Se señalaron los riesgos técnicos encontrados, en particular la ambigüedad match/cita en `reportes` y el backfill de `cerrada_en`.
- [x] Se ofrecieron alternativas de plazo, sin decidir por vos.

**Quedo esperando tu aprobación -- decisión por decisión o en bloque -- antes de tocar código.**
