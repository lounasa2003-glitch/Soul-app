# Qué debe pasar realmente en Free (piloto)

Documento de referencia para probar el plan Free real, ahora que
`TODOS_PRO_TEMPORAL` (`lib/authUtil.js`) ya no lo pisa a Pro para la cuenta
de prueba. Sirve como checklist manual — no hay tests automatizados nuevos
en este cambio.

## Cómo armar la cuenta de prueba

1. Registrar una cuenta nueva en la app con un email real que puedas abrir
   (necesita confirmar mail para llegar a matches/citas).
2. En Vercel, configurar la variable de entorno `CUENTA_PRUEBA_FREE_EMAIL`
   con ese email exacto.
3. Confirmar en el panel admin (`panel-admin.html`) que el `plan` de esa
   cuenta en la base es `free` (es el default si nunca se tocó a mano).
4. Para restaurarla a Pro en cualquier momento: **borrar** la variable de
   entorno `CUENTA_PRUEBA_FREE_EMAIL` de Vercel (no hace falta tocar la
   base) — sin esa variable, `TODOS_PRO_TEMPORAL` vuelve a tratar a esa
   cuenta como Pro igual que a cualquier otra, sin redeploy de código.

## Qué debe verse distinto en Free vs. Pro

| Área | Free (real) | Pro / resto del piloto (TODOS_PRO_TEMPORAL) |
|---|---|---|
| Modelo de la conversación principal ("Hablar con Soul") | Haiku 4.5 (`claude-haiku-4-5-20251001`) — **no depende del plan**, depende de `rapido:true` en `api/chat.js` | Igual: Haiku 4.5 |
| Modelo de extracción/análisis del perfil (`api/extraccionPerfil.js`) | Haiku 4.5 (`MODELO_RAPIDO`) | Sonnet 4.6 (`MODELO_FIJO`) |
| Modelo de comparación para matching (`api/calcularMatches.js`) | Sonnet 4.6 — **hardcodeado, no depende del plan** | Igual: Sonnet 4.6 |
| "Capacidad de volver a elegir" (modulo_fase `obligatorio`) | Disponible para todos, sin gate de plan (es requisito previo a cualquier encuentro) | Igual |
| Módulo esencial y módulo recomendado (fases `esencial`/`recomendado`) | **Bloqueados**: `api/chat.js` solo deja pasar `moduloFase==='obligatorio'` sin ser Pro — cualquier otra fase devuelve 403 `requiere_pro`. Corregí un error mío anterior en este mismo documento: el módulo esencial NO es gratis, únicamente "Capacidad de volver a elegir" lo es. | Ambos disponibles |
| Recalcular matches | 1 vez cada 72 horas (`LIMITE_MATCHES_FREE`) | 5 veces por hora (sin tope de producto adicional) |
| Límite de mensajes de chat | 30 cada 5 min / 80 por día — igual para ambos (es un tope técnico anti-abuso, no de producto) | Igual |
| Límite de extracción de perfil | 12 cada 15 min / 40 por día — igual para ambos | Igual |
| Badge de plan en "Mi perfil" | "Plan Free" | "Plan Pro" |
| Aviso antes de un módulo Pro | Etiqueta discreta "PRO" junto a la oferta del módulo recomendado (antes de tocar "Sí, sigamos →"), y un cartel preventivo de `mostrarPaywallModulo()` en cuanto `moduloRequierePro()` detecta la fase esencial o recomendada — nunca llega a mandar el mensaje al servidor sin avisar antes | No aplica (ya es Pro) |
| Mensaje si el servidor igual rechaza con 403 | El chat de módulo muestra el cartel de `mostrarPaywallModulo()` (mismo texto que el aviso preventivo, con el nombre del módulo si ya se detectó) — nunca "Algo se desconectó" | No aplica |

## Qué NO debería pasar en Free

- No debería poder avanzar al módulo esencial ni al recomendado sin ver antes el cartel/etiqueta "PRO" — nunca un error genérico de conexión.
- No debería ver "Plan Pro" en Mi Perfil.
- No debería poder recalcular matches más de una vez cada 72hs (el segundo intento debe devolver `limite_free_alcanzado`, no romperse en silencio).
- El resto del onboarding, la charla principal, "Capacidad de volver a elegir", el matching en sí (encontrar y ver un match) y las citas virtuales deben funcionar exactamente igual que en Pro — Free nunca debería sentirse roto, solo con menos profundidad/frecuencia.

## Al terminar de probar

Sacar la variable `CUENTA_PRUEBA_FREE_EMAIL` de Vercel para que esa cuenta
vuelva a tratarse como el resto del piloto (Pro), o dejarla si se quiere
seguir usando esa cuenta como referencia permanente de Free.
