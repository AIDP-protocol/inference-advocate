// The local daemon. Binds to 127.0.0.1 and nothing else.
//
// Paper: steps 1 and 12. PLAN: Phase 5.
//
// Why this exists. The core needs a filesystem and a SQLite file, so it runs in a process
// rather than in a browser tab, and the UI needs to talk to it. This daemon is that seam. It
// listens on the loopback interface only, has no authentication because it has no remote
// surface to authenticate, and is the piece that a desktop packaging step (Tauri) would
// replace with an in-process call. PLAN defers desktop packaging until the core demo works,
// and a local web app is fine for the reference stage.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { ProviderRegistry, openAdvocate, type ExchangeResult, type OpenedAdvocate } from '@aidp/core';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dataDir = process.env['AIDP_DATA_DIR'] ?? join(repoRoot, 'data');
const runDir = process.env['AIDP_RUN_DIR'] ?? join(repoRoot, '.advocate');
const uiDist = join(repoRoot, 'packages', 'ui', 'dist');
const PORT = Number(process.env['AIDP_PORT'] ?? 8790);

const providersPath = join(runDir, 'providers.json');

const opened: OpenedAdvocate = openAdvocate({
  dataDir,
  storePath: join(runDir, 'advocate.sqlite'),
  providersPath,
  jurisdictionId: process.env['AIDP_JURISDICTION'] ?? 'us-ny',
  devKeyfile: join(runDir, 'dev.key'),
});

/** Notices raised so far this session, so the UI can keep them pinned across turns. */
const pinned: Array<{ notice: ExchangeResult['decision']['notices'][number]; raisedAt: string }> = [];

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

/**
 * Re-read the provider file on every state poll. The daemon used to load it once at boot,
 * which meant adding a provider and wondering why the Send button did nothing. Configuration
 * that only takes effect on restart is a trap in a reference implementation people are
 * supposed to be able to poke at.
 */
function reloadProviders(): void {
  if (!existsSync(providersPath)) return;
  try {
    const fresh = ProviderRegistry.load(providersPath);
    for (const p of fresh.list()) opened.providers.add(p);
    for (const existing of opened.providers.list()) {
      if (!fresh.get(existing.id)) opened.providers.remove(existing.id);
    }
  } catch {
    // A half-written file during an edit is not worth taking the daemon down for.
  }
}

function monitorState() {
  const policy = opened.policy.document;
  return opened.providers.list().map((p) => {
    const entries = opened.advocate.ledger.recent(p.id, policy.window.n ?? 10);
    const windowScore = entries.reduce((s, e) => s + e.flags.reduce((t, f) => t + f.severity, 0), 0);
    const flagCounts: Record<string, number> = {};
    for (const e of entries) for (const f of e.flags) flagCounts[f.type] = (flagCounts[f.type] ?? 0) + 1;
    const carryover = opened.advocate.ledger.getCarryover(p.id);
    return {
      id: p.id,
      label: p.label,
      model: p.model,
      registerEntryId: p.registerEntryId ?? null,
      standing: opened.advocate.standingFor(p),
      windowScore,
      windowSize: entries.length,
      warn: policy.thresholds.warn,
      block: policy.thresholds.block,
      flagCounts,
      carryover: carryover ? { cleanRemaining: carryover.cleanRemaining } : null,
      openBlocks: opened.advocate.ledger.openBlocks(p.id),
      chain: opened.advocate.ledger.verifyChain(p.id),
      evaluatedTotal: opened.advocate.ledger.recent(p.id, Number.MAX_SAFE_INTEGER).length,
    };
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }

  try {
    if (url.pathname === '/api/state') {
      reloadProviders();
      json(res, 200, {
        sessionId: opened.advocate.sessionId,
        jurisdiction: opened.jurisdiction.ruleset,
        policy: opened.policy.document,
        taxonomy: {
          version: opened.taxonomy.version,
          status: opened.taxonomy.document.status,
          flags: opened.taxonomy.flags.map((f) => ({
            type: f.type,
            title: f.title,
            definition: f.definition,
            severity: f.severity,
          })),
        },
        register: { signatureValid: opened.register.signatureValid, entries: opened.register.entries().length },
        standing: { signatureValid: opened.standing.signatureValid, issuedAt: opened.standing.document.issuedAt },
        providers: monitorState(),
        warnings: opened.warnings,
        pinned,
      });
      return;
    }

    if (url.pathname === '/api/policy') {
      const md = readFileSync(join(dataDir, 'policy', 'delivery-policy.md'), 'utf8');
      json(res, 200, { markdown: md });
      return;
    }

    if (url.pathname === '/api/transcript') {
      const turns = opened.advocate.transcripts.session(opened.advocate.sessionId);
      json(res, 200, { sessionId: opened.advocate.sessionId, turns });
      return;
    }

    if (url.pathname === '/api/ask' && req.method === 'POST') {
      const body = await readBody<{ providerId: string; text: string }>(req);
      const result = await opened.advocate.ask({ providerId: body.providerId, text: body.text });
      const at = new Date().toISOString();
      for (const notice of result.decision.notices) {
        if (!pinned.some((p) => p.notice.id === notice.id)) pinned.push({ notice, raisedAt: at });
      }
      json(res, 200, { result, providers: monitorState(), pinned });
      return;
    }

    if (url.pathname === '/api/release' && req.method === 'POST') {
      const body = await readBody<{ providerId: string; responseId: string; actor: 'self' | 'custodian' }>(req);
      const outcome = opened.advocate.release(body.providerId, body.responseId, body.actor);
      const content = outcome.released
        ? opened.advocate.withheldContent(opened.advocate.sessionId, body.responseId)
        : undefined;
      json(res, 200, { ...outcome, content, providers: monitorState() });
      return;
    }

    if (url.pathname === '/api/session/new' && req.method === 'POST') {
      pinned.length = 0;
      json(res, 200, { sessionId: opened.advocate.newSession() });
      return;
    }

    if (url.pathname === '/api/export') {
      const floor = url.searchParams.get('floor');
      const view = opened.advocate.exportView(
        '2000-01-01T00:00:00.000Z',
        new Date(Date.now() + 60_000).toISOString(),
        floor ? Number(floor) : undefined,
      );
      json(res, 200, view);
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
  console.log(`  jurisdiction ${opened.jurisdiction.ruleset.id}`);
  for (const w of opened.warnings) console.log(`  warning      ${w}`);
  if (opened.providers.list().length === 0) {
    console.log('');
    console.log('  No providers configured. Copy data/providers.example.json to');
    console.log(`  ${join(runDir, 'providers.json')} and edit it, or run the demo instead.`);
  }
});
