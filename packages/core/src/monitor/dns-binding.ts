// DNS binding for register entry selection.
//
// Spec: draft-flores-airp-provenance-00 §4.7, §6.3, §8.8.
// Resolve `_airp` beneath the intended provider's identity domain. Where the lookup does not
// complete, fall back to the locally configured entry identifier. Never take an identifier
// from the response.

import { resolveTxt } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface AirpDnsBinding {
  /** Entry identifier from tag `e`. */
  entryId: string;
  /** Register location from tag `r` (https only). */
  registerUrl?: string;
  /** Key set digest from tag `k`. */
  keySetDigest?: string;
  /** Raw TTL guidance. Callers cache for the full TTL. */
  ttlHintSeconds?: number;
}

export type AirpDnsLookupResult =
  | { ok: true; binding: AirpDnsBinding }
  | { ok: false; reason: string };

/**
 * Parse a single TXT payload of `v=airp1;...` tags. Spec §4.7.
 * `v` must be first and must be `airp1`. Ignore unrecognized tags. Duplicated tags fail.
 */
export function parseAirpTxt(payload: string): AirpDnsLookupResult {
  const parts = payload.split(';').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, reason: 'empty TXT' };

  const tags = new Map<string, string>();
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const eq = part.indexOf('=');
    if (eq <= 0) return { ok: false, reason: `malformed tag: ${part}` };
    const name = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (i === 0) {
      if (name !== 'v' || value !== 'airp1') {
        return { ok: false, reason: 'first tag must be v=airp1' };
      }
    }
    if (tags.has(name)) return { ok: false, reason: `duplicated tag ${name}` };
    tags.set(name, value);
  }

  if (!tags.has('v') || tags.get('v') !== 'airp1') {
    return { ok: false, reason: 'missing v=airp1' };
  }

  const entryId = tags.get('e');
  if (!entryId) return { ok: false, reason: 'missing e tag' };

  const binding: AirpDnsBinding = { entryId };
  const registerUrl = tags.get('r');
  if (registerUrl !== undefined) {
    let url: URL;
    try {
      url = new URL(registerUrl);
    } catch {
      return { ok: false, reason: 'r tag is not a valid URL' };
    }
    if (url.protocol !== 'https:') return { ok: false, reason: 'r must be https' };
    if (isForbiddenAutoFetchHost(url.hostname)) {
      return { ok: false, reason: 'r points at a forbidden address' };
    }
    binding.registerUrl = registerUrl;
  }
  const keySetDigest = tags.get('k');
  if (keySetDigest !== undefined) binding.keySetDigest = keySetDigest;
  return { ok: true, binding };
}

/** Refuse loopback, link-local, and private addresses on any auto-fetch. Spec §4.7 / §8.8. */
export function isForbiddenAutoFetchHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  const ipVersion = isIP(hostname);
  if (ipVersion === 0) return false;
  if (ipVersion === 4) return isPrivateV4(hostname);
  return isPrivateV6(hostname);
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80:')) return true;
  return false;
}

/**
 * Concatenate multi-string TXT records in order with nothing inserted, then parse.
 * More than one record carrying v=airp1 is a lookup that did not complete. Spec §4.7.
 */
export function selectAirpTxtRecords(records: string[][]): AirpDnsLookupResult {
  const candidates: string[] = [];
  for (const chunks of records) {
    const joined = chunks.join('');
    if (/(?:^|;)\s*v=airp1(?:;|$)/.test(joined) || joined.trimStart().startsWith('v=airp1')) {
      candidates.push(joined);
    }
  }
  if (candidates.length === 0) return { ok: false, reason: 'no v=airp1 record' };
  if (candidates.length > 1) return { ok: false, reason: 'more than one v=airp1 record' };
  return parseAirpTxt(candidates[0]!);
}

export type ResolveTxtFn = (hostname: string) => Promise<string[][]>;

/**
 * Resolve `_airp.<identityDomain>`. On any failure, callers fall back to local config.
 * Cache bindings for their full TTL rather than resolving per exchange (caller's job).
 */
export async function lookupAirpBinding(
  identityDomain: string,
  resolve: ResolveTxtFn = resolveTxt,
): Promise<AirpDnsLookupResult> {
  const name = `_airp.${identityDomain.replace(/^\./, '')}`;
  try {
    const records = await resolve(name);
    return selectAirpTxtRecords(records);
  } catch (err) {
    return { ok: false, reason: `DNS lookup failed: ${(err as Error).message}` };
  }
}
