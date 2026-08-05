// Client for HostSession operations.
//
// Paper: steps 1 and 12.
//
// Browser-tab path: HTTP to the loopback daemon.
// Desktop path: Tauri invoke into a HostSession that the Node launcher constructed in-process
// and exposed over loopback RPC (no HTTP listener, no Node stdio child).
// Detection uses the global Tauri API injected when withGlobalTauri is enabled, so the browser
// build does not need a Tauri dependency.

export type HostMethod =
  | 'state'
  | 'policy'
  | 'transcript'
  | 'ask'
  | 'release'
  | 'session.new'
  | 'attestations.set'
  | 'transport.set'
  | 'reputation.reset'
  | 'export';

interface TauriGlobal {
  core?: {
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
}

function tauriInvoke(): TauriGlobal['core'] | undefined {
  const g = globalThis as typeof globalThis & { __TAURI__?: TauriGlobal };
  return g.__TAURI__?.core;
}

export function isDesktopShell(): boolean {
  return Boolean(tauriInvoke()?.invoke);
}

export async function hostCall(
  method: HostMethod,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const invoke = tauriInvoke()?.invoke;
  if (invoke) {
    return invoke('host_call', { method, params });
  }

  switch (method) {
    case 'state':
      return jsonFetch('/api/state');
    case 'policy':
      return jsonFetch('/api/policy');
    case 'transcript':
      return jsonFetch('/api/transcript');
    case 'ask':
      return jsonFetch('/api/ask', { method: 'POST', body: params });
    case 'release':
      return jsonFetch('/api/release', { method: 'POST', body: params });
    case 'session.new':
      return jsonFetch('/api/session/new', { method: 'POST', body: {} });
    case 'attestations.set':
      return jsonFetch('/api/attestations', { method: 'POST', body: params });
    case 'transport.set':
      return jsonFetch('/api/transport', { method: 'POST', body: params });
    case 'reputation.reset':
      return jsonFetch('/api/reputation/reset', { method: 'POST', body: params });
    case 'export': {
      const floor = params['floor'];
      const q =
        floor === undefined || floor === null || floor === ''
          ? ''
          : `?floor=${encodeURIComponent(String(floor))}`;
      return jsonFetch(`/api/export${q}`);
    }
    default: {
      const _exhaustive: never = method;
      throw new Error(`unknown host method: ${_exhaustive}`);
    }
  }
}

/**
 * Progress hooks for an in-flight ask. A stage name and a scalar, which is the whole channel:
 * the daemon has nothing else to send while the gate is holding a response, and the absence of a
 * text parameter here is the same claim the daemon makes in progress.ts, restated where the view
 * can see it.
 */
export interface AskProgress {
  onStage?: (stage: string) => void;
  onArrival?: (activity: number) => void;
}

/**
 * Ask, reading progress frames as they arrive.
 *
 * The desktop shell reaches HostSession over a loopback RPC bridge that does not carry
 * notifications yet, so there it falls back to the plain call and the indicator has no arrival
 * signal to show. That is a gap in the bridge, reported as one, rather than a timer pretending
 * to be arrival.
 */
export async function askWithProgress(
  providerId: string,
  text: string,
  progress: AskProgress = {},
): Promise<unknown> {
  if (tauriInvoke()?.invoke) return hostCall('ask', { providerId, text });

  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({ providerId, text }),
  });
  if (!res.body) return res.json();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let outcome: unknown;

  const consume = (line: string): void => {
    if (!line.trim()) return;
    const frame = JSON.parse(line) as { kind?: string; stage?: string; activity?: number };
    if (frame.kind === 'stage' && typeof frame.stage === 'string') progress.onStage?.(frame.stage);
    else if (frame.kind === 'arrival' && typeof frame.activity === 'number') {
      progress.onArrival?.(frame.activity);
    } else outcome = frame;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      consume(line);
    }
  }
  consume(pending);
  return outcome;
}

async function jsonFetch(
  path: string,
  init?: { method?: string; body?: Record<string, unknown> },
): Promise<unknown> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  return res.json();
}
