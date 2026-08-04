// Instrument drawer: demo-simulation and explanatory annotation, structurally below the
// client. Shut by default. Dark inversion so it cannot be mistaken for product.
//
// Paper: steps 1 and 12 (presentation of the apparatus). Not a product surface.
// Values and layout from reference/Inference Advocate Client.dc.html.

import type { AdvocateState } from './types';
import { MonitorPanel } from './MonitorPanel';
import { ExportView } from './ExportView';
import { SCENARIO_STEPS } from './scenario-steps';
import { IconAirp } from './icons';

export type DrawerTab = 'monitor' | 'scenario' | 'export' | 'gaps' | 'attrs';

export function InstrumentDrawer(props: {
  open: boolean;
  tab: DrawerTab;
  state: AdvocateState | null;
  onOpen: () => void;
  onClose: () => void;
  onTab: (tab: DrawerTab) => void;
  onChildMode: (child: boolean) => void;
  onResetReputation: (providerId?: string) => void;
  scenarioStep: number;
  onScenarioStep: (step: number) => void;
}) {
  const {
    open,
    tab,
    state,
    onOpen,
    onClose,
    onTab,
    onChildMode,
    onResetReputation,
    scenarioStep,
    onScenarioStep,
  } = props;

  const withheld = state?.providers.reduce((n, p) => n + p.openBlocks.length, 0) ?? 0;
  const providerCount = state?.providers.length ?? 0;
  const stepLabel = `${scenarioStep + 1}/${SCENARIO_STEPS.length}`;

  if (!open) {
    return (
      <div className="instrument-drawer shut">
        <button type="button" className="drawer-strip" onClick={onOpen}>
          <IconAirp className="drawer-strip-icon" />
          <span className="label">▲ Instruments</span>
          <span className="aside">demonstration only · not part of the client</span>
          <span className="chips">
            {withheld > 0 && (
              <span className="chip alert">
                {withheld} withheld
              </span>
            )}
            <span className="chip">step {stepLabel}</span>
            <span className="chip">
              {providerCount} provider{providerCount === 1 ? '' : 's'}
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="instrument-drawer open">
      <div className="drawer-tabs">
        <button type="button" className="drawer-close" onClick={onClose}>
          ▼
        </button>
        {(
          [
            ['monitor', 'Monitor'],
            ['scenario', 'Scenario'],
            ['export', 'What leaves'],
            ['gaps', 'Gaps in this build'],
            ['attrs', 'Attributes'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`drawer-tab ${tab === id ? 'on' : ''}`}
            onClick={() => onTab(id)}
          >
            {label}
          </button>
        ))}
        <span className="ships">nothing here ships</span>
      </div>

      <div className="drawer-body">
        {tab === 'monitor' && (
          <MonitorPanel state={state} onResetReputation={onResetReputation} />
        )}
        {tab === 'scenario' && (
          <ScenarioTab
            step={scenarioStep}
            providerCount={providerCount}
            onStep={onScenarioStep}
          />
        )}
        {tab === 'export' && <ExportView floorFromPolicy={state?.policy.telemetry.granularityFloor ?? null} />}
        {tab === 'gaps' && <GapsTab warnings={state?.warnings ?? []} />}
        {tab === 'attrs' && (
          <AttributesTab state={state} onChildMode={onChildMode} />
        )}
      </div>
    </div>
  );
}

function ScenarioTab(props: {
  step: number;
  providerCount: number;
  onStep: (step: number) => void;
}) {
  const { step, providerCount, onStep } = props;
  const last = SCENARIO_STEPS.length - 1;

  return (
    <div className="scenario-pane">
      <div className="scenario-controls">
        <button
          type="button"
          className="scenario-btn"
          disabled={step <= 0}
          onClick={() => onStep(Math.max(0, step - 1))}
        >
          ← back
        </button>
        <span className="scenario-step-label">
          step {step + 1} of {SCENARIO_STEPS.length}
        </span>
        <button
          type="button"
          className="scenario-btn"
          disabled={step >= last}
          onClick={() => onStep(Math.min(last, step + 1))}
        >
          next →
        </button>
        <button type="button" className="scenario-btn" onClick={() => onStep(0)}>
          replay from start
        </button>
        <span className="scenario-providers">
          {providerCount} mock providers on 127.0.0.1:8811–8814
        </span>
      </div>
      <div className="scenario-steps">
        {SCENARIO_STEPS.map((s, i) => (
          <div key={s.n} className={`scenario-step ${i === step ? 'current' : ''}`}>
            <span className="n">{s.n}</span>
            <span className="t">{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GapsTab({ warnings }: { warnings: string[] }) {
  return (
    <div className="gaps-pane">
      <p className="gaps-intro">
        The advocate reports these about itself at startup. A reference implementation that
        overstates itself is worse than none.
      </p>
      {warnings.length === 0 ? (
        <p className="gaps-intro">No startup warnings reported yet.</p>
      ) : (
        <div className="gaps-grid">
          {warnings.map((w, i) => (
            <div key={i} className="gap-row">
              <span className="mark">not built</span>
              <span className="text">{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttributesTab(props: {
  state: AdvocateState | null;
  onChildMode: (child: boolean) => void;
}) {
  const { state, onChildMode } = props;
  const child = state ? !state.attestations.isAdult : false;
  const release = state?.policy.releaseAuthority;
  const nonReleasable = Object.entries(release?.byFlagType ?? {})
    .filter(([, v]) => v === 'non_releasable')
    .map(([k]) => k);
  const minor = state?.jurisdiction.minorOnly?.thresholdOverrides;

  return (
    <div className="attrs-pane">
      <div className="attrs-toggle-row">
        <button
          type="button"
          className={`child-toggle ${child ? 'on' : ''}`}
          onClick={() => onChildMode(!child)}
          title="Locally asserted. Not verified. Reference demo only."
        >
          <span className="track">
            <span className="knob" />
          </span>
          <span className="label">Child mode: {child ? 'on' : 'off'}</span>
        </button>
        <span className="attrs-caveat">locally asserted, not verified, reference demo only</span>
      </div>

      {child && (
        <div className="attrs-consequence">
          Child mode on: pending jurisdiction provisions for users under eighteen are still not
          applied as law. Self-release of withheld responses is refused until an adult attribute is
          asserted.
        </div>
      )}

      {state && (
        <div className="attrs-grid">
          <div className="kv-row">
            <span className="k">Attribute</span>
            <span className="v">{state.attestations.isAdult ? 'adult' : 'child'}</span>
          </div>
          <div className="kv-row">
            <span className="k">Issuer</span>
            <span className="v">{shortIssuer(state.attestations.issuer)}</span>
          </div>
          <div className="kv-row">
            <span className="k">Jurisdiction</span>
            <span className="v">{state.jurisdiction.id}</span>
          </div>
          <div className="kv-row">
            <span className="k">Default release authority</span>
            <span className="v">{release?.default ?? '—'}</span>
          </div>
          <div className="kv-row">
            <span className="k">Non-releasable categories</span>
            <span className="v">
              {nonReleasable.length ? nonReleasable.join(', ') : '—'}
            </span>
          </div>
          <div className="kv-row">
            <span className="k">Minor thresholds (pending)</span>
            <span className="v amber">
              {minor
                ? `warn ${minor.warn}, block ${minor.block}`
                : 'none listed on this ruleset'}
            </span>
          </div>
        </div>
      )}

      <p className="attrs-note">
        Attribute attestation is itself one of the gaps. Nothing here is verified against an
        issuer, which is why this panel sits below the floor and not in Settings.
      </p>
    </div>
  );
}

function shortIssuer(issuer: string): string {
  if (issuer === 'unverified-local-assertion' || issuer === 'self') return 'self';
  return issuer;
}
