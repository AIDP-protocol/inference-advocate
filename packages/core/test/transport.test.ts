// Both transport modes, end to end. Neither is a fallback for the other, so neither is
// covered only incidentally: the streamed path, the deliberately selected non-streamed path,
// and a provider that ignores the flag each get their own tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSqliteStore } from '@airp/store-sqlite';
import { dataPath } from './helpers.js';
import {
  Advocate,
  ArrivalActivity,
  ARRIVAL_HALF_LIFE_MS,
  DeliveryPolicy,
  Jurisdiction,
  MasterSecret,
  ProviderRegistry,
  RuleEvaluator,
  SSE_CHAT_DELTA_V1,
  SemanticMonitor,
  ServingRegister,
  SseStreamParser,
  StandingRegistry,
  Taxonomy,
  accumulateBoundContent,
  computeRequestDigest,
  encodeSeal,
  generateSealKeypair,
  parseSseStream,
  runDeterministicPass,
  send,
  signSeal,
  verifySeal,
  type ExchangeStage,
  type ProviderConfig,
  type TransportPolicyConfig,
} from '@airp/core';

const taxonomy = Taxonomy.loadFromFile(dataPath('taxonomy', 'flags.v0.json'));
const policy = DeliveryPolicy.loadFromFile(dataPath('policy', 'delivery-policy.json'));
const utf8 = new TextEncoder();
const ENTRY_ID = 'e.stream';

const PROVIDER: ProviderConfig = {
  id: 'p',
  label: 'Streaming provider',
  baseUrl: 'http://127.0.0.1:9999/v1',
  model: 'test-model',
  registerEntryId: ENTRY_ID,
};

interface SeenRequest {
  headers: Record<string, string>;
  body: { stream?: unknown };
}

interface SealKeys {
  privateKeyPem: string;
  publicKeyPem: string;
}

/** Split text the way an OpenAI-compatible provider does, one delta per whitespace-run token. */
function deltaObjects(text: string, model: string): unknown[] {
  const parts = text.split(/(\s+)/).filter((p) => p.length > 0);
  return (parts.length > 0 ? parts : [text]).map((part, i) => ({
    id: 'stream-1',
    object: 'chat.completion.chunk',
    model,
    choices: [
      {
        index: 0,
        delta: i === 0 ? { role: 'assistant', content: part } : { content: part },
        finish_reason: null,
      },
    ],
  }));
}

/**
 * The SSE text a sealing provider serves for one response: content deltas, the terminal-seal
 * event over the accumulated binding output, then [DONE]. Spec §3.8.3 / Appendix B.
 */
function sseBody(opts: {
  text: string;
  model: string;
  keys?: SealKeys;
  exchangeId?: string;
  requestDigest?: string;
  /** Extra copies of the terminal-seal event, for the more-than-one case. */
  extraSeals?: number;
  /** A data event after the terminal seal, which is unsigned content under a sealed response. */
  trailingContent?: string;
}): string {
  const objects = deltaObjects(opts.text, opts.model);
  const frames = objects.map((o) => `data: ${JSON.stringify(o)}\n\n`);

  if (opts.keys) {
    const sealValue = encodeSeal(
      signSeal(
        {
          registerEntryId: ENTRY_ID,
          selector: 's1',
          alg: 'ed25519',
          model: opts.model,
          providerIdentity: 'test',
          exchangeId: opts.exchangeId ?? '',
          requestDigest: opts.requestDigest ?? '',
          signedAt: new Date().toISOString(),
          content: accumulateBoundContent(SSE_CHAT_DELTA_V1, objects),
        },
        opts.keys.privateKeyPem,
      ),
    );
    for (let i = 0; i < 1 + (opts.extraSeals ?? 0); i++) {
      frames.push(`event: airp-seal\ndata: ${sealValue}\n\n`);
    }
  }
  if (opts.trailingContent !== undefined) {
    for (const o of deltaObjects(opts.trailingContent, opts.model)) {
      frames.push(`data: ${JSON.stringify(o)}\n\n`);
    }
  }
  frames.push('data: [DONE]\n\n');
  return frames.join('');
}

/** Chunk on byte boundaries, so multi-byte characters and event boundaries both get split. */
function byteChunkedStream(raw: string, chunkBytes: number): ReadableStream<Uint8Array> {
  const bytes = utf8.encode(raw);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkBytes));
      offset += chunkBytes;
    },
  });
}

/**
 * A provider that seals what it serves, binding the exchange id and request digest of the
 * request it received so the deterministic pass has something honest to check. It streams when
 * asked, unless ignoreStreamFlag says to answer with a whole body regardless.
 */
