// Monitor state made visible: per-provider score, threshold proximity, and standing.
//
// The bar is the point. A user should be able to see a provider walking toward a line before
// it crosses one, because a gate that only speaks when it fires teaches nothing.
//
// Lives in the instrument drawer (demonstration), not the client shell.

import type { AdvocateState, ProviderState } from './types';
import { splitProviderLabel } from './provider-label';
import {
  IconDeliveryPolicy,
  IconJurisdiction,
  IconServingRegister,
  IconTaxonomy,
} from './icons';

export function MonitorPanel({
  state,
  onResetReputation,
}: {
  state: AdvocateState | null;
  onResetReputation: (providerId?: string) => void;
}) {
  if (!state) {
    return <div className="monitor-empty">connecting to the local daemon...</div>;
  }

  if (state.providers.length === 0) {
    return (
      <div className="monitor-empty">
        No providers configured. Copy <code>data/providers.demo.json</code> into the run directory
        as <code>providers.json</code>.
      </div>
    );
  }

  const anyReputation = state.providers.some(
    (p) => p.carryover || p.windowScore > 0 || p.evaluatedTotal > 0,
  );

  return (
    <div className="monitor-pane">
      <div className="monitor-grid">
        {state.providers.map((p) => (
          <ProviderCard key={p.id} p={p} onReset={() => onResetReputation(p.id)} />
        ))}
        <TrustFabric state={state} />
      </div>

      <div className="monitor-demo-reset">
        <button
          type="button"
          className="demo-reset-btn"
          disabled={!anyReputation}
          onClick={() => onResetReputation()}
          title="Clears rolling scores and carryover for every provider. Does not release withheld content. Reference demo only."
        >
          Reset all provider reputations
        </button>
        <span className="demo-reset-caveat">
          demo only · clears scores and carryover, not withheld content · will not ship
        </span>
      </div>
    </div>
  );
}

