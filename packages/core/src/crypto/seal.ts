// Provenance Seal signing and verification.
//
// Paper: step 5 (the provider signs) and step 7 (the advocate verifies). Ancestry: DKIM.
//
// The advocate only ever verifies. The signing half lives here too because the reference
// repository ships a mock provider that seals, and because a register of public keys is
// not testable without something that can produce a signature against it.

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { ProvenanceSeal } from '../types.js';

export interface SealSubject {
  registerEntryId: string;
  selector: string;
  model: string;
  providerIdentity: string;
  signedAt: string;
  /** The served response text. */
  content: string;
}

/**
 * Canonical bytes over which the signature is computed. Field order is fixed here rather
 * than taken from object iteration order, so that two implementations agree.
 */
export function canonicalSealPayload(s: SealSubject): Buffer {
  const lines = [
    'aidp-seal/v1',
    `register-entry:${s.registerEntryId}`,
    `selector:${s.selector}`,
    `model:${s.model}`,
    `provider:${s.providerIdentity}`,
    `signed-at:${s.signedAt}`,
    `content-length:${Buffer.byteLength(s.content, 'utf8')}`,
    '',
    s.content,
  ];
  return Buffer.from(lines.join('\n'), 'utf8');
}

export function generateSealKeypair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function signSeal(subject: SealSubject, privateKeyPem: string): ProvenanceSeal {
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, canonicalSealPayload(subject), key);
  return {
    registerEntryId: subject.registerEntryId,
    selector: subject.selector,
    model: subject.model,
    providerIdentity: subject.providerIdentity,
    signedAt: subject.signedAt,
    alg: 'ed25519',
    signature: signature.toString('base64url'),
  };
}

export function verifySeal(seal: ProvenanceSeal, content: string, publicKeyPem: string): boolean {
  if (seal.alg !== 'ed25519') return false;
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(
      null,
      canonicalSealPayload({
        registerEntryId: seal.registerEntryId,
        selector: seal.selector,
        model: seal.model,
        providerIdentity: seal.providerIdentity,
        signedAt: seal.signedAt,
        content,
      }),
      key,
      Buffer.from(seal.signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

/** Detached signature over an arbitrary document, used for the register and standing files. */
export function signDocument(bytes: Buffer, privateKeyPem: string): string {
  return sign(null, bytes, createPrivateKey(privateKeyPem)).toString('base64url');
}

export function verifyDocument(bytes: Buffer, signature: string, publicKeyPem: string): boolean {
  try {
    return verify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}
