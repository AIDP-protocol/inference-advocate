// The Serving Register, as a local signed document.
//
// Paper: step 4 and step 7, and Section 4.1 (the DNS answer). Ancestry: SPF.
// Spec: draft-flores-airp-provenance-00 §4.
// The deployed register is a signed, database-backed service or transparency log, with a TXT
// record binding a provider's domain to its register entry. What exists here is the document
// that such a service would serve, signed by a registrar key that the advocate pins locally,
// so that swapping the file for an HTTPS fetch plus the same signature check is a transport
// change and not a redesign.

import { readFileSync } from 'node:fs';
import { pemSpkiBody, verifyDocument } from '../crypto/seal.js';
import { sha256 } from '../crypto/vendor/noble-hashes/sha2.js';
import { parseJsonNoDuplicates } from '../interchange/json-strict.js';

export type EntryStatus = 'active' | 'probationary' | 'revoked';
/** Spec §4.3. `compromised` rejects unconditionally; `retired` is bounded by retiredAt. */
export type KeyStatus = 'current' | 'rotating' | 'retired' | 'compromised';

export interface RegisterKey {
  selector: string;
  publicKeyPem: string;
  status: KeyStatus;
  /** RFC 3339. Required for retired and compromised. Spec §4.3. */
  retiredAt?: string;
}

export interface RegisterEntry {
  id: string;
  providerIdentity: string;
  status: EntryStatus;
  /** Endpoints authorized to serve this provider's models. Matched by endpointMatches below. */
  authorizedEndpoints: string[];
  models: string[];
  keys: RegisterKey[];
  /**
   * Declared sealing policy. "all" is the equivalent of a published reject policy: a response
   * from this provider arriving without a seal is invalid on its face rather than merely
   * unsealed. Paper Section 4.1 (the downgrade attack).
   */
  sealPolicy: 'all' | 'none';
  /**
   * Content binding identifier for streamed responses. Spec §3.8.3 / Appendix B.
   * Required of providers that serve streamed sealed responses.
   */
  contentBinding?: string;
  /**
   * Identity domain under which `_airp` is published. Spec §4.7. When absent, DNS binding
   * is skipped and the entry is treated as unconfirmed.
   */
  identityDomain?: string;
}

export interface RegisterDocument {
  /** Register format version. draft-flores-airp-provenance Section 4 defines "1". */
  airpRegisterVersion: string;
  issuedAt: string;
  registrar: { id: string; publicKeyPem: string };
  entries: RegisterEntry[];
}

export interface RegisterLoadResult {
  document: RegisterDocument;
  /** False when the detached signature does not verify against the pinned registrar key. */
  signatureValid: boolean;
}

/** Trailing slashes carry no authority meaning; strip them before comparing paths. */
function normalizedPath(u: URL): string {
  return u.pathname.replace(/\/+$/, '');
}

export function endpointMatches(registeredBase: string, contactedUrl: string): boolean {
  let base: URL;
  let contacted: URL;
  try {
    base = new URL(registeredBase);
    contacted = new URL(contactedUrl);
  } catch {
    return false;
  }
  if (base.username || base.password || contacted.username || contacted.password) return false;
  if (base.origin !== contacted.origin) return false;
  if (base.origin === 'null' || contacted.origin === 'null') return false;

  const basePath = normalizedPath(base);
  const contactedPath = normalizedPath(contacted);
  return contactedPath === basePath || contactedPath.startsWith(`${basePath}/`);
}

/**
 * Key set digest over an entry's keys. Spec §4.8.
 * Sort by selector ascending byte order; for each: selector LF base64(SPKI DER) LF.
 * Status is outside the digest. Use the PEM body bytes, do not re-encode from a parsed key.
 */
export function computeKeySetDigest(entry: RegisterEntry): string {
  const sorted = [...entry.keys].sort((a, b) =>
    a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0,
  );
  let material = '';
  for (const key of sorted) {
    material += `${key.selector}\n${pemSpkiBody(key.publicKeyPem)}\n`;
  }
  return Buffer.from(sha256(new TextEncoder().encode(material))).toString('base64url');
}

export class ServingRegister {
  readonly document: RegisterDocument;
  readonly signatureValid: boolean;
  readonly #byId: Map<string, RegisterEntry>;

  constructor(result: RegisterLoadResult) {
    this.document = result.document;
    this.signatureValid = result.signatureValid;
    this.#byId = new Map(result.document.entries.map((e) => [e.id, e]));
  }

  /**
   * Load a register document, its detached signature, and the pinned registrar public key.
   * The registrar key inside the document is never used to check the document. The pinned
   * key is the trust anchor, which is the whole point of pinning it.
   */
  static loadFromFiles(documentPath: string, signaturePath: string, pinnedRegistrarKeyPath: string): ServingRegister {
    const bytes = readFileSync(documentPath);
    const signature = readFileSync(signaturePath, 'utf8').trim();
    const pinned = readFileSync(pinnedRegistrarKeyPath, 'utf8');
    const document = parseJsonNoDuplicates(bytes.toString('utf8')) as RegisterDocument;
    return new ServingRegister({ document, signatureValid: verifyDocument(bytes, signature, pinned) });
  }

  static fromDocument(document: RegisterDocument, signatureValid = true): ServingRegister {
    return new ServingRegister({ document, signatureValid });
  }

  entry(id: string): RegisterEntry | undefined {
    return this.#byId.get(id);
  }

  entries(): RegisterEntry[] {
    return [...this.#byId.values()];
  }

  /**
   * Locate a key by selector regardless of status. Spec §6.7: status rules apply after
   * resolution. Filtering retired here would turn a post-retirement seal into "no such key."
   */
  key(entryId: string, selector: string): RegisterKey | undefined {
    return this.#byId.get(entryId)?.keys.find((k) => k.selector === selector);
  }

  /**
   * Endpoint authorization. Raw string prefix matching would authorize
   * https://api.example.com/v1evil against a registered https://api.example.com/v1, so both
   * URLs are parsed and compared structurally: identical origin (scheme, host, and port, with
   * default ports normalized by URL), and a contacted path that either equals the registered
   * path or extends it at a segment boundary. Credentials in either URL disqualify the match.
   */
  endpointAuthorized(entryId: string, contactedUrl: string): boolean {
    const entry = this.#byId.get(entryId);
    if (!entry) return false;
    return entry.authorizedEndpoints.some((base) => endpointMatches(base, contactedUrl));
  }
}
