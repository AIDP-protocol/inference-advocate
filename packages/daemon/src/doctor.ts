// `npm run doctor`: print the configuration the advocate actually resolved.
//
// This exists because of a real failure. Someone set an evaluator config, ran the demo, and
// could not tell from the output whether the configuration had taken effect. Configuration
// that silently does nothing is worse than configuration that fails, so this command answers
// one question directly: what is this advocate actually going to do, right now, with the files
// and environment variables it can see.
//
// It opens the store read-only in a temporary location and sends no requests to anyone.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAdvocate } from '@airp/store-sqlite';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dataDir = process.env['AIRP_DATA_DIR'] ?? join(repoRoot, 'data');
const runDir = process.env['AIRP_RUN_DIR'] ?? join(repoRoot, '.advocate');
const scratch = mkdtempSync(join(tmpdir(), 'airp-doctor-'));

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(24)} ${value}`);
}

console.log('');
console.log('inference advocate: resolved configuration');
console.log('');

console.log('paths');
line('data directory', dataDir);
line('run directory', runDir);
line('store', existsSync(join(runDir, 'advocate.sqlite')) ? join(runDir, 'advocate.sqlite') : 'not created yet');
line(
  'providers file',
  existsSync(join(runDir, 'providers.json')) ? join(runDir, 'providers.json') : 'MISSING, no providers will load',
);

console.log('');
console.log('environment');
const evaluatorEnv = process.env['AIRP_EVALUATOR_CONFIG'];
line('AIRP_EVALUATOR_CONFIG', evaluatorEnv ? evaluatorEnv : 'not set, so the rule evaluator is used');
if (evaluatorEnv) {
  line('  that path exists', existsSync(evaluatorEnv) ? 'yes' : 'NO, the advocate will fall back to the rule evaluator');
}
line('AIRP_JURISDICTION', process.env['AIRP_JURISDICTION'] ?? 'not set, the daemon defaults to us-ny');
const registerDocEnv = process.env['AIRP_REGISTER_DOCUMENT'];
line(
  'AIRP_REGISTER_DOCUMENT',
  registerDocEnv
    ? registerDocEnv
    : 'not set, data/register/serving-register.json',
);
if (registerDocEnv) {
  line('  that path exists', existsSync(registerDocEnv) ? 'yes' : 'NO');
}
for (const name of Object.keys(process.env).filter((k) => k.startsWith('AIRP_') && k.endsWith('_API_KEY'))) {
  line(name, process.env[name] ? 'set' : 'empty');
}

try {
  const opened = openAdvocate({
    dataDir,
    storePath: join(scratch, 'probe.sqlite'),
    ...(existsSync(join(runDir, 'providers.json')) ? { providersPath: join(runDir, 'providers.json') } : {}),
    jurisdictionId: process.env['AIRP_JURISDICTION'] ?? 'us-ny',
  });

  console.log('');
  console.log('resolved');
  line('storage adapter', opened.store.adapterId);
  line('store location', opened.store.location);
  line('taxonomy', `${opened.taxonomy.version} (${opened.taxonomy.document.status})`);
  line('policy', `${opened.policy.document.policyVersion}, ${opened.policy.document.scale} scale`);
  line('mode', opened.policy.document.mode);
  line(
    'thresholds',
    `warn ${opened.policy.document.thresholds.warn}, block ${opened.policy.document.thresholds.block}`,
  );
  line('jurisdiction', `${opened.jurisdiction.ruleset.id} (${opened.jurisdiction.ruleset.name})`);
  const pending = opened.jurisdiction.pendingProvisions();
  line(
    'pending provisions',
    pending.length === 0
      ? 'none'
      : `${pending.length} listed, not applied as law`,
  );
  line('register signature', opened.register.signatureValid ? 'verified' : 'INVALID');
  line('standing signature', opened.standing.signatureValid ? 'verified' : 'INVALID');

  console.log('');
  console.log('providers');
  if (opened.providers.list().length === 0) {
    line('none', 'copy data/providers.demo.json to .advocate/providers.json');
  }
  for (const p of opened.providers.list()) {
    line(p.id, `${p.model} at ${p.baseUrl}, standing ${opened.advocate.standingFor(p)}`);
  }

  const view = opened.advocate.exportView('2000-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z');
  console.log('');
  console.log('what would leave this device');
  if (view.outboundContentPaths.length === 0) {
    line('content', 'nothing. No configured path sends conversation content anywhere');
  }
  for (const path of view.outboundContentPaths) line('content', path);
  line('rates', opened.policy.document.telemetry.endpoint ?? 'no telemetry endpoint configured, nothing receives them');

  console.log('');
  console.log('what this advocate says about itself');
  for (const w of opened.warnings) console.log(`  - ${w}`);

  opened.store.close();
} catch (err) {
  console.log('');
  console.log(`could not open the advocate: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('');
