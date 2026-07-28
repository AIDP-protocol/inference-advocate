// Transcript store. Conversation content and the evidence spans derived from it.
//
// Paper: step 9. Provisional: Section 2.2 (store segregation).
// Holds the transcript key. Nothing that talks to the network is given this object.

import { randomUUID } from 'node:crypto';
import type { AdvocateDb } from './db.js';
import type { StoreKey } from '../crypto/keys.js';
import type { EvidenceSpan, Message } from '../types.js';

export interface StoredTurn {
  id: string;
  sessionId: string;
  providerId: string;
  role: Message['role'];
  at: string;
  content: string;
}

export class TranscriptStore {
  readonly #db: AdvocateDb;
  readonly #key: StoreKey;

  constructor(db: AdvocateDb, key: StoreKey) {
    if (key.store !== 'transcript') throw new Error('TranscriptStore requires the transcript key');
    this.#db = db;
    this.#key = key;
  }

  append(turn: Omit<StoredTurn, 'id'> & { id?: string }): string {
    const id = turn.id ?? randomUUID();
    this.#db.raw
      .prepare('INSERT INTO transcripts(id, session_id, provider_id, role, at, sealed) VALUES (?,?,?,?,?,?)')
      .run(id, turn.sessionId, turn.providerId, turn.role, turn.at, this.#key.seal(turn.content));
    return id;
  }

  session(sessionId: string): StoredTurn[] {
    const rows = this.#db.raw
      .prepare('SELECT id, session_id, provider_id, role, at, sealed FROM transcripts WHERE session_id = ? ORDER BY at, rowid')
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
      role: r.role as Message['role'],
      at: r.at,
      content: this.#key.open(r.sealed),
    }));
  }

  /** Messages in wire shape, for assembling the next request client-side. Paper Section 2.4. */
  history(sessionId: string): Message[] {
    return this.session(sessionId).map((t) => ({ role: t.role, content: t.content }));
  }

  /** Evidence spans are content. They are stored here and referenced from the ledger by opaque ref. */
  putEvidence(responseId: string, spans: EvidenceSpan[]): string {
    const ref = randomUUID();
    this.#db.raw
      .prepare('INSERT INTO evidence(ref, response_id, sealed) VALUES (?,?,?)')
      .run(ref, responseId, this.#key.seal(JSON.stringify(spans)));
    return ref;
  }

  getEvidence(ref: string): EvidenceSpan[] | undefined {
    const row = this.#db.raw.prepare('SELECT sealed FROM evidence WHERE ref = ?').get(ref) as
      | { sealed: string }
      | undefined;
    if (!row) return undefined;
    return JSON.parse(this.#key.open(row.sealed)) as EvidenceSpan[];
  }

  /** Counts and sizes only. Used by the export view to show what never leaves the device. */
  residencySummary(): { turns: number; evidenceSpans: number; sealedBytes: number } {
    const turns = this.#db.raw.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(sealed)),0) AS b FROM transcripts').get() as {
      n: number;
      b: number;
    };
    const ev = this.#db.raw.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(sealed)),0) AS b FROM evidence').get() as {
      n: number;
      b: number;
    };
    return { turns: turns.n, evidenceSpans: ev.n, sealedBytes: turns.b + ev.b };
  }
}
