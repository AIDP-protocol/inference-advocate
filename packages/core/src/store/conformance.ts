// Adapter conformance suite. Any StoreBackend must satisfy these behaviors.
//
// Paper: step 9 and Provisional Mechanism 2. Exported so a second adapter can be checked
// against the same assertions the SQLite adapter already passes. Not a substitute for the
// raw-byte tests that inspect SQLite rows on disk; those stay against the concrete adapter.

import assert from 'node:assert/strict';
import { MasterSecret } from '../crypto/keys.js';
import { LedgerStore } from './ledger.js';
import { PreferenceStore } from './preferences.js';
import { TranscriptStore } from './transcripts.js';
import type { StoreBackend } from './port.js';

export type StoreFactory = () => StoreBackend;

/**
 * Run behavioral assertions every adapter must satisfy. The factory opens a fresh empty store
 * for each logical group; callers typically pass `() => openSqliteStore(':memory:')`.
 */
export function runStoreConformance(create: StoreFactory): void {
  metaRoundTrip(create());
  keyScopeGuards(create());
  ledgerChains(create());
  carryoverAndBlocks(create());
  evidenceStaysOutOfLedgerFlags(create());
  preferencesRoundTrip(create());
}

function metaRoundTrip(store: StoreBackend): void {
  assert.equal(store.getMeta('missing'), undefined);
  store.setMeta('k', 'v1');
  assert.equal(store.getMeta('k'), 'v1');
  store.setMeta('k', 'v2');
  assert.equal(store.getMeta('k'), 'v2');
  assert.ok(store.adapterId.length > 0);
  assert.ok(store.location.length > 0);
  store.close();
}

function keyScopeGuards(store: StoreBackend): void {
  const master = MasterSecret.generate();
  assert.throws(() => new LedgerStore(store, master.deriveStoreKey('transcript')));
  assert.throws(() => new TranscriptStore(store, master.deriveStoreKey('ledger')));
  assert.throws(() => new PreferenceStore(store, master.deriveStoreKey('ledger')));
  store.close();
}

function ledgerChains(store: StoreBackend): void {
  const ledger = new LedgerStore(store, MasterSecret.generate().deriveStoreKey('ledger'));
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
  assert.deepEqual(ledger.providerIds(), ['p1']);
  assert.equal(ledger.entriesInWindow('p1', '2026-07-28T00:01:00.000Z', '2026-07-28T00:04:00.000Z').length, 3);
  store.close();
}

function carryoverAndBlocks(store: StoreBackend): void {
  const ledger = new LedgerStore(store, MasterSecret.generate().deriveStoreKey('ledger'));
  ledger.setCarryover({ providerId: 'p1', multiplier: 1, cleanRemaining: 2, setAt: '2026-07-28T00:00:00.000Z' });
  ledger.decayCarryover('p1');
  assert.equal(ledger.getCarryover('p1')?.cleanRemaining, 1);
  ledger.decayCarryover('p1');
  assert.equal(ledger.getCarryover('p1'), undefined);

  ledger.raiseBlock({
    providerId: 'p1',
    responseId: 'r-block',
    authority: 'self_release',
    raisedAt: '2026-07-28T00:00:00.000Z',
  });
  assert.equal(ledger.openBlocks('p1').length, 1);
  ledger.releaseBlock('p1', 'r-block', 'self', '2026-07-28T00:01:00.000Z');
  assert.equal(ledger.openBlocks('p1').length, 0);

  ledger.append({
    providerId: 'p1',
    responseId: 'r-acc',
    at: '2026-07-28T00:02:00.000Z',
    flags: [{ type: 'sycophancy', severity: 2, evidenceRef: 'e-acc' }],
    outcome: 'withhold',
    score: 2,
    evaluatorVersion: 'test@1',
    taxonomyVersion: 'v0.1.0',
  });
  ledger.setCarryover({
    providerId: 'p1',
    multiplier: 1,
    cleanRemaining: 5,
    setAt: '2026-07-28T00:02:00.000Z',
  });
  ledger.raiseBlock({
    providerId: 'p1',
    responseId: 'r-acc',
    authority: 'self_release',
    raisedAt: '2026-07-28T00:02:00.000Z',
  });
  ledger.resetReputation('p1');
  assert.equal(ledger.recent('p1', 10).length, 0);
  assert.equal(ledger.getCarryover('p1'), undefined);
  assert.equal(ledger.openBlocks('p1').length, 1, 'reset leaves open blocks for release');
  assert.deepEqual(ledger.verifyChain('p1'), { ok: true });
  store.close();
}

function evidenceStaysOutOfLedgerFlags(store: StoreBackend): void {
  const master = MasterSecret.generate();
  const ledger = new LedgerStore(store, master.deriveStoreKey('ledger'));
  const transcripts = new TranscriptStore(store, master.deriveStoreKey('transcript'));
  const secret = 'conversation words that must not appear in ledger flags';
  const ref = transcripts.putEvidence('r1', [{ start: 0, end: 5, text: secret.slice(0, 5) }]);
  const entry = ledger.append({
    providerId: 'p1',
    responseId: 'r1',
    at: '2026-07-28T00:00:00.000Z',
    flags: [{ type: 'sycophancy', severity: 1, evidenceRef: ref }],
    outcome: 'deliver',
    score: 1,
    evaluatorVersion: 'test@1',
    taxonomyVersion: 'v0.1.0',
  });
  assert.equal(JSON.stringify(entry.flags).includes(secret), false);
  assert.equal(entry.flags[0]?.evidenceRef, ref);
  assert.deepEqual(transcripts.getEvidence(ref)?.[0]?.text, secret.slice(0, 5));
  const residency = transcripts.residencySummary();
  assert.equal(residency.evidenceSpans, 1);
  assert.ok(residency.sealedBytes > 0);
  store.close();
}

function preferencesRoundTrip(store: StoreBackend): void {
  const prefs = new PreferenceStore(store, MasterSecret.generate().deriveStoreKey('preference'));
  prefs.set('theme', { mode: 'light' });
  assert.deepEqual(prefs.get('theme'), { mode: 'light' });
  assert.deepEqual(prefs.keys(), ['theme']);
  store.close();
}
