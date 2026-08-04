// The AIRP Interchange, bootstrapped on the OpenAI-compatible de facto wire format.
//
// Paper: steps 3 and 6.
// Spec: draft-flores-airp-provenance-00 §3.8, §7.1.
//
// Bootstrap decision. A new wire format that nobody serves is not an existence proof, so the
// reference advocate speaks the format every provider already speaks and carries the AIRP
// additions in places an unmodified server ignores:
//
//   outbound  AIRP-Exchange-Id, X-AIDP-Version, X-AIDP-Attestations
//             Cache-Control: no-store (when an exchange id is present)
//   inbound   AIRP-Seal                            (response header, base64url JSON)
//             AIDP-Seal, X-AIDP-Seal               (legacy, accepted on read only)
//
// A provider that knows nothing about AIRP therefore still answers, and its responses arrive
// unsealed, which is a finding rather than an error. That is the whole migration path: the
// advocate works on day one against the installed base and gets stricter as providers register.
//
// The body-carried seal path is gone: the draft no longer defines one.

import type { AttestationPackage, ProvenanceSeal } from '../types.js';
import type { SealFieldName } from '../crypto/seal.js';
import { parseJsonNoDuplicates } from './json-strict.js';

export const AIDP_VERSION = '0.1';

export const HEADER_VERSION = 'x-aidp-version';
export const HEADER_ATTESTATIONS = 'x-aidp-attestations';
export const HEADER_EXCHANGE_ID = 'airp-exchange-id';

/**
 * The registered response field name. draft-flores-airp-provenance Section 7.1 registers
 * AIRP-Seal and leaves the X-form unregistered per RFC 6648.
 */
export const HEADER_SEAL = 'airp-seal';

/**
 * Pre-rename registered name. Section 7.1 permits a verifier to accept it for compatibility.
 * Prefer AIRP-Seal where both are present. Read only: nothing in this repository emits it.
 */
export const HEADER_SEAL_LEGACY = 'aidp-seal';

/**
 * The name earlier builds emitted. Section 7.1 permits a verifier to accept it for
 * compatibility. Read only: nothing in this repository emits it.
 */
export const HEADER_SEAL_DEPRECATED = 'x-aidp-seal';

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
    const text = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = parseJsonNoDuplicates(text) as ProvenanceSeal;
    if (!parsed || typeof parsed !== 'object') return undefined;
    if (typeof parsed.signature !== 'string' || parsed.alg !== 'ed25519') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Resolve which seal header to use. Multiples of the registered name are invalid.
 * Prefer AIRP-Seal over legacy names. Spec §3.8.3 / §7.1.
 */
export function selectSealHeader(headers: Headers): {
  value?: string;
  fieldName?: SealFieldName;
  multipleAirpSeals: boolean;
} {
  // Fetch joins duplicate field values with ", ". base64url never contains a comma, so a
  // comma in the registered-name value means more than one AIRP-Seal was present.
  const airpRaw = headers.get(HEADER_SEAL);
  if (airpRaw !== null) {
    if (airpRaw.includes(',')) return { multipleAirpSeals: true };
    return { value: airpRaw, fieldName: 'airp-seal', multipleAirpSeals: false };
  }
  const legacy = headers.get(HEADER_SEAL_LEGACY);
  if (legacy !== null) {
    if (legacy.includes(',')) return { multipleAirpSeals: true };
    return { value: legacy, fieldName: 'aidp-seal', multipleAirpSeals: false };
  }
  const deprecated = headers.get(HEADER_SEAL_DEPRECATED);
  if (deprecated !== null) {
    if (deprecated.includes(',')) return { multipleAirpSeals: true };
    return { value: deprecated, fieldName: 'x-aidp-seal', multipleAirpSeals: false };
  }
  return { multipleAirpSeals: false };
}

/** The subset of the OpenAI chat completions response the advocate reads. */
export interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { role?: string; content?: string | null } }>;
}
