# Aviso sobre el uso de inteligencia artificial en Soul

> Este documento complementa la `politica-privacidad.md` y explica en detalle cómo Soul usa inteligencia artificial. Léelo junto con esa política.

## ¿Qué hace la inteligencia artificial en Soul?

Soul usa el modelo de inteligencia artificial **Claude**, desarrollado por **Anthropic**, a través de su servicio comercial para desarrolladores (API). No usamos una cuenta de consumidor de Claude — usamos el servicio empresarial que Anthropic ofrece a aplicaciones como la nuestra.

La inteligencia artificial de Soul:

1. **Conversa con vos** durante el proceso de onboarding, la charla libre y los módulos de profundización, para conocerte.
2. **Extrae un perfil vincular estructurado** a partir de esa conversación: valores, estilo de comunicación, forma de vincularte, patrones de conflicto, apertura, y otros rasgos relacionados con cómo te vinculás.
3. **Calcula compatibilidad** entre tu perfil y el de otras personas, para proponerte (o no) un match.
4. **Genera una breve presentación tuya** para que la vea un match potencial antes de decidir si acepta conocerte.
5. **Interviene puntualmente** dentro de la Sala de Encuentros, como una especie de "directora invisible" que puede proponer un tema de conversación o ayudar si la charla se siente incómoda.
6. **Analiza tu cita**, solo si vos y la otra persona dieron su consentimiento explícito para ese análisis — ver más abajo.
7. **Genera un resumen objetivo de la cita** para uso exclusivo del equipo de Soul (nunca visible para las personas usuarias), también condicionado al mismo consentimiento de ambas partes.

## ¿Qué datos se envían a Anthropic?

Dependiendo de la función, se envía: el contenido de tu conversación con Soul, tu perfil vincular ya construido, el texto de tus "no negociables"/"negociables", la transcripción de los mensajes de una cita (solo si diste tu consentimiento de análisis), y — si usás la función de "análisis externo" — el texto que vos pegues de una conversación mantenida fuera de Soul.

## ¿Qué guarda Anthropic, y por cuánto tiempo?

Confirmado directamente en la configuración de la cuenta de Soul con Anthropic (2026-07-28): **Anthropic conserva los datos que le enviamos durante 30 días** desde que los recibe o los genera, como parte de su régimen estándar de retención para clientes de su API comercial. Soul **no tiene activado** un acuerdo de "retención cero" (Zero Data Retention) con Anthropic — es decir, sí existe un período de conservación de 30 días de tu lado de Anthropic, más allá de lo que Soul guarda en su propia base de datos.

Existe una excepción a este plazo: si un mensaje es marcado por los sistemas internos de seguridad de Anthropic (por ejemplo, por sospecha de uso indebido), ese contenido puntual podría conservarse hasta 2 años, según la política general de Anthropic. No tenemos forma de saber si esto ocurrió alguna vez con contenido de Soul.

## ¿Los datos que enviamos se usan para entrenar los modelos de Anthropic?

**No, por defecto.** La documentación oficial de privacidad de Anthropic para sus productos comerciales (que incluye la API que usa Soul) establece que no usan las entradas ni salidas de estos productos para entrenar sus modelos, salvo que la organización reporte contenido explícitamente a través de un mecanismo de feedback — algo que Soul no tiene implementado. Esta información surge de la documentación pública oficial de Anthropic consultada como parte de esta revisión (julio de 2026). [REVISIÓN LEGAL — validar esta afirmación contra los términos contractuales vigentes al momento de publicar este aviso, ya que las políticas de un proveedor externo pueden cambiar.]

Aparte de esto, **Soul no tiene un modelo de inteligencia artificial propio**: usa el modelo de Anthropic tal cual, a través de su API, y no entrena ni ajusta ningún modelo propio con tus datos.

## Transferencia internacional

El procesamiento por parte de Anthropic ocurre en Estados Unidos y otros países fuera del Espacio Económico Europeo. Esto implica que el contenido de tus conversaciones, tu perfil vincular y (con tu consentimiento) las transcripciones de tus citas viajan fuera de Argentina para ser procesados. Ver la sección de transferencias internacionales de `politica-privacidad.md` y `consentimiento-datos-sensibles.md`.

## ¿Qué NO hace la inteligencia artificial de Soul?

- **No diagnostica.** No hace diagnósticos psicológicos ni evaluaciones clínicas de ningún tipo.
- **No es terapia.** Las conversaciones con Soul no reemplazan a un profesional de la salud mental.
- **No garantiza compatibilidad ni éxito en ningún vínculo.** Sus análisis son probabilísticos.
- **No es infalible.** Puede malinterpretar lo que contás, generar una inferencia incompleta o directamente equivocada.
- **No decide por vos.** El match propuesto es una sugerencia; sos vos quien decide si aceptarlo o no.

## Cómo influye en tu perfil y en el matching

Todo lo que conversás con Soul alimenta tu perfil vincular, que es la base sobre la que se calcula tu compatibilidad con otras personas. Cuanto más completa sea tu conversación, más informado es ese perfil — pero sigue siendo una interpretación, no un hecho objetivo sobre vos.

## Cuándo se analiza una cita

Después de la Sala de Encuentros, Soul puede generar un análisis de la dinámica de esa cita y una devolución para vos (el debriefing). **Esto solo ocurre si vos y la otra persona dieron su consentimiento explícito** para ese análisis, dentro de la propia cita. Si cualquiera de las dos personas no da ese consentimiento, no se analiza la transcripción ni se genera ningún resumen — ni el que ves vos, ni el que usa internamente el equipo de Soul para control de calidad y seguridad.

## Cómo cuestionar una inferencia

Si no estás de acuerdo con algo que la inteligencia artificial infirió sobre vos (por ejemplo, un rasgo de tu perfil vincular), podés cuestionarlo desde "Mi perfil", con la opción "No estoy de acuerdo con una parte de mi perfil". Ahí podés indicar qué parte cuestionás y por qué. Tu pedido queda registrado con un estado (pendiente, en revisión, resuelto) y el equipo de Soul lo revisa y te responde. Esta revisión es humana y manual — no hay un botón que corrija tu perfil automáticamente, porque cualquier corrección la evalúa una persona antes de aplicarla.

## Mitigación de manipulación del chat

Soul tiene filtros automáticos para detectar intentos de manipular las instrucciones internas de la inteligencia artificial (lo que se conoce como "prompt injection" o intentos de fuga). Estos filtros son una mitigación razonable pero no perfecta — se basan en patrones conocidos y pueden no detectar variantes nuevas.

---

Ver también `politica-privacidad.md` (secciones 7 y 8), `consentimiento-datos-sensibles.md` y `derechos-usuario.md`.
