# Desktop packaging (Tauri)

Tauri 2 shell for the inference advocate. Advocate operations use `HostSession` over
stdio IPC, not HTTP.

## What this is

A Tauri window that:

1. Spawns `packages/daemon/dist/ipc-host.js` (Node child, `AIDP_DESKTOP=1`, no HTTP listener).
2. Loads the built UI from `packages/ui/dist`.
3. Forwards UI calls through the `host_call` command into that HostSession over line-delimited
   JSON on stdin/stdout.

The browser-tab path (`npm run daemon`) still uses the loopback HTTP daemon. Both seams share
`HostSession` and `dispatchHostMethod` in `packages/daemon/src/host.ts`.

Conversation content does not gain a new outbound path through this shell. The remaining
packaging gap is honest: HostSession still runs in a Node child process, not inside the Rust
binary. That warning is reported at startup when `AIDP_DESKTOP=1`.

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
npm run desktop        # builds if needed, checks deps, starts Tauri + IPC host
```

Or:

```bash
npm run desktop --workspace @aidp/desktop
```

Environment the shell honors:

| Variable | Role |
| --- | --- |
| `AIDP_REPO_ROOT` | Repository root (set automatically by `npm run desktop`) |
| `AIDP_NODE` | Node binary for the IPC host (defaults to the Node running the launcher) |
| `AIDP_DESKTOP` | Set to `1` by the shell so HostSession reports the Node-process gap |

## Check without launching

```bash
npm run check-deps --workspace @aidp/desktop
```

## Next slice

1. Embed or otherwise host `HostSession` inside the Tauri binary (retire the Node child).
2. Real app icons and `bundle.active` once that packaging claim is honest.
