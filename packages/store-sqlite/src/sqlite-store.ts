// SQLite adapter for the advocate store port.
//
// Paper: Section 6 ("an operator who never holds a thing cannot be compelled to produce it").
// Provisional: Mechanism 2, Section 2.2 (store segregation).
// One file on the user's device. The port in @airp/core names the rows; this class opens the
// file, applies the schema, and speaks SQL. `raw` is exposed so the load-bearing privacy tests
// can read bytes on disk without going through the port.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  BlockRow,
  CarryoverRow,
  EvidenceRow,
  LedgerRow,
  ResidencyCounts,
  StoreBackend,
  TranscriptRow,
} from '@airp/core';
import { SCHEMA } from './schema.js';

export interface OpenSqliteOptions {
  /** Path to the single on-device file. Use `:memory:` in tests. */
  path: string;
}

export class SqliteStore implements StoreBackend {
  readonly adapterId = 'sqlite';
  readonly location: string;
  /** Concrete handle for tests that must inspect raw rows. Not part of the port. */
  readonly raw: DatabaseSync;

  constructor(opts: OpenSqliteOptions) {
    this.location = opts.path;
    if (opts.path !== ':memory:') mkdirSync(dirname(opts.path), { recursive: true });
    this.raw = new DatabaseSync(opts.path);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec(SCHEMA);
  }

