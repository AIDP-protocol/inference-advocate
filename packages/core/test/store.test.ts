import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdvocateDb } from '../src/store/db.js';
import { MasterSecret } from '../src/crypto/keys.js';
import { LedgerStore } from '../src/store/ledger.js';
import { TranscriptStore } from '../src/store/transcripts.js';

function fixture() {
  const db = new AdvocateDb({ path: ':memory:' });
  const master = MasterSecret.generate();
  return {
    db,
    master,
    ledger: new LedgerStore(db, master.deriveStoreKey('ledger')),
    transcripts: new TranscriptStore(db, master.deriveStoreKey('transcript')),
  };
}

test('a store refuses a key scoped to another store', () => {
  const db = new AdvocateDb({ path: ':memory:' });
  const master = MasterSecret.generate();
  assert.throws(() => new LedgerStore(db, master.deriveStoreKey('transcript')));
  assert.throws(() => new TranscriptStore(db, master.deriveStoreKey('ledger')));
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
  const { db, ledger } = fixture();
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
  db.raw.prepare("UPDATE ledger SET outcome = 'refuse' WHERE seq = 2 AND provider_id = 'p1'").run();
  assert.deepEqual(ledger.verifyChain('p1'), { ok: false, brokenAtSeq: 2 });
});

test('evidence lives under the transcript key and the ledger only holds a reference', () => {
  const { ledger, transcripts, db } = fixture();
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
  const row = db.raw.prepare('SELECT flags_json FROM ledger WHERE provider_id = ?').get('p1') as { flags_json: string };
  assert.equal(row.flags_json.includes('hello'), false);
  assert.equal(row.flags_json.includes(ref), true);

  // And the evidence itself is sealed, so the raw row is not readable either.
  const ev = db.raw.prepare('SELECT sealed FROM evidence WHERE ref = ?').get(ref) as { sealed: string };
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
