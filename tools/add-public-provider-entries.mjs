// Additive re-sign: append honestmodel.win and cheapai.win register entries and mint
// only their sealing keys. Does not regenerate the registrar, standing body, or demo.*
// provider keys. Run once when those public entries are introduced; safe to re-run only
// after removing the public private keys and entries if you intentionally want new ones.
//
// Spec: draft-flores-airp-provenance-00 §4.
// Paper: steps 4 and 5.

import { generateKeyPairSync, sign, createPublicKey, createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
const keysDir = join(dataDir, 'demo-keys');
const registerPath = join(dataDir, 'register', 'serving-register.json');
const registerSigPath = join(dataDir, 'register', 'serving-register.sig');
const registrarPrivPath = join(keysDir, 'registrar-private.pem');
const registrarPubPath = join(dataDir, 'register', 'registrar-public.pem');

const PUBLIC_ENTRIES = [
  {
    id: 'honestmodel.win.entry',
    providerIdentity: 'honestmodel.win',
    identityDomain: 'honestmodel.win',
    authorizedEndpoints: ['https://api.honestmodel.win/v1'],
    models: ['honestmodel-1'],
    contentBinding: 'sse-chat-delta-v1',
    sealPolicy: 'all',
    keyFile: 'provider-honestmodel-private.pem',
    selector: 's1',
  },
  {
    id: 'cheapai.win.entry',
    providerIdentity: 'cheapai.win',
    identityDomain: 'cheapai.win',
    authorizedEndpoints: ['https://api.cheapai.win/v1'],
    models: ['cheapai-1'],
    contentBinding: 'sse-chat-delta-v1',
    sealPolicy: 'all',
    keyFile: 'provider-cheapai-private.pem',
    selector: 's1',
  },
];

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function publicPemFromPrivate(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

function assertRegistrarUnchanged() {
  const priv = readFileSync(registrarPrivPath, 'utf8');
  const derived = publicPemFromPrivate(priv);
  const pinned = readFileSync(registrarPubPath, 'utf8');
  if (derived !== pinned) {
    throw new Error(
      'registrar-private.pem does not match registrar-public.pem; refusing to re-sign',
    );
  }
}

function writeSignedRegister(document, privateKeyPem) {
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
  writeFileSync(registerPath, bytes);
  const signature = sign(null, bytes, { key: privateKeyPem }).toString('base64url');
  writeFileSync(registerSigPath, signature + '\n', 'utf8');
}

assertRegistrarUnchanged();
mkdirSync(keysDir, { recursive: true });

const document = JSON.parse(readFileSync(registerPath, 'utf8'));
if (document.airpRegisterVersion !== '1') {
  throw new Error(`unexpected airpRegisterVersion ${document.airpRegisterVersion}`);
}

const existingIds = new Set(document.entries.map((e) => e.id));
for (const demoId of ['demo.aligned', 'demo.companion', 'demo.legacy', 'demo.excluded']) {
  if (!existingIds.has(demoId)) {
    throw new Error(`refusing to proceed: missing demo entry ${demoId}`);
  }
}

for (const spec of PUBLIC_ENTRIES) {
  const keyPath = join(keysDir, spec.keyFile);
  let publicKeyPem;
  if (existsSync(keyPath)) {
    publicKeyPem = publicPemFromPrivate(readFileSync(keyPath, 'utf8'));
    console.log(`keeping existing sealing key ${spec.keyFile}`);
  } else {
    const kp = keypair();
    writeFileSync(keyPath, kp.privateKeyPem);
    publicKeyPem = kp.publicKeyPem;
    console.log(`minted sealing key ${spec.keyFile}`);
  }

  const entry = {
    id: spec.id,
    providerIdentity: spec.providerIdentity,
    status: 'active',
    authorizedEndpoints: spec.authorizedEndpoints,
    models: spec.models,
    keys: [{ selector: spec.selector, publicKeyPem, status: 'current' }],
    sealPolicy: spec.sealPolicy,
    contentBinding: spec.contentBinding,
    identityDomain: spec.identityDomain,
  };

  const idx = document.entries.findIndex((e) => e.id === spec.id);
  if (idx >= 0) {
    document.entries[idx] = entry;
    console.log(`updated register entry ${spec.id}`);
  } else {
    document.entries.push(entry);
    console.log(`added register entry ${spec.id}`);
  }
}

document.issuedAt = new Date().toISOString();

const registrarPrivate = readFileSync(registrarPrivPath, 'utf8');
writeSignedRegister(document, registrarPrivate);
console.log('re-signed data/register/serving-register.json with existing registrar key');
