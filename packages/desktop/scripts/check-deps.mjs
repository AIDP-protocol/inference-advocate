// Reports whether this machine can compile and run the Tauri shell.
//
// Honest about gaps: missing system libraries are named rather than buried in a rustc error.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const quiet = process.argv.includes('--quiet');
const here = dirname(fileURLToPath(import.meta.url));
const srcTauri = join(here, '..', 'src-tauri');

function log(msg) {
  if (!quiet) console.log(msg);
}

function which(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : null;
}

const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
const cargoBin = join(cargoHome, 'bin');

const rustc = which('rustc') ?? (existsSync(join(cargoBin, 'rustc')) ? join(cargoBin, 'rustc') : null);
const cargo = which('cargo') ?? (existsSync(join(cargoBin, 'cargo')) ? join(cargoBin, 'cargo') : null);

const missing = [];

if (!rustc || !cargo) {
  missing.push('Rust toolchain (install: curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh)');
} else {
  log(`rustc: ${rustc}`);
  log(`cargo: ${cargo}`);
}

if (process.platform === 'linux') {
  const hasPkgConfig = !!which('pkg-config');
  if (!hasPkgConfig) {
    missing.push(
      'pkg-config and Tauri 2 Linux libs: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf pkg-config build-essential (Ubuntu 22.04+). Ubuntu 20.04 does not ship webkit2gtk-4.1.',
    );
  } else {
    const pkg = spawnSync('pkg-config', ['--exists', 'webkit2gtk-4.1'], { encoding: 'utf8' });
    if (pkg.status !== 0) {
      const pkg40 = spawnSync('pkg-config', ['--exists', 'webkit2gtk-4.0'], { encoding: 'utf8' });
      if (pkg40.status === 0) {
        missing.push(
          'webkit2gtk-4.1 (Tauri 2). This host has webkit2gtk-4.0 only. On Ubuntu 22.04+: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf pkg-config build-essential',
        );
      } else {
        missing.push(
          'Linux Tauri deps: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf pkg-config build-essential (Ubuntu 22.04+). Ubuntu 20.04 does not ship webkit2gtk-4.1.',
        );
      }
    } else {
      log('webkit2gtk-4.1: present');
    }
  }
}

if (!existsSync(join(srcTauri, 'Cargo.toml'))) {
  missing.push(`src-tauri at ${srcTauri}`);
}

if (missing.length === 0) {
  log('desktop deps: ok');
  process.exit(0);
}

if (!quiet) {
  console.log('desktop packaging: scaffolding is present; this machine cannot run the Tauri shell yet:');
  for (const m of missing) console.log(`  - ${m}`);
  console.log('The advocate still runs via npm run daemon and a browser. See packages/desktop/README.md.');
}
process.exit(quiet ? 0 : 1);
