import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  generateSealKeypair,
  MasterSecret,
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
