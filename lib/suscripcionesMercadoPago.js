// Unico lugar que traduce el status "crudo" de un preapproval de Mercado
// Pago a como lo guarda Soul -- mismo rol que lib/suscripciones.js cumple
// para Google Play, para que api/subscribe.js, api/webhooks/mercadopago.js y
// api/subscription/{status,cancel,sync}.js no dupliquen la regla en cada
// lado. Cualquier cambio a la politica de cancelacion (gracia hasta fin de
// periodo, etc.) se hace UNA sola vez aca -- ninguno de esos tres lugares
// tiene logica propia de estados, todos pasan por esta funcion.
//
// 'pending' (recien creada, todavia sin autorizar del lado de la persona) NO
// toca 'plan' a proposito -- Pro se activa solo cuando MP confirma
// 'authorized' de verdad, nunca antes (nunca desde back_url ni desde
// parametros del navegador).
const MAPA_ESTADOS = {
  authorized: 'pro',
  paused: 'free'
  // 'cancelled' se resuelve aparte mas abajo (gracia hasta fin de periodo).
  // 'pending' deliberadamente ausente -- ver comentario arriba.
};

// Mercado Pago no expone (confirmado en la doc oficial) un concepto propio
// de "cancelado pero vigente hasta tal fecha" -- lo construye Soul: la
// gracia es, ni mas ni menos, el ultimo plan_vencimiento que ya estaba
// guardado de la vez que la suscripcion estuvo 'authorized'. Esta funcion
// nunca RECALCULA esa fecha, solo decide si sigue siendo futura.
function vencimientoEsFuturo(valor) {
  if (!valor) return false;
  const fecha = new Date(valor);
  if (isNaN(fecha.getTime())) return false;
  return fecha.getTime() > Date.now();
}

// Arma los campos a guardar en 'usuarios' a partir de la respuesta de MP.
// filaActual es la fila que la persona YA tenia antes de este evento (al
// menos {plan_origen, plan_vencimiento}) -- protege varios casos, calcados
// de camposDesdeGoogle en lib/suscripciones.js:
//   1) Un Pro manual/cortesia (plan_origen='manual') nunca se pisa ni se
//      degrada por un evento de Mercado Pago -- se actualizan los campos
//      administrativos (mp_status, mp_preapproval_id) para tener registro,
//      pero 'plan'/'plan_origen'/'plan_vencimiento' quedan intactos.
//   2) Un status ambiguo (no listado en MAPA_ESTADOS, ej. 'pending') nunca
//      mueve a nadie de Pro a Free ni viceversa "por las dudas".
//   3) 'cancelled' NUNCA borra anticipadamente un plan_vencimiento futuro ya
//      pagado -- lo conserva tal cual estaba, y solo baja a 'free' si ese
//      vencimiento falta, es invalido, o ya paso. Idempotente: aplicar el
//      mismo 'cancelled' dos veces (reintento de webhook, sync manual, etc.)
//      da exactamente el mismo resultado las dos veces.
export function camposDesdeMP(preapprovalId, datosMP, filaActual) {
  if (!datosMP) return null;
  const status = datosMP.status || null;
  const planOrigenActual = filaActual ? filaActual.plan_origen : null;
  const esManualProtegido = planOrigenActual === 'manual';

  const campos = {
    mp_preapproval_id: preapprovalId,
    mp_status: status,
    plan_actualizado_en: new Date().toISOString()
  };

  if (esManualProtegido) return campos;

  if (status === 'cancelled') {
    campos.plan_origen = 'mercadopago';
    campos.plan_auto_renueva = false;
    const vencimientoActual = filaActual ? filaActual.plan_vencimiento : null;
    if (vencimientoEsFuturo(vencimientoActual)) {
      campos.plan = 'pro';
      campos.plan_vencimiento = vencimientoActual; // se conserva tal cual, nunca se recalcula
    } else {
      campos.plan = 'free';
      campos.plan_vencimiento = null;
    }
    return campos;
  }

  const planResuelto = MAPA_ESTADOS[status];
  if (planResuelto) {
    campos.plan = planResuelto;
    campos.plan_origen = 'mercadopago';
    // next_payment_date solo tiene sentido mientras la suscripcion sigue
    // autorizada -- en paused no hay proximo cobro programado, asi que no
    // se deja una fecha vieja dando la falsa idea de que Pro sigue vigente
    // hasta ese dia.
    campos.plan_vencimiento = status === 'authorized' ? (datosMP.next_payment_date || null) : null;
    campos.plan_auto_renueva = status === 'authorized';
  }

  return campos;
}

