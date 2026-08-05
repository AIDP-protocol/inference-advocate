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
  canonicalAirpPresealPayload,
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
      alg: 'ed25519',
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
      alg: 'ed25519',
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
    alg: 'ed25519',
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

test('the terminal-seal payload is byte exact against the draft layout', () => {
  // Written from draft-flores-airp-provenance-00 Section 3.6 rather than from the builder:
  // version token, the eight header fields in order, content-length, an empty line, then the
  // content octets. A payload assembled from the code would only assert the code agrees with
  // itself, which is how the missing alg line survived signer and verifier sharing a builder.
  const content = new TextEncoder().encode('forty two');
  const payload = canonicalAirpSealPayload({
    registerEntryId: 'demo.aligned',
    selector: 's1',
    alg: 'ed25519',
    model: 'aligned-1',
    providerIdentity: 'Aligned Reference Models (demo)',
    exchangeId: 'AAAAAAAAAAAAAAAAAAAAAA',
    requestDigest: 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    signedAt: '2026-07-28T00:00:00.000Z',
    content,
  });

  const expected = Buffer.concat([
    Buffer.from(
      'airp-seal/v1\n' +
        'register-entry:demo.aligned\n' +
        'selector:s1\n' +
        'alg:ed25519\n' +
        'model:aligned-1\n' +
        'provider:Aligned Reference Models (demo)\n' +
        'exchange-id:AAAAAAAAAAAAAAAAAAAAAA\n' +
        'request-digest:sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n' +
        'signed-at:2026-07-28T00:00:00.000Z\n' +
        'content-length:9\n' +
        '\n',
      'utf8',
    ),
    Buffer.from(content),
  ]);
  assert.deepEqual(Buffer.from(payload), expected);
});

test('the pre-seal payload is byte exact against the draft layout and ends after signed-at', () => {
  // Written from draft-flores-airp-provenance-00 Section 3.6: the same eight header fields as a
  // terminal seal, and then nothing. No content-length line, no empty line, no content.
  const payload = canonicalAirpPresealPayload({
    registerEntryId: 'demo.aligned',
    selector: 's1',
    alg: 'ed25519',
    model: 'aligned-1',
    providerIdentity: 'Aligned Reference Models (demo)',
    exchangeId: 'AAAAAAAAAAAAAAAAAAAAAA',
    requestDigest: 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    signedAt: '2026-07-28T00:00:00.000Z',
  });

  const expected = Buffer.from(
    'airp-preseal/v1\n' +
      'register-entry:demo.aligned\n' +
      'selector:s1\n' +
      'alg:ed25519\n' +
      'model:aligned-1\n' +
      'provider:Aligned Reference Models (demo)\n' +
      'exchange-id:AAAAAAAAAAAAAAAAAAAAAA\n' +
      'request-digest:sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n' +
      'signed-at:2026-07-28T00:00:00.000Z\n',
    'utf8',
  );
  assert.deepEqual(Buffer.from(payload), expected);

  const text = new TextDecoder().decode(payload);
  assert.ok(text.endsWith('signed-at:2026-07-28T00:00:00.000Z\n'));
  assert.equal(text.includes('content-length:'), false);
  assert.equal(text.includes('\n\n'), false);
});

test('a pre-seal payload is not a terminal payload over the same fields', () => {
  const fields = {
    registerEntryId: 'demo.aligned',
    selector: 's1',
    alg: 'ed25519',
    model: 'aligned-1',
    providerIdentity: 'Aligned Reference Models (demo)',
    exchangeId: 'AAAAAAAAAAAAAAAAAAAAAA',
    requestDigest: 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    signedAt: '2026-07-28T00:00:00.000Z',
  };
  // Empty content is the case where the two payloads would come closest, so it is the one
  // worth pinning: a pre-seal is shorter by the content-length line and the empty line, not
  // merely different in its version token.
  const preseal = canonicalAirpPresealPayload(fields);
  const terminal = canonicalAirpSealPayload({ ...fields, content: new Uint8Array() });
  assert.notDeepEqual(Buffer.from(preseal), Buffer.from(terminal));
  assert.equal(
    new TextDecoder().decode(terminal),
    new TextDecoder().decode(preseal).replace('airp-preseal/v1', 'airp-seal/v1') +
      'content-length:0\n\n',
  );
});

test('an alg substitution changes the payload and invalidates the signature', () => {
  const { publicKeyPem, privateKeyPem } = generateSealKeypair();
  const content = new TextEncoder().encode('the answer');
  const fields = {
    registerEntryId: 'demo.aligned',
    selector: 's1',
    model: 'aligned-1',
    providerIdentity: 'Aligned Reference Models (demo)',
    exchangeId: 'AAAAAAAAAAAAAAAAAAAAAA',
    requestDigest: 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    signedAt: '2026-07-28T00:00:00.000Z',
  };

  const declared = canonicalAirpSealPayload({ ...fields, alg: 'ed25519', content });
  const substituted = canonicalAirpSealPayload({ ...fields, alg: 'ed25519-ph', content });
  assert.notDeepEqual(Buffer.from(declared), Buffer.from(substituted));

  // signDocument is a raw Ed25519 signer over bytes, so this stands in for a provider that
  // signed one algorithm's payload and published another in the field a verifier reads.
  const substitutedSignature = signDocument(Buffer.from(substituted), privateKeyPem);
  assert.equal(
    verifySeal({ ...fields, alg: 'ed25519', signature: substitutedSignature }, content, publicKeyPem),
    false,
  );

  const honestSignature = signDocument(Buffer.from(declared), privateKeyPem);
  assert.equal(
    verifySeal({ ...fields, alg: 'ed25519', signature: honestSignature }, content, publicKeyPem),
    true,
  );

  // And the signer refuses to mint one, so the divergence cannot originate here either.
  assert.throws(() => signSeal({ ...fields, alg: 'ed25519-ph', content }, privateKeyPem), /ed25519 only/);
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
    alg: 'ed25519' as const,
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
    `alg:${subject.alg}\n` +
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
        alg: subject.alg,
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
      alg: 'ed25519',
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
    `alg:${seal.alg}\n` +
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
