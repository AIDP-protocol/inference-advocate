// Stdio IPC host for HostSession. No HTTP listener.
//
// Paper: steps 1 and 12.
//
// Desktop packaging (Tauri) spawns this process and forwards UI invokes over line-delimited
// JSON on stdin/stdout. The browser-tab path keeps server.ts. Logs go to stderr so the
// protocol on stdout stays unambiguous.

import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchHostMethod, HostSession } from './host.js';

const repoRoot = process.env['AIDP_REPO_ROOT']
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dataDir = process.env['AIDP_DATA_DIR'] ?? join(repoRoot, 'data');
const runDir = process.env['AIDP_RUN_DIR'] ?? join(repoRoot, '.advocate');

const host = new HostSession({
  dataDir,
  runDir,
  providersPath: join(runDir, 'providers.json'),
  storePath: join(runDir, 'advocate.sqlite'),
  devKeyfile: join(runDir, 'dev.key'),
  jurisdictionId: process.env['AIDP_JURISDICTION'] ?? 'us-ny',
});

function write(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

write({ event: 'ready' });
console.error('inference advocate desktop IPC host ready (stdio, no HTTP listener)');
console.error(`  store        ${join(runDir, 'advocate.sqlite')}`);
console.error(`  providers    ${join(runDir, 'providers.json')}`);
console.error(`  jurisdiction ${host.opened.jurisdiction.ruleset.id}`);
for (const w of host.warnings) console.error(`  warning      ${w}`);

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: { id?: unknown; method?: unknown; params?: unknown };
  try {
    req = JSON.parse(trimmed) as { id?: unknown; method?: unknown; params?: unknown };
  } catch (err) {
    write({ id: null, ok: false, error: `invalid JSON: ${(err as Error).message}` });
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
      write({ id, ok: true, result });
    } catch (err) {
      write({ id, ok: false, error: (err as Error).message });
    }
  })();
});

rl.on('close', () => {
  process.exit(0);
});
