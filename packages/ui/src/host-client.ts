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
