// Ensures core, daemon, and UI are built before the Tauri shell starts the sidecar.
//
// Paper: steps 1 and 12. Desktop packaging: the shell still needs the Node daemon on disk.

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

function need(path, label) {
  if (!existsSync(path)) {
    console.error(`missing ${label}: ${path}`);
    console.error('run npm run build && npm run build:ui from the repository root');
    process.exit(1);
  }
}

const daemonJs = join(repoRoot, 'packages', 'daemon', 'dist', 'server.js');
const uiIndex = join(repoRoot, 'packages', 'ui', 'dist', 'index.html');

if (!existsSync(daemonJs) || !existsSync(uiIndex)) {
  console.log('building core, daemon, and UI for the desktop shell...');
  const r = spawnSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  const u = spawnSync('npm', ['run', 'build:ui'], { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  if (u.status !== 0) process.exit(u.status ?? 1);
}

need(daemonJs, 'daemon entry');
need(uiIndex, 'UI build');
console.log('desktop prerequisites present');