function streamingProvider(opts: {
  script: string[];
  keys?: SealKeys;
  model?: string;
  ignoreStreamFlag?: boolean;
  chunkBytes?: number;
  extraSeals?: number;
  trailingContent?: string;
}) {
  const model = opts.model ?? 'test-model';
  const seen: SeenRequest[] = [];
  let served = 0;

  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const headers = Object.fromEntries(
      new Headers(init?.headers as Record<string, string> | undefined).entries(),
    );
    const body = JSON.parse(bodyText || '{}') as { stream?: unknown };
    seen.push({ headers, body });

    const text = opts.script[Math.min(served, opts.script.length - 1)] ?? '';
    served += 1;
    const exchangeId = headers['airp-exchange-id'] ?? '';
    const requestDigest = computeRequestDigest(utf8.encode(bodyText));

    if (body.stream !== true || opts.ignoreStreamFlag) {
      const wholeBody = JSON.stringify({
        model,
        choices: [{ message: { role: 'assistant', content: text } }],
      });
      const bodyBytes = utf8.encode(wholeBody);
      const outHeaders: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.keys) {
        outHeaders['airp-seal'] = encodeSeal(
          signSeal(
            {
              registerEntryId: ENTRY_ID,
              selector: 's1',
              alg: 'ed25519',
              model,
              providerIdentity: 'test',
              exchangeId,
              requestDigest,
              signedAt: new Date().toISOString(),
              content: bodyBytes,
            },
            opts.keys.privateKeyPem,
          ),
        );
      }
      return new Response(bodyBytes, { status: 200, headers: outHeaders });
    }

    const raw = sseBody({
      text,
      model,
      ...(opts.keys ? { keys: opts.keys } : {}),
      exchangeId,
      requestDigest,
      ...(opts.extraSeals ? { extraSeals: opts.extraSeals } : {}),
      ...(opts.trailingContent !== undefined ? { trailingContent: opts.trailingContent } : {}),
    });
    return new Response(byteChunkedStream(raw, opts.chunkBytes ?? 24), {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, seen };
}

function registerFor(publicKeyPem: string, contentBinding?: string): ServingRegister {
  return ServingRegister.fromDocument({
    airpRegisterVersion: '1',
    issuedAt: '2026-07-01T00:00:00.000Z',
    registrar: { id: 'test', publicKeyPem: 'unused' },
    entries: [
      {
        id: ENTRY_ID,
        providerIdentity: 'test',
        status: 'active',
        authorizedEndpoints: ['http://127.0.0.1:9999/v1'],
        models: ['test-model'],
        keys: [{ selector: 's1', publicKeyPem, status: 'current' }],
        sealPolicy: 'all',
        ...(contentBinding ? { contentBinding } : {}),
      },
    ],
  });
}

function buildAdvocate(opts: {
  script: string[];
  contentBinding?: string;
  trailingContent?: string;
  transportPolicy?: TransportPolicyConfig;
}) {
  const keys = generateSealKeypair();
  const { fetchImpl, seen } = streamingProvider({
    script: opts.script,
    keys,
    ...(opts.trailingContent !== undefined ? { trailingContent: opts.trailingContent } : {}),
  });
  const advocate = new Advocate({
    store: openSqliteStore(':memory:'),
    master: MasterSecret.generate(),
    providers: new ProviderRegistry([{ ...PROVIDER, id: 'test' }]),
    register: registerFor(keys.publicKeyPem, opts.contentBinding),
    standing: StandingRegistry.empty(),
    policy: opts.transportPolicy
      ? new DeliveryPolicy({ ...policy.document, transport: opts.transportPolicy })
      : policy,
    jurisdiction: Jurisdiction.none(),
    monitor: new SemanticMonitor(new RuleEvaluator(taxonomy), taxonomy),
    attestations: { isAdult: true, jurisdiction: 'none', issuer: 'test' },
    fetchImpl,
  });
  return { advocate, seen };
}

const ANSWER = 'The capital of Nepal is Kathmandu, and the flag is not a rectangle.';

test('a streamed exchange verifies the terminal seal over the accumulated octets', async () => {
  const keys = generateSealKeypair();
  const { fetchImpl, seen } = streamingProvider({ script: [ANSWER], keys });

  const response = await send(PROVIDER, {
    messages: [{ role: 'user', content: 'ask' }],
    contentBinding: SSE_CHAT_DELTA_V1,
    fetchImpl,
  });

  assert.equal(seen[0]?.body.stream, true);
  assert.equal(response.transport, 'streamed');
  assert.equal(response.content, ANSWER);
  assert.equal(new TextDecoder().decode(response.sealedContent), ANSWER);
  assert.equal(response.sealFieldName, 'airp-seal');
  assert.equal(response.reportedModel, 'test-model');
  assert.ok(response.seal);
  assert.equal(verifySeal(response.seal!, response.sealedContent, keys.publicKeyPem), true);
});

