// HostSession packaging warnings. Claim: AIDP_DESKTOP=1 surfaces the HTTP-sidecar gap.
//
// Paper: steps 1 and 12. Desktop packaging honesty.
// Runs against the compiled host module so the daemon package keeps rootDir=src.

import assert from 'node:assert/strict';
import test from 'node:test';
import { packagingWarnings } from '../dist/host.js';

test('packagingWarnings is empty without AIDP_DESKTOP', () => {
  assert.deepEqual(packagingWarnings({}), []);
  assert.deepEqual(packagingWarnings({ AIDP_DESKTOP: '0' }), []);
});

test('packagingWarnings names the HTTP sidecar gap when AIDP_DESKTOP=1', () => {
  const w = packagingWarnings({ AIDP_DESKTOP: '1' });
  assert.equal(w.length, 1);
  assert.match(w[0], /Tauri shell over the loopback daemon/);
  assert.match(w[0], /HTTP/);
  assert.match(w[0], /in-process Tauri commands/);
});
