// The telemetry emitter.
//
// Paper: Section 5. "The component that emits telemetry holds the key to the ledger store and
// holds no key to the transcript store, so it is structurally incapable of transmitting what
// it cannot read."
// This is the file where that claim is either true or marketing. It is constructed with a
// LedgerReader and a ledger StoreKey. It is given no transcript store, no transcript key, and
// no reference to the database object through which it could reach one. Adding a transcript
// dependency to this class is a visible change to its constructor signature, which is the
// kind of change a certification review can actually check.

import { randomUUID } from 'node:crypto';
import type { LedgerReader } from '../store/ledger.js';
import type { StoreKey } from '../crypto/keys.js';
import { canonicalBatch, computeRates, type TelemetryBatch } from './rates.js';
import { signDocument } from '../crypto/seal.js';

export interface EmitterOptions {
  instanceCredential?: string;
  trafficClass: string;
  granularityFloor: number;
  evaluatorVersion: string;
  taxonomyVersion: string;
  /** Null means nothing receives it, which is the honest state of the world today. */
  endpoint: string | null;
  /** Instance signing key. In a deployed advocate this is non-exportable hardware-backed material. */
  instancePrivateKeyPem?: string;
  fetchImpl?: typeof fetch;
}

export type EmitResult =
  | { status: 'no_endpoint'; batch: TelemetryBatch }
  | { status: 'sent'; batch: TelemetryBatch; httpStatus: number }
  | { status: 'failed'; batch: TelemetryBatch; error: string };

export class TelemetryEmitter {
  readonly #ledger: LedgerReader;
  readonly #opts: EmitterOptions;
  readonly #instanceCredential: string;

  /**
   * @param ledger  read access to flag types, severities, and counts
   * @param ledgerKey  present to make the key scope explicit at the call site
   */
  constructor(ledger: LedgerReader, ledgerKey: StoreKey, opts: EmitterOptions) {
    if (ledgerKey.store !== 'ledger') {
      throw new Error('the telemetry emitter may hold the ledger key and no other');
    }
    this.#ledger = ledger;
    this.#opts = opts;
    this.#instanceCredential = opts.instanceCredential ?? randomUUID();
  }

  build(windowStart: string, windowEnd: string): TelemetryBatch {
    const providers = computeRates({
      ledger: this.#ledger,
      windowStart,
      windowEnd,
      granularityFloor: this.#opts.granularityFloor,
    });
    const batch: TelemetryBatch = {
      airpTelemetryVersion: '0.1',
      instanceCredential: this.#instanceCredential,
      trafficClass: this.#opts.trafficClass,
      windowStart,
      windowEnd,
      evaluatorVersion: this.#opts.evaluatorVersion,
      taxonomyVersion: this.#opts.taxonomyVersion,
      providers,
    };
    if (this.#opts.instancePrivateKeyPem) {
      batch.signature = signDocument(canonicalBatch(batch), this.#opts.instancePrivateKeyPem);
    }
    return batch;
  }

  /**
   * Emission is batched and scheduled, decoupled from any interaction, so that the timing of
   * a report says nothing about the timing of a conversation. Paper Section 5.
   */
  async emit(windowStart: string, windowEnd: string): Promise<EmitResult> {
    const batch = this.build(windowStart, windowEnd);
    if (!this.#opts.endpoint) return { status: 'no_endpoint', batch };
    const doFetch = this.#opts.fetchImpl ?? fetch;
    try {
      const res = await doFetch(this.#opts.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      });
      return { status: 'sent', batch, httpStatus: res.status };
    } catch (err) {
      return { status: 'failed', batch, error: (err as Error).message };
    }
  }
}