test('a provider that ignores stream:true is served by the non-streamed path', async () => {
  const keys = generateSealKeypair();
  const { fetchImpl, seen } = streamingProvider({ script: [ANSWER], keys, ignoreStreamFlag: true });

  const response = await send(PROVIDER, {
    messages: [{ role: 'user', content: 'ask' }],
    contentBinding: SSE_CHAT_DELTA_V1,
    fetchImpl,
  });

  // The flag went out and the provider answered with a whole body anyway. The content-type
  // decides, so this ran the non-streamed path and the seal covers the body octets.
  assert.equal(seen[0]?.body.stream, true);
  assert.equal(response.transport, 'non_streamed');
  assert.equal(response.content, ANSWER);
  assert.equal(verifySeal(response.seal!, response.sealedContent, keys.publicKeyPem), true);
});

test('non-streamed transport selected deliberately sends stream:false and verifies', async () => {
  const keys = generateSealKeypair();
  const { fetchImpl, seen } = streamingProvider({ script: [ANSWER], keys });

  const response = await send(PROVIDER, {
    messages: [{ role: 'user', content: 'ask' }],
    transport: 'non_streamed',
    fetchImpl,
  });

  assert.equal(seen[0]?.body.stream, false);
  assert.equal(seen[0]?.headers['accept'], undefined);
  assert.equal(response.transport, 'non_streamed');
  assert.equal(response.content, ANSWER);
  assert.equal(verifySeal(response.seal!, response.sealedContent, keys.publicKeyPem), true);
});

test('the request digest covers the body as sent, including the transport flag', async () => {
  const keys = generateSealKeypair();
  for (const transport of ['streamed', 'non_streamed'] as const) {
    const { fetchImpl, seen } = streamingProvider({ script: [ANSWER], keys });
    const response = await send(PROVIDER, {
      messages: [{ role: 'user', content: 'ask' }],
      transport,
      ...(transport === 'streamed' ? { contentBinding: SSE_CHAT_DELTA_V1 } : {}),
      fetchImpl,
    });
    assert.equal(seen[0]?.body.stream, transport === 'streamed');
    // The provider computed the digest over what it received; the client over what it sent.
    assert.equal(response.seal?.requestDigest, response.requestDigest);
  }
});

test('streamed transport refuses to run without the binding the entry names', async () => {
  const { fetchImpl } = streamingProvider({ script: [ANSWER] });
  await assert.rejects(
    () =>
      send(PROVIDER, {
        messages: [{ role: 'user', content: 'ask' }],
        transport: 'streamed',
        fetchImpl,
      }),
    /content binding/,
  );
});

test('a stream is requested with identity coding and an event-stream accept', async () => {
  const { fetchImpl, seen } = streamingProvider({ script: [ANSWER] });
  await send(PROVIDER, {
    messages: [{ role: 'user', content: 'ask' }],
    contentBinding: SSE_CHAT_DELTA_V1,
    fetchImpl,
  });
  assert.equal(seen[0]?.headers['accept'], 'text/event-stream');
  assert.equal(seen[0]?.headers['accept-encoding'], 'identity');
});

test('the arrival signal is a bounded scalar that settles at zero', async () => {
  const keys = generateSealKeypair();
  const { fetchImpl } = streamingProvider({ script: [ANSWER], keys, chunkBytes: 8 });

  const seenActivity: unknown[] = [];
  await send(PROVIDER, {
    messages: [{ role: 'user', content: 'ask' }],
    contentBinding: SSE_CHAT_DELTA_V1,
    onArrival: (activity) => seenActivity.push(activity),
    fetchImpl,
  });

  assert.ok(seenActivity.length > 0);
  for (const value of seenActivity) {
    assert.equal(typeof value, 'number');
    const n = value as number;
    assert.ok(Number.isFinite(n) && n >= 0 && n <= 1, `activity out of range: ${n}`);
  }
  assert.equal(seenActivity[seenActivity.length - 1], 0);
});

test('arrival activity saturates at one and decays toward zero', () => {
  const activity = new ArrivalActivity(0);
  for (let i = 0; i < 10; i++) activity.observe(i);
  assert.equal(activity.observe(10), 1);
  const halved = activity.value(10 + ARRIVAL_HALF_LIFE_MS);
  assert.ok(Math.abs(halved - 0.5) < 0.01, `expected about 0.5, got ${halved}`);
  assert.equal(activity.value(10 + ARRIVAL_HALF_LIFE_MS * 40), 0);
});

