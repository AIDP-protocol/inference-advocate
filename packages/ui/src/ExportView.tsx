// What leaves the device, and what never does.
//
// Paper: Section 5.
//
// This screen exists so that the privacy claim can be checked rather than believed. On the
// left, the exact bytes a telemetry batch would put on the wire. On the right, an inventory of
// everything the advocate is holding, in counts and sizes, because a report about content that
// contained content would be its own refutation.
//
// Lives in the instrument drawer (demonstration), not the client shell.

import { useEffect, useState } from 'react';
import { hostCall } from './host-client';

interface ExportPayload {
  generatedAt: string;
  wouldLeave: { wire: string; bytes: number };
  neverLeaves: {
    transcriptTurns: number;
    evidenceSpans: number;
    sealedBytesOnDevice: number;
    ledgerEntriesByProvider: Record<string, number>;
    storePath: string;
  };
  outboundContentPaths: string[];
}

export function ExportView({ floorFromPolicy }: { floorFromPolicy?: number | null }) {
  const [data, setData] = useState<ExportPayload | null>(null);
  const [floor, setFloor] = useState<number | null>(null);

  useEffect(() => {
    const params = floor === null ? {} : { floor };
    hostCall('export', params)
      .then((b) => setData(b as ExportPayload))
      .catch(() => setData(null));
  }, [floor]);

  if (!data) return <div className="monitor-empty">reading the ledger...</div>;

  let wire: { rates?: unknown[]; suppressedCells?: number } = {};
  try {
    wire = JSON.parse(data.wouldLeave.wire) as typeof wire;
  } catch {
    wire = {};
  }
  const suppressed = typeof wire.suppressedCells === 'number' ? wire.suppressedCells : 0;
  const ratesEmpty = !Array.isArray(wire.rates) || wire.rates.length === 0;
  const policyFloor = floorFromPolicy ?? null;
  const maxEvaluated = Object.values(data.neverLeaves.ledgerEntriesByProvider).reduce(
    (a, b) => Math.max(a, b),
    0,
  );

  const ledgerLine = Object.entries(data.neverLeaves.ledgerEntriesByProvider)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');

  return (
    <div className="export-grid">
      <section className="export-panel">
        <div className="export-head">
          <h3>Would leave</h3>
          <span className="export-bytes">{data.wouldLeave.bytes} bytes</span>
        </div>
        <p className="export-note">
          Rates and counts only, per provider and per flag type, with the evaluator and taxonomy
          versions that produced them. Nothing receives this today, because no standing body exists
          yet.
        </p>
        <div className="export-floor">
          <span>granularity floor</span>
          <select
            value={floor ?? 'policy'}
            onChange={(e) => setFloor(e.target.value === 'policy' ? null : 1)}
          >
            <option value="policy">
              as the policy sets it{policyFloor !== null ? ` — ${policyFloor}` : ''}
            </option>
            <option value="1">lowered to 1, to see suppressed cells</option>
          </select>
        </div>
        <pre className="export-code">{JSON.stringify(JSON.parse(data.wouldLeave.wire), null, 2)}</pre>
        {ratesEmpty && suppressed > 0 && floor === null && policyFloor !== null && (
          <span className="export-suppress">
            Every cell is suppressed. The floor is {policyFloor} evaluated responses per provider
            and the highest here is {maxEvaluated}. A real batch would carry nothing yet — which is
            what the floor is for.
          </span>
        )}
      </section>

      <section className="export-panel">
        <h3>Never leaves</h3>
        <p className="export-note">
          Counts and sizes only. This panel cannot show you the content either.
        </p>
        <div className="kv-list">
          <div className="kv-row">
            <span className="k">Transcript turns on device</span>
            <span className="v">{data.neverLeaves.transcriptTurns}</span>
          </div>
          <div className="kv-row">
            <span className="k">Evidence spans on device</span>
            <span className="v">{data.neverLeaves.evidenceSpans}</span>
          </div>
          <div className="kv-row">
            <span className="k">Encrypted bytes on device</span>
            <span className="v">
              {data.neverLeaves.sealedBytesOnDevice.toLocaleString()}
            </span>
          </div>
          <div className="kv-row">
            <span className="k">Ledger entries by provider</span>
            <span className="v">{ledgerLine || '—'}</span>
          </div>
          <div className="kv-row">
            <span className="k">Store file</span>
            <span className="v">{data.neverLeaves.storePath}</span>
          </div>
          <div className="kv-row">
            <span className="k">Outbound content paths</span>
            <span className={`v ${data.outboundContentPaths.length ? 'bad' : 'ok'}`}>
              {data.outboundContentPaths.length === 0
                ? 'none configured'
                : data.outboundContentPaths.join(', ')}
            </span>
          </div>
        </div>
        <p className="export-note">
          The batch builder holds the ledger key and not the transcript key, so it cannot read the
          conversation even if it were asked to send it. The evaluator runs on the loopback
          interface, so it is not listed as an outbound path.
        </p>
      </section>
    </div>
  );
}
