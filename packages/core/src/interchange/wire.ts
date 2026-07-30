// The AIDP Interchange, bootstrapped on the OpenAI-compatible de facto wire format.
//
// Paper: steps 3 and 6. "An open, standardized client-to-provider wire standard, so that any
// certified advocate can front any registered provider."
// Bootstrap decision. A new wire format that nobody serves is not an existence proof, so the
// reference advocate speaks the format every provider already speaks and carries the AIDP
// additions in places an unmodified server ignores:
//
//   outbound  X-AIDP-Version, X-AIDP-Attestations  (request headers)
//   inbound   X-AIDP-Seal                          (response header, base64url JSON)
//             body field aidp_seal                 (accepted as an alternative)
//
// A provider that knows nothing about AIDP therefore still answers, and its responses arrive
// unsealed, which is a finding rather than an error. That is the whole migration path: the
// advocate works on day one against the installed base and gets stricter as providers register.

import type { AttestationPackage, ProvenanceSeal } from '../types.js';

export const AIDP_VERSION = '0.1';

export const HEADER_VERSION = 'x-aidp-version';
export const HEADER_ATTESTATIONS = 'x-aidp-attestations';
export const HEADER_SEAL = 'x-aidp-seal';

export function encodeAttestations(pkg: AttestationPackage): string {
  return Buffer.from(JSON.stringify(pkg), 'utf8').toString('base64url');
}

export function decodeAttestations(value: string): AttestationPackage {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as AttestationPackage;
}

export function encodeSeal(seal: ProvenanceSeal): string {
  return Buffer.from(JSON.stringify(seal), 'utf8').toString('base64url');
}

export function decodeSeal(value: string): ProvenanceSeal | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ProvenanceSeal;
    if (!parsed || typeof parsed !== 'object') return undefined;
    if (typeof parsed.signature !== 'string' || parsed.alg !== 'ed25519') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/** The subset of the OpenAI chat completions response the advocate reads. */
export interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { role?: string; content?: string | null } }>;
  aidp_seal?: ProvenanceSeal;
}
