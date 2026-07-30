// Line-oriented JSON RPC into HostSession over a duplex stream.
//
// Paper: steps 1 and 12.
//
// Desktop packaging keeps HostSession in-process in the Node launcher and exposes this
// protocol on a 127.0.0.1 TCP socket so the Tauri UI shell can call the same
// dispatchHostMethod table the HTTP daemon uses. This is not HTTP: one JSON object per
// line, matched by id. Embedding HostSession inside the Rust binary is a later question
// (JS runtime in-process, or a Rust port of the host and store).

import { createServer, type Server, type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { dispatchHostMethod, type HostSession } from './host.js';

function writeJson(output: Writable, msg: unknown): void {
  output.write(`${JSON.stringify(msg)}\n`);
}

/**
 * Serve HostSession on an existing duplex stream (TCP socket, or tests with a pipe).
 * Sends `{ event: "ready" }` first so a client can wait before issuing calls.
 */
export function attachHostRpc(
  input: Readable,
  output: Writable,
  host: HostSession,
): { close: () => void } {
  writeJson(output, { event: 'ready' });

  const rl = createInterface({ input, crlfDelay: Infinity });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: { id?: unknown; method?: unknown; params?: unknown };
    try {
      req = JSON.parse(trimmed) as { id?: unknown; method?: unknown; params?: unknown };
    } catch (err) {
      writeJson(output, { id: null, ok: false, error: `invalid JSON: ${(err as Error).message}` });
      return;
    }

    const id = req.id ?? null;
    const method = typeof req.method === 'string' ? req.method : '';
    const params =
      req.params && typeof req.params === 'object' && !Array.isArray(req.params)
        ? (req.params as Record<string, unknown>)
        : {};

    void (async () => {
      try {
        const result = await dispatchHostMethod(host, method, params);
        writeJson(output, { id, ok: true, result });
      } catch (err) {
        writeJson(output, { id, ok: false, error: (err as Error).message });
      }
    })();
  });

  return {
    close: () => {
      rl.close();
    },
  };
}

export interface HostRpcListenOptions {
  /** Defaults to 127.0.0.1. Desktop must not bind a routable interface. */
  host?: string;
  /** Defaults to 0 (ephemeral). The launcher passes the chosen port to Tauri. */
  port?: number;
}

export interface HostRpcServer {
  address: string;
  port: number;
  /** `host:port` for AIDP_HOST_ADDR. */
  endpoint: string;
  close: () => Promise<void>;
}

/**
 * Listen for HostSession RPC connections on loopback TCP.
 * Each connection gets its own ready line and independent request stream.
 */
export function listenHostRpc(
  hostSession: HostSession,
  opts: HostRpcListenOptions = {},
): Promise<HostRpcServer> {
  const bindHost = opts.host ?? '127.0.0.1';
  const bindPort = opts.port ?? 0;

  return new Promise((resolve, reject) => {
    const server: Server = createServer((socket: Socket) => {
      attachHostRpc(socket, socket, hostSession);
    });

    server.once('error', reject);
    server.listen(bindPort, bindHost, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('host RPC listen: expected a TCP address'));
        return;
      }
      // Node may report IPv6-mapped form; the endpoint string stays what Tauri should dial.
      const address = addr.address === '::ffff:127.0.0.1' ? '127.0.0.1' : addr.address;
      if (address !== '127.0.0.1' && address !== '::1') {
        server.close();
        reject(new Error(`host RPC refused non-loopback bind: ${address}`));
        return;
      }
      resolve({
        address,
        port: addr.port,
        endpoint: `${address === '::1' ? '127.0.0.1' : address}:${addr.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });
}
