import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  selectAirpTxtRecords,
} from '@aidp/core';
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
