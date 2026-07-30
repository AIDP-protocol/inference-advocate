// The local daemon. Binds to 127.0.0.1 and nothing else.
//
// Paper: steps 1 and 12.
//
// Why this exists. The core needs a filesystem and a SQLite file, so it runs in a process
// rather than in a browser tab, and the UI needs to talk to it. This daemon is that seam. It
// listens on the loopback interface only, has no authentication because it has no remote
// surface to authenticate, and is the piece that a desktop packaging step (Tauri) replaces
// with an in-process call. The first Tauri slice still launches this listener inside the
// desktop shell; HostSession (host.ts) is the API surface that slice and the next one share.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostSession } from './host.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dataDir = process.env['AIDP_DATA_DIR'] ?? join(repoRoot, 'data');
const runDir = process.env['AIDP_RUN_DIR'] ?? join(repoRoot, '.advocate');
const uiDist = join(repoRoot, 'packages', 'ui', 'dist');
const PORT = Number(process.env['AIDP_PORT'] ?? 8790);

const host = new HostSession({
  dataDir,
  runDir,
  providersPath: join(runDir, 'providers.json'),
  storePath: join(runDir, 'advocate.sqlite'),
  devKeyfile: join(runDir, 'dev.key'),
  jurisdictionId: process.env['AIDP_JURISDICTION'] ?? 'us-ny',
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }

  try {
    if (url.pathname === '/api/state') {
      json(res, 200, host.state());
      return;
    }

    if (url.pathname === '/api/policy') {
      json(res, 200, { markdown: host.policyMarkdown() });
      return;
    }

    if (url.pathname === '/api/transcript') {
      json(res, 200, host.transcript());
      return;
    }

    if (url.pathname === '/api/ask' && req.method === 'POST') {
      const body = await readBody<{ providerId: string; text: string }>(req);
      json(res, 200, await host.ask(body.providerId, body.text));
      return;
    }

    if (url.pathname === '/api/release' && req.method === 'POST') {
      const body = await readBody<{ providerId: string; responseId: string; actor: 'self' | 'custodian' }>(req);
      json(res, 200, host.release(body.providerId, body.responseId, body.actor));
      return;
    }

    if (url.pathname === '/api/session/new' && req.method === 'POST') {
      json(res, 200, host.newSession());
      return;
    }

    if (url.pathname === '/api/export') {
      const floor = url.searchParams.get('floor');
      json(res, 200, host.exportView(floor ? Number(floor) : undefined));
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
  const kind = process.env['AIDP_DESKTOP'] === '1' ? 'desktop sidecar' : 'daemon';
  console.log(`inference advocate ${kind} on http://127.0.0.1:${PORT}`);
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
