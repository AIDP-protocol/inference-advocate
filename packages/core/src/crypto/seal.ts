// Provenance Seal signing and verification.
//
// Paper: step 5 (the provider signs) and step 7 (the advocate verifies). Ancestry: DKIM.
// Spec: draft-flores-airp-provenance-00 §§3.4–3.6, §3.8, §6.7.
//
// The advocate only ever verifies. The signing half lives here too because the reference
// repository ships a mock provider that seals, and because a register of public keys is
// not testable without something that can produce a signature against it.
//
// Ed25519 is pure TypeScript (ed25519.ts / vendored noble), so this module does not import
// node:crypto. PEM encode/decode is fixed-size SPKI and PKCS8 for Ed25519 only.
//
// Canonical construction is octets: UTF-8 header block, then content bytes appended without
// re-encoding. Terminal-seal and pre-seal payloads are built on separate paths so a token
// from one cannot be substituted into the other.

import type { ProvenanceSeal } from '../types.js';
import {
  ed25519PublicKeyFromSeed,
  ed25519RandomSeed,
  ed25519Sign,
  ed25519Verify,
} from './ed25519.js';
import { sha256 } from './vendor/noble-hashes/sha2.js';

/** SPKI prefix for a 32-byte Ed25519 public key (RFC 8410). */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
/** PKCS8 prefix for a 32-byte Ed25519 seed (RFC 8410). */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const utf8 = new TextEncoder();

/** Header field that carried the seal. Spec §7.1 registers AIRP-Seal only. */
export type SealFieldName = 'airp-seal';

export interface SealSubject {
  registerEntryId: string;
  selector: string;
  model: string;
  providerIdentity: string;
  /** Base64url unpadded exchange identifier, or empty where the request carried none. */
  exchangeId: string;
  /** `sha-256=` + base64url unpadded digest of the request body. */
  requestDigest: string;
  signedAt: string;
  /** Sealed content octets (decompressed body, or binding-extracted stream bytes). */
  content: Uint8Array;
}

/**
 * Header field values are joined with LF, so a value containing LF or CR could forge a
 * header line inside the signed region and make two conforming implementations agree on
 * different parses of the same bytes. Field values are therefore constrained. `content` is
 * exempt: it is last and its byte length is bound in the header block above it.
 */
function assertNoLineBreak(field: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`seal field ${field} contains a line break`);
  }
}

function concatOctets(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * AIRP terminal-seal payload. Spec §3.6. Separate from the pre-seal builder on purpose:
 * do not factor the version token into a shared parameterized builder.
 */
export function canonicalAirpSealPayload(s: SealSubject): Uint8Array {
  assertNoLineBreak('register-entry', s.registerEntryId);
  assertNoLineBreak('selector', s.selector);
  assertNoLineBreak('model', s.model);
  assertNoLineBreak('provider', s.providerIdentity);
  assertNoLineBreak('exchange-id', s.exchangeId);
  assertNoLineBreak('request-digest', s.requestDigest);
  assertNoLineBreak('signed-at', s.signedAt);

  const header =
    'airp-seal/v1\n' +
    `register-entry:${s.registerEntryId}\n` +
    `selector:${s.selector}\n` +
    `model:${s.model}\n` +
    `provider:${s.providerIdentity}\n` +
    `exchange-id:${s.exchangeId}\n` +
    `request-digest:${s.requestDigest}\n` +
    `signed-at:${s.signedAt}\n` +
    `content-length:${s.content.byteLength}\n` +
    '\n';
  return concatOctets([utf8.encode(header), s.content]);
}

/** AIRP pre-seal payload. Spec §3.6. */
export function canonicalAirpPresealPayload(s: SealSubject): Uint8Array {
  assertNoLineBreak('register-entry', s.registerEntryId);
  assertNoLineBreak('selector', s.selector);
  assertNoLineBreak('model', s.model);
  assertNoLineBreak('provider', s.providerIdentity);
  assertNoLineBreak('exchange-id', s.exchangeId);
  assertNoLineBreak('request-digest', s.requestDigest);
  assertNoLineBreak('signed-at', s.signedAt);

  const header =
    'airp-preseal/v1\n' +
    `register-entry:${s.registerEntryId}\n` +
    `selector:${s.selector}\n` +
    `model:${s.model}\n` +
    `provider:${s.providerIdentity}\n` +
    `exchange-id:${s.exchangeId}\n` +
    `request-digest:${s.requestDigest}\n` +
    `signed-at:${s.signedAt}\n` +
    `content-length:${s.content.byteLength}\n` +
    '\n';
  return concatOctets([utf8.encode(header), s.content]);
}

/** Default canonical payload for newly minted seals (AIRP terminal). */
export function canonicalSealPayload(s: SealSubject): Uint8Array {
  return canonicalAirpSealPayload(s);
}

/** `sha-256=` + base64url unpadded SHA-256 of the request body. Spec §3.4. */
export function computeRequestDigest(requestBody: Uint8Array): string {
  return `sha-256=${Buffer.from(sha256(requestBody)).toString('base64url')}`;
}

/** At least 128 bits from a CSPRNG, base64url unpadded. Spec §3.8.1. */
export function generateExchangeId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
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

/** PEM body with armor and whitespace removed (DER SubjectPublicKeyInfo base64). Spec §4.8. */
export function pemSpkiBody(publicKeyPem: string): string {
  return fromPem(publicKeyPem, 'PUBLIC KEY').toString('base64');
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
  const signature = ed25519Sign(canonicalAirpSealPayload(subject), seed);
  return {
    registerEntryId: subject.registerEntryId,
    selector: subject.selector,
    model: subject.model,
    providerIdentity: subject.providerIdentity,
    exchangeId: subject.exchangeId,
    requestDigest: subject.requestDigest,
    signedAt: subject.signedAt,
    alg: 'ed25519',
    signature: Buffer.from(signature).toString('base64url'),
  };
}

/** Verify a seal over the AIRP terminal-seal payload. Spec §3.6 / §7.1. */
export function verifySeal(
  seal: ProvenanceSeal,
  content: Uint8Array,
  publicKeyPem: string,
): boolean {
  if (seal.alg !== 'ed25519') return false;
  try {
    const payload = canonicalAirpSealPayload({
      registerEntryId: seal.registerEntryId,
      selector: seal.selector,
      model: seal.model,
      providerIdentity: seal.providerIdentity,
      exchangeId: seal.exchangeId ?? '',
      requestDigest: seal.requestDigest ?? '',
      signedAt: seal.signedAt,
      content,
    });
    return ed25519Verify(Buffer.from(seal.signature, 'base64url'), payload, decodePublicKeyPem(publicKeyPem));
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
