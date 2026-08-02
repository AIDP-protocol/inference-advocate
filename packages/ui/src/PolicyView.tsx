// The Delivery Policy, readable in the app.
//
// A policy the user cannot read is a policy the user cannot hold anyone to, so the same
// markdown file that ships in the repository is what renders here. No paraphrase, no summary
// written for the screen. If the policy is wrong, it is wrong in both places at once.
//
// Product surface under Settings. Layout from reference/Inference Advocate Client.dc.html.

import { useEffect, useState } from 'react';
import type { AdvocateState } from './types';
import { hostCall } from './host-client';
import { IconDeliveryPolicy, IconJurisdiction, IconTaxonomy } from './icons';

export function PolicyView({ state }: { state: AdvocateState | null }) {
  const [markdown, setMarkdown] = useState<string>('');

  useEffect(() => {
    hostCall('policy')
      .then((b) => setMarkdown((b as { markdown: string }).markdown))
      .catch(() => setMarkdown('The Delivery Policy file could not be read.'));
  }, []);

  const window = state?.policy.window;
  const windowChip =
    window?.kind === 'count' && window.n !== undefined
      ? `window ${window.n}, ${window.scope.replace(/_/g, '-')}`
      : window
        ? `window ${window.scope}`
        : null;

  return (
    <div className="policy-scroller">
      <div className="policy">
        <div className="policy-header">
          <span className="policy-eyebrow">Settings</span>
          <h1>
            <IconDeliveryPolicy className="policy-title-icon" />
            Delivery Policy
          </h1>
          <p className="policy-deck">
            The same file that ships in the repository is what renders here. No paraphrase written
            for the screen. If the policy is wrong, it is wrong in both places at once.
          </p>
        </div>

        {state && (
          <div className="fact-chips">
            <span className="fact-chip">policy {state.policy.policyVersion}</span>
            <span className="fact-chip">{state.policy.scale} scale</span>
            <span className="fact-chip">
              warn {state.policy.thresholds.warn}, block {state.policy.thresholds.block}
            </span>
            <span className="fact-chip">mode {state.policy.mode}</span>
            {windowChip && <span className="fact-chip">{windowChip}</span>}
            <span className="fact-chip">jurisdiction {state.jurisdiction.id}</span>
          </div>
        )}

        {state && (
          <div className="jurisdiction-card">
            <div className="lead">
              <IconJurisdiction className="section-icon" />
              <div>
                <strong>
                  Jurisdiction ruleset ({state.jurisdiction.name}, {state.jurisdiction.version}):
                </strong>{' '}
                {state.jurisdiction.disclaimer}
              </div>
            </div>

            {state.pendingProvisions.length > 0 && (
              <div className="jurisdiction-section">
                <h3>Pending provisions (not applied as law)</h3>
                <ul>
                  {state.pendingProvisions.map((p) => (
                    <li key={p.id}>{p.summary}</li>
                  ))}
                </ul>
                <p>Delivery follows enacted (in_force) rules only.</p>
              </div>
            )}

            {state.jurisdiction.citations && state.jurisdiction.citations.length > 0 && (
              <div className="jurisdiction-section citations">
                <h3>Citations</h3>
                {state.jurisdiction.citations.map((c, i) => (
                  <span key={i} className="citation">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <pre className="policy-markdown">{markdown}</pre>

        {state && (
          <div className="taxonomy-block">
            <h2>
              <IconTaxonomy className="section-icon" />
              Flag taxonomy {state.taxonomy.version}
            </h2>
            <div className="taxonomy-table">
              <div className="taxonomy-head">
                <span>Type</span>
                <span>Severity</span>
                <span>Definition</span>
              </div>
              {state.taxonomy.flags.map((f) => (
                <div className="taxonomy-row" key={f.type}>
                  <span className="type">{f.type}</span>
                  <span className="sev">{f.severity}</span>
                  <span className="def">{f.definition}</span>
                </div>
              ))}
            </div>
            <span className="taxonomy-note">
              Severity floors set by your jurisdiction can raise these. They cannot lower them.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