function ProviderCard({ p, onReset }: { p: ProviderState; onReset: () => void }) {
  const excluded = p.standing === 'excluded';
  const band = excluded
    ? 'excluded'
    : p.windowScore >= p.block
      ? 'block'
      : p.windowScore >= p.warn
        ? 'warn'
        : 'clear';
  const scale = Math.max(p.block, p.windowScore, 1);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const { primary, secondary } = splitProviderLabel(p.label);
  const subtitle = providerSubtitle(p);
  const canReset = !excluded && (Boolean(p.carryover) || p.windowScore > 0 || p.evaluatedTotal > 0);

  return (
    <div className="monitor-card">
      <div className="head">
        <span className="name">
          {primary}
          {secondary && <span className="provider-model"> ({secondary})</span>}
        </span>
        <span className={`band-pill ${band}`}>{band}</span>
      </div>
      <span className="monitor-sub">{subtitle}</span>

      {excluded ? (
        <>
          <div className="monitor-status red">relay declined before a request is sent</div>
          <div className="monitor-score">
            0 requests sent, {p.evaluatedTotal} evaluated
          </div>
          <div className="monitor-status muted">
            nothing is held, because nothing was received
          </div>
        </>
      ) : (
        <>
          <div className="meter">
            <div className={`fill ${band}`} style={{ width: pct(p.windowScore) }} />
            <div className="tick warn" style={{ left: pct(p.warn) }} title={`warn ${p.warn}`} />
            <div className="tick block" style={{ left: pct(p.block) }} title={`block ${p.block}`} />
          </div>
          <div className="monitor-score">
            score {p.windowScore} over {p.windowSize} responses, warn {p.warn}, block {p.block}
          </div>
          {Object.keys(p.flagCounts).length > 0 && (
            <div className="monitor-flags">
              {Object.entries(p.flagCounts).map(([type, n]) => (
                <span key={type} className="chip">
                  {type} x{n}
                </span>
              ))}
            </div>
          )}
          {p.carryover && (
            <div className="monitor-status amber">
              on edge: {p.carryover.cleanRemaining} clean responses to decay
            </div>
          )}
          {p.openBlocks.length > 0 && (
            <div className="monitor-status red">
              {p.openBlocks.length} withheld awaiting release
            </div>
          )}
          <div className={`monitor-status ${p.chain.ok ? 'green' : 'red'}`}>
            ledger chain {p.chain.ok ? 'intact' : `broken at ${p.chain.brokenAtSeq}`},{' '}
            {p.evaluatedTotal} evaluated
          </div>
          {canReset && (
            <button
              type="button"
              className="demo-reset-btn per-provider"
              onClick={onReset}
              title="Clears this provider's rolling score and carryover. Does not release withheld content. Reference demo only."
            >
              Reset reputation · demo only
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TrustFabric({ state }: { state: AdvocateState }) {
  const demoKeys = state.warnings.some((w) => /development key material|ephemeral master/i.test(w));

  return (
    <div className="fabric-card">
      <h2>Trust fabric</h2>
      <div className="fabric-row">
        <span className="k">
          <IconServingRegister className="fabric-icon" />
          Serving Register
        </span>
        <span className={`v ${state.register.signatureValid ? 'ok' : 'bad'}`}>
          {state.register.signatureValid ? 'signature verified' : 'signature INVALID'},{' '}
          {state.register.entries} entries
        </span>
      </div>
      <div className="fabric-row">
        <span className="k">Standing document</span>
        <span className={`v ${state.standing.signatureValid ? 'ok' : 'bad'}`}>
          {state.standing.signatureValid ? 'signature verified' : 'signature INVALID'}
        </span>
      </div>
      <div className="fabric-row">
        <span className="k">
          <IconTaxonomy className="fabric-icon" />
          Taxonomy
        </span>
        <span className="v">{state.taxonomy.version}</span>
      </div>
      <div className="fabric-row">
        <span className="k">
          <IconJurisdiction className="fabric-icon" />
          Jurisdiction
        </span>
        <span className="v">{state.jurisdiction.name}</span>
      </div>
      <div className="fabric-row">
        <span className="k">
          <IconDeliveryPolicy className="fabric-icon" />
          Delivery Policy
        </span>
        <span className="v">{state.policy.policyVersion}</span>
      </div>
      <div className="fabric-row">
        <span className="k">User attribute</span>
        <span className="v">
          {state.attestations.isAdult ? 'adult' : 'child'} ({shortIssuer(state.attestations.issuer)})
        </span>
      </div>
      <div className="fabric-row">
        <span className="k">Thresholds</span>
        <span className="v">
          warn {state.effectiveThresholds.warn}, block {state.effectiveThresholds.block}
        </span>
      </div>
      <div className="fabric-row">
        <span className="k">Mode</span>
        <span className="v">{state.policy.mode}</span>
      </div>
      <div className="fabric-row">
        <span className="k">Signing keys</span>
        <span className={`v ${demoKeys ? 'amber' : 'ok'}`}>
          {demoKeys ? 'demo fixtures' : 'configured'}
        </span>
      </div>
    </div>
  );
}

function providerSubtitle(p: ProviderState): string {
  const { secondary } = splitProviderLabel(p.label);
  // Demo mocks annotate themselves in the label paren ("mock", "mock, drifts", ...).
  const mockNote = secondary && /^mock\b/i.test(secondary) ? secondary : null;

  let standingBit: string;
  if (p.standing === 'elevated_scrutiny') standingBit = 'elevated, window seeded at 2';
  else if (p.standing === 'excluded') standingBit = 'excluded at population level';
  else if (p.standing === 'good') standingBit = 'good standing';
  else standingBit = p.standing.replace(/_/g, ' ');

  if (mockNote) {
    if (mockNote.toLowerCase().includes(standingBit.toLowerCase())) return mockNote;
    return `${mockNote} · ${standingBit}`;
  }
  return standingBit;
}

function shortIssuer(issuer: string): string {
  if (issuer === 'unverified-local-assertion' || issuer === 'self') return 'self';
  return issuer;
}
