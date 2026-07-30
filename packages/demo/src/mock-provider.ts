// A mock provider: an OpenAI-compatible endpoint that serves a scripted conversation and
// seals its responses when given a key.
//
// Paper: steps 4 and 5.
//
// The demo runs over a real socket rather than through an in-process shortcut, because the
// claim being demonstrated is about a wire between two parties. A stubbed function call would
// prove that the code runs. An HTTP request proves that the pipe exists.

import { createServer, type Server } from 'node:http';
import { signSeal } from '@aidp/core';
import { HEADER_SEAL, encodeSeal } from '@aidp/core';

export interface MockProviderOptions {
  port: number;
  model: string;
  /** Responses served in order. The last one repeats once the script runs out. */
  script: string[];
  seal?: { registerEntryId: string; selector: string; privateKeyPem: string; providerIdentity: string };
}

export interface RunningMockProvider {
  server: Server;
  baseUrl: string;
  requestCount: () => number;
  close: () => Promise<void>;
}

export function startMockProvider(opts: MockProviderOptions): Promise<RunningMockProvider> {
  let served = 0;

  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const content = opts.script[Math.min(served, opts.script.length - 1)] ?? '';
      served += 1;

      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.seal) {
        headers[HEADER_SEAL] = encodeSeal(
          signSeal(
            {
              registerEntryId: opts.seal.registerEntryId,
              selector: opts.seal.selector,
              model: opts.model,
              providerIdentity: opts.seal.providerIdentity,
              signedAt: new Date().toISOString(),
              content,
            },
            opts.seal.privateKeyPem,
          ),
        );
      }
      res.writeHead(200, headers).end(
        JSON.stringify({
          id: `mock-${served}`,
          model: opts.model,
          choices: [{ message: { role: 'assistant', content } }],
        }),
      );
    });
  });

  return new Promise((resolveStart, rejectStart) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        rejectStart(
          new Error(
            `port ${opts.port} on 127.0.0.1 is already in use. ` +
              'Another copy of the mock providers is probably still running; stop it and try again.',
          ),
        );
        return;
      }
      rejectStart(err);
    });
    server.listen(opts.port, '127.0.0.1', () => {
      resolveStart({
        server,
        baseUrl: `http://127.0.0.1:${opts.port}/v1`,
        requestCount: () => served,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
