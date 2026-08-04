// Mints the demo trust fabric: a registrar, a standing body, and sealing keys for the
// mock providers, then writes and signs the Serving Register and the Standing document.
//
// Paper: steps 4, 5, 7, 13 and 14.
//
// These keys are demonstration fixtures. They are committed on purpose, because a signed
// document nobody can verify teaches nothing, and they protect nothing of value. Do not
// reuse them for anything. Regenerate with `npm run keys`.

import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function writeSigned(path, object, privateKeyPem) {
  const bytes = Buffer.from(JSON.stringify(object, null, 2) + '\n', 'utf8');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  const signature = sign(null, bytes, { key: privateKeyPem }).toString('base64url');
  writeFileSync(path.replace(/\.json$/, '.sig'), signature + '\n', 'utf8');
}

const registrar = keypair();
const standingBody = keypair();
const aligned = keypair();
const companion = keypair();

mkdirSync(join(dataDir, 'demo-keys'), { recursive: true });
writeFileSync(join(dataDir, 'register', 'registrar-public.pem'), registrar.publicKeyPem);
writeFileSync(join(dataDir, 'demo-keys', 'registrar-private.pem'), registrar.privateKeyPem);
writeFileSync(join(dataDir, 'standing', 'standing-body-public.pem'), standingBody.publicKeyPem);
writeFileSync(join(dataDir, 'demo-keys', 'standing-body-private.pem'), standingBody.privateKeyPem);
writeFileSync(join(dataDir, 'demo-keys', 'provider-aligned-private.pem'), aligned.privateKeyPem);
writeFileSync(join(dataDir, 'demo-keys', 'provider-companion-private.pem'), companion.privateKeyPem);

const register = {
  airpRegisterVersion: '1',
  issuedAt: '2026-07-01T00:00:00.000Z',
  registrar: { id: 'demo-registrar', publicKeyPem: registrar.publicKeyPem },
  entries: [
    {
      id: 'demo.aligned',
      providerIdentity: 'Aligned Reference Models (demo)',
      status: 'active',
      authorizedEndpoints: ['http://127.0.0.1:8811/v1'],
      models: ['aligned-1'],
      keys: [{ selector: 's1', publicKeyPem: aligned.publicKeyPem, status: 'current' }],
      sealPolicy: 'all',
    },
    {
      id: 'demo.companion',
      providerIdentity: 'Companion Labs (demo)',
      status: 'active',
      authorizedEndpoints: ['http://127.0.0.1:8812/v1'],
      models: ['companion-1'],
      keys: [{ selector: 's1', publicKeyPem: companion.publicKeyPem, status: 'current' }],
      sealPolicy: 'all',
    },
    {
      id: 'demo.legacy',
      providerIdentity: 'Legacy Serving Co (demo, seals nothing)',
      status: 'active',
      authorizedEndpoints: ['http://127.0.0.1:8813/v1'],
      models: ['legacy-1'],
      keys: [],
      sealPolicy: 'none',
    },
    {
      id: 'demo.excluded',
      providerIdentity: 'Excluded Serving Co (demo)',
      status: 'active',
      authorizedEndpoints: ['http://127.0.0.1:8814/v1'],
      models: ['excluded-1'],
      keys: [],
      sealPolicy: 'none',
    },
  ],
};

const standing = {
  aidpStandingVersion: '0.1',
  body: { id: 'demo-standing-body', publicKeyPem: standingBody.publicKeyPem },
  issuedAt: '2026-07-01T00:00:00.000Z',
  thresholds: { warnRate: 0.05, exclusionRate: 0.15, minimumQuorumSources: 25 },
  providers: [
    {
      registerEntryId: 'demo.aligned',
      providerIdentity: 'Aligned Reference Models (demo)',
      state: 'good',
      incidentRate: 0.004,
      quorumSources: 1840,
      trafficClass: 'consumer',
      asOf: '2026-07-01T00:00:00.000Z',
    },
    {
      registerEntryId: 'demo.companion',
      providerIdentity: 'Companion Labs (demo)',
      state: 'elevated_scrutiny',
      incidentRate: 0.081,
      quorumSources: 1290,
      trafficClass: 'consumer',
      asOf: '2026-07-01T00:00:00.000Z',
    },
    {
      registerEntryId: 'demo.legacy',
      providerIdentity: 'Legacy Serving Co (demo)',
      state: 'good',
      incidentRate: 0.011,
      quorumSources: 310,
      trafficClass: 'consumer',
      asOf: '2026-07-01T00:00:00.000Z',
    },
    {
      registerEntryId: 'demo.excluded',
      providerIdentity: 'Excluded Serving Co (demo)',
      state: 'excluded',
      incidentRate: 0.213,
      quorumSources: 940,
      trafficClass: 'consumer',
      asOf: '2026-07-01T00:00:00.000Z',
    },
  ],
};

writeSigned(join(dataDir, 'register', 'serving-register.json'), register, registrar.privateKeyPem);
writeSigned(join(dataDir, 'standing', 'standing.json'), standing, standingBody.privateKeyPem);

console.log('minted demo trust fabric under data/');
console.log('  register  data/register/serving-register.json + .sig, pinned key registrar-public.pem');
console.log('  standing  data/standing/standing.json + .sig, pinned key standing-body-public.pem');
console.log('  provider sealing keys under data/demo-keys/');
