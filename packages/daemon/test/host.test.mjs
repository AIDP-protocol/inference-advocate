// HostSession packaging warnings and stdio IPC.
//
// Paper: steps 1 and 12. Desktop packaging honesty.
// Runs against the compiled host module so the daemon package keeps rootDir=src.

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { packagingWarnings } from '../dist/host.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const ipcHostJs = join(here, '..', 'dist', 'ipc-host.js');

test('packagingWarnings is empty without AIDP_DESKTOP', () => {
  assert.deepEqual(packagingWarnings({}), []);
  assert.deepEqual(packagingWarnings({ AIDP_DESKTOP: '0' }), []);
});

test('packagingWarnings names the Node stdio IPC gap when AIDP_DESKTOP=1', () => {
  const w = packagingWarnings({ AIDP_DESKTOP: '1' });
  assert.equal(w.length, 1);
  assert.match(w[0], /stdio IPC/);
  assert.match(w[0], /Node child process/);
  assert.match(w[0], /not yet embedded in-process/);
  assert.doesNotMatch(w[0], /loopback daemon/);
});

test('ipc-host answers state over stdio without binding HTTP', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'aidp-ipc-'));
  try {
    writeFileSync(join(runDir, 'providers.json'), JSON.stringify({ version: 1, providers: [] }));
    const child = spawn(process.execPath, [ipcHostJs], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AIDP_DESKTOP: '1',
        AIDP_REPO_ROOT: repoRoot,
        AIDP_DATA_DIR: join(repoRoot, 'data'),
        AIDP_RUN_DIR: runDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = createInterface({ input: child.stdout });
    const readJson = () =>
      new Promise((resolve, reject) => {
        const onLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          rl.off('line', onLine);
          try {
            resolve(JSON.parse(trimmed));
          } catch (err) {
            reject(err);
          }
        };
        rl.on('line', onLine);
        child.on('exit', (code) => reject(new Error(`ipc-host exited ${code}`)));
      });

    const ready = await readJson();
    assert.equal(ready.event, 'ready');

    child.stdin.write(`${JSON.stringify({ id: 1, method: 'state', params: {} })}\n`);
    const reply = await readJson();
    assert.equal(reply.id, 1);
    assert.equal(reply.ok, true);
    assert.ok(reply.result.sessionId);
    assert.ok(Array.isArray(reply.result.warnings));
    assert.ok(reply.result.warnings.some((w) => /stdio IPC/.test(w)));

    child.stdin.write(`${JSON.stringify({ id: 2, method: 'policy', params: {} })}\n`);
    const policy = await readJson();
    assert.equal(policy.id, 2);
    assert.equal(policy.ok, true);
    assert.match(policy.result.markdown, /Delivery Policy/i);

    child.stdin.end();
    await new Promise((resolve) => child.on('close', resolve));
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});
