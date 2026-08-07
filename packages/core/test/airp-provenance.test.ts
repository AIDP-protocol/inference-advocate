import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DuplicateJsonMemberError,
  SSE_CHAT_DELTA_V1,
  SSE_CONTENT_BLOCK_DELTA_V1,
  accumulateBoundContent,
  accumulateStream,
  computeKeySetDigest,
  generateSealKeypair,
  isForbiddenAutoFetchHost,
  parseAirpTxt,
  parseJsonNoDuplicates,
  parseSseStream,
  runDeterministicPass,
  selectAirpTxtRecords,
  ServingRegister,
} from '@airp/core';
import type { ProviderResponse } from '@airp/core';
import { dataPath, repoRoot } from './helpers.js';

test('sse-chat-delta-v1 extracts content and ignores tool/thinking deltas', () => {
  const sealed = accumulateBoundContent(SSE_CHAT_DELTA_V1, [
    { choices: [{ delta: { content: 'Hello' } }] },
    { choices: [{ delta: { tool_calls: [{ id: '1' }] } }] },
    { choices: [{ delta: { content: ' world' } }] },
    { choices: [{ delta: { reasoning: 'secret' } }] },
  ]);
  assert.equal(new TextDecoder().decode(sealed), 'Hello world');
});

test('sse-content-block-delta-v1 extracts text_delta only', () => {
  const sealed = accumulateBoundContent(SSE_CONTENT_BLOCK_DELTA_V1, [
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A' } },
    { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } },
    { type: 'content_block_start', content_block: { type: 'text' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'B' } },
  ]);
  assert.equal(new TextDecoder().decode(sealed), 'AB');
});

test('content after a terminal-seal event is flagged and excluded from sealed octets', () => {
  const result = accumulateStream(SSE_CHAT_DELTA_V1, [
    { kind: 'data', data: { choices: [{ delta: { content: 'ok' } }] } },
    { kind: 'terminal-seal', sealValue: 'seal' },
    { kind: 'data', data: { choices: [{ delta: { content: 'leak' } }] } },
  ]);
  assert.equal(new TextDecoder().decode(result.sealedContent), 'ok');
  assert.equal(result.contentAfterTerminalSeal, true);
  assert.equal(result.terminalSealValue, 'seal');
});

test('parseSseStream maps airp-seal framing and ignores [DONE]', () => {
  const raw =
    'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' +
    'data: {"choices":[{"delta":{}}]}\n\n' +
    'event: airp-seal\n' +
    'data: seal-value\n\n' +
    'data: [DONE]\n\n';
  const events = parseSseStream(raw);
  assert.equal(events.length, 3);
  assert.equal(events[0]?.kind, 'data');
  assert.equal(events[1]?.kind, 'data');
  assert.equal(events[2]?.kind, 'terminal-seal');
  assert.equal(events[2]?.sealValue, 'seal-value');
  const sealed = accumulateStream(SSE_CHAT_DELTA_V1, events);
  assert.equal(new TextDecoder().decode(sealed.sealedContent), 'Hi');
  assert.equal(sealed.terminalSealValue, 'seal-value');
  assert.equal(sealed.contentAfterTerminalSeal, false);
});

test('key set digest sorts by selector and ignores array order and status', () => {
  const a = generateSealKeypair();
  const b = generateSealKeypair();
  const entryOutOfOrder = {
    id: 'e',
    providerIdentity: 'p',
    status: 'active' as const,
    authorizedEndpoints: [],
    models: [],
    sealPolicy: 'all' as const,
    keys: [
      { selector: 'z', publicKeyPem: b.publicKeyPem, status: 'retired' as const, retiredAt: '2026-01-01T00:00:00.000Z' },
      { selector: 'a', publicKeyPem: a.publicKeyPem, status: 'current' as const },
    ],
  };
  const entrySorted = {
    ...entryOutOfOrder,
    keys: [
      { selector: 'a', publicKeyPem: a.publicKeyPem, status: 'compromised' as const, retiredAt: '2026-01-01T00:00:00.000Z' },
      { selector: 'z', publicKeyPem: b.publicKeyPem, status: 'current' as const },
    ],
  };
  assert.equal(computeKeySetDigest(entryOutOfOrder), computeKeySetDigest(entrySorted));
});

