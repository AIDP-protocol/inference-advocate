// Per-provider ledger. Append only, hash chained, local.
//
// Paper: step 9 ("one individual user's history with one provider, held locally, for them").
// Provisional: Sections 1.7 (persistence and tamper resistance) and 1.8 (carryover).
// The ledger holds flag types, severities, outcomes and scores. It does not hold conversation
// content. Evidence is referenced by an opaque ref into the transcript store, which is under a
// different key. A component holding only the ledger key sees that a sycophancy flag of
// severity 1 occurred at a time, and cannot see a single word of what was said.

import { sha256Hex } from '../crypto/sha256.js';
import type { StoreKey } from '../crypto/keys.js';
import type { DeliveryOutcomeKind, LedgerEntry, LedgerFlag, ReleaseAuthority } from '../types.js';
import type { StoreBackend } from './port.js';

export interface AppendInput {
  providerId: string;
  responseId: string;
  at: string;
  flags: LedgerFlag[];
  outcome: DeliveryOutcomeKind;
  score: number;
  evaluatorVersion: string;
  taxonomyVersion: string;
}

export interface CarryoverState {
  providerId: string;
  multiplier: number;
  cleanRemaining: number;
  setAt: string;
}

export interface BlockRecord {
  providerId: string;
  responseId: string;
  authority: ReleaseAuthority;
  raisedAt: string;
  releasedAt?: string;
  releasedBy?: string;
}

/** The read surface the telemetry emitter is given. Rates and counts, nothing else. */
export interface LedgerReader {
  entriesInWindow(providerId: string, since: string, until: string): LedgerEntry[];
  providerIds(): string[];
  recent(providerId: string, n: number): LedgerEntry[];
}

const GENESIS = '0'.repeat(64);

export class LedgerStore implements LedgerReader {
  readonly #store: StoreBackend;

  constructor(store: StoreBackend, key: StoreKey) {
    if (key.store !== 'ledger') throw new Error('LedgerStore requires the ledger key');
    this.#store = store;
  }

  static hashEntry(input: {
    providerId: string;
    seq: number;
    responseId: string;
    at: string;
    flags: LedgerFlag[];
    outcome: string;
    score: number;
    prevHash: string;
  }): string {
    const canonical = [
      'aidp-ledger/v1',
      input.providerId,
      String(input.seq),
      input.responseId,
      input.at,
      input.outcome,
      input.score.toFixed(4),
      input.flags.map((f) => `${f.type}:${f.severity}:${f.evidenceRef}`).join(','),
      input.prevHash,
    ].join('\n');
    return sha256Hex(canonical);
  }

  append(input: AppendInput): LedgerEntry {
    const head = this.head(input.providerId);
    const seq = (head?.seq ?? 0) + 1;
    const prevHash = head?.hash ?? GENESIS;
    const hash = LedgerStore.hashEntry({ ...input, seq, prevHash });
    const entry: LedgerEntry = { ...input, seq, prevHash, hash };
    this.#store.insertLedgerEntry(entry);
    return entry;
  }

  head(providerId: string): LedgerEntry | undefined {
    return this.#store.getLedgerHead(providerId);
  }

  providerIds(): string[] {
    return this.#store.listLedgerProviderIds();
  }

  /** Count-based window: the trailing N evaluated responses. Provisional Section 1.3. */
  recent(providerId: string, n: number): LedgerEntry[] {
    return this.#store.listLedgerRecent(providerId, n);
  }

  /** Time-based window. Provisional Section 1.3. */
  entriesInWindow(providerId: string, since: string, until: string): LedgerEntry[] {
    return this.#store.listLedgerInWindow(providerId, since, until);
  }

  /**
   * Walk the chain and report the first break. A ledger that has been rewritten locally
   * fails here. Anchoring the chain head outside the user's unilateral control is disclosed
   * in the provisional and is not implemented at reference stage; see ARCHITECTURE.md.
   */
  verifyChain(providerId: string): { ok: true } | { ok: false; brokenAtSeq: number } {
    const rows = this.#store.listLedgerOrdered(providerId);
    let prev = GENESIS;
    for (const e of rows) {
      if (e.prevHash !== prev) return { ok: false, brokenAtSeq: e.seq };
      const expect = LedgerStore.hashEntry({ ...e, prevHash: prev });
      if (expect !== e.hash) return { ok: false, brokenAtSeq: e.seq };
      prev = e.hash;
    }
    return { ok: true };
  }

  // Carryover, provisional Section 1.8.

  getCarryover(providerId: string): CarryoverState | undefined {
    return this.#store.getCarryover(providerId);
  }

  setCarryover(state: CarryoverState): void {
    this.#store.setCarryover(state);
  }

  /** A clean response decays the carryover by one. At zero the modifier is removed. */
  decayCarryover(providerId: string): void {
    const c = this.getCarryover(providerId);
    if (!c) return;
    if (c.cleanRemaining <= 1) {
      this.#store.deleteCarryover(providerId);
      return;
    }
    this.setCarryover({ ...c, cleanRemaining: c.cleanRemaining - 1 });
  }

  /**
   * Wipe rolling-window accumulation and carryover for a provider. Reference/demo only: the
   * paper's path is decay through clean responses (Section 1.8). Does not release open blocks
   * and does not touch the transcript.
   */
  resetReputation(providerId: string): void {
    this.#store.clearProviderLedger(providerId);
    this.#store.deleteCarryover(providerId);
  }

  // Blocks, provisional Sections 1.5 and 1.8.

  raiseBlock(rec: Omit<BlockRecord, 'releasedAt' | 'releasedBy'>): void {
    this.#store.upsertBlock(rec);
  }

  openBlocks(providerId: string): BlockRecord[] {
    return this.#store.listOpenBlocks(providerId);
  }

  releaseBlock(providerId: string, responseId: string, releasedBy: string, at: string): void {
    this.#store.releaseBlock(providerId, responseId, releasedBy, at);
  }
}
