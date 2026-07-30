// The chat surface.
//
// Paper: steps 1 and 12. "From the user's seat it looks almost exactly like the product they
// already use. The whole apparatus is invisible when nothing is wrong, which is the design
// goal."
//
// So the default state of this screen is a prompt box and a conversation. The monitor panel
// is there, at the side, quiet, until something crosses a line. Notices are pinned at the top
// with no close button anywhere in this file, which is the entire implementation of
// non-dismissable.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdvocateState, ExchangeResult, Notice } from './types';
import { hostCall } from './host-client';
import { MonitorPanel } from './MonitorPanel';
import { PolicyView } from './PolicyView';
import { ExportView } from './ExportView';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  result?: ExchangeResult;
}

type Tab = 'chat' | 'policy' | 'export';

export function App() {
  const [state, setState] = useState<AdvocateState | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = (await hostCall('state')) as AdvocateState;
    setState(next);
    setProvider((p) => p || next.providers[0]?.id || '');
  }, []);

  useEffect(() => {
    refresh().catch((e: unknown) => setError(String(e)));
  }, [refresh]);

  const pinnedNotices: Notice[] = useMemo(() => (state?.pinned ?? []).map((p) => p.notice), [state]);

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
      setTurns((t) => [
        ...t,
        { role: 'assistant', text: result.delivered ?? '', result },
      ]);
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
    await refresh();
  }

  return (
    <div className="app">
      <header>
        <div className="brand">
          <strong>Inference Advocate</strong>
          <span className="sub">reference implementation, pre-alpha</span>
        </div>
        <nav>
          <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
            Chat
          </button>
          <button className={tab === 'policy' ? 'on' : ''} onClick={() => setTab('policy')}>
            Delivery Policy
          </button>
          <button className={tab === 'export' ? 'on' : ''} onClick={() => setTab('export')}>
            What leaves
          </button>
          <button onClick={() => void newSession()}>New session</button>
        </nav>
      </header>

      {pinnedNotices.length > 0 && (
        <section className="notices" aria-label="Pinned notices">
          {pinnedNotices.map((n) => (
            <div key={n.id} className={`notice notice-${n.source}`}>
              <span className="tag">{n.source}</span>
              <span>{n.text}</span>
            </div>
          ))}
        </section>
      )}

      <main>
        <div className="pane">
          {tab === 'chat' && (
            <>
              <div className="transcript">
                {turns.length === 0 && (
                  <p className="empty">
                    Ask something. Nothing reaches this screen until the monitor has finished with it.
                  </p>
                )}
                {turns.map((turn, i) => (
                  <div key={i} className={`turn ${turn.role}`}>
                    {turn.role === 'assistant' && turn.result ? (
                      <AssistantTurn
                        result={turn.result}
                        text={turn.text}
                        open={detailFor === turn.result.responseId}
                        onToggle={() =>
                          setDetailFor((d) => (d === turn.result!.responseId ? null : turn.result!.responseId))
                        }
                        onRelease={(actor) => void release(turn.result!, actor)}
                      />
                    ) : (
                      <p>{turn.text}</p>
                    )}
                  </div>
                ))}
                {busy && <p className="working">evaluating...</p>}
              </div>

              {error && <div className="error">{error}</div>}
              {blocked && !error && <p className="empty">{blocked}</p>}

              <div className="composer">
                <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {(state?.providers ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={input}
                  placeholder="Type a message"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button onClick={() => void send()} disabled={busy || blocked !== null} title={blocked ?? 'Send'}>
                  Send
                </button>
              </div>
            </>
          )}

          {tab === 'policy' && <PolicyView state={state} />}
          {tab === 'export' && <ExportView />}
        </div>

        <MonitorPanel state={state} />
      </main>
    </div>
  );
}

function AssistantTurn(props: {
  result: ExchangeResult;
  text: string;
  open: boolean;
  onToggle: () => void;
  onRelease: (actor: 'self' | 'custodian') => void;
}) {
  const { result, text, open, onToggle, onRelease } = props;
  const kind = result.decision.kind;

  return (
    <div className={`assistant kind-${kind}`}>
      {kind === 'withhold' && (
        <div className="withheld">
          <p>
            <strong>Withheld.</strong> This response is on your device and has not been rendered. Accumulated
            score {result.decision.score} against a block line of {result.decision.effectiveBlock}.
          </p>
          <p className="authority">Release authority: {result.decision.releaseAuthority}</p>
          <div className="row">
            <button onClick={() => onRelease('self')}>Release (self)</button>
            <button onClick={() => onRelease('custodian')}>Release (supervising party)</button>
          </div>
        </div>
      )}
      {kind === 'refuse' && (
        <div className="refused">
          <strong>Refused.</strong> {result.decision.rationale.filter((r) => r.includes('refus')).join(' ')}
        </div>
      )}
      {text && <p className="body">{text}</p>}

      <button className="why" onClick={onToggle}>
        {open ? 'hide' : 'why'} ({result.semantic.flags.length} flags, score {result.decision.score})
      </button>

      {open && (
        <div className="detail">
          <dl>
            <dt>Provenance</dt>
            <dd>
              {result.deterministic.sealPresent
                ? result.deterministic.sealValid
                  ? 'sealed and verified against the Serving Register'
                  : 'seal present and invalid'
                : 'unsealed'}
              {result.deterministic.endpointAuthorized ? ', endpoint authorized' : ', endpoint NOT authorized'}
            </dd>
            <dt>Evaluator</dt>
            <dd>
              {result.semantic.evaluatorId}@{result.semantic.evaluatorVersion}, taxonomy{' '}
              {result.semantic.taxonomyVersion}
            </dd>
            <dt>Flags</dt>
            <dd>
              {result.semantic.flags.length === 0 && 'none'}
              {result.semantic.flags.map((f) => (
                <div key={f.type} className="flag">
                  <code>
                    {f.type} severity {f.severity}
                  </code>
                  <span className="basis">{f.basis}</span>
                  {f.evidence.map((e, i) => (
                    <blockquote key={i}>{e.text}</blockquote>
                  ))}
                </div>
              ))}
            </dd>
            <dt>Why this outcome</dt>
            <dd>
              <ul>
                {result.decision.rationale.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}
