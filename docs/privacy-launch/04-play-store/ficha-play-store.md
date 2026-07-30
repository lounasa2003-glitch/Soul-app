# Ficha de Play Store — borrador coherente (Agente 4)

> Verificado contra el código y contra `03-documentos/` al 2026-07-29. Reutiliza el texto de marketing ya redactado en `/ficha-play-store.md` (raíz del repo, no modificado por este encargo) donde ese texto es consistente con el estado actual del producto, y lo completa con los puntos que el encargo de este agente pide explícitamente y que ese borrador anterior no cubre (edad, IA, privacidad, contacto, eliminación de cuenta, publicidad, pagos, permisos). No se inventa ninguna función ni beneficio no verificado en el código.

## Nombre de la app

**Soul**

Evidencia: `manifest.json` (`"name"`), `capacitor.config.json` (`"appName": "Soul"`).

## Descripción breve (máx. 80 caracteres)

```
Un espacio para conocerte mejor a través de tus vínculos.
```
(58 caracteres — coincide con `manifest.json`.)

## Descripción completa

Se reutiliza el texto ya redactado (verificado, sin funciones inventadas: conversación con IA, perfil vincular, matching por compatibilidad, encuentro guiado, debriefing posterior, módulos de profundización como parte de Soul Pro):

```
Soul no es una app de citas más.

No hay swipes. No hay fotos como primer filtro. No hay conversaciones que se apagan solas.

Soul es un espacio de acompañamiento consciente para las personas que quieren conocerse mejor a sí mismas antes de conocer a alguien más — y que buscan vínculos con sentido, no solo matches.

CÓMO FUNCIONA

Todo empieza con una conversación real con Soul, tu compañera de reflexión con inteligencia artificial. No te pide un formulario: te escucha, te hace preguntas, y va construyendo con vos un perfil vincular genuino — qué buscás, cómo te relacionás, qué necesitás para sentirte en confianza.

A partir de ahí, Soul busca compatibilidad real, no solo coincidencias superficiales. Cuando encuentra a alguien con quien tiene sentido que se conozcan, arma un encuentro guiado: un espacio de conversación asistido, pensado para que ambas personas se muestren tal cual son.

Después de cada encuentro, Soul te acompaña en una reflexión — un espacio para pensar juntas cómo te sentiste, qué te resonó, y qué querés hacer con eso.

QUÉ TE OFRECE SOUL

✦ Conversaciones reales con una IA que te conoce, no un formulario
✦ Perfiles vinculares basados en cómo sos, no en fotos
✦ Encuentros guiados, pensados para conocerse de verdad
✦ Reflexión después de cada encuentro
✦ Módulos de profundización para seguir conociéndote (Soul Pro)

PARA QUIÉN ES SOUL

Exclusivamente para personas mayores de 18 años que están cansadas de deslizar sin sentido, y que prefieren invertir tiempo en conocerse mejor antes de conocer a alguien más.

SOBRE LA INTELIGENCIA ARTIFICIAL DE SOUL

Soul usa inteligencia artificial (el modelo Claude, de Anthropic) para conversar con vos, construir tu perfil vincular y calcular tu compatibilidad con otras personas. Sus análisis son interpretaciones probabilísticas, no diagnósticos ni garantías de compatibilidad, y pueden equivocarse.

TU PRIVACIDAD IMPORTA

Soul nunca comparte tu perfil psicológico completo con nadie. Tu match solo ve una síntesis de compatibilidad — nunca tus conversaciones privadas ni un diagnóstico. Podés pedir la eliminación de tu cuenta y tus datos en cualquier momento desde "Mi perfil".

Soul está para acompañarte a conocerte — el resto, viene después.
```

*Cambio respecto del borrador de la raíz del repo*: se agregó el bloque "SOBRE LA INTELIGENCIA ARTIFICIAL DE SOUL" (antes ausente en la descripción de la tienda, aunque sí estaba en `aviso-ia.md`) y se aclaró "Exclusivamente para personas mayores de 18 años" en la sección de público, en vez de "para personas... que están cansadas de...", para que la restricción de edad quede explícita también en el texto público de la ficha, no solo en la política.

## Público objetivo

Personas adultas (18+) que buscan vínculos con intención, no una audiencia general ni menores de edad.

Evidencia de la restricción: `api/guardar.js` (`EDAD_MINIMA`/`calcularEdad()` de `lib/edad.js`, validación de servidor); `soul.html:702` (declaración en el consentimiento). Actualizado 2026-07-30: la validación de servidor ahora corre tanto en el alta como en cualquier edición posterior de `fecha_nacimiento` desde "Mi perfil", y una cuenta rechazada por edad en el alta se borra de inmediato en vez de quedar huérfana — ver `checklist-lanzamiento.md` P-01 a P-04b (código commiteado, deploy pendiente al momento de escribir esto).