test('the incremental parser agrees with the whole-body parser across chunk boundaries', () => {
  const raw = sseBody({ text: 'Kathmandu is not a rectangle', model: 'test-model' });
  const parser = new SseStreamParser();
  const incremental = [];
  for (let i = 0; i < raw.length; i += 3) incremental.push(...parser.push(raw.slice(i, i + 3)));
  incremental.push(...parser.flush());
  assert.deepEqual(incremental, parseSseStream(raw));
});

test('a multi-byte character split across chunks survives the streamed path', async () => {
  const keys = generateSealKeypair();
  const text = 'Namaste नमस्ते and a rocket 🚀 at the end';
  // Small enough that code points land across chunk boundaries.
  const { fetchImpl } = streamingProvider({ script: [text], keys, chunkBytes: 7 });

  const response = await send(PROVIDER, {
    messages: [{ role: 'user', content: 'ask' }],
    contentBinding: SSE_CHAT_DELTA_V1,
    fetchImpl,
  });

  assert.equal(response.content, text);
  assert.equal(verifySeal(response.seal!, response.sealedContent, keys.publicKeyPem), true);
});

test('more than one terminal-seal event is a refusing finding', async () => {
  const keys = generateSealKeypair();
  const { fetchImpl } = streamingProvider({ script: [ANSWER], keys, extraSeals: 1 });

  const response = await send(PROVIDER, {
    messages: [{ role: 'user', content: 'ask' }],
    contentBinding: SSE_CHAT_DELTA_V1,
    fetchImpl,
  });
  assert.equal(response.multipleSeals, true);

  const verdict = runDeterministicPass(
    PROVIDER,
    response,
    registerFor(keys.publicKeyPem, 'sse-chat-delta-v1'),
  );
  assert.equal(verdict.passed, false);
  assert.equal(verdict.findings.some((f) => f.code === 'seal_multiple'), true);
});

test('a streamed exchange delivers through the whole pipeline', async () => {
  const { advocate, seen } = buildAdvocate({ script: [ANSWER], contentBinding: 'sse-chat-delta-v1' });
  const arrivals: number[] = [];
  const result = await advocate.ask({
    providerId: 'test',
    text: 'What is the capital of Nepal?',
    onArrival: (a) => arrivals.push(a),
  });

  assert.equal(seen[0]?.body.stream, true);
  assert.equal(result.decision.kind, 'deliver');
  assert.equal(result.delivered, ANSWER);
  assert.equal(result.deterministic.sealValid, true);
  assert.ok(arrivals.length > 0);
});

test('an entry that names no content binding is asked for a whole body', async () => {
  const { advocate, seen } = buildAdvocate({ script: [ANSWER] });
  const result = await advocate.ask({ providerId: 'test', text: 'ask' });

  // Nothing tells this client how to reconstruct the octets a seal over a stream would cover,
  // so it does not ask for one. Spec §3.8.3.
  assert.equal(seen[0]?.body.stream, false);
  assert.equal(result.decision.kind, 'deliver');
  assert.equal(result.deterministic.sealValid, true);
});

test('the non-streamed mode selected deliberately delivers through the whole pipeline', async () => {
  const { advocate, seen } = buildAdvocate({ script: [ANSWER], contentBinding: 'sse-chat-delta-v1' });
  const result = await advocate.ask({
    providerId: 'test',
    text: 'ask',
    transport: 'non_streamed',
  });

  assert.equal(seen[0]?.body.stream, false);
  assert.equal(result.decision.kind, 'deliver');
  assert.equal(result.delivered, ANSWER);
  assert.equal(result.deterministic.sealValid, true);
});

test('the progress hooks carry stage names and a scalar and no content', async () => {
  const { advocate } = buildAdvocate({ script: [ANSWER], contentBinding: 'sse-chat-delta-v1' });
  const stages: ExchangeStage[] = [];
  const arrivals: unknown[] = [];
  await advocate.ask({
    providerId: 'test',
    text: 'What is the capital of Nepal?',
    onStage: (s) => stages.push(s),
    onArrival: (a) => arrivals.push(a),
  });

  // Every stage reported is one the pipeline runs, and the streamed path reports receiving
  // rather than waiting.
  const known: ExchangeStage[] = [
    'checking_standing',
    'awaiting_response',
    'receiving',
    'response_complete',
    'verifying_seal',
    'evaluating_content',
    'resolving_delivery',
    'recording',
    'delivering',
  ];
  assert.deepEqual(
    stages,
    [
      'checking_standing',
      'receiving',
      'response_complete',
      'verifying_seal',
      'evaluating_content',
      'resolving_delivery',
      'recording',
      'delivering',
    ],
  );
  for (const stage of stages) assert.ok(known.includes(stage));

  // That the stages are exactly this closed set of compile-time names, and that every arrival is
  // a number, is the whole content claim for this channel. A substring search for words of the
  // response would be the weaker test and a misleading one: "response" occurs in a stage name.
  // If accumulated text could reach the view the delivery gate would be a stylesheet rather than
  // a fact about data flow, and there is nowhere here for it to travel.
  for (const value of arrivals) {
    assert.equal(typeof value, 'number');
    assert.ok(Number.isFinite(value as number));
  }
});

