// What leaves the device, and what never does.
//
// Paper: Section 5.
//
// This screen exists so that the privacy claim can be checked rather than believed. On the
// left, the exact bytes a telemetry batch would put on the wire. On the right, an inventory of
// everything the advocate is holding, in counts and sizes, because a report about content that
// contained content would be its own refutation.

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

export function ExportView() {
  const [data, setData] = useState<ExportPayload | null>(null);
  const [floor, setFloor] = useState<number | null>(null);

  useEffect(() => {
    const params = floor === null ? {} : { floor };
    hostCall('export', params)
      .then((b) => setData(b as ExportPayload))
      .catch(() => setData(null));
  }, [floor]);

  if (!data) return <div className="export">reading the ledger...</div>;

  return (
    <div className="export">
      <div className="cols">
        <section>
          <h3>Would leave</h3>
          <p className="note">
            {data.wouldLeave.bytes} bytes. Rates and counts, per provider and per flag type, with the evaluator and
            taxonomy versions that produced them. Nothing receives this today, because no standing body exists yet.
          </p>
          <label>
            granularity floor:{' '}
            <select value={floor ?? 'policy'} onChange={(e) => setFloor(e.target.value === 'policy' ? null : 1)}>
              <option value="policy">as the policy sets it</option>
              <option value="1">lowered to 1, to see suppressed cells</option>
            </select>
          </label>
          <pre>{JSON.stringify(JSON.parse(data.wouldLeave.wire), null, 2)}</pre>
        </section>

        <section>
          <h3>Never leaves</h3>
          <p className="note">Counts and sizes only. This panel cannot show you the content either.</p>
          <dl>
            <dt>Transcript turns on device</dt>
            <dd>{data.neverLeaves.transcriptTurns}</dd>
            <dt>Evidence spans on device</dt>
            <dd>{data.neverLeaves.evidenceSpans}</dd>
            <dt>Encrypted bytes on device</dt>
            <dd>{data.neverLeaves.sealedBytesOnDevice}</dd>
            <dt>Ledger entries by provider</dt>
            <dd>
              {Object.entries(data.neverLeaves.ledgerEntriesByProvider).map(([k, v]) => (
                <div key={k}>
                  {k}: {v}
                </div>
              ))}
            </dd>
            <dt>Store file</dt>
            <dd>
              <code>{data.neverLeaves.storePath}</code>
            </dd>
            <dt>Outbound content paths</dt>
            <dd className={data.outboundContentPaths.length ? 'bad' : 'ok'}>
              {data.outboundContentPaths.length === 0
                ? 'none configured'
                : data.outboundContentPaths.join(', ')}
            </dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
