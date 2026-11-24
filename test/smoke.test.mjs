import test from 'node:test';
import assert from 'node:assert/strict';

test('runtime environment initializes', () => {
  assert.equal(typeof process.version, 'string');
});
