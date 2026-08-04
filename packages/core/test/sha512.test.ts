import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha512 } from '@airp/core';

test('vendored sha512 matches node:crypto for seal-shaped inputs', () => {
  const samples = [
    new Uint8Array(),
    new TextEncoder().encode('airp-seal/v1'),
    new TextEncoder().encode('a'.repeat(200)),
    new Uint8Array(130).fill(7),
  ];
  for (const s of samples) {
    const expected = createHash('sha512').update(s).digest();
    assert.deepEqual(Buffer.from(sha512(s)), expected);
  }
});
