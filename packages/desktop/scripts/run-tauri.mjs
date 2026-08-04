// Launches HostSession in-process for `dev`, then starts the Tauri UI shell against its
// loopback RPC. `build` only compiles the shell (no live HostSession required).
//
// Paper: steps 1 and 12.
//
// Retires the Node stdio IPC child: HostSession is constructed here as a library, listenHostRpc
// publishes it on 127.0.0.1, and Tauri dials AIRP_HOST_ADDR. AIRP_DESKTOP=1 still reports that
// the advocate is not embedded inside the Rust binary.

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const mode = process.argv[2] === 'build' ? 'build' : 'dev';
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const repoRoot = join(pkgRoot, '..', '..');

const ensure = spawnSync(process.execPath, [join(here, 'ensure-built.mjs')], { cwd: pkgRoot, stdio: 'inherit' });
if (ensure.status !== 0) process.exit(ensure.status ?? 1);

const deps = spawnSync(process.execPath, [join(here, 'check-deps.mjs')], { cwd: pkgRoot, stdio: 'inherit' });
if (deps.status !== 0) process.exit(deps.status ?? 1);

const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin');
const pathParts = [cargoBin, process.env.PATH ?? ''];
const tauriCli = join(repoRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const tauriArgs = existsSync(tauriCli) ? [tauriCli, mode] : ['tauri', mode];
const tauriCmd = existsSync(tauriCli) ? process.execPath : 'npx';
const tauriSpawnArgs = existsSync(tauriCli) ? tauriArgs : ['--yes', '@tauri-apps/cli', mode];

function spawnTauri(extraEnv) {
  return spawn(tauriCmd, tauriSpawnArgs, {
    cwd: pkgRoot,
    env: {
      ...process.env,
      PATH: pathParts.join(process.platform === 'win32' ? ';' : ':'),
      AIRP_REPO_ROOT: repoRoot,
      AIRP_DESKTOP: '1',
      ...extraEnv,
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

if (mode === 'build') {
  // Compile only. A shipped binary still needs a Node launcher to construct HostSession;
  // bundle.active stays off until that packaging claim is honest.
  const child = spawnTauri({});
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  const { HostSession } = await import('../../daemon/dist/host.js');
  const { listenHostRpc } = await import('../../daemon/dist/host-rpc.js');

  const runDir = process.env['AIRP_RUN_DIR'] ?? join(repoRoot, '.advocate');
  const dataDir = process.env['AIRP_DATA_DIR'] ?? join(repoRoot, 'data');
  process.env['AIRP_DESKTOP'] = '1';
  process.env['AIRP_REPO_ROOT'] = repoRoot;

  const host = new HostSession({
    dataDir,
    runDir,
    providersPath: join(runDir, 'providers.json'),
    storePath: join(runDir, 'advocate.sqlite'),
    devKeyfile: join(runDir, 'dev.key'),
    jurisdictionId: process.env['AIRP_JURISDICTION'] ?? 'us-ny',
  });

  const rpc = await listenHostRpc(host);
  console.error('inference advocate desktop HostSession ready (in-process library, loopback RPC)');
  console.error(`  rpc          ${rpc.endpoint}`);
  console.error(`  store        ${join(runDir, 'advocate.sqlite')}`);
  console.error(`  providers    ${join(runDir, 'providers.json')}`);
  console.error(`  jurisdiction ${host.opened.jurisdiction.ruleset.id}`);
  for (const w of host.warnings) console.error(`  warning      ${w}`);

  const child = spawnTauri({
    AIRP_HOST_ADDR: rpc.endpoint,
    AIRP_RUN_DIR: runDir,
    AIRP_DATA_DIR: dataDir,
  });

  async function shutdown(code) {
    try {
      await rpc.close();
    } catch {
      // Listener may already be closed.
    }
    process.exit(code ?? 1);
  }

  child.on('exit', (code) => {
    void shutdown(code ?? 1);
  });

  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });
  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}