export { vencimientoEsFuturo };

async function patchUsuario(usuarioId, campos) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${supabaseUrl}/rest/v1/usuarios?id=eq.${encodeURIComponent(usuarioId)}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(campos)
  });
  if (!res.ok) {
    const texto = await res.text();
    if (res.status === 409 || /duplicate key|unique/i.test(texto)) {
      const err = new Error('preapproval_ya_vinculado');
      err.codigo = 'preapproval_ya_vinculado';
      throw err;
    }
    throw new Error(`No se pudo actualizar usuarios: HTTP ${res.status} ${texto}`);
  }
}

// Un fallo HTTP real (500, 401, servicio caido, etc.) NUNCA se trata como
// "la fila no existe" -- son dos cosas distintas y confundirlas es peligroso
// aca (podria hacer que aplicarSuscripcionPorUsuarioId trate un error
// transitorio como "usuario no encontrado" en vez de reintentar). El mensaje
// del error solo lleva el status HTTP, nunca el body de la respuesta ni la
// service key.
async function buscarUsuarioPorId(usuarioId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(
    `${supabaseUrl}/rest/v1/usuarios?select=id,plan,plan_origen,plan_vencimiento,mp_preapproval_id&id=eq.${encodeURIComponent(usuarioId)}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!res.ok) {
    throw new Error(`No se pudo consultar usuarios: HTTP ${res.status}`);
  }
  const filas = await res.json();
  return filas[0] || null;
}

// Llamado desde api/subscribe.js apenas se crea el preapproval -- deja
// constancia de a que suscripcion quedo esperando esta persona, ANTES de que
// llegue ningun webhook. No toca 'plan'/'plan_origen' (todavia esta
// 'pending', ver MAPA_ESTADOS).
export async function registrarPreapprovalPendiente(usuarioId, preapprovalId) {
  await patchUsuario(usuarioId, {
    mp_preapproval_id: preapprovalId,
    mp_status: 'pending',
    plan_actualizado_en: new Date().toISOString()
  });
}

// Camino usado por api/subscription/{status,cancel,sync}.js -- ya conocen el
// usuarioId de la sesion autenticada.
export async function aplicarSuscripcionAUsuario(usuarioId, preapprovalId, datosMP) {
  const fila = await buscarUsuarioPorId(usuarioId);
  if (!fila) {
    const err = new Error('usuario_no_encontrado');
    err.codigo = 'usuario_no_encontrado';
    throw err;
  }
  const campos = camposDesdeMP(preapprovalId, datosMP, fila);
  if (!campos) throw new Error('mercadopago_no_reconoce_el_preapproval');
  await patchUsuario(usuarioId, campos);
  return campos;
}

// Camino usado por api/webhooks/mercadopago.js -- solo tiene el
// usuarioId resuelto via external_reference (ver resolverEventoWebhook en
// lib/mercadoPago.js/api/webhooks/mercadopago.js), no una sesion de usuario.
// Se niega a tocar 'plan'/'plan_origen' de cualquier fila que ya sea
// 'manual' (ver camposDesdeMP) y, como red adicional, si la fila no existe
// directamente no hace nada.
export async function aplicarSuscripcionPorUsuarioId(usuarioId, preapprovalId, datosMP) {
  const fila = await buscarUsuarioPorId(usuarioId);
  if (!fila) return { encontrado: false };

  const campos = camposDesdeMP(preapprovalId, datosMP, fila);
  if (!campos) return { encontrado: true, aplicado: false, motivo: 'sin_datos_mp' };

  await patchUsuario(usuarioId, campos);
  return { encontrado: true, aplicado: true, campos };
}

export { buscarUsuarioPorId };
