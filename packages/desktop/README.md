# Desktop packaging (Tauri)

Tauri 2 shell for the inference advocate. Advocate operations use in-process `HostSession`
in the Node launcher, reached from the UI shell over loopback RPC (not HTTP, not a Node
stdio child).

## What this is

A Node launcher that:

1. Constructs `HostSession` in-process (`AIDP_DESKTOP=1`, library call into
   `packages/daemon/src/host.ts`).
2. Listens with `listenHostRpc` on `127.0.0.1` (line-delimited JSON, same method table as the
   HTTP daemon).
3. Starts the Tauri window, which loads the built UI from `packages/ui/dist` and forwards
   `host_call` invokes to that RPC endpoint (`AIDP_HOST_ADDR`).

The browser-tab path (`npm run daemon`) still uses the loopback HTTP daemon. Both seams share
`HostSession` and `dispatchHostMethod` in `packages/daemon/src/host.ts`.

Conversation content does not gain a new outbound path through this shell. The remaining
packaging gap is honest: HostSession still runs under Node in the launcher, not inside the
Rust binary. Embedding it in-process in Tauri would need a JS runtime inside the binary, or a
Rust port of the host and store. That warning is reported at startup when `AIDP_DESKTOP=1`.

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
npm run desktop        # builds if needed, checks deps, starts HostSession + Tauri
```

Or:

```bash
npm run desktop --workspace @aidp/desktop
```

Environment the shell honors:

| Variable | Role |
| --- | --- |
| `AIDP_REPO_ROOT` | Repository root (set automatically by `npm run desktop`) |
| `AIDP_HOST_ADDR` | Loopback `host:port` for HostSession RPC (set by the launcher for Tauri) |
| `AIDP_DESKTOP` | Set to `1` so HostSession reports the Node-launcher / not-in-Rust-binary gap |
| `AIDP_RUN_DIR` | Advocate run directory (default `.advocate`) |
| `AIDP_DATA_DIR` | Trust-document directory (default `data`) |

## Check without launching

```bash
npm run check-deps --workspace @aidp/desktop
```

## Next slice

1. Embed a JS runtime in the Tauri binary, or port the host and a StoreBackend to Rust, so
   HostSession does not need a Node launcher at all.
2. Real app icons and `bundle.active` once that packaging claim is honest (a shipped binary
   still needs the Node launcher today).
