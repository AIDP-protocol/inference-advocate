import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MasterSecret } from '../src/crypto/keys.js';
import { generateSealKeypair, signSeal, verifySeal, signDocument, verifyDocument } from '../src/crypto/seal.js';

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
