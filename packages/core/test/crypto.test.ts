import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  scryptSync,
  sign,
  verify,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  canonicalAirpSealPayload,
  generateSealKeypair,
  MasterSecret,
  StoreKey,
  signDocument,
  signSeal,
  verifyDocument,
  verifySeal,
} from '@airp/core';
import { dataPath } from './helpers.js';

test('per-store keys are distinct and do not open each other', () => {
  const master = MasterSecret.generate();
  const transcript = master.deriveStoreKey('transcript');
  const ledger = master.deriveStoreKey('ledger');

  const sealed = transcript.seal('the conversation');
  assert.equal(transcript.open(sealed), 'the conversation');
  assert.throws(() => ledger.open(sealed));
});

test('derivation is deterministic for the same master secret', () => {
  const bytes = Buffer.alloc(32, 7);
  const a = MasterSecret.fromBytes(bytes).deriveStoreKey('preference');
  const b = MasterSecret.fromBytes(bytes).deriveStoreKey('preference');
  assert.equal(b.open(a.seal('hello')), 'hello');
});

test('vendored custody crypto matches node:crypto scrypt and HKDF', () => {
  const salt = Buffer.alloc(16, 1);
  const fromPassphrase = MasterSecret.fromPassphrase('test-pass', salt);
  const nodeMaster = MasterSecret.fromBytes(
    Buffer.from(
      scryptSync('test-pass', salt, 32, {
        N: 2 ** 15,
        r: 8,
        p: 1,
        maxmem: 128 * 1024 * 1024,
      }),
    ),
  );
  assert.equal(
    fromPassphrase.deriveStoreKey('ledger').open(nodeMaster.deriveStoreKey('ledger').seal('scrypt')),
    'scrypt',
  );

  // Same master bytes yield the same store key as node hkdfSync with empty salt.
  const ikm = Buffer.alloc(32, 7);
  const nodeDerived = Buffer.from(
    hkdfSync('sha256', ikm, Buffer.alloc(0), 'airp/advocate/store/transcript', 32),
  );
  const portable = MasterSecret.fromBytes(ikm).deriveStoreKey('transcript');
  const probe = new StoreKey('transcript', nodeDerived);
  assert.equal(portable.open(probe.seal('custody interop')), 'custody interop');
  assert.equal(probe.open(portable.seal('custody interop')), 'custody interop');
});