## Mayores de 18 años

**Sí, exclusivamente.** Ver evidencia arriba. Este campo del cuestionario de Play Console debe marcarse en consonancia con la categoría de "app de citas" (activa requisitos adicionales de seguridad que Soul ya cubre parcialmente — ver `checklist-lanzamiento.md` sección 5).

**Checklist manual para Play Console** (no verificable desde el repo, a completar a mano al cargar la ficha):
- En la sección **"Público objetivo y contenido"** (distinta del cuestionario IARC): seleccionar únicamente **"18 años o más"** — no marcar ningún rango que incluya menores.
- Dentro de esa misma sección, habilitar **"Restringir acceso a menores"** (o el toggle equivalente que ofrezca Play Console para apps que no están dirigidas a público infantil/adolescente).
- Completar el **cuestionario de clasificación de contenido (IARC)** como paso separado e independiente de lo anterior — no asumir de antemano una clasificación regional concreta (ej. "Mature 17+" o "PEGI 16"): el resultado lo calcula el cuestionario según las respuestas reales, no se fija a mano. La guía de respuestas sugeridas está en `/ficha-play-store.md` (raíz del repo, sección "Cuestionario de clasificación de contenido (IARC)") — usarla como punto de partida, no como resultado garantizado.

## Advertencia de IA

Debe incluirse en la ficha (Google exige declarar el uso de IA generativa cuando corresponde). Texto sugerido, basado en `aviso-ia.md`:

> Soul usa inteligencia artificial (Claude, de Anthropic) para conversar con las personas usuarias, construir su perfil vincular y calcular compatibilidad. Es una herramienta de interpretación, no un diagnóstico ni una garantía de compatibilidad o éxito en ningún vínculo.

## Privacidad

- Política de privacidad completa: `legal.html`, enlazada desde el flujo de consentimiento (`soul.html:676`) y desde el footer de `index.html`. URL pública a confirmar según el dominio de producción (`soulapp.love`).
- Documentos complementarios ya redactados en `03-documentos/`: `aviso-ia.md`, `consentimiento-datos-sensibles.md`, `derechos-usuario.md`, `eliminacion-cuenta.md`, `politica-cookies-tecnologias.md`.
- Responsable del tratamiento identificado: Lourdes Satragno, CABA, Argentina.

## Contacto

**contacto@soulapp.love** — canal único identificado en todos los documentos (`legal.html`, `soul.html`, `03-documentos/`).

## Eliminación de cuenta

Disponible dentro de la app, desde "Mi perfil" (`api/auth.js`, `solicitarBorrado`). Ventana de gracia de 30 días antes del borrado real, con excepciones documentadas para contenido compartido con otra persona (12 meses desde el cierre de la cita) y reportes de seguridad. Ver `checklist-lanzamiento.md` sección 3 para el detalle de qué está confirmado y qué no (en particular E-04, E-08, E-09).

Google Play suele exigir que este proceso sea localizable también fuera de la app si el registro es posible fuera de ella — Soul es una PWA con registro vía navegador, lo cual podría ya cubrir este requisito, pero **no está confirmado explícitamente**. [VERIFICAR EN POLÍTICA DE GOOGLE PLAY]

## Publicidad

**Ausente.** No se detectaron SDKs de publicidad ni redes publicitarias en el código (`docs/privacy-launch/01-auditoria/proveedores.md`, sección "Proveedores explícitamente descartados").

## Pagos

**Ausentes actualmente.** Existe lógica de planes Free/Pro en el código (`usuarios.plan`), pero sin pasarela de pago ni facturación in-app conectada — `lib/authUtil.js` (`TODOS_PRO_TEMPORAL = true`, todas las cuentas tratadas como Pro mientras tanto). Si se activa un cobro real antes de publicar, este campo de la ficha y el formulario de Data Safety deben actualizarse para declarar el mecanismo de pago.

## Permisos relevantes

Solo `android.permission.INTERNET` está declarado en el manifest fuente (`AndroidManifest.xml:34`). No hay permisos de cámara, ubicación ni almacenamiento (las fotos se suben vía selector de archivos del navegador, no vía API nativa). El permiso de notificaciones (necesario para Firebase Cloud Messaging en Android 13+) depende de que se recompile el proyecto tras integrar `@capacitor/push-notifications` — ver `checklist-lanzamiento.md` A-01/A-02 y `contradicciones.md` C-04, que señalan que el build de release actual todavía no lo incluye.

---

**No se inventó ninguna función, beneficio o dato no verificado en el código o en los documentos fuente.** Donde el borrador de la raíz del repo (`/ficha-play-store.md`) tenía contenido ya desactualizado respecto del código actual, se marcó explícitamente el cambio en vez de sobrescribirlo silenciosamente.
