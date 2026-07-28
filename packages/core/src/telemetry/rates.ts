// Incident Telemetry: rates out, never content.
//
// Paper: steps 13 and 14, and Section 5 ("What leaves the client").
// PLAN: Phase 4, "Rates, never content: aggregate incident rates derived from the ledger".
//
// Note the denominator. The paper insists that consumer-facing incidents be measured against
// consumer-facing volume rather than a provider's total throughput, because otherwise a
// thousand clean agentic calls drown one harmful consumer exchange. The traffic class is
// therefore part of the batch rather than an annotation on it.

import type { LedgerReader } from '../store/ledger.js';

export interface ProviderRates {
  providerId: string;
  evaluatedResponses: number;
  /** Flag type to count. */
  flagCounts: Record<string, number>;
  severityWeightedIncidents: number;
  /** severityWeightedIncidents / evaluatedResponses, or null below the granularity floor. */
  incidentRate: number | null;
  /** True when the cell was suppressed for being too small to report. */
  suppressed: boolean;
}

export interface TelemetryBatch {
  aidpTelemetryVersion: string;
  /** Anonymous but unique. Hardware attestation backing is disclosed in the provisional and not built here. */
  instanceCredential: string;
  trafficClass: string;
  windowStart: string;
  windowEnd: string;
  evaluatorVersion: string;
  taxonomyVersion: string;
  providers: ProviderRates[];
  /** Base64url signature over the canonical batch, added by the emitter. */
  signature?: string;
}

export interface ComputeRatesInput {
  ledger: LedgerReader;
  windowStart: string;
  windowEnd: string;
  granularityFloor: number;
  providerIds?: string[];
}

export function computeRates(input: ComputeRatesInput): ProviderRates[] {
  const ids = input.providerIds ?? input.ledger.providerIds();
  return ids.map((providerId) => {
    const entries = input.ledger.entriesInWindow(providerId, input.windowStart, input.windowEnd);
    const flagCounts: Record<string, number> = {};
    let weighted = 0;
    for (const e of entries) {
      for (const f of e.flags) {
        flagCounts[f.type] = (flagCounts[f.type] ?? 0) + 1;
        weighted += f.severity;
      }
    }
    const suppressed = entries.length < input.granularityFloor;
    return {
      providerId,
      evaluatedResponses: entries.length,
      flagCounts,
      severityWeightedIncidents: weighted,
      incidentRate: suppressed || entries.length === 0 ? null : weighted / entries.length,
      suppressed,
    };
  });
}

/** Field order is fixed so that two implementations sign the same bytes. */
export function canonicalBatch(batch: TelemetryBatch): Buffer {
  const providers = [...batch.providers]
    .sort((a, b) => a.providerId.localeCompare(b.providerId))
    .map((p) => ({
      providerId: p.providerId,
      evaluatedResponses: p.evaluatedResponses,
      flagCounts: Object.fromEntries(Object.entries(p.flagCounts).sort(([a], [b]) => a.localeCompare(b))),
      severityWeightedIncidents: p.severityWeightedIncidents,
      incidentRate: p.incidentRate,
      suppressed: p.suppressed,
    }));
  return Buffer.from(
    JSON.stringify({
      aidpTelemetryVersion: batch.aidpTelemetryVersion,
      instanceCredential: batch.instanceCredential,
      trafficClass: batch.trafficClass,
      windowStart: batch.windowStart,
      windowEnd: batch.windowEnd,
      evaluatorVersion: batch.evaluatorVersion,
      taxonomyVersion: batch.taxonomyVersion,
      providers,
    }),
    'utf8',
  );
}
