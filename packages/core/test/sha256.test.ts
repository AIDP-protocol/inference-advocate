import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '@aidp/core';

test('vendored sha256Hex matches node:crypto for ledger-shaped inputs', () => {
  const samples = [
    '',
    'aidp-ledger/v1',
    ['aidp-ledger/v1', 'fixture-p', '1', 'r0', '2026-07-28T00:00:00.000Z', 'deliver', '0.0000', '', '0'.repeat(64)].join(
      '\n',
    ),
    'a'.repeat(200),
  ];
  for (const s of samples) {
    const expected = createHash('sha256').update(s, 'utf8').digest('hex');
    assert.equal(sha256Hex(s), expected);
  }
});
