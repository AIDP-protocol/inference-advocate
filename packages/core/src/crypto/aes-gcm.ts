// Thin typed face over vendored noble-ciphers AES-GCM.
//
// Paper: Mechanism 2 (local custody). The vendor wrapCipher signatures take an optional
// output buffer that TypeScript treats as required; this module keeps keys.ts typed and
// documents the seal format contract (ciphertext and 16-byte tag, separate in the v1 wire).

import { gcm as nobleGcm } from './vendor/noble-ciphers/aes.js';

const TAG_BYTES = 16;

type AesGcm = {
  encrypt(plaintext: Uint8Array): Uint8Array;
  decrypt(ciphertextAndTag: Uint8Array): Uint8Array;
};

function gcm(key: Uint8Array, iv: Uint8Array): AesGcm {
  // Vendored wrapCipher types require a second output arg; runtime treats it as optional.
  const cipher = nobleGcm(key, iv) as unknown as {
    encrypt(data: Uint8Array, output?: Uint8Array): Uint8Array;
    decrypt(data: Uint8Array, output?: Uint8Array): Uint8Array;
  };
  return {
    encrypt(plaintext) {
      return cipher.encrypt(plaintext);
    },
    decrypt(ciphertextAndTag) {
      return cipher.decrypt(ciphertextAndTag);
    },
  };
}

/** AES-256-GCM encrypt. Returns ciphertext and auth tag separately (matches prior node:crypto layout). */
export function aes256GcmSeal(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): { ct: Uint8Array; tag: Uint8Array } {
  const sealed = gcm(key, iv).encrypt(plaintext);
  return {
    ct: sealed.subarray(0, sealed.length - TAG_BYTES),
    tag: sealed.subarray(sealed.length - TAG_BYTES),
  };
}

/** AES-256-GCM decrypt. Throws if the auth tag does not verify. */
export function aes256GcmOpen(key: Uint8Array, iv: Uint8Array, ct: Uint8Array, tag: Uint8Array): Uint8Array {
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct, 0);
  combined.set(tag, ct.length);
  return gcm(key, iv).decrypt(combined);
}
