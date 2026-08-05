// The local daemon. Binds to 127.0.0.1 and nothing else.
//
// Paper: steps 1 and 12.
//
// Why this exists. The core needs a filesystem and a SQLite file, so it runs in a process
// rather than in a browser tab, and the UI needs to talk to it. This daemon is that seam for
// the browser-tab path. It listens on the loopback interface only, has no authentication
// because it has no remote surface to authenticate. Desktop packaging constructs HostSession
// in the Node launcher and uses host-rpc.ts (loopback NDJSON, no HTTP) so the Tauri shell
// can call the same methods. Both seams share HostSession and dispatchHostMethod.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchHostMethod, HostSession } from './host.js';
import { encodeProgressFrame } from './progress.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dataDir = process.env['AIRP_DATA_DIR'] ?? join(repoRoot, 'data');
const runDir = process.env['AIRP_RUN_DIR'] ?? join(repoRoot, '.advocate');
const uiDist = join(repoRoot, 'packages', 'ui', 'dist');
const PORT = Number(process.env['AIRP_PORT'] ?? 8790);

const host = new HostSession({
  dataDir,
  runDir,
  providersPath: join(runDir, 'providers.json'),
  storePath: join(runDir, 'advocate.sqlite'),
  devKeyfile: join(runDir, 'dev.key'),
  jurisdictionId: process.env['AIRP_JURISDICTION'] ?? 'us-ny',
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
}

/**
 * Stream progress while one exchange runs, then the result. The response text appears in the
 * final line and nowhere earlier, which is what makes the delivery gate a fact about data flow
 * rather than a claim about the stylesheet.
 */
async function askWithProgress(
  res: ServerResponse,
  body: { providerId: string; text: string },
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  try {
    const result = await host.ask(body.providerId, body.text, {
      onStage: (stage) => res.write(encodeProgressFrame({ kind: 'stage', stage })),
      onArrival: (activity) => res.write(encodeProgressFrame({ kind: 'arrival', activity })),
    });
    res.write(`${JSON.stringify({ kind: 'result', ...result })}\n`);
  } catch (err) {
    res.write(`${JSON.stringify({ kind: 'error', error: (err as Error).message })}\n`);
  }
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }

  try {
    if (url.pathname === '/api/state') {
      json(res, 200, await dispatchHostMethod(host, 'state'));
      return;
    }

    if (url.pathname === '/api/policy') {
      json(res, 200, await dispatchHostMethod(host, 'policy'));
      return;
    }

    if (url.pathname === '/api/transcript') {
      json(res, 200, await dispatchHostMethod(host, 'transcript'));
      return;
    }

    if (url.pathname === '/api/ask' && req.method === 'POST') {
      const body = await readBody<{ providerId: string; text: string }>(req);
      // A client that asks for NDJSON gets progress frames while the exchange runs, then the
      // result as the last line. One that does not gets exactly what it got before. The frames
      // carry a stage name and an arrival scalar; see progress.ts.
      if ((req.headers['accept'] ?? '').includes('application/x-ndjson')) {
        await askWithProgress(res, body);
        return;
      }
      json(res, 200, await dispatchHostMethod(host, 'ask', { ...body }));
      return;
    }

    if (url.pathname === '/api/transport' && req.method === 'POST') {
      const body = await readBody<{ withholdUnverifiedContent?: boolean }>(req);
      json(res, 200, await dispatchHostMethod(host, 'transport.set', { ...body }));
      return;
    }

    if (url.pathname === '/api/release' && req.method === 'POST') {
      const body = await readBody<{ providerId: string; responseId: string; actor: 'self' | 'custodian' }>(req);
      json(res, 200, await dispatchHostMethod(host, 'release', { ...body }));
      return;
    }

    if (url.pathname === '/api/session/new' && req.method === 'POST') {
      json(res, 200, await dispatchHostMethod(host, 'session.new'));
      return;
    }

    if (url.pathname === '/api/attestations' && req.method === 'POST') {
      const body = await readBody<{ isAdult?: boolean }>(req);
      json(res, 200, await dispatchHostMethod(host, 'attestations.set', { ...body }));
      return;
    }

    if (url.pathname === '/api/reputation/reset' && req.method === 'POST') {
      const body = await readBody<{ providerId?: string }>(req);
      json(res, 200, await dispatchHostMethod(host, 'reputation.reset', { ...body }));
      return;
    }

    if (url.pathname === '/api/export') {
      const floor = url.searchParams.get('floor');
      json(res, 200, await dispatchHostMethod(host, 'export', floor ? { floor } : {}));
      return;
    }

    // Static UI, when it has been built.
    if (existsSync(uiDist)) {
      const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^([/\\])+/, '');
      const file = join(uiDist, rel);
      if (file.startsWith(uiDist) && existsSync(file)) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(readFileSync(file));
        return;
      }
      const index = join(uiDist, 'index.html');
      if (existsSync(index)) {
        res.writeHead(200, { 'content-type': MIME['.html']! });
        res.end(readFileSync(index));
        return;
      }
    }

    json(res, 404, {
      error: 'not found',
      hint: 'the UI has not been built yet. Run `npm run build:ui`, or run `npm run ui` for the dev server.',
    });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`inference advocate daemon on http://127.0.0.1:${PORT}`);
  console.log(`  store        ${join(runDir, 'advocate.sqlite')}`);
  console.log(`  providers    ${join(runDir, 'providers.json')}`);
  console.log(`  jurisdiction ${host.opened.jurisdiction.ruleset.id}`);
  for (const w of host.warnings) console.log(`  warning      ${w}`);
  if (host.opened.providers.list().length === 0) {
    console.log('');
    console.log('  No providers configured. Copy data/providers.example.json to');
    console.log(`  ${join(runDir, 'providers.json')} and edit it, or run the demo instead.`);
  }
});
