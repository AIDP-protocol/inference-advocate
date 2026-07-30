// HostSession packaging warnings and loopback RPC.
//
// Paper: steps 1 and 12. Desktop packaging honesty.
// Runs against the compiled host module so the daemon package keeps rootDir=src.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnection } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { packagingWarnings, HostSession } from '../dist/host.js';
import { listenHostRpc } from '../dist/host-rpc.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

test('packagingWarnings is empty without AIDP_DESKTOP', () => {
  assert.deepEqual(packagingWarnings({}), []);
  assert.deepEqual(packagingWarnings({ AIDP_DESKTOP: '0' }), []);
});

test('packagingWarnings names the Node-launcher gap when AIDP_DESKTOP=1', () => {
  const w = packagingWarnings({ AIDP_DESKTOP: '1' });
  assert.equal(w.length, 1);
  assert.match(w[0], /Node launcher/);
  assert.match(w[0], /not embedded inside the Tauri binary/);
  assert.doesNotMatch(w[0], /stdio IPC/);
  assert.doesNotMatch(w[0], /Node child process/);
  assert.doesNotMatch(w[0], /loopback daemon/);
});

test('listenHostRpc answers state over loopback without HTTP or a stdio child', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'aidp-rpc-'));
  const prevDesktop = process.env['AIDP_DESKTOP'];
  process.env['AIDP_DESKTOP'] = '1';
  try {
    writeFileSync(join(runDir, 'providers.json'), JSON.stringify({ version: 1, providers: [] }));
    const host = new HostSession({
      dataDir: join(repoRoot, 'data'),
      runDir,
      providersPath: join(runDir, 'providers.json'),
      storePath: join(runDir, 'advocate.sqlite'),
      devKeyfile: join(runDir, 'dev.key'),
      jurisdictionId: 'us-ny',
    });

    const rpc = await listenHostRpc(host);
    assert.equal(rpc.address, '127.0.0.1');

    const socket = createConnection({ host: rpc.address, port: rpc.port });
    const rl = createInterface({ input: socket });
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
        socket.on('error', reject);
      });

    const ready = await readJson();
    assert.equal(ready.event, 'ready');

    socket.write(`${JSON.stringify({ id: 1, method: 'state', params: {} })}\n`);
    const reply = await readJson();
    assert.equal(reply.id, 1);
    assert.equal(reply.ok, true);
    assert.ok(reply.result.sessionId);
    assert.ok(Array.isArray(reply.result.warnings));
    assert.ok(reply.result.warnings.some((w) => /Node launcher/.test(w)));
    assert.ok(reply.result.warnings.every((w) => !/stdio IPC/.test(w)));

    socket.write(`${JSON.stringify({ id: 2, method: 'policy', params: {} })}\n`);
    const policy = await readJson();
    assert.equal(policy.id, 2);
    assert.equal(policy.ok, true);
    assert.match(policy.result.markdown, /Delivery Policy/i);

    socket.end();
    rl.close();
    await rpc.close();
  } finally {
    if (prevDesktop === undefined) delete process.env['AIDP_DESKTOP'];
    else process.env['AIDP_DESKTOP'] = prevDesktop;
    rmSync(runDir, { recursive: true, force: true });
  }
});
