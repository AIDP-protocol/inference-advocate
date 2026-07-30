// Transcript store. Conversation content and the evidence spans derived from it.
//
// Paper: step 9. Provisional: Section 2.2 (store segregation).
// Holds the transcript key. Nothing that talks to the network is given this object.

import { randomUUID } from 'node:crypto';
import type { StoreKey } from '../crypto/keys.js';
import type { EvidenceSpan, Message } from '../types.js';
import type { StoreBackend } from './port.js';

export interface StoredTurn {
  id: string;
  sessionId: string;
  providerId: string;
  role: Message['role'];
  at: string;
  content: string;
}

export class TranscriptStore {
  readonly #store: StoreBackend;
  readonly #key: StoreKey;

  constructor(store: StoreBackend, key: StoreKey) {
    if (key.store !== 'transcript') throw new Error('TranscriptStore requires the transcript key');
    this.#store = store;
    this.#key = key;
  }

  append(turn: Omit<StoredTurn, 'id'> & { id?: string }): string {
    const id = turn.id ?? randomUUID();
    this.#store.insertTranscript({
      id,
      sessionId: turn.sessionId,
      providerId: turn.providerId,
      role: turn.role,
      at: turn.at,
      sealed: this.#key.seal(turn.content),
    });
    return id;
  }

  session(sessionId: string): StoredTurn[] {
    return this.#store.listTranscriptSession(sessionId).map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      providerId: r.providerId,
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
    this.#store.insertEvidence({
      ref,
      responseId,
      sealed: this.#key.seal(JSON.stringify(spans)),
    });
    return ref;
  }

  getEvidence(ref: string): EvidenceSpan[] | undefined {
    const row = this.#store.getEvidence(ref);
    if (!row) return undefined;
    return JSON.parse(this.#key.open(row.sealed)) as EvidenceSpan[];
  }

  /** Counts and sizes only. Used by the export view to show what never leaves the device. */
  residencySummary(): { turns: number; evidenceSpans: number; sealedBytes: number } {
    return this.#store.residencyCounts();
  }
}
