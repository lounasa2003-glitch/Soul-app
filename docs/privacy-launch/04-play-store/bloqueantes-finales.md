# Bloqueantes finales — Soul (Agente 4)

> Consolidado de `checklist-lanzamiento.md` y `contradicciones.md`. Separado por naturaleza, tal como exige el encargo. No declara cumplimiento legal definitivo.

## Bloqueantes técnicos (impiden subir un build funcional a Play Console)

1. **AAB/APK de release desactualizado respecto de Firebase Cloud Messaging.** El artefacto de release que hoy existe en el repo (`soul-app-native/android/app/build/outputs/bundle/release/app-release.aab`) fue compilado el 2026-07-27, **antes** de que se agregaran `google-services.json` y la dependencia `@capacitor/push-notifications` (2026-07-28). El manifest fusionado de ese build no contiene ningún componente de Firebase. Subir ese artefacto tal cual publicaría una app sin push funcional, pese a que el backend (`lib/push.js`) y los documentos públicos ya lo dan por activo. — *Acción: correr `npx cap sync android` y generar un nuevo build de release antes de cualquier submisión.* (`contradicciones.md` C-04)
2. **`versionCode`/`versionName` sin incrementar.** `android/app/build.gradle:19-20` sigue en `versionCode 1`, `versionName "1.0"`, el mismo valor que el build de debug original. — *Acción: incrementar en el mismo paso de recompilación.*
3. ~~**RLS no confirmado en 7 tablas con dato personal indirecto.**~~ **RESUELTO (2026-07-30).** Migración versionada agregada (`migracion_rls_tablas_internas.sql`), commiteada, deployada a producción (`a2fba74`) y confirmada en vivo contra Supabase producción (`kjughqrjyglfxaiunivw`):
   - `rate_limits`, `uso_tokens`, `eventos_piloto`, `errores_silenciosos`, `diagnosticos_diarios`, `historial_relacional`: RLS activo (`relrowsecurity = true`, confirmado por la founder en el SQL Editor de Supabase), sin políticas, GRANT revocado a `anon`/`authenticated`, solo `service_role`. Probado en vivo: `anon` → `403 42501 permission denied`; `authenticated` (JWT real de cuenta descartable, sin datos personales, borrada después del test) → `403 42501 permission denied`; `service_role` → confirmado funcionando end-to-end para `rate_limits` (flujo real de rate-limit de admin), `uso_tokens`/`eventos_piloto` (`/api/admin/personas?modo=metricas`) y `diagnosticos_diarios` (`/api/admin/personas?modo=diagnosticos`). `errores_silenciosos` e `historial_relacional` quedan protegidas por el mismo mecanismo RLS+REVOKE (confirmado a nivel de tabla y con `anon`/`authenticated` bloqueados), pero **su lectura server-side vía `service_role` no se ejerció end-to-end** porque la única vía disponible es disparar manualmente `api/cron/diagnostico-diario.js`, que hace purgas reales — se decidió no forzarlo fuera de su horario (corre diario a las 11:00 UTC) para evitar borrados fuera de ciclo. Código y deploy ya revisados en sesión previa (usan `SUPABASE_SERVICE_ROLE_KEY` sin fallback a anon).
   - `push_tokens`: ya tenía RLS + policy real por `auth.uid()` desde `migracion_push_tokens.sql` (mecanismo distinto: acceso propio vía token de sesión, no bloqueo total) — confirmado sin cambios necesarios.
   — *Sin acción pendiente sobre las 6 tablas de acceso exclusivo server-side. Pendiente opcional: ejercer `errores_silenciosos`/`historial_relacional`/cron completo en su próxima corrida programada, o autorizar una corrida manual.* (`contradicciones.md` C-07)
4. ~~**Verificación de edad no se re-aplica al editar el perfil.**~~ **RESUELTO (2026-07-30, pendiente de deploy).** `api/guardar.js` valida `fecha_nacimiento` (vía `EDAD_MINIMA`/`calcularEdad()` de `lib/edad.js`) siempre que ese campo viaje en el pedido a la tabla `usuarios`, sea alta (`guardarUsuarioYContinuar()`) o edición posterior (`guardarMiPerfil()` en "Mi perfil") — ya no depende de `etapa_actual==='chat'`. Una fecha inválida o de menor de edad se rechaza antes de escribir cualquier cambio (`error: fecha_invalida` o `edad_minima`). Además, si el rechazo ocurre en el **alta** (nunca en una edición de cuenta ya aprobada), el servidor borra de inmediato la fila de `usuarios` y el usuario de Supabase Auth recién creados (`eliminarCuentaPorEdadMinima()`, con `SUPABASE_SERVICE_ROLE_KEY`, acotado al propio `usuarioId`/`authId` de quien pidió el guardado) — antes esa cuenta quedaba indefinidamente con nombre, email y consentimiento aceptado, sin ninguna vía de autoeliminación accesible (la pantalla "Eliminar mi cuenta" solo existe dentro de "Mi perfil", inalcanzable para quien nunca pasó el gate de edad). Código commiteado, **todavía no deployado a producción** — la verificación en vivo (creación de cuenta real, confirmación de que no queda huérfana) queda pendiente hasta después del deploy. (`contradicciones.md` C-03)

