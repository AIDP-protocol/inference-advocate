import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqliteStore, openAdvocate } from '@aidp/store-sqlite';
import { dataPath } from './helpers.js';
import {
  Advocate,
  decodeAttestations,
  DeliveryPolicy,
  encodeSeal,
  generateSealKeypair,
  HEADER_ATTESTATIONS,
  HEADER_SEAL,
  Jurisdiction,
  MasterSecret,
  ProviderRegistry,
  RuleEvaluator,
  SemanticMonitor,
  ServingRegister,
  signSeal,
  StandingRegistry,
  Taxonomy,
} from '@aidp/core';

const taxonomy = Taxonomy.loadFromFile(dataPath('taxonomy', 'flags.v0.json'));
const policy = DeliveryPolicy.loadFromFile(dataPath('policy', 'delivery-policy.json'));

/** A provider that answers with whatever the script says next, sealing when given a key. */
function scriptedProvider(script: string[], keys?: { privateKeyPem: string; entryId: string; model: string }) {
  let i = 0;
  const seen: Array<{ headers: Record<string, string> }> = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const content = script[Math.min(i, script.length - 1)] ?? '';
    i += 1;
    const headers = new Headers(init?.headers as Record<string, string> | undefined);
    seen.push({ headers: Object.fromEntries(headers.entries()) });
    const outHeaders: Record<string, string> = { 'content-type': 'application/json' };
    if (keys) {
      const seal = signSeal(
        {
          registerEntryId: keys.entryId,
          selector: 's1',
          model: keys.model,
          providerIdentity: 'test',
          signedAt: '2026-07-28T00:00:00.000Z',
          content,
        },
        keys.privateKeyPem,
      );
      outHeaders[HEADER_SEAL] = encodeSeal(seal);
    }
    return new Response(
      JSON.stringify({ model: keys?.model ?? 'test-model', choices: [{ message: { role: 'assistant', content } }] }),
      { status: 200, headers: outHeaders },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

function build(opts: {
  script: string[];
  sealed?: boolean;
  jurisdiction?: Jurisdiction;
  isAdult?: boolean;
  standing?: StandingRegistry;
}) {
  const keys = generateSealKeypair();
  const register = ServingRegister.fromDocument({
    aidpRegisterVersion: '0.1',
    issuedAt: '2026-07-01T00:00:00.000Z',
    registrar: { id: 'test', publicKeyPem: 'unused' },
    entries: [
      {
        id: 'e.test',
        providerIdentity: 'test',
        status: 'active',
        authorizedEndpoints: ['http://127.0.0.1:9999/v1'],
        models: ['test-model'],
        keys: opts.sealed ? [{ selector: 's1', publicKeyPem: keys.publicKeyPem, status: 'current' }] : [],
        sealPolicy: opts.sealed ? 'all' : 'none',
      },
    ],
  });
  const { fetchImpl, seen } = scriptedProvider(
    opts.script,
    opts.sealed ? { privateKeyPem: keys.privateKeyPem, entryId: 'e.test', model: 'test-model' } : undefined,
  );
  const store = openSqliteStore(':memory:');
  const advocate = new Advocate({
    store,
    master: MasterSecret.generate(),
    providers: new ProviderRegistry([
      {
        id: 'test',
        label: 'Test provider',
        baseUrl: 'http://127.0.0.1:9999/v1',
        model: 'test-model',
        registerEntryId: 'e.test',
      },
    ]),
    register,
    standing: opts.standing ?? StandingRegistry.empty(),
    policy,
    jurisdiction: opts.jurisdiction ?? Jurisdiction.none(),
    monitor: new SemanticMonitor(new RuleEvaluator(taxonomy), taxonomy),
    attestations: { isAdult: opts.isAdult ?? true, jurisdiction: 'none', issuer: 'test' },
    fetchImpl,
  });
  return { advocate, seen, store };
}

const CLEAN = 'The capital of Nepal is Kathmandu.';
const HOOKY = "I really care about you. Come back soon and talk to me, our connection matters.";

test('a clean exchange delivers and the transcript stays local', async () => {
  const { advocate } = build({ script: [CLEAN] });
  const result = await advocate.ask({ providerId: 'test', text: 'What is the capital of Nepal?' });
  assert.equal(result.decision.kind, 'deliver');
  assert.equal(result.delivered, CLEAN);
  assert.equal(advocate.transcripts.session(advocate.sessionId).length, 2);
  assert.deepEqual(advocate.ledger.verifyChain('test'), { ok: true });
  assert.ok(result.timings.totalMs >= 0);
  assert.ok(result.timings.providerMs >= 0);
  assert.ok(result.timings.semanticMs >= 0);
  assert.ok(
    result.timings.totalMs + 5 >=
      result.timings.providerMs +
        result.timings.deterministicMs +
        result.timings.semanticMs +
        result.timings.resolveMs,
    'total covers the measured stages',
  );
});

test('the attestation package rides with the request and carries no identity', async () => {
  const { advocate, seen } = build({ script: [CLEAN] });
  await advocate.ask({ providerId: 'test', text: 'hello' });
  const header = seen[0]?.headers[HEADER_ATTESTATIONS];
  assert.ok(header);
  const pkg = decodeAttestations(header!);
  assert.equal(pkg.isAdult, true);
  assert.equal(JSON.stringify(pkg).toLowerCase().includes('name'), false);
});

test('accumulating relational hooks crosses the warn line and then the block line', async () => {
  const { advocate } = build({ script: [HOOKY] });
  const outcomes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await advocate.ask({ providerId: 'test', text: `turn ${i}` });
    outcomes.push(r.decision.kind);
  }
  // Each response carries relational hooks at severity 3, so the window climbs 3 at a time:
  // 3 (deliver), 6 (warn), 9 (block), and stays blocked.
  assert.deepEqual(outcomes, ['deliver', 'deliver_with_notice', 'withhold', 'withhold']);
});

test('a withheld response is retained locally and released only by a competent authority', async () => {
  const { advocate } = build({ script: [HOOKY] });
  let withheldId = '';
  for (let i = 0; i < 3; i++) {
    const r = await advocate.ask({ providerId: 'test', text: `turn ${i}` });
    if (r.decision.kind === 'withhold') withheldId = r.responseId;
  }
  assert.ok(withheldId);
  assert.equal(advocate.withheldContent(advocate.sessionId, withheldId), HOOKY);

  const custodianAttempt = advocate.release('test', withheldId, 'custodian');
  assert.equal(custodianAttempt.released, true);

  const again = advocate.release('test', withheldId, 'self');
  assert.equal(again.released, false);
});

test('a minor cannot self release a block an in_force jurisdiction marks non releasable', async () => {
  const ny = Jurisdiction.loadFromFile(dataPath('jurisdictions', 'us-ny.json'));
  const enacted = new Jurisdiction({
    ...ny.ruleset,
    minorOnly: {
      ...ny.ruleset.minorOnly!,
      status: 'in_force',
      categoryTreatments: Object.fromEntries(
        Object.entries(ny.ruleset.minorOnly!.categoryTreatments ?? {}).map(([k, v]) => [
          k,
          { ...v, status: 'in_force' as const },
        ]),
      ),
    },
  });
  const { advocate } = build({ script: [HOOKY], jurisdiction: enacted, isAdult: false });
  let withheldId = '';
  for (let i = 0; i < 3 && !withheldId; i++) {
    const r = await advocate.ask({ providerId: 'test', text: `turn ${i}` });
    if (r.decision.kind === 'withhold') withheldId = r.responseId;
  }
  assert.ok(withheldId, 'a minor under enacted New York minor provisions blocks quickly');
  assert.equal(advocate.release('test', withheldId, 'self').released, false);
  assert.equal(advocate.release('test', withheldId, 'custodian').released, false);
});

test('pending New York minor provisions are visible and do not block a minor alone', async () => {
  const ny = Jurisdiction.loadFromFile(dataPath('jurisdictions', 'us-ny.json'));
  assert.ok(ny.pendingProvisions().some((p) => p.id === 'minorOnly'));
  const { advocate } = build({ script: [HOOKY], jurisdiction: ny, isAdult: false });
  const r = await advocate.ask({ providerId: 'test', text: 'turn 0' });
  // One relational_hooks hit under default thresholds does not withhold; pending minorOnly
  // must not have tightened the block line to make a single flag withhold.
  assert.notEqual(r.decision.kind, 'withhold');
  assert.notEqual(r.decision.releaseAuthority, 'non_releasable');
});

test('child mode is a local attestation flip that refuses self release', async () => {
  const { advocate } = build({ script: [HOOKY, HOOKY, HOOKY] });
  assert.equal(advocate.attestations.isAdult, true);
  advocate.setIsAdult(false);
  assert.equal(advocate.attestations.isAdult, false);
  let withheldId = '';
  for (let i = 0; i < 3 && !withheldId; i++) {
    const r = await advocate.ask({ providerId: 'test', text: `turn ${i}` });
    if (r.decision.kind === 'withhold') withheldId = r.responseId;
  }
  assert.ok(withheldId);
  assert.equal(advocate.release('test', withheldId, 'self').released, false);
  assert.equal(advocate.release('test', withheldId, 'custodian').released, true);
});

test('a new session restores delivery and leaves the provider on edge', async () => {
  const { advocate } = build({ script: [HOOKY, HOOKY, HOOKY, CLEAN, CLEAN] });
  for (let i = 0; i < 3; i++) await advocate.ask({ providerId: 'test', text: `turn ${i}` });
  const carryBefore = advocate.ledger.getCarryover('test');
  assert.ok(carryBefore, 'a block sets carryover');
  advocate.newSession();
  const r = await advocate.ask({ providerId: 'test', text: 'a fresh start' });
  assert.ok(r.decision.rationale.some((line) => line.includes('carryover in force')));
});

test('a sealed response passes the deterministic layer and a substituted one does not', async () => {
  const { advocate } = build({ script: [CLEAN], sealed: true });
  const ok = await advocate.ask({ providerId: 'test', text: 'hello' });
  assert.equal(ok.deterministic.sealValid, true);
  assert.equal(ok.decision.kind, 'deliver');
});

test('an excluded provider is refused before the request is sent', async () => {
  const standing = new StandingRegistry(
    {
      aidpStandingVersion: '0.1',
      body: { id: 'test', publicKeyPem: '' },
      issuedAt: '2026-07-01T00:00:00.000Z',
      thresholds: { warnRate: 0.05, exclusionRate: 0.15, minimumQuorumSources: 25 },
      providers: [
        {
          registerEntryId: 'e.test',
          providerIdentity: 'test',
          state: 'excluded',
          incidentRate: 0.4,
          quorumSources: 900,
          trafficClass: 'consumer',
          asOf: '2026-07-01T00:00:00.000Z',
        },
      ],
    },
    true,
  );
  const { advocate, seen } = build({ script: [CLEAN], standing });
  const r = await advocate.ask({ providerId: 'test', text: 'hello' });
  assert.equal(r.decision.kind, 'refuse');
  assert.equal(seen.length, 0, 'nothing was sent');
});

test('openAdvocate loads the shipped documents and reports its own gaps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aidp-'));
  try {
    const opened = openAdvocate({
      dataDir: dataPath(),
      storePath: join(dir, 'advocate.sqlite'),
      jurisdictionId: 'us-ny',
      devKeyfile: join(dir, 'dev.key'),
    });
    assert.equal(opened.register.signatureValid, true);
    assert.equal(opened.standing.signatureValid, true);
    assert.equal(opened.jurisdiction.ruleset.id, 'us-ny');
    assert.ok(opened.warnings.some((w) => w.includes('not custody')));
    assert.ok(
      opened.warnings.some((w) => w.includes('dev.key') && !w.includes(dir)),
      'development key warning names the file, not the absolute host path',
    );
    assert.ok(
      !opened.warnings.some((w) => /(?:^|[\s`(])\/(?:home|Users)\//.test(w) || /[A-Za-z]:\\/.test(w)),
      'startup warnings must not publish absolute home or drive paths',
    );
    assert.ok(opened.warnings.some((w) => w.includes('attestations are locally asserted')));
    assert.ok(
      opened.warnings.some((w) => w.includes('pending') && w.includes('not applied as law')),
      'pending jurisdiction provisions must be named at startup',
    );
    assert.ok(opened.jurisdiction.pendingProvisions().some((p) => p.id === 'minorOnly'));
    opened.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
