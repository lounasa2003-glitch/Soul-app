# Tecnologías usadas por Soul

> Este documento explica, con precisión técnica pero en lenguaje simple, qué tecnologías de almacenamiento y seguimiento usa Soul. Solo se incluyen tecnologías confirmadas en la revisión técnica del código de la aplicación — no se incluye nada que no esté verificado.

## Cookies

Soul **no usa cookies de seguimiento ni cookies de publicidad**. No se detectó ningún uso de cookies en la aplicación durante la revisión técnica.

## Almacenamiento local del dispositivo

Soul funciona como una aplicación web progresiva (PWA), con un componente técnico (`service worker`) que permite que ciertos recursos de la aplicación carguen más rápido y que la app pueda instalarse en tu dispositivo como si fuera una aplicación nativa. Este componente no se usa para rastrear tu actividad ni para publicidad.

**Tu sesión (el hecho de que estés logueado) no se guarda en el almacenamiento del navegador.** Vive únicamente en la memoria de la página mientras la tenés abierta — si cerrás o recargás la aplicación, tenés que volver a iniciar sesión. Esto es una decisión de seguridad: reduce el riesgo de que alguien robe tu sesión a través de una vulnerabilidad del navegador.

## Autenticación

Usamos **Supabase Auth** para gestionar tu inicio de sesión (email y contraseña). Cuando iniciás sesión, se genera un token de acceso temporal que se envía en cada solicitud a nuestros servidores para confirmar que sos vos.

## Base de datos

Usamos **Supabase** (una base de datos Postgres gestionada) para almacenar toda la información de tu cuenta, tu perfil, tus conversaciones, tus matches y tus citas. La región confirmada de nuestra base de datos es São Paulo, Brasil.

## Hosting

La aplicación se aloja y se ejecuta en **Vercel**, que también ejecuta una tarea automática diaria encargada del mantenimiento operativo y de aplicar los plazos de borrado de datos descritos en `politica-privacidad.md`.

## Fuentes (tipografías)

Usamos **Google Fonts** (las tipografías Cormorant Garamond e Inter), cargadas de forma remota desde los servidores de Google. Esto implica que, al cargar la aplicación, tu dirección IP se comparte con Google como parte del comportamiento estándar de este servicio — no se comparte ningún otro dato personal por este medio.

## ¿Usamos analítica de terceros?

**No.** No usamos Google Analytics, Meta Pixel, ni ninguna otra herramienta de analítica de terceros. Internamente registramos algunas métricas agregadas de uso de la aplicación (por ejemplo, cuántas personas llegan a cada etapa del proceso) directamente en nuestra propia base de datos, sin enviarlas a ningún servicio externo de analítica.

## ¿Usamos publicidad?

**No.** Soul no muestra publicidad ni usa SDKs de redes publicitarias.

## ¿Usamos geolocalización?

**No.** Soul te pide que indiques tu ciudad de forma manual (texto que vos escribís), no usa GPS ni ningún servicio de geolocalización automática de tu dispositivo.

## ¿Usamos notificaciones push?

**Sí.** Usamos **Firebase Cloud Messaging**, un servicio de Google, para enviarte notificaciones a tu dispositivo cuando tenés un nuevo match, un mensaje nuevo en la Sala de Encuentros, o cuando se cierra una cita. Esto requiere dos cosas: que le hayas dado permiso a Soul para enviarte notificaciones en tu dispositivo, y que tengas activada la opción "comunicaciones de producto" en "Mi perfil" — la misma que controla los emails de producto. Si falta cualquiera de las dos, no recibís ese push. Ver `politica-privacidad.md` (secciones 12 y 14).

---

Ver también `politica-privacidad.md` (secciones 12 y 13).
