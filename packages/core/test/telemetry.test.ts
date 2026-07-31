import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSqliteStore } from '@aidp/store-sqlite';
import { dataPath } from './helpers.js';
import {
  buildExportView,
  canonicalBatch,
  computeRates,
  LedgerStore,
  MasterSecret,
  StandingRegistry,
  TelemetryEmitter,
  TranscriptStore,
} from '@aidp/core';

function fixture(responses: number) {
  const store = openSqliteStore(':memory:');
  const master = MasterSecret.generate();
  const ledger = new LedgerStore(store, master.deriveStoreKey('ledger'));
  const transcripts = new TranscriptStore(store, master.deriveStoreKey('transcript'));
  for (let i = 0; i < responses; i++) {
    const secret = `a private thing the user said number ${i}`;
    transcripts.append({
      sessionId: 's1',
      providerId: 'p1',
      role: 'user',
      at: `2026-07-28T00:00:0${i % 10}.000Z`,
      content: secret,
    });
    const ref = transcripts.putEvidence(`r${i}`, [{ start: 0, end: 6, text: secret.slice(0, 6) }]);
    ledger.append({
      providerId: 'p1',
      responseId: `r${i}`,
      at: `2026-07-28T00:00:0${i % 10}.000Z`,
      flags: i % 4 === 0 ? [{ type: 'sycophancy', severity: 1, evidenceRef: ref }] : [],
      outcome: 'deliver',
      score: 0,
      evaluatorVersion: 'test@1',
      taxonomyVersion: 'v0.1.0',
    });
  }
  return { store, master, ledger, transcripts };
}

test('rates carry counts and no content', () => {
  const { ledger } = fixture(24);
  const rates = computeRates({
    ledger,
    windowStart: '2026-07-27T00:00:00.000Z',
    windowEnd: '2026-07-29T00:00:00.000Z',
    granularityFloor: 20,
  });
  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.evaluatedResponses, 24);
  assert.equal(rates[0]?.flagCounts['sycophancy'], 6);
  assert.equal(rates[0]?.suppressed, false);
  assert.equal(JSON.stringify(rates).includes('private thing'), false);
});

test('a cell below the granularity floor is suppressed rather than reported', () => {
  const { ledger } = fixture(5);
  const rates = computeRates({
    ledger,
    windowStart: '2026-07-27T00:00:00.000Z',
    windowEnd: '2026-07-29T00:00:00.000Z',
    granularityFloor: 20,
  });
  assert.equal(rates[0]?.suppressed, true);
  assert.equal(rates[0]?.incidentRate, null);
});

test('the emitter will not accept a key scoped to any store but the ledger', () => {
  const { ledger, master } = fixture(1);
  const opts = {
    trafficClass: 'consumer',
    granularityFloor: 20,
    evaluatorVersion: 'test@1',
    taxonomyVersion: 'v0.1.0',
    endpoint: null,
  };
  assert.throws(() => new TelemetryEmitter(ledger, master.deriveStoreKey('transcript'), opts));
  assert.doesNotThrow(() => new TelemetryEmitter(ledger, master.deriveStoreKey('ledger'), opts));
});

test('the batch that would cross the wire contains no conversation content', () => {
  const { ledger, master } = fixture(30);
  const emitter = new TelemetryEmitter(ledger, master.deriveStoreKey('ledger'), {
    trafficClass: 'consumer',
    granularityFloor: 20,
    evaluatorVersion: 'test@1',
    taxonomyVersion: 'v0.1.0',
    endpoint: null,
    instanceCredential: 'fixed-for-test',
  });
  const batch = emitter.build('2026-07-27T00:00:00.000Z', '2026-07-29T00:00:00.000Z');
  const wire = canonicalBatch(batch).toString('utf8');
  assert.equal(wire.includes('private thing'), false);
  assert.equal(wire.includes('evidence'), false);
  assert.ok(wire.includes('"evaluatedResponses":30'));
});

test('the canonical batch is stable across key order', () => {
  const { ledger, master } = fixture(21);
  const emitter = new TelemetryEmitter(ledger, master.deriveStoreKey('ledger'), {
    trafficClass: 'consumer',
    granularityFloor: 20,
    evaluatorVersion: 'test@1',
    taxonomyVersion: 'v0.1.0',
    endpoint: null,
    instanceCredential: 'fixed-for-test',
  });
  const a = emitter.build('2026-07-27T00:00:00.000Z', '2026-07-29T00:00:00.000Z');
  const b = emitter.build('2026-07-27T00:00:00.000Z', '2026-07-29T00:00:00.000Z');
  assert.equal(canonicalBatch(a).toString('base64'), canonicalBatch(b).toString('base64'));
});

test('emit with no endpoint configured reports that nothing receives it', async () => {
  const { ledger, master } = fixture(21);
  const emitter = new TelemetryEmitter(ledger, master.deriveStoreKey('ledger'), {
    trafficClass: 'consumer',
    granularityFloor: 20,
    evaluatorVersion: 'test@1',
    taxonomyVersion: 'v0.1.0',
    endpoint: null,
  });
  const result = await emitter.emit('2026-07-27T00:00:00.000Z', '2026-07-29T00:00:00.000Z');
  assert.equal(result.status, 'no_endpoint');
});

test('the export view shows what would leave beside what never does', () => {
  const { ledger, master, transcripts } = fixture(22);
  const batch = new TelemetryEmitter(ledger, master.deriveStoreKey('ledger'), {
    trafficClass: 'consumer',
    granularityFloor: 20,
    evaluatorVersion: 'test@1',
    taxonomyVersion: 'v0.1.0',
    endpoint: null,
  }).build('2026-07-27T00:00:00.000Z', '2026-07-29T00:00:00.000Z');

  const view = buildExportView({ batch, ledger, transcripts, storePath: ':memory:' });
  assert.equal(view.neverLeaves.transcriptTurns, 22);
  assert.equal(view.neverLeaves.evidenceSpans, 22);
  assert.equal(view.neverLeaves.ledgerEntriesByProvider['p1'], 22);
  assert.equal(view.neverLeaves.storePath, ':memory:');
  assert.equal(JSON.stringify(view).includes('private thing'), false);
  assert.ok(view.wouldLeave.bytes > 0);

  const onDisk = buildExportView({
    batch,
    ledger,
    transcripts,
    storePath: '/home/someone/.advocate-public/advocate.sqlite',
  });
  assert.equal(onDisk.neverLeaves.storePath, 'advocate.sqlite');
  assert.equal(JSON.stringify(onDisk).includes('/home/someone'), false);
});

test('the shipped standing document verifies and is jurisdiction scoped', () => {
  const standing = StandingRegistry.loadFromFiles(
    dataPath('standing', 'standing.json'),
    dataPath('standing', 'standing.sig'),
    dataPath('standing', 'standing-body-public.pem'),
  );
  assert.equal(standing.signatureValid, true);
  assert.equal(standing.stateFor('demo.aligned', 'none'), 'good');
  assert.equal(standing.stateFor('demo.companion', 'none'), 'elevated_scrutiny');
  assert.equal(standing.stateFor('demo.excluded', 'none'), 'excluded');
  assert.equal(standing.stateFor('not.in.the.document', 'none'), 'unknown');
});
