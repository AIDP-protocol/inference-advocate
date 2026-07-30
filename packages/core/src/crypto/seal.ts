// Provenance Seal signing and verification.
//
// Paper: step 5 (the provider signs) and step 7 (the advocate verifies). Ancestry: DKIM.
//
// The advocate only ever verifies. The signing half lives here too because the reference
// repository ships a mock provider that seals, and because a register of public keys is
// not testable without something that can produce a signature against it.
//
// Ed25519 is pure TypeScript (ed25519.ts / vendored noble), so this module does not import
// node:crypto. PEM encode/decode is fixed-size SPKI and PKCS8 for Ed25519 only.

import type { ProvenanceSeal } from '../types.js';
import {
  ed25519PublicKeyFromSeed,
  ed25519RandomSeed,
  ed25519Sign,
  ed25519Verify,
} from './ed25519.js';

/** SPKI prefix for a 32-byte Ed25519 public key (RFC 8410). */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
/** PKCS8 prefix for a 32-byte Ed25519 seed (RFC 8410). */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

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

function toPem(label: string, der: Buffer): string {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function fromPem(pem: string, label: string): Buffer {
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const start = pem.indexOf(begin);
  const stop = pem.indexOf(end);
  if (start < 0 || stop < 0 || stop <= start) throw new Error(`missing ${label} PEM envelope`);
  const body = pem.slice(start + begin.length, stop).replace(/\s+/g, '');
  return Buffer.from(body, 'base64');
}

function encodePublicKeyPem(publicKey: Uint8Array): string {
  return toPem('PUBLIC KEY', Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey)]));
}

function encodePrivateKeyPem(seed: Uint8Array): string {
  return toPem('PRIVATE KEY', Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]));
}

function decodePublicKeyPem(pem: string): Uint8Array {
  const der = fromPem(pem, 'PUBLIC KEY');
  if (der.length !== SPKI_PREFIX.length + 32 || !der.subarray(0, SPKI_PREFIX.length).equals(SPKI_PREFIX)) {
    throw new Error('unsupported Ed25519 public key PEM');
  }
  return new Uint8Array(der.subarray(SPKI_PREFIX.length));
}

function decodePrivateKeyPem(pem: string): Uint8Array {
  const der = fromPem(pem, 'PRIVATE KEY');
  if (der.length !== PKCS8_PREFIX.length + 32 || !der.subarray(0, PKCS8_PREFIX.length).equals(PKCS8_PREFIX)) {
    throw new Error('unsupported Ed25519 private key PEM');
  }
  return new Uint8Array(der.subarray(PKCS8_PREFIX.length));
}

export function generateSealKeypair(): { publicKeyPem: string; privateKeyPem: string } {
  const seed = ed25519RandomSeed();
  const publicKey = ed25519PublicKeyFromSeed(seed);
  return {
    publicKeyPem: encodePublicKeyPem(publicKey),
    privateKeyPem: encodePrivateKeyPem(seed),
  };
}

export function signSeal(subject: SealSubject, privateKeyPem: string): ProvenanceSeal {
  const seed = decodePrivateKeyPem(privateKeyPem);
  const signature = ed25519Sign(canonicalSealPayload(subject), seed);
  return {
    registerEntryId: subject.registerEntryId,
    selector: subject.selector,
    model: subject.model,
    providerIdentity: subject.providerIdentity,
    signedAt: subject.signedAt,
    alg: 'ed25519',
    signature: Buffer.from(signature).toString('base64url'),
  };
}

export function verifySeal(seal: ProvenanceSeal, content: string, publicKeyPem: string): boolean {
  if (seal.alg !== 'ed25519') return false;
  try {
    return ed25519Verify(
      Buffer.from(seal.signature, 'base64url'),
      canonicalSealPayload({
        registerEntryId: seal.registerEntryId,
        selector: seal.selector,
        model: seal.model,
        providerIdentity: seal.providerIdentity,
        signedAt: seal.signedAt,
        content,
      }),
      decodePublicKeyPem(publicKeyPem),
    );
  } catch {
    return false;
  }
}

/** Detached signature over an arbitrary document, used for the register and standing files. */
export function signDocument(bytes: Buffer, privateKeyPem: string): string {
  return Buffer.from(ed25519Sign(bytes, decodePrivateKeyPem(privateKeyPem))).toString('base64url');
}

export function verifyDocument(bytes: Buffer, signature: string, publicKeyPem: string): boolean {
  try {
    return ed25519Verify(
      Buffer.from(signature, 'base64url'),
      bytes,
      decodePublicKeyPem(publicKeyPem),
    );
  } catch {
    return false;
  }
}