test('StoreKey opens AES-GCM values sealed by node:crypto and vice versa', () => {
  const keyBytes = Buffer.alloc(32, 7);
  const key = new StoreKey('preference', keyBytes);
  const plaintext = 'previously sealed material';

  const iv = Buffer.alloc(12, 2);
  const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const nodeSealed = `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
  assert.equal(key.open(nodeSealed), plaintext);

  const portableSealed = key.seal(plaintext);
  const parts = portableSealed.split('.');
  assert.equal(parts[0], 'v1');
  const piv = Buffer.from(parts[1]!, 'base64url');
  const ptag = Buffer.from(parts[2]!, 'base64url');
  const pct = Buffer.from(parts[3]!, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes, piv);
  decipher.setAuthTag(ptag);
  assert.equal(Buffer.concat([decipher.update(pct), decipher.final()]).toString('utf8'), plaintext);
});

test('a provenance seal verifies over the exact content and fails on a single changed character', () => {
  const { publicKeyPem, privateKeyPem } = generateSealKeypair();
  const content = new TextEncoder().encode('The answer is forty two.');
  const seal = signSeal(
    {
      registerEntryId: 'demo.aligned',
      selector: 's1',
      model: 'aligned-1',
      providerIdentity: 'Aligned Reference Models (demo)',
      exchangeId: 'AAAAAAAAAAAAAAAAAAAAAA',
      requestDigest: 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      signedAt: '2026-07-28T00:00:00.000Z',
      content,
    },
    privateKeyPem,
  );
  assert.equal(verifySeal(seal, content, publicKeyPem), true);
  const tampered = new TextEncoder().encode('The answer is forty three.');
  assert.equal(verifySeal(seal, tampered, publicKeyPem), false);
});

test('a seal does not verify under another provider key', () => {
  const a = generateSealKeypair();
  const b = generateSealKeypair();
  const content = new TextEncoder().encode('hello');
  const seal = signSeal(
    {
      registerEntryId: 'demo.aligned',
      selector: 's1',
      model: 'aligned-1',
      providerIdentity: 'x',
      exchangeId: 'AAAAAAAAAAAAAAAAAAAAAA',
      requestDigest: 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      signedAt: '2026-07-28T00:00:00.000Z',
      content,
    },
    a.privateKeyPem,
  );
  assert.equal(verifySeal(seal, content, b.publicKeyPem), false);
});

test('canonical payload appends content octets without re-encoding', () => {
  const { publicKeyPem, privateKeyPem } = generateSealKeypair();
  // Non-UTF-8 body: lone continuation byte.
  const content = new Uint8Array([0x80, 0xff, 0x00, 0x41]);
  const subject = {
    registerEntryId: 'demo.aligned',
    selector: 's1',
    model: 'aligned-1',
    providerIdentity: 'x',
    exchangeId: 'AAAAAAAAAAAAAAAAAAAAAA',
    requestDigest: 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    signedAt: '2026-07-28T00:00:00.000Z',
    content,
  };
  const seal = signSeal(subject, privateKeyPem);
  assert.equal(verifySeal(seal, content, publicKeyPem), true);
  const payload = canonicalAirpSealPayload(subject);
  assert.deepEqual(payload.slice(payload.byteLength - content.byteLength), content);
  const header = new TextDecoder().decode(payload.slice(0, payload.byteLength - content.byteLength));
  assert.ok(header.startsWith('airp-seal/v1\n'));
  assert.ok(header.endsWith(`content-length:${content.byteLength}\n\n`));
});

test('detached document signatures detect a rewritten register', () => {
  const { publicKeyPem, privateKeyPem } = generateSealKeypair();
  const doc = Buffer.from('{"entries":[]}', 'utf8');
  const sig = signDocument(doc, privateKeyPem);
  assert.equal(verifyDocument(doc, sig, publicKeyPem), true);
  assert.equal(verifyDocument(Buffer.from('{"entries":[1]}', 'utf8'), sig, publicKeyPem), false);
});

test('vendored Ed25519 verifies seals and documents produced by node:crypto', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const content = new TextEncoder().encode('node-minted seal body');
  const subject = {
    registerEntryId: 'demo.aligned',
    selector: 's1',
    model: 'aligned-1',
    providerIdentity: 'node',
    exchangeId: 'AAAAAAAAAAAAAAAAAAAAAA',
    requestDigest: 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    signedAt: '2026-07-28T00:00:00.000Z',
    content,
  };
  const header =
    'airp-seal/v1\n' +
    `register-entry:${subject.registerEntryId}\n` +
    `selector:${subject.selector}\n` +
    `model:${subject.model}\n` +
    `provider:${subject.providerIdentity}\n` +
    `exchange-id:${subject.exchangeId}\n` +
    `request-digest:${subject.requestDigest}\n` +
    `signed-at:${subject.signedAt}\n` +
    `content-length:${content.byteLength}\n` +
    '\n';
  const payload = Buffer.concat([Buffer.from(header, 'utf8'), Buffer.from(content)]);
  const nodeSealSig = sign(null, payload, privateKey).toString('base64url');
  assert.equal(
    verifySeal(
      {
        registerEntryId: subject.registerEntryId,
        selector: subject.selector,
        model: subject.model,
        providerIdentity: subject.providerIdentity,
        exchangeId: subject.exchangeId,
        requestDigest: subject.requestDigest,
        signedAt: subject.signedAt,
        alg: 'ed25519',
        signature: nodeSealSig,
      },
      content,
      publicKeyPem,
    ),
    true,
  );

  const doc = Buffer.from('{"entries":[]}', 'utf8');
  const nodeDocSig = sign(null, doc, createPrivateKey(privateKeyPem)).toString('base64url');
  assert.equal(verifyDocument(doc, nodeDocSig, publicKeyPem), true);
});

test('node:crypto verifies seals and documents produced by vendored Ed25519', () => {
  const { publicKeyPem, privateKeyPem } = generateSealKeypair();
  const content = new TextEncoder().encode('advocate-minted seal body');
  const seal = signSeal(
    {
      registerEntryId: 'demo.aligned',
      selector: 's1',
      model: 'aligned-1',
      providerIdentity: 'advocate',
      exchangeId: 'AAAAAAAAAAAAAAAAAAAAAA',
      requestDigest: 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      signedAt: '2026-07-28T00:00:00.000Z',
      content,
    },
    privateKeyPem,
  );
  const header =
    'airp-seal/v1\n' +
    `register-entry:${seal.registerEntryId}\n` +
    `selector:${seal.selector}\n` +
    `model:${seal.model}\n` +
    `provider:${seal.providerIdentity}\n` +
    `exchange-id:${seal.exchangeId}\n` +
    `request-digest:${seal.requestDigest}\n` +
    `signed-at:${seal.signedAt}\n` +
    `content-length:${content.byteLength}\n` +
    '\n';
  const payload = Buffer.concat([Buffer.from(header, 'utf8'), Buffer.from(content)]);
  assert.equal(
    verify(null, payload, createPublicKey(publicKeyPem), Buffer.from(seal.signature, 'base64url')),
    true,
  );

  const doc = Buffer.from('{"entries":[]}', 'utf8');
  const sig = signDocument(doc, privateKeyPem);
  assert.equal(verify(null, doc, createPublicKey(publicKeyPem), Buffer.from(sig, 'base64url')), true);
});

test('shipped register and standing signatures verify under the pinned demo keys', () => {
  const registerBytes = readFileSync(dataPath('register', 'serving-register.json'));
  const registerSig = readFileSync(dataPath('register', 'serving-register.sig'), 'utf8').trim();
  const registrarPub = readFileSync(dataPath('register', 'registrar-public.pem'), 'utf8');
  assert.equal(verifyDocument(registerBytes, registerSig, registrarPub), true);
  assert.equal(verifyDocument(Buffer.from('{"tampered":true}\n'), registerSig, registrarPub), false);

  const standingBytes = readFileSync(dataPath('standing', 'standing.json'));
  const standingSig = readFileSync(dataPath('standing', 'standing.sig'), 'utf8').trim();
  const standingPub = readFileSync(dataPath('standing', 'standing-body-public.pem'), 'utf8');
  assert.equal(verifyDocument(standingBytes, standingSig, standingPub), true);
});
