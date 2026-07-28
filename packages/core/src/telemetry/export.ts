// The export view: what would leave the device, and what never does.
//
// Paper: Section 5 and the README. "The export function exists so you can see exactly what
// would cross the wire and what never does."
// PLAN: Phase 4.
//
// A privacy claim nobody can inspect is a slogan. This produces two documents side by side:
// the exact bytes a telemetry batch would put on the wire, and a content-free inventory of
// everything the advocate is holding that no batch can reach.

import type { LedgerReader } from '../store/ledger.js';
import type { TranscriptStore } from '../store/transcripts.js';
import type { TelemetryBatch } from './rates.js';
import { canonicalBatch } from './rates.js';

export interface ResidencyReport {
  /** Counts and byte sizes only. No content, not even in a report about content. */
  transcriptTurns: number;
  evidenceSpans: number;
  sealedBytesOnDevice: number;
  ledgerEntriesByProvider: Record<string, number>;
  storePath: string;
}

export interface ExportView {
  generatedAt: string;
  wouldLeave: {
    batch: TelemetryBatch;
    bytes: number;
    /** Rendered exactly as it would be signed and sent. */
    wire: string;
  };
  neverLeaves: ResidencyReport;
  /** Any configured path that would send content off the device, so the tradeoff is visible. */
  outboundContentPaths: string[];
}

export interface BuildExportInput {
  batch: TelemetryBatch;
  ledger: LedgerReader;
  transcripts: TranscriptStore;
  storePath: string;
  /** For example a remote model evaluator, which does send response content somewhere. */
  outboundContentPaths?: string[];
  now?: Date;
}

export function buildExportView(input: BuildExportInput): ExportView {
  const wire = canonicalBatch(input.batch).toString('utf8');
  const residency = input.transcripts.residencySummary();
  const ledgerEntriesByProvider: Record<string, number> = {};
  for (const id of input.ledger.providerIds()) {
    ledgerEntriesByProvider[id] = input.ledger.recent(id, Number.MAX_SAFE_INTEGER).length;
  }
  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    wouldLeave: {
      batch: input.batch,
      bytes: Buffer.byteLength(wire, 'utf8'),
      wire,
    },
    neverLeaves: {
      transcriptTurns: residency.turns,
      evidenceSpans: residency.evidenceSpans,
      sealedBytesOnDevice: residency.sealedBytes,
      ledgerEntriesByProvider,
      storePath: input.storePath,
    },
    outboundContentPaths: input.outboundContentPaths ?? [],
  };
}
