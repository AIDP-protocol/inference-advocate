# Desktop packaging (Tauri)

First slice of desktop packaging for the inference advocate.

## What this is

A Tauri 2 window that starts the existing Node daemon as a **loopback sidecar**
(`AIDP_DESKTOP=1`, bind `127.0.0.1` only) and loads `http://127.0.0.1:8790` in the
webview. The UI still talks HTTP. Conversation content does not gain a new outbound path
through this shell.

That is scaffolding toward the shape ARCHITECTURE.md describes: replacing the daemon with
an in-process call (Tauri commands over `HostSession` in `packages/daemon/src/host.ts`).
It is not that replacement yet. The sidecar sets a startup warning the UI already renders
under "What this build does not have".

## Prerequisites

1. Node 22.5+ (24 preferred), with the repo built: `npm run build && npm run build:ui`
2. Rust stable via [rustup](https://rustup.rs/)
3. Linux system libraries for Tauri 2 (Ubuntu 22.04+):

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf pkg-config build-essential
```

Ubuntu 20.04 ships webkit2gtk-4.0 only. Tauri 2 needs 4.1. On 20.04, use the browser seam
(`npm run daemon`) until the host OS or libraries catch up, or develop the shell on a newer
machine / CI image.

## Run

From the repository root:

```bash
mkdir -p .advocate && cp data/providers.demo.json .advocate/providers.json
npm run mocks          # terminal one, if using demo providers
npm run desktop        # builds if needed, checks deps, starts Tauri + sidecar
```

Or:

```bash
npm run desktop --workspace @aidp/desktop
```

Environment the shell honors:

| Variable | Role |
| --- | --- |
| `AIDP_REPO_ROOT` | Repository root (set automatically by `npm run desktop`) |
| `AIDP_PORT` | Loopback port (default 8790) |
| `AIDP_NODE` | Node binary for the sidecar (defaults to the Node running the launcher) |
| `AIDP_DESKTOP` | Set to `1` by the shell so HostSession reports the HTTP gap |

## Check without launching

```bash
npm run check-deps --workspace @aidp/desktop
```

## Next slice

1. Tauri `invoke` commands that call `HostSession` methods (Node sidecar over stdio IPC, or
   another embedding that does not open an HTTP listener).
2. Point the UI at those commands instead of `fetch('/api/...')`.
3. Stop binding a port when running inside the desktop shell.
4. Real app icons and `bundle.active` once the bridge is honest.
