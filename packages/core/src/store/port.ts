// Persistence port. Core owns decisions; the host supplies the store.
//
// Paper: Section 6 (local custody). Provisional: Mechanism 2, Section 2.2 (store segregation).
// Row shape, hash chaining, key scoping and seal-vs-unsealed rules stay in the store classes
// above this interface. Opening a file, migrating a schema, and reading rows are platform
// details. Named methods keep SQL (or any other query language) on the adapter side of the
// boundary. Synchronous to match the current call sites.

import type { DeliveryOutcomeKind, LedgerFlag, ReleaseAuthority } from '../types.js';

export interface LedgerRow {
  providerId: string;
  seq: number;
  responseId: string;
  at: string;
  outcome: DeliveryOutcomeKind;
  score: number;
  evaluatorVersion: string;
  taxonomyVersion: string;
  flags: LedgerFlag[];
  prevHash: string;
  hash: string;
}

export interface CarryoverRow {
  providerId: string;
  multiplier: number;
  cleanRemaining: number;
  setAt: string;
}

export interface BlockRow {
  providerId: string;
  responseId: string;
  authority: ReleaseAuthority;
  raisedAt: string;
  releasedAt?: string;
  releasedBy?: string;
}

export interface TranscriptRow {
  id: string;
  sessionId: string;
  providerId: string;
  role: string;
  at: string;
  /** Already sealed under the transcript key. The adapter stores the blob as given. */
  sealed: string;
}

export interface EvidenceRow {
  ref: string;
  responseId: string;
  /** Already sealed under the transcript key. */
  sealed: string;
}

export interface ResidencyCounts {
  turns: number;
  evidenceSpans: number;
  sealedBytes: number;
}

/**
 * Narrow persistence surface. An adapter that is not a relational store can still implement
 * these without inventing SQL. Ledger rows are unsealed; transcript, evidence and preference
 * payloads arrive already sealed.
 */
export interface StoreBackend {
  /** Short id for doctor and export, e.g. `sqlite`. */
  readonly adapterId: string;
  /** Human-readable location (path, `:memory:`, etc.) for the residency report. */
  readonly location: string;

  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
  close(): void;

  insertLedgerEntry(row: LedgerRow): void;
  getLedgerHead(providerId: string): LedgerRow | undefined;
  listLedgerProviderIds(): string[];
  listLedgerRecent(providerId: string, n: number): LedgerRow[];
  listLedgerInWindow(providerId: string, since: string, until: string): LedgerRow[];
  /** Ascending by seq. Used by verifyChain. */
  listLedgerOrdered(providerId: string): LedgerRow[];

  getCarryover(providerId: string): CarryoverRow | undefined;
  setCarryover(row: CarryoverRow): void;
  deleteCarryover(providerId: string): void;

  upsertBlock(row: Omit<BlockRow, 'releasedAt' | 'releasedBy'>): void;
  listOpenBlocks(providerId: string): BlockRow[];
  releaseBlock(providerId: string, responseId: string, releasedBy: string, at: string): void;

  insertTranscript(row: TranscriptRow): void;
  listTranscriptSession(sessionId: string): TranscriptRow[];
  insertEvidence(row: EvidenceRow): void;
  getEvidence(ref: string): EvidenceRow | undefined;
  residencyCounts(): ResidencyCounts;

  /** Sealed preference blob. */
  getPreferenceSealed(key: string): string | undefined;
  setPreferenceSealed(key: string, sealed: string): void;
  listPreferenceKeys(): string[];
}
