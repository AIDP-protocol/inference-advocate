#!/usr/bin/env node
// Build a register document that verifies against the pinned registrar key but
// carries substituted sealing keys for honestmodel.win.entry.
//
// Spec: draft-flores-airp-provenance-00 §4.8.
// Paper: Section 4.7 (the k tag closes a two-party forgery that a registrar
// signature alone cannot).
//
// The client must refuse this document on key_set_digest_mismatch, not on
// signature failure. Those are different attacks. Re-run to regenerate the
// committed fixture under data/register/.

import { generateKeyPairSync, sign, createPublicKey, createPrivateKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registerPath = join(root, 'data/register/serving-register.json');
const outDoc = join(root, 'data/register/serving-register.substituted-keys.json');
const outSig = join(root, 'data/register/serving-register.substituted-keys.sig');
const registrarPrivPath = join(root, 'data/demo-keys/registrar-private.pem');
const registrarPubPath = join(root, 'data/register/registrar-public.pem');
const TARGET_ENTRY = 'honestmodel.win.entry';

function publicPemFromPrivate(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

const registrarPrivate = readFileSync(registrarPrivPath, 'utf8');
const derived = publicPemFromPrivate(registrarPrivate);
const pinned = readFileSync(registrarPubPath, 'utf8');
if (derived !== pinned) {
  throw new Error('registrar-private.pem does not match registrar-public.pem; refusing');
}

const document = JSON.parse(readFileSync(registerPath, 'utf8'));
const entry = document.entries.find((e) => e.id === TARGET_ENTRY);
if (!entry) throw new Error(`missing ${TARGET_ENTRY}`);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const substitutedPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
// Keep the private key out of the committed tree: this fixture is for refusal demos only.
void privateKey;

const originalPem = entry.keys[0]?.publicKeyPem;
if (!originalPem) throw new Error(`${TARGET_ENTRY} has no keys`);
if (substitutedPem === originalPem) {
  throw new Error('substituted key collided with the real key; re-run');
}

entry.keys = [
  {
    selector: entry.keys[0].selector,
    publicKeyPem: substitutedPem,
    status: 'current',
  },
];
document.issuedAt = new Date().toISOString();
// Mark the document so a human reading the file cannot mistake it for the live register.
document._airpFixture = {
  purpose: 'key-set-digest-mismatch',
  note:
    'Valid registrar signature, substituted keys on honestmodel.win.entry. ' +
    'Client must refuse on key_set_digest_mismatch, not signature failure.',
};

const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
const signature = sign(null, bytes, { key: registrarPrivate }).toString('base64url');
writeFileSync(outDoc, bytes);
writeFileSync(outSig, signature + '\n', 'utf8');

console.log(`wrote ${outDoc}`);
console.log(`wrote ${outSig}`);
console.log(`substituted ${TARGET_ENTRY} sealing key (registrar signature still verifies)`);