## Bloqueantes documentales (los documentos no reflejan el código, o viceversa)

1. **Retención de `reportes` declarada (5 años desde el cierre) sin implementación real.** El código no tiene ningún job de purga para la tabla `reportes`; la retención real hoy es indefinida. `eliminacion-cuenta.md`, `politica-privacidad.md` y `resumen-data-safety.md` afirman el plazo de 5 años como si ya rigiera. — *Acción: corregir el texto público a "en evaluación" hasta que exista código, o construir la purga real antes de publicar.* (`contradicciones.md` C-01)
2. **`foto_aprobada` descripto como moderación admin en `01-auditoria/`/`02-riesgos/`, pero es autoconsentimiento del usuario en el código real.** No existe hoy ningún paso de revisión humana de contenido de fotos antes de mostrarlas a un match. — *Acción: decisión de producto pendiente (D-06) sobre si se necesita moderación real antes de un lanzamiento más amplio; corregir los documentos de auditoría.* (`contradicciones.md` C-02)
3. **`matriz-riesgos.md` desactualizada.** Sigue marcando como "Abierto" los cuatro riesgos BLOQUEANTES originales (R-01 a R-04) y R-19, que `decisiones-founder.md` certifica como implementados, desplegados y probados en producción. — *Acción: actualizar el estado en `matriz-riesgos.md` o anotarlo como documento congelado a su fecha.* (`contradicciones.md` C-05)
4. **`propuesta-retencion.md` desactualizada** respecto de la purga de `cita_mensajes`/`citas` a 12 meses, ya implementada el mismo día de su redacción según `decisiones-founder.md`. — *Acción: nota de estado en ese documento.* (`contradicciones.md` C-06)

## Bloqueantes de Play Store (requisitos de la tienda, no verificables como "obligatorios" sin consultar la política vigente — marcados donde corresponde)

1. **Ausencia de moderación de contenido de fotos** en una app de citas — combinado con el punto de edad (bloqueante técnico #4), es el punto de mayor riesgo de rechazo/baja según el criterio general de Google Play para apps de citas. [VERIFICAR EN POLÍTICA DE GOOGLE PLAY]
2. **Página web pública o mecanismo externo de eliminación de cuenta**, no confirmado si existe fuera de "Mi perfil" dentro de la app. Dado que Soul es una PWA accesible por navegador (no solo dentro del wrapper Android), esto podría ya estar cubierto por el mismo flujo web — pero no se confirmó explícitamente. [VERIFICAR EN POLÍTICA DE GOOGLE PLAY]
3. **Categoría de contenido / declaración de "app de citas"** en el cuestionario de Play Console — depende de una decisión de carga en Play Console, no del código; ver `ficha-play-store.md` de este encargo.
4. **Confirmación de política de privacidad enlazada desde la ficha de Play Console** (campo de configuración, no verificable desde el repo).
5. **Región de Vercel y de Firebase Cloud Messaging no confirmada** — necesaria para completar con precisión el formulario de Data Safety.

## Pendientes legales no necesariamente bloqueantes

Ver `05-revision-legal/preguntas-abogado.md` para el listado completo. Resumen:
- Validez jurídica del plazo de 5 años para `reportes` (aun si se implementa el código).
- Mecanismo jurídico correspondiente para las transferencias internacionales (Argentina → Brasil/EE.UU.).
- Suficiencia de la identificación del responsable del tratamiento.
- Conveniencia de una declaración expresa y separada de mayoría de edad.
- Texto exacto para categorías sensibles incidentales (más allá de "orientación"/"vida íntima").
- Base legal para el procesamiento de datos de un tercero no usuario en "análisis externo".

---

## Qué puede cargarse ya como borrador en Play Console

- Ficha de texto (nombre, descripciones, categoría) — ver `ficha-play-store.md`.
- Capturas de pantalla y feature graphic — ya existen en `store-screenshots/`.
- Formulario de Data Safety — como **borrador**, usando `borrador-data-safety.md`, con las salvedades marcadas `[NO CONFIRMADO]` resueltas antes de enviar.
- Cuestionario de clasificación de contenido (IARC) — guía ya disponible en el `ficha-play-store.md` de la raíz del repo (fuera de este encargo), reutilizable como referencia.

## Qué impide hoy la submisión real

Los cuatro bloqueantes técnicos de arriba, en particular el artefacto Android desactualizado (#1) — es el único que impide subir un build funcional, independientemente de que el resto de la ficha esté lista.
