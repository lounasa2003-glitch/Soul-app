# Plan de correcciones — Soul

> Agente 2. Secuencia sugerida de trabajo a partir de `matriz-riesgos.md`, `minimizacion-datos.md` y las respuestas que se obtengan de `preguntas-pendientes.md`. No es una implementación ni reemplaza la decisión final de Producto/Legal sobre cada punto (ver `decisiones-producto.md`) — es un orden de ataque razonable dado el nivel de riesgo y las dependencias entre ítems.

---

## Fase 0 — Antes de tocar código: respuestas que destraban todo lo demás
No requiere desarrollo, pero condiciona la prioridad real de varias fases siguientes.

1. **P-01**: confirmar `SUPABASE_SERVICE_ROLE_KEY` en producción de Vercel (define si R-09 es ALTO o BLOQUEANTE).
2. **P-12**: definir destino inmediato (piloto cerrado vs. camino a Play Store) — define el rigor de R-01 y el orden de la Fase 3.
3. **P-02**: consultar a Anthropic sobre acuerdo de retención/entrenamiento (R-12).

---

## Fase 1 — Bloqueantes (antes de cualquier ampliación del piloto o sumisión a tienda)

| Orden | Acción | Riesgo(s) | Naturaleza |
|---|---|---|---|
| 1 | Agregar validación de edad mínima en servidor (bloqueante en `api/guardar.js`), nivel de rigor según respuesta a P-12 | R-01 | Desarrollo + decisión de producto (D-01) |
| 2 | Aplicar el chequeo de `consiente_analisis_a/b` a `generarResumenCitaEnSegundoPlano`, o decidir y documentar la excepción (D-02) | R-03 | Desarrollo + decisión de producto |
| 3 | Persistir el estado real del checkbox opcional y gatear las comunicaciones de producto con él; diferenciar transaccionales de producto (D-03) | R-04 | Desarrollo + decisión de producto |
| 4 | Unificar la fuente de verdad del texto legal aceptado en el flujo real (`soul.html`), o como mínimo agregar las secciones faltantes + enlace obligatorio al documento completo | R-02 | Desarrollo + Legal externo |

Estos cuatro puntos son interdependientes con el contenido final del documento legal — conviene resolverlos en conjunto con quien redacte la actualización de `legal.html`/`consentimiento.html` (fuera del alcance de este documento).

---

## Fase 2 — Altos (antes de publicar/ampliar acceso)

| Orden | Acción | Riesgo(s) |
|---|---|---|
| 5 | Corregir la obtención de IP en el lockout (`x-forwarded-for`) — desbloquea la efectividad real del freno de fuerza bruta del panel admin | R-05 |
| 6 | Agregar RLS a `rate_limits`, `uso_tokens`, `eventos_piloto`, `errores_silenciosos`, `diagnosticos_diarios`, `historial_relacional` | R-07 |
| 7 | Separar la condición de lectura de la de escritura en la política de `reportes_tecnicos` | R-08 |
| 8 | Resolver P-01; si `SUPABASE_SERVICE_ROLE_KEY` falta en producción, configurarla | R-09 |
| 9 | Agregar advertencia explícita en la UI de "análisis externo" sobre datos de terceros (mientras se decide D-09) | R-10 |
| 10 | Ampliar el texto legal de datos sensibles para cubrir cualquier categoría especial que pueda surgir en texto libre | R-11 |
| 11 | Resolver P-02 y reflejar el acuerdo real con Anthropic en el texto legal | R-12 |
| 12 | Definir y construir un mecanismo real (aunque sea manual) de revisión de inferencias (D-04) | R-13 |
| 13 | Completar el formulario de Data Safety de Play Console recién después de 1-4, 10 y 11 | R-14 |
| 14 | Evaluar mediano plazo: autenticación de admin con identidad real + 2FA (D-07) | R-06 |

El orden 5→9 no tiene dependencias fuertes entre sí y puede paralelizarse en desarrollo. 10, 11, 13 dependen de la actualización legal de la Fase 1.

---

## Fase 3 — Medios (dentro del plan inmediato, no bloqueantes)

| Orden | Acción | Riesgo(s) |
|---|---|---|
| 15 | Definir límite de retención concreto para conversaciones/mensajes (D-10) y documentarlo | R-15 |
| 16 | Revisar las 7 tablas fuera de la purga de 30 días; resolver P-08 primero | R-16 |
| 17 | Migrar fotos a storage con URLs firmadas (planificar como proyecto, no fix puntual) | R-17 |
| 18 | Evaluar moderación automatizada de fotos según umbral de escala (D-06) | R-18 |
| 19 | Agregar fecha y versión al consentimiento aceptado | R-19 |
| 20 | Evaluar exigir confirmación de email antes de onboarding/chat completo | R-20 |
| 21 | Resolver clasificación de `uso_tokens`/`eventos_piloto` como identificables o no (con criterio legal) | R-21 |
| 22 | Restringir `filtroDeLecturaValido` para `perfiles` a solo `eq` sobre el propio id | R-22 |
| 23 | Autohospedar Google Fonts o mencionar la carga en el aviso de privacidad | R-23 |
| 24 | Explicitar en el texto legal la excepción de contenido compartido que no se borra | R-24 |
| 25 | Aplicar los recortes de `minimizacion-datos.md` que Producto confirme (hora de nacimiento, alcance de `diagnosticos_diarios`, tope de `intentos_fuga_prompt`) | Minimización |

---

## Fase 4 — Bajos (mejoras recomendadas, sin urgencia)

| Orden | Acción | Riesgo(s) |
|---|---|---|
| 26 | Comparación en tiempo constante para `ADMIN_PASSWORD`/`CRON_SECRET` | R-25 |
| 27 | Mover `PREVIEW_PASSWORD` a variable de entorno | R-26 |
| 28 | Normalizar errores de proveedores externos antes de reenviarlos al cliente | R-27 |
| 29 | Sumar `SUPABASE_SERVICE_ROLE_KEY` a la lista de redacción de secretos en logs | R-28 |
| 30 | Evaluar automatizar portabilidad de datos si el volumen lo justifica | R-29 |
| 31 | Reevaluar la mitigación de prompt injection si crece el volumen de usuarios | R-30 |

---

## Nota de secuenciación

La Fase 1 es, en los hechos, un solo bloque de trabajo (legal + producto + desarrollo coordinados), no cuatro tickets independientes: los cuatro puntos tocan la misma superficie (qué se le promete a la persona usuaria vs. qué hace el código) y conviene cerrarlos con una sola actualización coherente del texto legal y del flujo de consentimiento, en vez de corregir cada uno por separado y terminar con nuevas inconsistencias entre ellos.
