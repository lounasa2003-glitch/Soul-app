# Eliminación de cuenta

## Cómo pedir la eliminación de tu cuenta

Podés pedir la eliminación de tu cuenta desde la sección "Mi perfil" dentro de la app. No hace falta escribirnos por otro medio, aunque también podés hacerlo por correo a contacto@soulapp.love si preferís ese canal.

## Qué pasa apenas lo pedís

Tu acceso a la cuenta se corta **de inmediato**. Desde ese momento no vas a poder iniciar sesión ni usar ninguna función de Soul con esa cuenta. Si tenías una cita abierta en la Sala de Encuentros, se cierra automáticamente, con un mensaje de despedida para que la otra persona no quede esperando una conversación que no va a continuar.

## Período de gracia: 30 días

Entre el momento en que pedís la eliminación y el borrado real de tus datos pasan **30 días**. Durante ese período:

- Ya no podés acceder a tu cuenta (el acceso está cortado desde el primer momento, como se explicó arriba).
- [PENDIENTE DE PRODUCTO — no está confirmado si existe hoy una forma de arrepentirte y cancelar el pedido de eliminación dentro de esos 30 días. Si necesitás esto, contactanos a contacto@soulapp.love durante ese período.]

## Qué se borra a los 30 días

Una tarea automática que corre todos los días ejecuta el borrado definitivo de las cuentas cuyo plazo ya venció. En ese momento:

- **Se eliminan por completo**: tu perfil vincular (todo lo que la inteligencia artificial construyó a partir de tus conversaciones), el historial completo de tu conversación con Soul, tu historial relacional, los registros de intentos de manipulación del chat asociados a tu cuenta, tu debriefing privado de cada cita, tus registros de uso de "ayuda privada", y tus solicitudes de revisión de perfil.
- **Se anonimiza (no se elimina el contenido, pero deja de estar vinculado a vos)**: tu feedback sobre tu experiencia en Soul, si lo dejaste.
- **Se anonimiza tu fila de cuenta**: tu nombre, tu fecha de nacimiento y tus fotos se eliminan; tu email se reemplaza por un valor genérico que no te identifica. No se borra la fila completa, porque eso podría romper la información de otras personas con las que tuviste un match o una cita — pero después de este paso, esa fila ya no contiene ningún dato que te identifique.
- **Se intenta borrar tu credencial real de acceso** (usuario y contraseña del sistema de autenticación), no solo anonimizar la fila de tu cuenta. La configuración técnica necesaria para esto está confirmada en producción, y el proceso automático diario corre sin errores. [PENDIENTE DE PRODUCTO — queda pendiente confirmar, sobre un caso real completo de eliminación de cuenta, que la credencial de acceso efectivamente terminó borrada.]

## Qué pasa con tus citas y mensajes compartidos con otra persona

Si tuviste una cita con otra persona, los mensajes de esa cita **no se borran automáticamente al eliminar tu cuenta**, porque son parte del registro de un vínculo real que la otra persona puede seguir consultando, y ella no pidió ningún borrado. Lo que sí ocurre es que tu identidad dentro de esa cita queda anonimizada (la otra persona ya no ve tu nombre real).

Este contenido compartido tiene su propio plazo de retención, independiente de tu cuenta:

## Retención de 12 meses desde el cierre de la cita

**A los 12 meses de que una cita se cierra**, se eliminan los mensajes de esa cita y los análisis que la inteligencia artificial generó sobre ella (el resumen interno de calidad, el debriefing y la compatibilidad calculada para esa cita puntual). Se conserva solamente un registro mínimo de que el encuentro existió — la fecha, con quién fue (si esa persona sigue activa) y el resultado — pero ya no la conversación en sí.

## Cuándo se frena esta eliminación

Si existe un **reporte de seguridad abierto** vinculado a esa cita o a ese match, la eliminación de los 12 meses **se suspende automáticamente** hasta que el reporte se resuelva. Esto es así para no perder información relevante mientras un caso de seguridad sigue activo.

## Retención de los reportes de seguridad

El reporte en sí y sus metadatos (motivo, fecha, quién reportó a quién, estado del reporte) tienen un plazo de retención propio, distinto del de la conversación:

- Se conservan **durante 5 años desde la fecha de cierre del reporte**.
- Mientras el reporte esté **abierto**, este plazo no empieza a correr — recién se cuenta desde que se cierra.
- Este plazo de 5 años aplica únicamente al reporte y sus metadatos, **no a toda la conversación asociada**: los mensajes de la cita o del chat vinculados al reporte siguen su propia retención de 12 meses desde el cierre de la cita (explicada arriba), de forma independiente, salvo que el reporte siga abierto, en cuyo caso esa eliminación queda suspendida como se explicó en la sección anterior.
- [REVISIÓN LEGAL — validar la validez jurídica definitiva de este plazo de 5 años bajo la normativa aplicable.]

## Datos técnicos con plazos distintos

Algunos registros técnicos y operativos no dependen de si tu cuenta está activa o eliminada, sino de su propia antigüedad:

- Reportes técnicos de soporte: se eliminan a los 180 días.
- Registros de errores técnicos: se eliminan a los 90 días.
- Diagnósticos operativos internos (diagnósticos diarios): se eliminan a los 90 días.

## Canal de contacto

Si tenés alguna consulta sobre tu eliminación de cuenta, sobre qué datos tuyos siguen existiendo o sobre cualquier otro punto de este proceso, escribinos a **contacto@soulapp.love**.

---

Ver también `politica-privacidad.md` (sección 15) y `derechos-usuario.md`.