test('key set digest is byte-exact against a fixture with keys out of selector order', () => {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, 'packages/core/test/fixtures/key-set-digest-entry.json'), 'utf8'),
  ) as {
    expectedDigest: string;
    id: string;
    providerIdentity: string;
    status: 'active';
    authorizedEndpoints: string[];
    models: string[];
    sealPolicy: 'all';
    keys: Array<{ selector: string; publicKeyPem: string; status: 'current' }>;
  };
  assert.equal(raw.keys[0]?.selector, 'k2', 'fixture must list k2 before k1 so the sort is exercised');
  assert.equal(raw.keys[1]?.selector, 'k1');
  const { expectedDigest, ...entry } = raw;
  assert.equal(computeKeySetDigest(entry), expectedDigest);
});

test('key set digest is invariant under key status change and changes when keys change', () => {
  const a = generateSealKeypair();
  const b = generateSealKeypair();
  const c = generateSealKeypair();
  const base = {
    id: 'e',
    providerIdentity: 'p',
    status: 'active' as const,
    authorizedEndpoints: [],
    models: [],
    sealPolicy: 'all' as const,
    keys: [{ selector: 's1', publicKeyPem: a.publicKeyPem, status: 'current' as const }],
  };
  const statusChanged = {
    ...base,
    keys: [
      {
        selector: 's1',
        publicKeyPem: a.publicKeyPem,
        status: 'compromised' as const,
        retiredAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
  assert.equal(computeKeySetDigest(base), computeKeySetDigest(statusChanged));

  const added = {
    ...base,
    keys: [
      ...base.keys,
      { selector: 's2', publicKeyPem: b.publicKeyPem, status: 'current' as const },
    ],
  };
  assert.notEqual(computeKeySetDigest(base), computeKeySetDigest(added));

  const removed = { ...base, keys: [] };
  assert.notEqual(computeKeySetDigest(base), computeKeySetDigest(removed));

  const substituted = {
    ...base,
    keys: [{ selector: 's1', publicKeyPem: c.publicKeyPem, status: 'current' as const }],
  };
  assert.notEqual(computeKeySetDigest(base), computeKeySetDigest(substituted));
});

test('key-set-digest tool agrees with the verifier on the two public entries', () => {
  const register = ServingRegister.loadFromFiles(
    dataPath('register', 'serving-register.json'),
    dataPath('register', 'serving-register.sig'),
    dataPath('register', 'registrar-public.pem'),
  );
  assert.equal(register.signatureValid, true);
  const tool = spawnSync(process.execPath, [join(repoRoot, 'tools', 'key-set-digest.mjs')], {
    encoding: 'utf8',
  });
  assert.equal(tool.status, 0, tool.stderr);
  for (const id of ['honestmodel.win.entry', 'cheapai.win.entry']) {
    const entry = register.entry(id);
    assert.ok(entry, id);
    const digest = computeKeySetDigest(entry);
    assert.match(tool.stdout, new RegExp(`# digest: ${digest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(tool.stdout, new RegExp(`k=${digest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});

test('substituted-keys register verifies but is refused on key set digest mismatch', () => {
  const honest = ServingRegister.loadFromFiles(
    dataPath('register', 'serving-register.json'),
    dataPath('register', 'serving-register.sig'),
    dataPath('register', 'registrar-public.pem'),
  );
  const substituted = ServingRegister.loadFromFiles(
    dataPath('register', 'serving-register.substituted-keys.json'),
    dataPath('register', 'serving-register.substituted-keys.sig'),
    dataPath('register', 'registrar-public.pem'),
  );
  assert.equal(honest.signatureValid, true);
  assert.equal(substituted.signatureValid, true, 'fixture must verify against the pinned registrar key');

  const honestEntry = honest.entry('honestmodel.win.entry');
  const badEntry = substituted.entry('honestmodel.win.entry');
  assert.ok(honestEntry && badEntry);
  const dnsDigest = computeKeySetDigest(honestEntry);
  const computed = computeKeySetDigest(badEntry);
  assert.notEqual(dnsDigest, computed, 'substituted keys must change the digest');

  const provider = {
    id: 'honestmodel',
    label: 'honestmodel.win',
    baseUrl: 'https://api.honestmodel.win/v1',
    model: 'honestmodel-1',
    registerEntryId: 'honestmodel.win.entry',
  };
  const content = 'substituted keys still look signed';
  const response: ProviderResponse = {
    providerId: 'honestmodel',
    servedFrom: 'https://api.honestmodel.win/v1/chat/completions',
    receivedAt: '2026-08-06T00:00:00.000Z',
    latencyMs: 1,
    transport: 'non_streamed',
    content,
    sealedContent: new TextEncoder().encode(content),
    sealFieldName: 'airp-seal',
    exchangeId: 'AAAAAAAAAAAAAAAAAAAAAA',
    requestDigest: 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };

  const mismatch = runDeterministicPass(provider, response, substituted, {
    keySetDigestFromDns: dnsDigest,
    keySetDigestComputed: computed,
  });
  assert.equal(mismatch.passed, false);
  assert.equal(mismatch.findings.some((f) => f.code === 'key_set_digest_mismatch'), true);
  assert.equal(
    mismatch.findings.some((f) => f.code === 'register_entry_unknown'),
    false,
    'refusal must be digest mismatch, not a missing entry',
  );
  // The register document itself verified; a signature failure would have been caught at load.
  assert.equal(substituted.signatureValid, true);

  const confirmed = runDeterministicPass(provider, response, honest, {
    keySetDigestFromDns: dnsDigest,
    keySetDigestComputed: dnsDigest,
  });
  assert.equal(confirmed.attribution, 'confirmed');
  assert.equal(confirmed.findings.some((f) => f.code === 'key_set_digest_mismatch'), false);
});

test('parseAirpTxt requires v=airp1 first and rejects duplicates', () => {
  const ok = parseAirpTxt('v=airp1;e=demo.aligned;k=abc;r=https://register.example/v1');
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.binding.entryId, 'demo.aligned');
    assert.equal(ok.binding.keySetDigest, 'abc');
  }
  assert.equal(parseAirpTxt('e=demo.aligned;v=airp1').ok, false);
  assert.equal(parseAirpTxt('v=airp1;e=a;e=b').ok, false);
  assert.equal(parseAirpTxt('v=airp1;e=a;r=http://register.example/v1').ok, false);
  assert.equal(parseAirpTxt('v=airp1;e=a;r=https://127.0.0.1/reg').ok, false);
});

test('TXT multi-string concatenation and dual v=airp1 refusal', () => {
  const split = selectAirpTxtRecords([['v=airp1;e=demo.', 'aligned;k=abc']]);
  assert.equal(split.ok, true);
  if (split.ok) assert.equal(split.binding.entryId, 'demo.aligned');

  const dual = selectAirpTxtRecords([
    ['v=airp1;e=one'],
    ['v=airp1;e=two'],
  ]);
  assert.equal(dual.ok, false);
});

test('forbidden auto-fetch hosts cover loopback and RFC1918', () => {
  assert.equal(isForbiddenAutoFetchHost('127.0.0.1'), true);
  assert.equal(isForbiddenAutoFetchHost('10.0.0.1'), true);
  assert.equal(isForbiddenAutoFetchHost('192.168.1.1'), true);
  assert.equal(isForbiddenAutoFetchHost('169.254.1.1'), true);
  assert.equal(isForbiddenAutoFetchHost('::1'), true);
  assert.equal(isForbiddenAutoFetchHost('register.example'), false);
});

test('duplicate JSON member names are rejected', () => {
  assert.throws(() => parseJsonNoDuplicates('{"a":1,"a":2}'), DuplicateJsonMemberError);
  assert.deepEqual(parseJsonNoDuplicates('{"a":1,"b":{"c":2}}'), { a: 1, b: { c: 2 } });
});

test('nested duplicate member names are rejected', () => {
  assert.throws(() => parseJsonNoDuplicates('{"a":{"x":1,"x":2}}'), DuplicateJsonMemberError);
});
