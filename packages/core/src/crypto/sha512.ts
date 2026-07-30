// Synchronous SHA-512 with no Node or WebCrypto dependency.
//
// Paper: steps 5 and 7 (Ed25519 seal signing and verification). RFC 8032 hashes the
// private key and the signing transcript with SHA-512. WebCrypto's digest is async, and
// making signSeal / verifySeal async would ripple through the monitor and the mock
// provider. A small pure-TypeScript SHA-512 keeps those APIs synchronous and portable,
// the same tradeoff as sha256.ts for ledger hashing.

const K = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

const MASK64 = 0xffffffffffffffffn;

function rotr(x: bigint, n: number): bigint {
  return ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK64;
}

function pad(bytes: Uint8Array): Uint8Array {
  const bitLen = BigInt(bytes.length) * 8n;
  const withOne = bytes.length + 1;
  const paddedLen = (withOne + 16 + 127) & ~127;
  const out = new Uint8Array(paddedLen);
  out.set(bytes);
  out[bytes.length] = 0x80;
  const view = new DataView(out.buffer);
  // SHA-512 length is a 128-bit big-endian bit count; high 64 bits stay zero for our sizes.
  const hi = bitLen >> 64n;
  const lo = bitLen & MASK64;
  view.setBigUint64(paddedLen - 16, hi);
  view.setBigUint64(paddedLen - 8, lo);
  return out;
}

/** Raw SHA-512 digest. Byte-identical to node:crypto createHash('sha512').digest(). */
export function sha512(message: Uint8Array): Uint8Array {
  const data = pad(message);
  let h0 = 0x6a09e667f3bcc908n;
  let h1 = 0xbb67ae8584caa73bn;
  let h2 = 0x3c6ef372fe94f82bn;
  let h3 = 0xa54ff53a5f1d36f1n;
  let h4 = 0x510e527fade682d1n;
  let h5 = 0x9b05688c2b3e6c1fn;
  let h6 = 0x1f83d9abfb41bd6bn;
  let h7 = 0x5be0cd19137e2179n;

  const w = new Array<bigint>(80);
  const view = new DataView(data.buffer);

  for (let offset = 0; offset < data.length; offset += 128) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getBigUint64(offset + i * 8);
    }
    for (let i = 16; i < 80; i++) {
      const s0 = rotr(w[i - 15]!, 1) ^ rotr(w[i - 15]!, 8) ^ (w[i - 15]! >> 7n);
      const s1 = rotr(w[i - 2]!, 19) ^ rotr(w[i - 2]!, 61) ^ (w[i - 2]! >> 6n);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) & MASK64;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 80; i++) {
      const S1 = rotr(e, 14) ^ rotr(e, 18) ^ rotr(e, 41);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i]! + w[i]!) & MASK64;
      const S0 = rotr(a, 28) ^ rotr(a, 34) ^ rotr(a, 39);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & MASK64;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK64;
    }

    h0 = (h0 + a) & MASK64;
    h1 = (h1 + b) & MASK64;
    h2 = (h2 + c) & MASK64;
    h3 = (h3 + d) & MASK64;
    h4 = (h4 + e) & MASK64;
    h5 = (h5 + f) & MASK64;
    h6 = (h6 + g) & MASK64;
    h7 = (h7 + h) & MASK64;
  }

  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  outView.setBigUint64(0, h0);
  outView.setBigUint64(8, h1);
  outView.setBigUint64(16, h2);
  outView.setBigUint64(24, h3);
  outView.setBigUint64(32, h4);
  outView.setBigUint64(40, h5);
  outView.setBigUint64(48, h6);
  outView.setBigUint64(56, h7);
  return out;
}