test('the non-streamed transport reports waiting rather than receiving', async () => {
  const { advocate } = buildAdvocate({
    script: [ANSWER],
    contentBinding: 'sse-chat-delta-v1',
    transportPolicy: { withholdUnverifiedContent: true },
  });
  const stages: ExchangeStage[] = [];
  await advocate.ask({ providerId: 'test', text: 'ask', onStage: (s) => stages.push(s) });

  assert.equal(stages.includes('awaiting_response'), true);
  assert.equal(stages.includes('receiving'), false);
});

test('the transport setting selects the mode and persists across exchanges', async () => {
  const { advocate, seen } = buildAdvocate({ script: [ANSWER], contentBinding: 'sse-chat-delta-v1' });
  assert.equal(advocate.transportSetting.transport, 'streamed');
  assert.equal(advocate.transportSetting.locked, false);

  const set = advocate.setWithholdUnverifiedContent(true);
  assert.equal(set.ok, true);
  assert.equal(set.setting.transport, 'non_streamed');

  await advocate.ask({ providerId: 'test', text: 'ask' });
  assert.equal(seen[0]?.body.stream, false);

  advocate.setWithholdUnverifiedContent(false);
  await advocate.ask({ providerId: 'test', text: 'ask again' });
  assert.equal(seen[1]?.body.stream, true);
});

test('a locked transport setting refuses to change and names who set it', async () => {
  const { advocate, seen } = buildAdvocate({
    script: [ANSWER],
    contentBinding: 'sse-chat-delta-v1',
    transportPolicy: {
      withholdUnverifiedContent: true,
      locked: true,
      lockedBy: 'the profile on this managed device',
    },
  });

  const setting = advocate.transportSetting;
  assert.equal(setting.withholdUnverifiedContent, true);
  assert.equal(setting.locked, true);
  assert.equal(setting.lockedBy, 'the profile on this managed device');

  const attempt = advocate.setWithholdUnverifiedContent(false);
  assert.equal(attempt.ok, false);
  assert.match(attempt.reason ?? '', /managed device/);
  assert.equal(attempt.setting.withholdUnverifiedContent, true);

  await advocate.ask({ providerId: 'test', text: 'ask' });
  assert.equal(seen[0]?.body.stream, false);
});

test('a typical duration is not claimed before there is history for it', async () => {
  const { advocate } = buildAdvocate({ script: [ANSWER], contentBinding: 'sse-chat-delta-v1' });
  assert.equal(advocate.typicalDurationMs('test', 'test-model'), null);

  await advocate.ask({ providerId: 'test', text: 'one' });
  assert.equal(advocate.typicalDurationMs('test', 'test-model'), null);

  await advocate.ask({ providerId: 'test', text: 'two' });
  await advocate.ask({ providerId: 'test', text: 'three' });
  const typical = advocate.typicalDurationMs('test', 'test-model');
  assert.equal(typeof typical, 'number');
  assert.ok((typical ?? -1) >= 0);
  // A different model has its own history, and this one has none.
  assert.equal(advocate.typicalDurationMs('test', 'other-model'), null);
});

test('content after the terminal seal refuses and delivers nothing', async () => {
  const { advocate } = buildAdvocate({
    script: [ANSWER],
    contentBinding: 'sse-chat-delta-v1',
    trailingContent: 'and here is the unsigned part',
  });
  const result = await advocate.ask({ providerId: 'test', text: 'ask' });

  assert.equal(result.decision.kind, 'refuse');
  assert.equal(result.delivered, null);
  assert.equal(
    result.deterministic.findings.some(
      (f) => f.code === 'content_after_terminal_seal' && f.refuses,
    ),
    true,
  );
  // The unsigned trailing bytes are not in what the advocate retained either.
  assert.equal(result.withheldContent?.includes('unsigned part'), false);
  assert.equal(advocate.release('test', result.responseId, 'self').released, false);
});
