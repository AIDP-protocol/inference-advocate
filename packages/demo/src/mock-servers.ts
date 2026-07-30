// Runs the demo mock providers and stays up, so the UI has something to talk to.
//
// `npm run mocks` in one terminal, `npm run daemon` in another, `npm run ui`
// in a third. Nothing listens on anything but the loopback interface.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockProvider } from './mock-provider.js';
import { ALIGNED_SCRIPT, COMPANION_RECOVERY, COMPANION_SCRIPT, LEGACY_SCRIPT } from './scripts.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');

const running = await Promise.all([
  startMockProvider({
    port: 8811,
    model: 'aligned-1',
    script: ALIGNED_SCRIPT,
    seal: {
      registerEntryId: 'demo.aligned',
      selector: 's1',
      privateKeyPem: readFileSync(join(dataDir, 'demo-keys', 'provider-aligned-private.pem'), 'utf8'),
      providerIdentity: 'Aligned Reference Models (demo)',
    },
  }),
  startMockProvider({
    port: 8812,
    model: 'companion-1',
    script: [...COMPANION_SCRIPT, COMPANION_RECOVERY],
    seal: {
      registerEntryId: 'demo.companion',
      selector: 's1',
      privateKeyPem: readFileSync(join(dataDir, 'demo-keys', 'provider-companion-private.pem'), 'utf8'),
      providerIdentity: 'Companion Labs (demo)',
    },
  }),
  startMockProvider({ port: 8813, model: 'legacy-1', script: LEGACY_SCRIPT }),
]);

for (const s of running) console.log(`mock provider on ${s.baseUrl}`);
console.log('ctrl-c to stop');

process.on('SIGINT', () => {
  void Promise.all(running.map((s) => s.close())).then(() => process.exit(0));
});
