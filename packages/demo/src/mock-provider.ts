// A mock provider: an OpenAI-compatible endpoint that serves a scripted conversation and
// seals its responses when given a key.
//
// Paper: steps 4 and 5.
// Spec: draft-flores-airp-provenance-00 §3.8.
//
// The demo runs over a real socket rather than through an in-process shortcut, because the
// claim being demonstrated is about a wire between two parties. A stubbed function call would
// prove that the code runs. An HTTP request proves that the pipe exists.
//
// When the request asks for stream:true, the mock emits sse-chat-delta-v1 shaped events and,
// when sealing, a terminal-seal event as the last framed event before [DONE]. Spec §3.8.3.

import { createServer, type Server, type ServerResponse } from 'node:http';
import {
  HEADER_EXCHANGE_ID,
  HEADER_SEAL,
  SSE_CHAT_DELTA_V1,
  accumulateBoundContent,
  computeRequestDigest,
  encodeSeal,
  signSeal,
} from '@aidp/core';

export interface MockProviderOptions {
  port: number;
  model: string;
  /** Responses served in order. The last one repeats once the script runs out. */
  script: string[];
  seal?: { registerEntryId: string; selector: string; privateKeyPem: string; providerIdentity: string };
  /**
   * From this response onward (1-based), the seal names a model other than the one the caller
   * asked for. Signing stays honest, so the signature still verifies. What fails is the claim,
   * against the models the register entry lists (`seal_model_mismatch`, monitor/deterministic.ts).
   *
   * This is silent model substitution in the only form an advocate can catch it. The unsigned
   * response body keeps reporting the requested model, which is the field every client trusts
   * today, so the two disagree and only one of them is signed.
   *
   * Requires `seal`. Without one there is nothing to compare against and the substitution is
   * undetectable, which is the present state of the world rather than a case to demonstrate.
   */
  substituteFrom?: { response: number; model: string };
  /**
   * Pause between SSE chunks so a buffering proxy has a chance to show itself. Signature
   * mismatch under Apache is the failure mode this is meant to surface. Default 15ms.
   */
  streamChunkDelayMs?: number;
}

export interface RunningMockProvider {
  server: Server;
  baseUrl: string;
  requestCount: () => number;
  close: () => Promise<void>;
}

function wantsStream(requestBody: Buffer): boolean {
  try {
    const parsed = JSON.parse(requestBody.toString('utf8')) as { stream?: unknown };
    return parsed.stream === true;
  } catch {
    return false;
  }
}

/** Split assistant text into small content deltas so the stream is more than one event. */
function contentDeltas(text: string): string[] {
  if (!text) return [''];
  const parts = text.split(/(\s+)/).filter((p) => p.length > 0);
  return parts.length > 0 ? parts : [text];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeSse(res: ServerResponse, eventType: string | undefined, data: string): void {
  if (eventType) res.write(`event: ${eventType}\n`);
  for (const line of data.split('\n')) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n');
}

export function startMockProvider(opts: MockProviderOptions): Promise<RunningMockProvider> {
  let served = 0;
  const chunkDelayMs = opts.streamChunkDelayMs ?? 15;

  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const requestBody = Buffer.concat(chunks);
        const exchangeId = String(req.headers[HEADER_EXCHANGE_ID] ?? '');
        const requestDigest = computeRequestDigest(new Uint8Array(requestBody));

        const content = opts.script[Math.min(served, opts.script.length - 1)] ?? '';
        served += 1;

        const substituting = Boolean(opts.substituteFrom && served >= opts.substituteFrom.response);
        const sealedModel = substituting ? opts.substituteFrom!.model : opts.model;
        const stream = wantsStream(requestBody);

        if (!stream) {
          // Body first, then seal over those octets. Spec §3.8.2.
          const body = JSON.stringify({
            id: `mock-${served}`,
            // Deliberately the requested model even while substituting. An unsigned field says
            // whatever the party sending it wants it to say, which is why the seal exists.
            model: opts.model,
            choices: [{ message: { role: 'assistant', content } }],
          });
          const bodyBytes = Buffer.from(body, 'utf8');

          const headers: Record<string, string> = {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          };
          if (opts.seal) {
            headers[HEADER_SEAL] = encodeSeal(
              signSeal(
                {
                  registerEntryId: opts.seal.registerEntryId,
                  selector: opts.seal.selector,
                  model: sealedModel,
                  providerIdentity: opts.seal.providerIdentity,
                  exchangeId,
                  requestDigest,
                  signedAt: new Date().toISOString(),
                  content: new Uint8Array(bodyBytes),
                },
                opts.seal.privateKeyPem,
              ),
            );
          }
          res.writeHead(200, headers).end(bodyBytes);
          return;
        }

        // Streamed path. Spec §3.8.3 / Appendix B (sse-chat-delta-v1).
        const id = `mock-${served}`;
        const deltas = contentDeltas(content);
        const dataObjects: unknown[] = [];

        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          // Discourage intermediary buffering of the event stream.
          'x-accel-buffering': 'no',
        });

        for (let i = 0; i < deltas.length; i++) {
          const delta: Record<string, unknown> =
            i === 0 ? { role: 'assistant', content: deltas[i] } : { content: deltas[i] };
          const obj = {
            id,
            object: 'chat.completion.chunk',
            model: opts.model,
            choices: [{ index: 0, delta, finish_reason: null }],
          };
          dataObjects.push(obj);
          writeSse(res, undefined, JSON.stringify(obj));
          if (chunkDelayMs > 0) await sleep(chunkDelayMs);
        }

        const stopObj = {
          id,
          object: 'chat.completion.chunk',
          model: opts.model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        };
        // Empty delta: contributes zero octets under sse-chat-delta-v1.
        dataObjects.push(stopObj);
        writeSse(res, undefined, JSON.stringify(stopObj));
        if (chunkDelayMs > 0) await sleep(chunkDelayMs);

        if (opts.seal) {
          const sealedContent = accumulateBoundContent(SSE_CHAT_DELTA_V1, dataObjects);
          const sealValue = encodeSeal(
            signSeal(
              {
                registerEntryId: opts.seal.registerEntryId,
                selector: opts.seal.selector,
                model: sealedModel,
                providerIdentity: opts.seal.providerIdentity,
                exchangeId,
                requestDigest,
                signedAt: new Date().toISOString(),
                content: sealedContent,
              },
              opts.seal.privateKeyPem,
            ),
          );
          writeSse(res, 'airp-seal', sealValue);
          if (chunkDelayMs > 0) await sleep(chunkDelayMs);
        }

        writeSse(res, undefined, '[DONE]');
        res.end();
      })().catch((err: unknown) => {
        if (!res.headersSent) res.writeHead(500);
        res.end(String(err));
      });
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
