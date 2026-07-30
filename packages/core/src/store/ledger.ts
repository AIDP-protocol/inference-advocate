// Per-provider ledger. Append only, hash chained, local.
//
// Paper: step 9 ("one individual user's history with one provider, held locally, for them").
// Provisional: Sections 1.7 (persistence and tamper resistance) and 1.8 (carryover).
// The ledger holds flag types, severities, outcomes and scores. It does not hold conversation
// content. Evidence is referenced by an opaque ref into the transcript store, which is under a
// different key. A component holding only the ledger key sees that a sycophancy flag of
// severity 1 occurred at a time, and cannot see a single word of what was said.

import { createHash } from 'node:crypto';
import type { AdvocateDb } from './db.js';
import type { StoreKey } from '../crypto/keys.js';
import type { DeliveryOutcomeKind, LedgerEntry, LedgerFlag, ReleaseAuthority } from '../types.js';

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
  readonly #db: AdvocateDb;

  constructor(db: AdvocateDb, key: StoreKey) {
    if (key.store !== 'ledger') throw new Error('LedgerStore requires the ledger key');
    this.#db = db;
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
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  append(input: AppendInput): LedgerEntry {
    const head = this.head(input.providerId);
    const seq = (head?.seq ?? 0) + 1;
    const prevHash = head?.hash ?? GENESIS;
    const hash = LedgerStore.hashEntry({ ...input, seq, prevHash });
    this.#db.raw
      .prepare(
        `INSERT INTO ledger(provider_id, seq, response_id, at, outcome, score,
           evaluator_version, taxonomy_version, flags_json, prev_hash, hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.providerId,
        seq,
        input.responseId,
        input.at,
        input.outcome,
        input.score,
        input.evaluatorVersion,
        input.taxonomyVersion,
        JSON.stringify(input.flags),
        prevHash,
        hash,
      );
    return { ...input, seq, prevHash, hash };
  }

  head(providerId: string): LedgerEntry | undefined {
    const row = this.#db.raw
      .prepare('SELECT * FROM ledger WHERE provider_id = ? ORDER BY seq DESC LIMIT 1')
      .get(providerId) as Record<string, unknown> | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  providerIds(): string[] {
    const rows = this.#db.raw.prepare('SELECT DISTINCT provider_id AS p FROM ledger').all() as Array<{ p: string }>;
    return rows.map((r) => r.p);
  }

  /** Count-based window: the trailing N evaluated responses. Provisional Section 1.3. */
  recent(providerId: string, n: number): LedgerEntry[] {
    const rows = this.#db.raw
      .prepare('SELECT * FROM ledger WHERE provider_id = ? ORDER BY seq DESC LIMIT ?')
      .all(providerId, n) as Array<Record<string, unknown>>;
    return rows.map(rowToEntry).reverse();
  }

  /** Time-based window. Provisional Section 1.3. */
  entriesInWindow(providerId: string, since: string, until: string): LedgerEntry[] {
    const rows = this.#db.raw
      .prepare('SELECT * FROM ledger WHERE provider_id = ? AND at >= ? AND at < ? ORDER BY seq')
      .all(providerId, since, until) as Array<Record<string, unknown>>;
    return rows.map(rowToEntry);
  }

  /**
   * Walk the chain and report the first break. A ledger that has been rewritten locally
   * fails here. Anchoring the chain head outside the user's unilateral control is disclosed
   * in the provisional and is not implemented at reference stage; see ARCHITECTURE.md.
   */
  verifyChain(providerId: string): { ok: true } | { ok: false; brokenAtSeq: number } {
    const rows = this.#db.raw
      .prepare('SELECT * FROM ledger WHERE provider_id = ? ORDER BY seq')
      .all(providerId) as Array<Record<string, unknown>>;
    let prev = GENESIS;
    for (const row of rows) {
      const e = rowToEntry(row);
      if (e.prevHash !== prev) return { ok: false, brokenAtSeq: e.seq };
      const expect = LedgerStore.hashEntry({ ...e, prevHash: prev });
      if (expect !== e.hash) return { ok: false, brokenAtSeq: e.seq };
      prev = e.hash;
    }
    return { ok: true };
  }

  // Carryover, provisional Section 1.8.

  getCarryover(providerId: string): CarryoverState | undefined {
    const row = this.#db.raw.prepare('SELECT * FROM carryover WHERE provider_id = ?').get(providerId) as
      | { provider_id: string; multiplier: number; clean_remaining: number; set_at: string }
      | undefined;
    if (!row) return undefined;
    return {
      providerId: row.provider_id,
      multiplier: row.multiplier,
      cleanRemaining: row.clean_remaining,
      setAt: row.set_at,
    };
  }

  setCarryover(state: CarryoverState): void {
    this.#db.raw
      .prepare(
        `INSERT INTO carryover(provider_id, multiplier, clean_remaining, set_at) VALUES (?,?,?,?)
         ON CONFLICT(provider_id) DO UPDATE SET multiplier=excluded.multiplier,
           clean_remaining=excluded.clean_remaining, set_at=excluded.set_at`,
      )
      .run(state.providerId, state.multiplier, state.cleanRemaining, state.setAt);
  }

  /** A clean response decays the carryover by one. At zero the modifier is removed. */
  decayCarryover(providerId: string): void {
    const c = this.getCarryover(providerId);
    if (!c) return;
    if (c.cleanRemaining <= 1) {
      this.#db.raw.prepare('DELETE FROM carryover WHERE provider_id = ?').run(providerId);
      return;
    }
    this.setCarryover({ ...c, cleanRemaining: c.cleanRemaining - 1 });
  }

  // Blocks, provisional Sections 1.5 and 1.8.

  raiseBlock(rec: Omit<BlockRecord, 'releasedAt' | 'releasedBy'>): void {
    this.#db.raw
      .prepare('INSERT OR REPLACE INTO blocks(provider_id, response_id, authority, raised_at) VALUES (?,?,?,?)')
      .run(rec.providerId, rec.responseId, rec.authority, rec.raisedAt);
  }

  openBlocks(providerId: string): BlockRecord[] {
    const rows = this.#db.raw
      .prepare('SELECT * FROM blocks WHERE provider_id = ? AND released_at IS NULL ORDER BY raised_at')
      .all(providerId) as Array<{
      provider_id: string;
      response_id: string;
      authority: string;
      raised_at: string;
    }>;
    return rows.map((r) => ({
      providerId: r.provider_id,
      responseId: r.response_id,
      authority: r.authority as ReleaseAuthority,
      raisedAt: r.raised_at,
    }));
  }

  releaseBlock(providerId: string, responseId: string, releasedBy: string, at: string): void {
    this.#db.raw
      .prepare('UPDATE blocks SET released_at = ?, released_by = ? WHERE provider_id = ? AND response_id = ?')
      .run(at, releasedBy, providerId, responseId);
  }
}

function rowToEntry(row: Record<string, unknown>): LedgerEntry {
  return {
    seq: row['seq'] as number,
    providerId: row['provider_id'] as string,
    responseId: row['response_id'] as string,
    at: row['at'] as string,
    flags: JSON.parse(row['flags_json'] as string) as LedgerFlag[],
    outcome: row['outcome'] as DeliveryOutcomeKind,
    score: row['score'] as number,
    evaluatorVersion: row['evaluator_version'] as string,
    taxonomyVersion: row['taxonomy_version'] as string,
    prevHash: row['prev_hash'] as string,
    hash: row['hash'] as string,
  };
}
