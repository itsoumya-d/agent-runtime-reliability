import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, CircuitBreakerError, CircuitState } from '../src/circuit_breaker.js';

test('CircuitBreaker - starts in CLOSED state and handles successful calls', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 3 });
  const result = await cb.execute(async () => 'hello world');
  assert.equal(result, 'hello world');

  const stats = cb.getStats();
  assert.equal(stats.state, CircuitState.CLOSED);
  assert.equal(stats.successCount, 1);
  assert.equal(stats.failureCount, 0);
});

test('CircuitBreaker - trips to OPEN after reaching failureThreshold', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });

  for (let i = 0; i < 3; i++) {
    await assert.rejects(
      async () => cb.execute(async () => { throw new Error('upstream failure'); }),
      { message: 'upstream failure' }
    );
  }

  const stats = cb.getStats();
  assert.equal(stats.state, CircuitState.OPEN);
  assert.equal(stats.trips, 1);

  // Subsequent call while OPEN should fail fast with CircuitBreakerError
  await assert.rejects(
    async () => cb.execute(async () => 'should not run'),
    (err) => err instanceof CircuitBreakerError && err.state === CircuitState.OPEN
  );
});

test('CircuitBreaker - uses fallback when provided', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5000 });

  // First call trips circuit
  await cb.execute(
    async () => { throw new Error('provider timeout'); },
    () => 'fallback-value'
  );

  // Second call fast-fails with fallback
  const fallbackRes = await cb.execute(
    async () => 'primary',
    () => 'cached-fallback'
  );

  assert.equal(fallbackRes, 'cached-fallback');
});

test('CircuitBreaker - recovers through HALF_OPEN back to CLOSED', async () => {
  const cb = new CircuitBreaker({
    failureThreshold: 2,
    cooldownMs: 50, // Short cooldown for testing
    halfOpenLimit: 2
  });

  // Trip circuit
  for (let i = 0; i < 2; i++) {
    await assert.rejects(async () => cb.execute(async () => { throw new Error('err'); }));
  }
  assert.equal(cb.getStats().state, CircuitState.OPEN);

  // Wait for cooldown
  await new Promise((r) => setTimeout(r, 60));

  // First probe succeeds
  await cb.execute(async () => 'probe 1');
  assert.equal(cb.getStats().state, CircuitState.HALF_OPEN);

  // Second probe succeeds -> transitions back to CLOSED
  await cb.execute(async () => 'probe 2');
  assert.equal(cb.getStats().state, CircuitState.CLOSED);
});

test('CircuitBreaker - per-call timeout enforcement', async () => {
  const cb = new CircuitBreaker({ timeoutMs: 50 });

  await assert.rejects(
    async () => cb.execute(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return 'too late';
    }),
    /timed out after 50ms/
  );
});
