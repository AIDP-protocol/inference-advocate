import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openSqliteStore, type SqliteStore } from '@aidp/store-sqlite';
import {
  LedgerStore,
  MasterSecret,
  TranscriptStore,
  type AppendInput,
} from '@aidp/core';
import { repoRoot } from './helpers.js';

function fixture() {
  const store = openSqliteStore(':memory:');
  const master = MasterSecret.generate();
  return {
    store,
    master,
    ledger: new LedgerStore(store, master.deriveStoreKey('ledger')),
    transcripts: new TranscriptStore(store, master.deriveStoreKey('transcript')),
  };
}

test('a store refuses a key scoped to another store', () => {
  const store = openSqliteStore(':memory:');
  const master = MasterSecret.generate();
  assert.throws(() => new LedgerStore(store, master.deriveStoreKey('transcript')));
  assert.throws(() => new TranscriptStore(store, master.deriveStoreKey('ledger')));
});

test('the ledger chains and the chain verifies', () => {
  const { ledger } = fixture();
  for (let i = 0; i < 5; i++) {
    ledger.append({
      providerId: 'p1',
      responseId: `r${i}`,
      at: `2026-07-28T00:0${i}:00.000Z`,
      flags: i % 2 === 0 ? [] : [{ type: 'sycophancy', severity: 1, evidenceRef: `e${i}` }],
      outcome: 'deliver',
      score: i,
      evaluatorVersion: 'test@1',
      taxonomyVersion: 'v0.1.0',
    });
  }
  assert.deepEqual(ledger.verifyChain('p1'), { ok: true });
  assert.equal(ledger.recent('p1', 3).length, 3);
  assert.equal(ledger.head('p1')?.seq, 5);
});

test('rewriting a ledger row breaks the chain at that row', () => {
  const { store, ledger } = fixture();
  for (let i = 0; i < 3; i++) {
    ledger.append({
      providerId: 'p1',
      responseId: `r${i}`,
      at: `2026-07-28T00:0${i}:00.000Z`,
      flags: [],
      outcome: 'deliver',
      score: 0,
      evaluatorVersion: 'test@1',
      taxonomyVersion: 'v0.1.0',
    });
  }
  (store as SqliteStore).raw
    .prepare("UPDATE ledger SET outcome = 'refuse' WHERE seq = 2 AND provider_id = 'p1'")
    .run();
  assert.deepEqual(ledger.verifyChain('p1'), { ok: false, brokenAtSeq: 2 });
});

test('evidence lives under the transcript key and the ledger only holds a reference', () => {
  const { ledger, transcripts, store } = fixture();
  const ref = transcripts.putEvidence('r1', [{ start: 0, end: 5, text: 'hello' }]);
  ledger.append({
    providerId: 'p1',
    responseId: 'r1',
    at: '2026-07-28T00:00:00.000Z',
    flags: [{ type: 'sycophancy', severity: 1, evidenceRef: ref }],
    outcome: 'deliver',
    score: 1,
    evaluatorVersion: 'test@1',
    taxonomyVersion: 'v0.1.0',
  });

  // What the ledger row actually contains, read straight out of the table.
  const row = (store as SqliteStore).raw
    .prepare('SELECT flags_json FROM ledger WHERE provider_id = ?')
    .get('p1') as { flags_json: string };
  assert.equal(row.flags_json.includes('hello'), false);
  assert.equal(row.flags_json.includes(ref), true);

  // And the evidence itself is sealed, so the raw row is not readable either.
  const ev = (store as SqliteStore).raw.prepare('SELECT sealed FROM evidence WHERE ref = ?').get(ref) as {
    sealed: string;
  };
  assert.equal(ev.sealed.includes('hello'), false);
  assert.deepEqual(transcripts.getEvidence(ref), [{ start: 0, end: 5, text: 'hello' }]);
});

test('carryover decays one clean response at a time', () => {
  const { ledger } = fixture();
  ledger.setCarryover({ providerId: 'p1', multiplier: 1, cleanRemaining: 2, setAt: '2026-07-28T00:00:00.000Z' });
  ledger.decayCarryover('p1');
  assert.equal(ledger.getCarryover('p1')?.cleanRemaining, 1);
  ledger.decayCarryover('p1');
  assert.equal(ledger.getCarryover('p1'), undefined);
});

test('resetReputation clears ledger and carryover but leaves open blocks', () => {
  const { ledger, store } = fixture();
  ledger.append({
    providerId: 'p1',
    responseId: 'r1',
    at: '2026-07-28T00:00:00.000Z',
    flags: [{ type: 'sycophancy', severity: 3, evidenceRef: 'e1' }],
    outcome: 'withhold',
    score: 3,
    evaluatorVersion: 'test@1',
    taxonomyVersion: 'v0.1.0',
  });
  ledger.setCarryover({
    providerId: 'p1',
    multiplier: 1,
    cleanRemaining: 5,
    setAt: '2026-07-28T00:00:00.000Z',
  });
  ledger.raiseBlock({
    providerId: 'p1',
    responseId: 'r1',
    authority: 'self_release',
    raisedAt: '2026-07-28T00:00:00.000Z',
  });

  ledger.resetReputation('p1');

  assert.equal(ledger.recent('p1', 10).length, 0);
  assert.equal(ledger.getCarryover('p1'), undefined);
  assert.equal(ledger.openBlocks('p1').length, 1);
  assert.deepEqual(ledger.verifyChain('p1'), { ok: true });

  // Raw rows: ledger gone, carryover gone, block still open.
  const ledgerRows = (store as SqliteStore).raw
    .prepare('SELECT * FROM ledger WHERE provider_id = ?')
    .all('p1');
  assert.equal(ledgerRows.length, 0);
  const carryRows = (store as SqliteStore).raw
    .prepare('SELECT * FROM carryover WHERE provider_id = ?')
    .all('p1');
  assert.equal(carryRows.length, 0);
});

test('a pre-refactor ledger fixture verifies with identical hashes', () => {
  const fixturePath = join(repoRoot, 'packages', 'core', 'test', 'fixtures', 'ledger-chain-prerefactor.json');
  const captured = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    providerId: string;
    appendInputs: AppendInput[];
    entries: Array<{ seq: number; prevHash: string; hash: string; score: number }>;
    verifyChain: { ok: true };
    hashEntryGoldens: string[];
  };

  for (let i = 0; i < captured.entries.length; i++) {
    const input = captured.appendInputs[i]!;
    const expected = captured.entries[i]!;
    const hash = LedgerStore.hashEntry({
      ...input,
      seq: expected.seq,
      prevHash: expected.prevHash,
    });
    assert.equal(hash, expected.hash, `hashEntry mismatch at seq ${expected.seq}`);
  }

  const store = openSqliteStore(':memory:');
  const ledger = new LedgerStore(store, MasterSecret.generate().deriveStoreKey('ledger'));
  const written = captured.appendInputs.map((input) => ledger.append(input));
  for (let i = 0; i < written.length; i++) {
    assert.equal(written[i]!.hash, captured.entries[i]!.hash, `append hash mismatch at seq ${i + 1}`);
    assert.equal(written[i]!.prevHash, captured.entries[i]!.prevHash);
  }
  assert.deepEqual(ledger.verifyChain(captured.providerId), captured.verifyChain);
  assert.equal(LedgerStore.hashEntry({
    providerId: 'fixture-p',
    seq: 1,
    responseId: 'r0',
    at: '2026-07-28T00:00:00.000Z',
    flags: [],
    outcome: 'deliver',
    score: 0,
    prevHash: '0'.repeat(64),
  }), captured.hashEntryGoldens[0]);
  store.close();
});
