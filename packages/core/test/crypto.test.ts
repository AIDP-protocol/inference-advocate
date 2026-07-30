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
  generateSealKeypair,
  MasterSecret,
  StoreKey,
  signDocument,
  signSeal,
  verifyDocument,
  verifySeal,
} from '@aidp/core';
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
    hkdfSync('sha256', ikm, Buffer.alloc(0), 'aidp/advocate/store/transcript', 32),
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
  const content = 'The answer is forty two.';
  const seal = signSeal(
    {
      registerEntryId: 'demo.aligned',
      selector: 's1',
      model: 'aligned-1',
      providerIdentity: 'Aligned Reference Models (demo)',
      signedAt: '2026-07-28T00:00:00.000Z',
      content,
    },
    privateKeyPem,
  );
  assert.equal(verifySeal(seal, content, publicKeyPem), true);
  assert.equal(verifySeal(seal, content.replace('forty two', 'forty three'), publicKeyPem), false);
});

test('a seal does not verify under another provider key', () => {
  const a = generateSealKeypair();
  const b = generateSealKeypair();
  const seal = signSeal(
    {
      registerEntryId: 'demo.aligned',
      selector: 's1',
      model: 'aligned-1',
      providerIdentity: 'x',
      signedAt: '2026-07-28T00:00:00.000Z',
      content: 'hello',
    },
    a.privateKeyPem,
  );
  assert.equal(verifySeal(seal, 'hello', b.publicKeyPem), false);
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
  const content = 'node-minted seal body';
  const subject = {
    registerEntryId: 'demo.aligned',
    selector: 's1',
    model: 'aligned-1',
    providerIdentity: 'node',
    signedAt: '2026-07-28T00:00:00.000Z',
    content,
  };
  const payload = Buffer.from(
    [
      'aidp-seal/v1',
      `register-entry:${subject.registerEntryId}`,
      `selector:${subject.selector}`,
      `model:${subject.model}`,
      `provider:${subject.providerIdentity}`,
      `signed-at:${subject.signedAt}`,
      `content-length:${Buffer.byteLength(content, 'utf8')}`,
      '',
      content,
    ].join('\n'),
    'utf8',
  );
  const nodeSealSig = sign(null, payload, privateKey).toString('base64url');
  assert.equal(
    verifySeal(
      {
        registerEntryId: subject.registerEntryId,
        selector: subject.selector,
        model: subject.model,
        providerIdentity: subject.providerIdentity,
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
  const content = 'advocate-minted seal body';
  const seal = signSeal(
    {
      registerEntryId: 'demo.aligned',
      selector: 's1',
      model: 'aligned-1',
      providerIdentity: 'advocate',
      signedAt: '2026-07-28T00:00:00.000Z',
      content,
    },
    privateKeyPem,
  );
  const payload = Buffer.from(
    [
      'aidp-seal/v1',
      `register-entry:${seal.registerEntryId}`,
      `selector:${seal.selector}`,
      `model:${seal.model}`,
      `provider:${seal.providerIdentity}`,
      `signed-at:${seal.signedAt}`,
      `content-length:${Buffer.byteLength(content, 'utf8')}`,
      '',
      content,
    ].join('\n'),
    'utf8',
  );
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
