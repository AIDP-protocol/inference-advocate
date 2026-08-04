// Public mock providers for the AIRP demo domains (honestmodel.win / cheapai.win).
//
// Paper: steps 4 and 5.
// Spec: draft-flores-airp-provenance-00 §3.8 / §4.
//
// Separate from mock-servers.ts so the tryaidp.com loopback mocks stay untouched.
// Listens on 127.0.0.1 only; Apache reverse-proxies the public API hostnames here.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockProvider } from './mock-provider.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');

const HONEST_SCRIPT = [
  'This response is sealed by honestmodel.win through the public API endpoint.',
];
const CHEAP_SCRIPT = [
  'This response is sealed by cheapai.win through the public API endpoint.',
];

const running = await Promise.all([
  startMockProvider({
    port: 8821,
    model: 'honestmodel-1',
    script: HONEST_SCRIPT,
    seal: {
      registerEntryId: 'honestmodel.win.entry',
      selector: 's1',
      privateKeyPem: readFileSync(join(dataDir, 'demo-keys', 'provider-honestmodel-private.pem'), 'utf8'),
      providerIdentity: 'honestmodel.win',
    },
  }),
  startMockProvider({
    port: 8822,
    model: 'cheapai-1',
    script: CHEAP_SCRIPT,
    seal: {
      registerEntryId: 'cheapai.win.entry',
      selector: 's1',
      privateKeyPem: readFileSync(join(dataDir, 'demo-keys', 'provider-cheapai-private.pem'), 'utf8'),
      providerIdentity: 'cheapai.win',
    },
  }),
]);

for (const s of running) console.log(`public mock provider on ${s.baseUrl}`);
console.log('ctrl-c to stop');

process.on('SIGINT', () => {
  void Promise.all(running.map((s) => s.close())).then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void Promise.all(running.map((s) => s.close())).then(() => process.exit(0));
});
