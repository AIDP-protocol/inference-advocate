// Key hierarchy: one user-held master secret, per-store keys derived from it.
//
// Paper: Section 6 ("Everything else stays on the device ... components holding store keys
// strictly by function"). Provisional: Mechanism 2, Section 2.2a.
//
// What is real here: the derivation, the per-store separation, and the fact that a component
// handed one store key cannot read another store. What is deferred: hardware backing, the
// recovery spectrum, and the attestation wallet. Those are named in ARCHITECTURE.md as gaps.
//
// Custody crypto is pure TypeScript (vendored @noble/hashes and @noble/ciphers) so MasterSecret
// / StoreKey stay synchronous and free of node:crypto. Random salts and IVs use
// globalThis.crypto.getRandomValues (Web Crypto), matching Ed25519 seal key generation.
// Web Crypto has no scrypt, so a SubtleCrypto-only path would still need a pure-TS KDF and
// would force async seal/open; keeping sync matches the ledger SHA-256 decision.

import { aes256GcmOpen, aes256GcmSeal } from './aes-gcm.js';
import { hkdf } from './vendor/noble-hashes/hkdf.js';
import { scrypt } from './vendor/noble-hashes/scrypt.js';
import { sha256 } from './vendor/noble-hashes/sha2.js';

export type StoreName = 'transcript' | 'preference' | 'ledger' | 'attestation' | 'monitor';

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const INFO_PREFIX = 'aidp/advocate/store/';

/** CSPRNG bytes via Web Crypto. Available on Node 19+ without importing node:crypto. */
function randomBytes(n: number): Buffer {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error('crypto.getRandomValues must be defined');
  const out = new Uint8Array(n);
  c.getRandomValues(out);
  return Buffer.from(out);
}

/** The master secret. Held by the user, never by any operator. */
export class MasterSecret {
  readonly #bytes: Buffer;

  private constructor(bytes: Buffer) {
    this.#bytes = bytes;
  }

  /**
   * Derive a master secret from a passphrase and a stored salt.
   * The reference implementation uses scrypt, a memory-hard KDF, per the provisional's
   * requirement that the fallback not be a short user-invented password run through
   * something cheap. Generate the passphrase from a wordlist.
   */
  static fromPassphrase(passphrase: string, salt: Buffer): MasterSecret {
    if (salt.length < SALT_BYTES) throw new Error('salt too short');
    const bytes = scrypt(passphrase, salt, {
      N: 2 ** 15,
      r: 8,
      p: 1,
      dkLen: KEY_BYTES,
      maxmem: 128 * 1024 * 1024,
    });
    return new MasterSecret(Buffer.from(bytes));
  }

  /** For tests and for the demo, where no human is present to type a passphrase. */
  static fromBytes(bytes: Buffer): MasterSecret {
    if (bytes.length !== KEY_BYTES) throw new Error(`master secret must be ${KEY_BYTES} bytes`);
    return new MasterSecret(Buffer.from(bytes));
  }

  static generate(): MasterSecret {
    return new MasterSecret(randomBytes(KEY_BYTES));
  }

  static newSalt(): Buffer {
    return randomBytes(SALT_BYTES);
  }

  /**
   * Per-store key by HKDF. A component is handed exactly the StoreKey objects its function
   * requires, and holds no path back to the master secret.
   */
  deriveStoreKey(store: StoreName): StoreKey {
    // Empty salt matches the previous node:crypto hkdfSync call (Buffer.alloc(0)), not the
    // RFC "salt omitted" case of HashLen zeros. Pass a zero-length array, not undefined.
    const derived = hkdf(sha256, this.#bytes, new Uint8Array(0), INFO_PREFIX + store, KEY_BYTES);
    return new StoreKey(store, Buffer.from(derived));
  }
}

/**
 * A key scoped to one store. Least privilege by key scope is a claimed element of the
 * architecture: the telemetry emitter is given a ledger StoreKey and no transcript StoreKey,
 * so it is structurally incapable of reading what it is not permitted to transmit.
 */
export class StoreKey {
  readonly store: StoreName;
  readonly #bytes: Buffer;

  constructor(store: StoreName, bytes: Buffer) {
    this.store = store;
    this.#bytes = bytes;
  }

  /** AES-256-GCM. Output is salt-free because the key is already store-scoped. */
  seal(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const { ct, tag } = aes256GcmSeal(this.#bytes, iv, new TextEncoder().encode(plaintext));
    return `v1.${iv.toString('base64url')}.${Buffer.from(tag).toString('base64url')}.${Buffer.from(ct).toString('base64url')}`;
  }

  open(sealed: string): string {
    const parts = sealed.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('malformed sealed value');
    const iv = Buffer.from(parts[1]!, 'base64url');
    const tag = Buffer.from(parts[2]!, 'base64url');
    const ct = Buffer.from(parts[3]!, 'base64url');
    try {
      return new TextDecoder().decode(aes256GcmOpen(this.#bytes, iv, ct, tag));
    } catch {
      throw new Error('unable to open sealed value');
    }
  }
}
