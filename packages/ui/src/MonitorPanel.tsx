// Monitor state made visible: per-provider score, threshold proximity, and standing.
//
// PLAN: Phase 5, "Monitor state visible: per-provider rates, threshold proximity, standing".
//
// The bar is the point. A user should be able to see a provider walking toward a line before
// it crosses one, because a gate that only speaks when it fires teaches nothing.

import type { AdvocateState, ProviderState } from './types';

export function MonitorPanel({ state }: { state: AdvocateState | null }) {
  if (!state) return <aside className="monitor">connecting to the local daemon...</aside>;

  return (
    <aside className="monitor">
      <h2>Monitor</h2>
      {state.providers.length === 0 && (
        <p className="empty">
          No providers configured. Copy <code>data/providers.example.json</code> into the run directory as
          <code> providers.json</code>.
        </p>
      )}
      {state.providers.map((p) => (
        <ProviderCard key={p.id} p={p} />
      ))}

      <h2>Trust fabric</h2>
      <dl className="fabric">
        <dt>Serving Register</dt>
        <dd className={state.register.signatureValid ? 'ok' : 'bad'}>
          {state.register.signatureValid ? 'signature verified' : 'signature INVALID'}, {state.register.entries}{' '}
          entries
        </dd>
        <dt>Standing document</dt>
        <dd className={state.standing.signatureValid ? 'ok' : 'bad'}>
          {state.standing.signatureValid ? 'signature verified' : 'signature INVALID'}, issued{' '}
          {state.standing.issuedAt.slice(0, 10)}
        </dd>
        <dt>Taxonomy</dt>
        <dd>
          {state.taxonomy.version} ({state.taxonomy.status})
        </dd>
        <dt>Jurisdiction</dt>
        <dd>{state.jurisdiction.name}</dd>
        <dt>Mode</dt>
        <dd>{state.policy.mode}</dd>
      </dl>

      {state.warnings.length > 0 && (
        <>
          <h2>What this build does not have</h2>
          <ul className="warnings">
            {state.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

function ProviderCard({ p }: { p: ProviderState }) {
  const span = Math.max(p.block, p.windowScore, 1);
  const pct = (v: number) => `${Math.min(100, (v / span) * 100)}%`;
  const band = p.windowScore >= p.block ? 'block' : p.windowScore >= p.warn ? 'warn' : 'clear';

  return (
    <div className={`provider band-${band}`}>
      <div className="head">
        <strong>{p.label}</strong>
        <span className={`standing standing-${p.standing}`}>{p.standing.replace('_', ' ')}</span>
      </div>
      <div className="meter">
        <div className="fill" style={{ width: pct(p.windowScore) }} />
        <div className="line warn" style={{ left: pct(p.warn) }} title={`warn ${p.warn}`} />
        <div className="line block" style={{ left: pct(p.block) }} title={`block ${p.block}`} />
      </div>
      <div className="numbers">
        score {p.windowScore} over {p.windowSize} responses, warn {p.warn}, block {p.block}
      </div>
      {Object.keys(p.flagCounts).length > 0 && (
        <div className="flags">
          {Object.entries(p.flagCounts).map(([type, n]) => (
            <span key={type} className="chip">
              {type} x{n}
            </span>
          ))}
        </div>
      )}
      {p.carryover && <div className="carry">on edge: {p.carryover.cleanRemaining} clean responses to decay</div>}
      {p.openBlocks.length > 0 && <div className="blocks">{p.openBlocks.length} withheld awaiting release</div>}
      <div className={`chain ${p.chain.ok ? 'ok' : 'bad'}`}>
        ledger chain {p.chain.ok ? 'intact' : `broken at ${p.chain.brokenAtSeq}`}, {p.evaluatedTotal} evaluated
      </div>
    </div>
  );
}
