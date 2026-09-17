// Pruebas de camposDesdeMP (lib/suscripcionesMercadoPago.js): es una funcion
// pura (no llama a fetch ni toca red), asi que estas pruebas no necesitan
// mock de red -- solo importan la funcion y verifican su salida.
import test from 'node:test';
import assert from 'node:assert/strict';
import { camposDesdeMP } from '../lib/suscripcionesMercadoPago.js';

function horasDesdeAhora(horas) {
  return new Date(Date.now() + horas * 3600 * 1000).toISOString();
}

test('camposDesdeMP: authorized activa pro con vencimiento de MP y auto_renueva', () => {
  const vencimiento = horasDesdeAhora(24 * 30);
  const campos = camposDesdeMP('preap-1', { status: 'authorized', next_payment_date: vencimiento }, null);
  assert.equal(campos.plan, 'pro');
  assert.equal(campos.plan_origen, 'mercadopago');
  assert.equal(campos.plan_auto_renueva, true);
  assert.equal(campos.plan_vencimiento, vencimiento);
  assert.equal(campos.mp_status, 'authorized');
  assert.equal(campos.mp_preapproval_id, 'preap-1');
});

test('camposDesdeMP: cancelled con vencimiento futuro conserva pro y exactamente la misma fecha', () => {
  const vencimientoFuturo = horasDesdeAhora(24 * 10);
  const filaActual = { plan_origen: 'mercadopago', plan_vencimiento: vencimientoFuturo };
  const campos = camposDesdeMP('preap-2', { status: 'cancelled' }, filaActual);
  assert.equal(campos.plan, 'pro');
  assert.equal(campos.plan_vencimiento, vencimientoFuturo);
  assert.equal(campos.plan_auto_renueva, false);
  assert.equal(campos.plan_origen, 'mercadopago');
  assert.equal(campos.mp_status, 'cancelled');
});

test('camposDesdeMP: cancelled con vencimiento ya vencido baja a free', () => {
  const vencimientoVencido = horasDesdeAhora(-24);
  const filaActual = { plan_origen: 'mercadopago', plan_vencimiento: vencimientoVencido };
  const campos = camposDesdeMP('preap-3', { status: 'cancelled' }, filaActual);
  assert.equal(campos.plan, 'free');
  assert.equal(campos.plan_vencimiento, null);
  assert.equal(campos.plan_auto_renueva, false);
});

test('camposDesdeMP: cancelled sin vencimiento previo baja a free', () => {
  const filaActual = { plan_origen: 'mercadopago', plan_vencimiento: null };
  const campos = camposDesdeMP('preap-4', { status: 'cancelled' }, filaActual);
  assert.equal(campos.plan, 'free');
  assert.equal(campos.plan_vencimiento, null);
  assert.equal(campos.plan_auto_renueva, false);
});

test('camposDesdeMP: repetir cancelled con vencimiento futuro es idempotente', () => {
  const vencimientoFuturo = horasDesdeAhora(24 * 5);
  const filaActual1 = { plan_origen: 'mercadopago', plan_vencimiento: vencimientoFuturo };
  const resultado1 = camposDesdeMP('preap-5', { status: 'cancelled' }, filaActual1);

  // Simula que resultado1 ya quedo persistido en 'usuarios' y llega un
  // segundo evento 'cancelled' sobre esa misma fila (reintento de webhook,
  // sync manual, etc.) -- debe dar exactamente el mismo resultado.
  const filaActual2 = { ...filaActual1, ...resultado1 };
  const resultado2 = camposDesdeMP('preap-5', { status: 'cancelled' }, filaActual2);

  assert.equal(resultado1.plan, resultado2.plan);
  assert.equal(resultado1.plan_vencimiento, resultado2.plan_vencimiento);
  assert.equal(resultado1.plan_auto_renueva, resultado2.plan_auto_renueva);
  assert.equal(resultado2.plan, 'pro');
  assert.equal(resultado2.plan_vencimiento, vencimientoFuturo);
});

test('camposDesdeMP: un plan manual protegido nunca se modifica', () => {
  const filaActual = { plan_origen: 'manual', plan_vencimiento: null };
  const campos = camposDesdeMP('preap-6', { status: 'authorized', next_payment_date: horasDesdeAhora(24) }, filaActual);
  assert.equal(campos.plan, undefined);
  assert.equal(campos.plan_origen, undefined);
  assert.equal(campos.plan_vencimiento, undefined);
  assert.equal(campos.plan_auto_renueva, undefined);
  // Se siguen guardando los campos administrativos, para tener registro.
  assert.equal(campos.mp_status, 'authorized');
  assert.equal(campos.mp_preapproval_id, 'preap-6');
});
