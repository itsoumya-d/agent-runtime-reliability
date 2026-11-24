import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthProbe } from '../src/health_probe.js';
import { CircuitBreaker } from '../src/circuit_breaker.js';

test('HealthProbe - liveness probe returns UP', () => {
  const probe = new HealthProbe();
  const live = probe.checkLiveness();
  assert.equal(live.status, 'UP');
  assert.ok(typeof live.uptimeSeconds === 'number');
});

test('HealthProbe - readiness probe degrades when registered circuit breaker is OPEN', async () => {
  const probe = new HealthProbe();
  const cb = new CircuitBreaker({ failureThreshold: 1 });

  probe.registerCircuitBreaker('upstream-model-api', cb);

  // Initially ready
  let ready = probe.checkReadiness();
  assert.equal(ready.status, 'READY');
  assert.equal(ready.ready, true);

  // Trip circuit breaker
  await assert.rejects(async () => cb.execute(async () => { throw new Error('fail'); }));

  // Readiness degraded
  ready = probe.checkReadiness();
  assert.equal(ready.status, 'DEGRADED');
  assert.equal(ready.ready, false);
  assert.deepEqual(ready.openCircuits, ['upstream-model-api']);
});