  getMeta(key: string): string | undefined {
    const row = this.raw.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.raw
      .prepare(
        'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  close(): void {
    this.raw.close();
  }

  insertLedgerEntry(row: LedgerRow): void {
    this.raw
      .prepare(
        `INSERT INTO ledger(provider_id, seq, response_id, at, outcome, score,
           evaluator_version, taxonomy_version, flags_json, prev_hash, hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.providerId,
        row.seq,
        row.responseId,
        row.at,
        row.outcome,
        row.score,
        row.evaluatorVersion,
        row.taxonomyVersion,
        JSON.stringify(row.flags),
        row.prevHash,
        row.hash,
      );
  }

  getLedgerHead(providerId: string): LedgerRow | undefined {
    const row = this.raw
      .prepare('SELECT * FROM ledger WHERE provider_id = ? ORDER BY seq DESC LIMIT 1')
      .get(providerId) as Record<string, unknown> | undefined;
    return row ? rowToLedger(row) : undefined;
  }

  listLedgerProviderIds(): string[] {
    const rows = this.raw.prepare('SELECT DISTINCT provider_id AS p FROM ledger').all() as Array<{ p: string }>;
    return rows.map((r) => r.p);
  }

  listLedgerRecent(providerId: string, n: number): LedgerRow[] {
    const rows = this.raw
      .prepare('SELECT * FROM ledger WHERE provider_id = ? ORDER BY seq DESC LIMIT ?')
      .all(providerId, n) as Array<Record<string, unknown>>;
    return rows.map(rowToLedger).reverse();
  }

  listLedgerInWindow(providerId: string, since: string, until: string): LedgerRow[] {
    const rows = this.raw
      .prepare('SELECT * FROM ledger WHERE provider_id = ? AND at >= ? AND at < ? ORDER BY seq')
      .all(providerId, since, until) as Array<Record<string, unknown>>;
    return rows.map(rowToLedger);
  }

  listLedgerOrdered(providerId: string): LedgerRow[] {
    const rows = this.raw
      .prepare('SELECT * FROM ledger WHERE provider_id = ? ORDER BY seq')
      .all(providerId) as Array<Record<string, unknown>>;
    return rows.map(rowToLedger);
  }

  getCarryover(providerId: string): CarryoverRow | undefined {
    const row = this.raw.prepare('SELECT * FROM carryover WHERE provider_id = ?').get(providerId) as
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

  setCarryover(state: CarryoverRow): void {
    this.raw
      .prepare(
        `INSERT INTO carryover(provider_id, multiplier, clean_remaining, set_at) VALUES (?,?,?,?)
         ON CONFLICT(provider_id) DO UPDATE SET multiplier=excluded.multiplier,
           clean_remaining=excluded.clean_remaining, set_at=excluded.set_at`,
      )
      .run(state.providerId, state.multiplier, state.cleanRemaining, state.setAt);
  }

  deleteCarryover(providerId: string): void {
    this.raw.prepare('DELETE FROM carryover WHERE provider_id = ?').run(providerId);
  }

  clearProviderLedger(providerId: string): void {
    this.raw.prepare('DELETE FROM ledger WHERE provider_id = ?').run(providerId);
  }

  upsertBlock(rec: Omit<BlockRow, 'releasedAt' | 'releasedBy'>): void {
    this.raw
      .prepare('INSERT OR REPLACE INTO blocks(provider_id, response_id, authority, raised_at) VALUES (?,?,?,?)')
      .run(rec.providerId, rec.responseId, rec.authority, rec.raisedAt);
  }

  listOpenBlocks(providerId: string): BlockRow[] {
    const rows = this.raw
      .prepare('SELECT * FROM blocks WHERE provider_id = ? AND released_at IS NULL ORDER BY raised_at')
      .all(providerId) as Array<{
      provider_id: string;
      response_id: string;
      authority: BlockRow['authority'];
      raised_at: string;
    }>;
    return rows.map((r) => ({
      providerId: r.provider_id,
      responseId: r.response_id,
      authority: r.authority,
      raisedAt: r.raised_at,
    }));
  }

  releaseBlock(providerId: string, responseId: string, releasedBy: string, at: string): void {
    this.raw
      .prepare('UPDATE blocks SET released_at = ?, released_by = ? WHERE provider_id = ? AND response_id = ?')
      .run(at, releasedBy, providerId, responseId);
  }

  insertTranscript(row: TranscriptRow): void {
    this.raw
      .prepare('INSERT INTO transcripts(id, session_id, provider_id, role, at, sealed) VALUES (?,?,?,?,?,?)')
      .run(row.id, row.sessionId, row.providerId, row.role, row.at, row.sealed);
  }

  listTranscriptSession(sessionId: string): TranscriptRow[] {
    const rows = this.raw
      .prepare(
        'SELECT id, session_id, provider_id, role, at, sealed FROM transcripts WHERE session_id = ? ORDER BY at, rowid',
      )
      .all(sessionId) as Array<{
      id: string;
      session_id: string;
      provider_id: string;
      role: string;
      at: string;
      sealed: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      providerId: r.provider_id,
      role: r.role,
      at: r.at,
      sealed: r.sealed,
    }));
  }

  insertEvidence(row: EvidenceRow): void {
    this.raw
      .prepare('INSERT INTO evidence(ref, response_id, sealed) VALUES (?,?,?)')
      .run(row.ref, row.responseId, row.sealed);
  }

  getEvidence(ref: string): EvidenceRow | undefined {
    const row = this.raw.prepare('SELECT ref, response_id, sealed FROM evidence WHERE ref = ?').get(ref) as
      | { ref: string; response_id: string; sealed: string }
      | undefined;
    if (!row) return undefined;
    return { ref: row.ref, responseId: row.response_id, sealed: row.sealed };
  }

  residencyCounts(): ResidencyCounts {
    const turns = this.raw.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(sealed)),0) AS b FROM transcripts').get() as {
      n: number;
      b: number;
    };
    const ev = this.raw.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(sealed)),0) AS b FROM evidence').get() as {
      n: number;
      b: number;
    };
    return { turns: turns.n, evidenceSpans: ev.n, sealedBytes: turns.b + ev.b };
  }

  getPreferenceSealed(key: string): string | undefined {
    const row = this.raw.prepare('SELECT sealed FROM preferences WHERE key = ?').get(key) as
      | { sealed: string }
      | undefined;
    return row?.sealed;
  }

  setPreferenceSealed(key: string, sealed: string): void {
    this.raw
      .prepare(
        'INSERT INTO preferences(key, sealed) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET sealed = excluded.sealed',
      )
      .run(key, sealed);
  }

  listPreferenceKeys(): string[] {
    const rows = this.raw.prepare('SELECT key FROM preferences ORDER BY key').all() as Array<{ key: string }>;
    return rows.map((r) => r.key);
  }
}

export function openSqliteStore(path: string): SqliteStore {
  return new SqliteStore({ path });
}

function rowToLedger(row: Record<string, unknown>): LedgerRow {
  return {
    seq: row['seq'] as number,
    providerId: row['provider_id'] as string,
    responseId: row['response_id'] as string,
    at: row['at'] as string,
    flags: JSON.parse(row['flags_json'] as string),
    outcome: row['outcome'] as LedgerRow['outcome'],
    score: row['score'] as number,
    evaluatorVersion: row['evaluator_version'] as string,
    taxonomyVersion: row['taxonomy_version'] as string,
    prevHash: row['prev_hash'] as string,
    hash: row['hash'] as string,
  };
}
