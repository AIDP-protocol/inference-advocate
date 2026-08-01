// The chat surface.
//
// Paper: steps 1 and 12. "From the user's seat it looks almost exactly like the product they
// already use. The whole apparatus is invisible when nothing is wrong, which is the design
// goal."
//
// Client shell is light product UI. Demo-simulation and explanatory annotation live in the
// instrument drawer. Notices are pinned with no close button anywhere in this file, which is
// the entire implementation of non-dismissable.
//
// Layout and styling from reference/Inference Advocate Client.dc.html.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdvocateState, ExchangeResult, Notice } from './types';
import { hostCall } from './host-client';
import { PolicyView } from './PolicyView';
import { WorkingIndicator } from './WorkingIndicator';
import { InstrumentDrawer, type DrawerTab } from './InstrumentDrawer';
import { ProviderPicker } from './ProviderPicker';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  result?: ExchangeResult;
}

type View = 'chat' | 'policy';

const NARROW_BP = 820;

export function App() {
  const [state, setState] = useState<AdvocateState | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('chat');
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('monitor');
  const [scenarioStep, setScenarioStep] = useState(8);
  const [narrow, setNarrow] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth < NARROW_BP : false),
  );

  const refresh = useCallback(async () => {
    const next = (await hostCall('state')) as AdvocateState;
    setState(next);
    setProvider((p) => p || next.providers[0]?.id || '');
  }, []);

  useEffect(() => {
    refresh().catch((e: unknown) => setError(String(e)));
  }, [refresh]);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_BP);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const pinnedNotices: Notice[] = useMemo(
    () => (state?.pinned ?? []).map((p) => p.notice),
    [state],
  );

  // Why sending is not possible right now, in words. A button that does nothing and says
  // nothing is the wrong behavior anywhere, and especially here.
  const blocked: string | null = !state
    ? 'Connecting to the local advocate.'
    : state.providers.length === 0
      ? 'No providers configured. Copy data/providers.demo.json to .advocate/providers.json and restart the daemon.'
      : !provider
        ? 'Choose a provider.'
        : null;

  async function send() {
    if (blocked) {
      setError(blocked);
      return;
    }
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    setTurns((t) => [...t, { role: 'user', text }]);
    setBusy(true);
    setError(null);
    try {
      const body = (await hostCall('ask', { providerId: provider, text })) as {
        result?: ExchangeResult;
        error?: string;
      };
      if (body.error || !body.result) throw new Error(body.error ?? 'no result');
      const result = body.result;
      setTurns((t) => [...t, { role: 'assistant', text: result.delivered ?? '', result }]);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function release(result: ExchangeResult, actor: 'self' | 'custodian') {
    const body = (await hostCall('release', {
      providerId: result.providerId,
      responseId: result.responseId,
      actor,
    })) as { released: boolean; reason?: string; content?: string };
    if (body.released && body.content) {
      setTurns((t) =>
        t.map((turn) =>
          turn.result?.responseId === result.responseId ? { ...turn, text: body.content! } : turn,
        ),
      );
    } else {
      setError(body.reason ?? 'release refused');
    }
    await refresh();
  }

  async function newSession() {
    await hostCall('session.new');
    setTurns([]);
    setDetailFor(null);
    setView('chat');
    await refresh();
  }

  async function setChildMode(child: boolean) {
    setError(null);
    try {
      await hostCall('attestations.set', { isAdult: !child });
      setTurns([]);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function resetReputation(providerId?: string) {
    setError(null);
    try {
      await hostCall('reputation.reset', providerId ? { providerId } : {});
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  const sessionTitle = 'Chat';

  return (
    <div className="app">
      <div className="app-row">
        {!narrow && (
          <aside className="sidebar">
            <button type="button" className="btn-new-session" onClick={() => void newSession()}>
              ＋ New session
            </button>

            <div className="session-list">
              <div className="session-group">
                <span className="session-group-label">Today</span>
                <span className="not-built">not built</span>
              </div>
              <button
                type="button"
                className={`session-item ${view === 'chat' ? 'active' : ''}`}
                onClick={() => setView('chat')}
              >
                Current session
              </button>
              <div className="session-group later">
                <span className="session-group-label">Earlier</span>
              </div>
              <div className="session-item muted">Session history</div>
            </div>

            <nav className="sidebar-footer">
              <button
                type="button"
                className={`nav-row ${view === 'chat' ? 'on' : ''}`}
                onClick={() => setView('chat')}
              >
                Chat
              </button>
              <button
                type="button"
                className={`nav-row between ${view === 'policy' ? 'on' : ''}`}
                onClick={() => setView('policy')}
              >
                Settings
                <span className="chevron">▾</span>
              </button>
              <button
                type="button"
                className={`nav-child ${view === 'policy' ? 'on' : ''}`}
                onClick={() => setView('policy')}
              >
                Delivery Policy
              </button>
              <div className="nav-badge-row">
                <span className="nav-child muted">Providers</span>
                <span className="not-built">not built</span>
              </div>
              <div className="nav-badge-row">
                <span className="nav-child muted">Local store &amp; keys</span>
                <span className="not-built">not built</span>
              </div>
              <div className="account-row">
                <span className="account-label">
                  <span className="account-avatar" />
                  Account
                </span>
                <span className="not-built">not built</span>
              </div>
            </nav>
          </aside>
        )}

        <div className="main-col">
          {narrow && (
            <div className="narrow-header">
              <span className="icon" aria-hidden="true">
                ☰
              </span>
              <span className="narrow-title">{sessionTitle}</span>
              <button
                type="button"
                className="icon plus"
                onClick={() => void newSession()}
                aria-label="New session"
              >
                ＋
              </button>
            </div>
          )}

          {view === 'chat' && (
            <div className="chat-pane">
              <div className="transcript-scroller">
                <div className="transcript-col">
                  {pinnedNotices.length > 0 && (
                    <section className="pinned-notices" aria-label="Pinned notices">
                      {pinnedNotices.map((n) => (
                        <div key={n.id} className="pinned-notice">
                          <span className="pinned-kicker">{noticeKicker(n.source)}</span>
                          <span className="pinned-body">{n.text}</span>
                        </div>
                      ))}
                    </section>
                  )}

                  {turns.length === 0 && !busy && (
                    <p className="empty">
                      Ask something. Nothing reaches this screen until the monitor has finished with
                      it.
                    </p>
                  )}

                  {turns.map((turn, i) =>
                    turn.role === 'user' ? (
                      <div key={i} className="turn-user">
                        <div className="bubble-user">{turn.text}</div>
                      </div>
                    ) : turn.result ? (
                      <AssistantTurn
                        key={i}
                        result={turn.result}
                        text={turn.text}
                        open={detailFor === turn.result.responseId}
                        onToggle={() =>
                          setDetailFor((d) =>
                            d === turn.result!.responseId ? null : turn.result!.responseId,
                          )
                        }
                        onRelease={(actor) => void release(turn.result!, actor)}
                        taxonomy={state?.taxonomy.flags ?? []}
                      />
                    ) : (
                      <div key={i} className="turn-assistant">
                        <p className="assistant-body">{turn.text}</p>
                      </div>
                    ),
                  )}

                  {busy && <WorkingIndicator />}
                  {error && <div className="error">{error}</div>}
                  {blocked && !error && turns.length === 0 && <p className="empty">{blocked}</p>}
                </div>
              </div>

              <div className="composer-wrap">
                <div className="composer-col">
                  <div className="composer">
                    <textarea
                      value={input}
                      placeholder="Type a message"
                      rows={1}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <ProviderPicker
                      providers={state?.providers ?? []}
                      value={provider}
                      onChange={setProvider}
                    />
                    <button
                      type="button"
                      className="composer-send"
                      onClick={() => void send()}
                      disabled={busy || blocked !== null}
                      title={blocked ?? 'Send'}
                    >
                      ↑
                    </button>
                  </div>
                  <span className="composer-hint">
                    Nothing reaches this screen until the monitor has finished with it.
                  </span>
                </div>
              </div>
            </div>
          )}

          {view === 'policy' && <PolicyView state={state} />}
        </div>
      </div>

      <InstrumentDrawer
        open={drawerOpen}
        tab={drawerTab}
        state={state}
        onOpen={() => setDrawerOpen(true)}
        onClose={() => setDrawerOpen(false)}
        onTab={setDrawerTab}
        onChildMode={(child) => void setChildMode(child)}
        onResetReputation={(providerId) => void resetReputation(providerId)}
        scenarioStep={scenarioStep}
        onScenarioStep={setScenarioStep}
      />
    </div>
  );
}

function AssistantTurn(props: {
  result: ExchangeResult;
  text: string;
  open: boolean;
  onToggle: () => void;
  onRelease: (actor: 'self' | 'custodian') => void;
  taxonomy: Array<{ type: string; definition: string }>;
}) {
  const { result, text, open, onToggle, onRelease, taxonomy } = props;
  const kind = result.decision.kind;
  const flagCount = result.semantic.flags.length;
  const whyLabel = `${open ? 'hide' : 'why'} (${flagCount} flag${flagCount === 1 ? '' : 's'}, score ${result.decision.score})`;
  const authority = result.decision.releaseAuthority;
  const showSelf = authority === 'self_release';
  const showCustodian = authority === 'self_release' || authority === 'custodial_release';
  const showRelease = kind === 'withhold' && authority && authority !== 'non_releasable' && authority !== 'escalating';

  const deliveryNotices =
    kind === 'deliver_with_notice'
      ? result.decision.notices.filter((n) => n.source === 'monitor')
      : [];

  return (
    <div className="turn-assistant">
      {kind === 'withhold' && (
        <div className="withheld">
          <p className="withheld-body">
            <strong>Withheld.</strong> This response is on your device and has not been rendered.
            Accumulated score {result.decision.score} against a block line of{' '}
            {result.decision.effectiveBlock}.
          </p>
          {authority && (
            <div className="withheld-authority">Release authority: {authority}</div>
          )}
          {showRelease && (
            <div className="withheld-actions">
              {showSelf && (
                <button type="button" className="btn-release" onClick={() => onRelease('self')}>
                  Release (self)
                </button>
              )}
              {showCustodian && (
                <button
                  type="button"
                  className="btn-release secondary"
                  onClick={() => onRelease('custodian')}
                >
                  Release (supervising party)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {kind === 'refuse' && (
        <div className="refused">
          <strong>Refused.</strong>{' '}
          {result.decision.rationale.filter((r) => r.includes('refus')).join(' ') ||
            result.decision.rationale.join(' ')}
        </div>
      )}

      {deliveryNotices.map((n) => (
        <div key={n.id} className="delivery-notice">
          <span className="kicker">NOTICE</span>
          <span className="body">{n.text}</span>
        </div>
      ))}

      {kind === 'deliver_with_notice' && deliveryNotices.length === 0 && (
        <div className="delivery-notice">
          <span className="kicker">NOTICE</span>
          <span className="body">
            Window score {result.decision.score}, at the warn line of {result.decision.effectiveWarn}{' '}
            and below the block line of {result.decision.effectiveBlock}.
            {flagCount > 0
              ? ` Flagged ${result.semantic.flags.map((f) => f.type.replace(/_/g, ' ')).join(' and ')}.`
              : ''}{' '}
            Displayed by your advocate.
          </span>
        </div>
      )}

      {text && <p className="assistant-body">{text}</p>}

      <div className="action-row">
        <button
          type="button"
          className={`why-link ${open ? 'open' : ''}`}
          onClick={onToggle}
        >
          {whyLabel}
        </button>
        {text && (
          <button
            type="button"
            className="copy-link"
            onClick={() => void navigator.clipboard?.writeText(text)}
          >
            Copy
          </button>
        )}
      </div>

      {open && (
        <div className="why-panel">
          <div className="why-grid">
            <div className="why-label">Provenance</div>
            <div className="why-value">{provenanceLine(result)}</div>
            <div className="why-label">Evaluator</div>
            <div className="why-value mono">
              {result.semantic.evaluatorId}@{result.semantic.evaluatorVersion}, taxonomy{' '}
              {result.semantic.taxonomyVersion}
            </div>
            <div className="why-label">Flags</div>
            <div className="why-value">
              {result.semantic.flags.length === 0 && 'none'}
              {result.semantic.flags.map((f) => {
                const def =
                  taxonomy.find((t) => t.type === f.type)?.definition ?? f.basis;
                return (
                  <div key={f.type} className="flag-block">
                    <div className="flag-head">
                      <code>
                        {f.type} severity {f.severity}
                      </code>
                      <span className="flag-basis">{def}</span>
                    </div>
                    {f.evidence.map((e, i) => (
                      <div key={i} className="flag-evidence">
                        “{e.text}”
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="why-label">Why this outcome</div>
            <div className="why-value">
              <ul className="rationale-list">
                {result.decision.rationale.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function noticeKicker(source: Notice['source']): string {
  if (source === 'policy') return 'POLICY';
  if (source === 'jurisdiction') return 'JURISDICTION';
  return 'NOTICE';
}

function provenanceLine(result: ExchangeResult): string {
  const seal = result.deterministic.sealPresent
    ? result.deterministic.sealValid
      ? 'sealed and verified against the Serving Register'
      : 'seal present and invalid'
    : 'unsealed';
  const endpoint = result.deterministic.endpointAuthorized
    ? 'endpoint authorized'
    : 'endpoint NOT authorized';
  return `${seal}, ${endpoint}`;
}

