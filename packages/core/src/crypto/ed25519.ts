// Ed25519 sign, verify, and key generation for Provenance Seals.
//
// Paper: steps 5 and 7. Sync pure-TypeScript (vendored noble-ed25519 plus sha512.ts), so
// seal APIs stay synchronous and free of node:crypto. Random private keys use
// globalThis.crypto.getRandomValues (Web Crypto, available on Node 19+ without importing
// node:crypto). Verification uses RFC 8032 rules (zip215: false) to match node:crypto.

import { sha512 } from './sha512.js';
import {
  etc,
  getPublicKey,
  sign as nobleSign,
  utils,
  verify as nobleVerify,
} from './vendor/noble-ed25519.js';

etc.sha512Sync = (...messages: Uint8Array[]) => sha512(etc.concatBytes(...messages));

/** RFC 8032 verification, matching node:crypto rather than the ZIP215 default in noble. */
const RFC8032 = { zip215: false } as const;

export function ed25519PublicKeyFromSeed(seed: Uint8Array): Uint8Array {
  return getPublicKey(seed);
}

export function ed25519RandomSeed(): Uint8Array {
  return utils.randomPrivateKey();
}

export function ed25519Sign(message: Uint8Array, seed: Uint8Array): Uint8Array {
  return nobleSign(message, seed);
}

export function ed25519Verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return nobleVerify(signature, message, publicKey, RFC8032);
  } catch {
    return false;
  }
}
