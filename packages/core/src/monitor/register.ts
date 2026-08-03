// The Serving Register, as a local signed document.
//
// Paper: step 4 and step 7, and Section 4.1 (the DNS answer). Ancestry: SPF.
// The deployed register is a signed, database-backed service or transparency log, with a TXT
// record binding a provider's domain to its register entry. None of that exists yet. What
// exists here is the document that such a service would serve, signed by a registrar key that
// the advocate pins locally, so that swapping the file for an HTTPS fetch plus the same
// signature check is a transport change and not a redesign.

import { readFileSync } from 'node:fs';
import { verifyDocument } from '../crypto/seal.js';

export type EntryStatus = 'active' | 'probationary' | 'revoked';
export type KeyStatus = 'current' | 'rotating' | 'retired';

export interface RegisterKey {
  selector: string;
  publicKeyPem: string;
  status: KeyStatus;
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
}

export interface RegisterDocument {
  /** Register format version. draft-flores-aidp-provenance Section 4.1 defines "1". */
  aidpRegisterVersion: string;
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
    const document = JSON.parse(bytes.toString('utf8')) as RegisterDocument;
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

  key(entryId: string, selector: string): RegisterKey | undefined {
    return this.#byId.get(entryId)?.keys.find((k) => k.selector === selector && k.status !== 'retired');
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
