// Launches `tauri` after ensuring Node builds and the Rust toolchain are on PATH.
//
// Paper: steps 1 and 12. The shell sets AIDP_DESKTOP=1 so HostSession reports the HTTP gap.

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
const env = {
  ...process.env,
  PATH: pathParts.join(process.platform === 'win32' ? ';' : ':'),
  AIDP_REPO_ROOT: repoRoot,
  AIDP_DESKTOP: '1',
  AIDP_PORT: process.env.AIDP_PORT ?? '8790',
  AIDP_NODE: process.env.AIDP_NODE ?? process.execPath,
};

const tauriCli = join(repoRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const args = existsSync(tauriCli)
  ? [tauriCli, mode]
  : ['tauri', mode];

const child = spawn(existsSync(tauriCli) ? process.execPath : 'npx', existsSync(tauriCli) ? args : ['--yes', '@tauri-apps/cli', mode], {
  cwd: pkgRoot,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));
