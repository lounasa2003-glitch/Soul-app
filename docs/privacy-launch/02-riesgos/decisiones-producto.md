# Decisiones de producto pendientes — Soul

> Agente 2. Este documento no redacta política ni código: enumera decisiones que le corresponden a Producto/Founder (con eventual consulta legal) porque no se resuelven solo con un cambio técnico — requieren definir qué debe hacer Soul, no solo cómo. Cada una referencia el riesgo de `matriz-riesgos.md` del que se desprende.

---

### D-01 — Rigor de la verificación de edad (relacionado con R-01)
Hoy no hay ningún control. Antes de implementar algo, hay que decidir el nivel de rigor:
- **Opción mínima**: bloquear en servidor cualquier fecha de nacimiento que implique menos de 18 años (validación de rango, sin verificación de identidad).
- **Opción intermedia**: sumar una declaración jurada explícita ("confirmo que soy mayor de 18 años") separada del checkbox de consentimiento general.
- **Opción robusta**: verificación de identidad/documento de un tercero, típica de apps de citas a mayor escala.
La decisión depende de si el destino inmediato es seguir como piloto cerrado (por invitación, con personas conocidas) o avanzar hacia Play Store / público general — el estándar exigido no es el mismo. Ver `preguntas-pendientes.md` P-12.

### D-02 — Qué hacer con el resumen de cita para uso admin (relacionado con R-03)
Hay dos caminos, y ambos requieren una decisión de producto explícita en vez de dejarlo como está (que es la situación hoy: se genera igual, sin decisión documentada):
- **A.** Tratarlo como "función indispensable" de control de calidad/seguridad del piloto, distinta de los análisis de perfil, y comunicarlo así explícitamente en el texto legal (aceptando que corre siempre, con o sin `consiente_analisis`).
- **B.** Igualarlo al criterio de los otros dos análisis y aplicarle el mismo gate de consentimiento, aceptando que en algunos casos la administradora no tendrá resumen de una cita.
No es una decisión técnica — es decidir qué le importa más a Soul: la supervisión operativa completa del piloto, o la consistencia estricta con lo que la persona usuaria consintió.

### D-03 — Alcance real de "comunicaciones opcionales" (relacionado con R-04)
Hay que decidir, con una lista concreta, qué comunicaciones son:
- **Transaccionales** (indispensables: confirmación de cuenta, recuperación de contraseña) — no deberían requerir opt-in.
- **De producto/engagement** (avisos de match, recordatorios de mensajes sin respuesta, cuentas trabadas) — deberían quedar sujetas al toggle real que hoy no existe.
Esto también implica decidir si "Mi perfil" necesita una pantalla/sección nueva para exponer ese control, lo cual es trabajo de producto, no solo de backend.

### D-04 — Mecanismo real de corrección/objeción de inferencias (relacionado con R-13)
El texto legal promete poder "cuestionar o solicitar la revisión de cualquier inferencia", pero hoy no existe ningún flujo de producto para eso (solo una herramienta interna de administración que reconstruye todo el perfil desde cero). Hay que decidir:
- Si ese mecanismo va a ser manual (p. ej. un botón "no estoy de acuerdo con mi perfil" que dispare una revisión humana) o
- Si se retira esa promesa del texto legal hasta tener un mecanismo real.
Dejarlo como está (prometido pero inexistente) no es una opción sostenible una vez que se decida publicar el documento legal actualizado.

### D-05 — Propósito de `hora_nacimiento` (relacionado con `minimizacion-datos.md` 1.1)
Antes de decidir si se sigue recolectando, Producto necesita confirmar si hay o habrá una función real que la use (p. ej. algo vinculado al enfoque "ontológico" de la propuesta). Si no hay una función concreta, la decisión de producto es simplemente dejar de pedirla.

### D-06 — Nivel de moderación de contenido de fotos (relacionado con R-18)
Hoy el único control es la revisión manual de la administradora antes de aprobar una foto. Hay que decidir en qué momento (qué volumen de usuarios, qué etapa de lanzamiento) ese control manual deja de ser suficiente y se vuelve necesario un servicio de moderación automatizada — no es una decisión técnica sino de a partir de qué escala Soul considera aceptable el riesgo residual de revisión 100% manual.

### D-07 — Modelo de autenticación del panel admin a mediano plazo (relacionado con R-06)
Corregir el bypass de IP (R-05) es urgente y técnico. Pero decidir si el panel admin debe migrar a cuentas individuales con 2FA es una decisión de producto/organización: depende de si va a haber más de una persona administrando el piloto, y de qué tan pronto. Mientras sea una sola administradora, el riesgo residual puede ser aceptable si R-05 se corrige; si el equipo crece, la decisión cambia.

### D-08 — Arquitectura de almacenamiento de fotos (relacionado con R-17)
Migrar a Supabase Storage con URLs firmadas es una recomendación técnica clara, pero implica una decisión de producto sobre cuándo priorizar ese trabajo (antes o después del lanzamiento a Play Store) dado que no es un cambio trivial (afecta subida, visualización y borrado de fotos en múltiples pantallas).

### D-09 — Alcance de "análisis externo" (relacionado con R-10)
Dado que esta función procesa datos de una persona que no es usuaria de Soul y sin su consentimiento, Producto tiene que decidir si:
- Se mantiene la función con una advertencia más explícita en la UI (responsabilidad del usuario de no incluir datos identificables de terceros), o
- Se restringe/rediseña la función para reducir el riesgo de procesar datos de terceros no consintientes.

### D-10 — Definir un límite de retención concreto para conversaciones y mensajes (relacionado con R-15)
Hoy la política es "mientras la cuenta esté activa". Producto necesita fijar un número concreto (¿6 meses de inactividad? ¿1 año?) para que Legal pueda documentarlo, en vez de dejar una retención indefinida de facto.
