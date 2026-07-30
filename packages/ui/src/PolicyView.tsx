// The Delivery Policy, readable in the app.
//
// A policy the user cannot read is a policy the user cannot hold anyone to, so the same
// markdown file that ships in the repository is what renders here. No paraphrase, no summary
// written for the screen. If the policy is wrong, it is wrong in both places at once.

import { useEffect, useState } from 'react';
import type { AdvocateState } from './types';

export function PolicyView({ state }: { state: AdvocateState | null }) {
  const [markdown, setMarkdown] = useState<string>('');

  useEffect(() => {
    fetch('/api/policy')
      .then((r) => r.json() as Promise<{ markdown: string }>)
      .then((b) => setMarkdown(b.markdown))
      .catch(() => setMarkdown('The Delivery Policy file could not be read.'));
  }, []);

  return (
    <div className="policy">
      {state && (
        <div className="policy-head">
          <span>
            policy {state.policy.policyVersion}, {state.policy.scale} scale
          </span>
          <span>
            warn {state.policy.thresholds.warn}, block {state.policy.thresholds.block}
          </span>
          <span>mode {state.policy.mode}</span>
          <span>jurisdiction {state.jurisdiction.id}</span>
        </div>
      )}
      {state && (
        <div className="disclaimer">
          <strong>Jurisdiction ruleset:</strong> {state.jurisdiction.disclaimer}
          {state.pendingProvisions.length > 0 && (
            <div className="pending-provisions">
              <strong>Pending provisions (not applied as law):</strong>
              <ul>
                {state.pendingProvisions.map((p) => (
                  <li key={p.id}>{p.summary}</li>
                ))}
              </ul>
              Delivery follows enacted (in_force) rules only.
            </div>
          )}
          {state.jurisdiction.citations && (
            <ul>
              {state.jurisdiction.citations.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <pre className="markdown">{markdown}</pre>

      {state && (
        <>
          <h3>Flag taxonomy {state.taxonomy.version}</h3>
          <table className="taxonomy">
            <thead>
              <tr>
                <th>Type</th>
                <th>Severity</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              {state.taxonomy.flags.map((f) => (
                <tr key={f.type}>
                  <td>
                    <code>{f.type}</code>
                  </td>
                  <td>{f.severity}</td>
                  <td>{f.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
