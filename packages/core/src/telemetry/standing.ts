// Global Standing, consumed as a local signed document.
//
// Paper: steps 13 and 14, and Section 5 ("What standing actually does").
// No standing body exists. The advocate is written as though one does, reading a document of
// the shape such a body would publish, verified against a pinned key, so that replacing the
// file with a periodic pull over the wire is a transport change.
//
// The acquisition model matters and is encoded in the shape rather than in the fetch: standing
// is pulled on a schedule, deliberately decoupled from the interaction flow, so that no
// per-contact query reveals which providers a user talks to. A push revocation channel for
// acute events is disclosed in the provisional and is not implemented here.

import { readFileSync } from 'node:fs';
import { verifyDocument } from '../crypto/seal.js';
import type { StandingState } from '../types.js';

export interface StandingEntry {
  /** Register entry the standing attaches to. */
  registerEntryId: string;
  providerIdentity: string;
  state: StandingState;
  /** Severity weighted incidents per evaluated response, in the reporting class. */
  incidentRate: number;
  /** Distinct admitted sources behind the rate. Below quorum, the rate does not move standing. */
  quorumSources: number;
  trafficClass: string;
  asOf: string;
  /** Set when the state is excluded and the exclusion is scoped to particular jurisdictions. */
  excludedInJurisdictions?: string[];
}

export interface StandingDocument {
  airpStandingVersion: string;
  body: { id: string; publicKeyPem: string };
  issuedAt: string;
  /** Published baseline thresholds. Paper Section 5, "Who sets the numbers". */
  thresholds: { warnRate: number; exclusionRate: number; minimumQuorumSources: number };
  providers: StandingEntry[];
}

export class StandingRegistry {
  readonly document: StandingDocument;
  readonly signatureValid: boolean;
  readonly #byEntry: Map<string, StandingEntry>;

  constructor(document: StandingDocument, signatureValid: boolean) {
    this.document = document;
    this.signatureValid = signatureValid;
    this.#byEntry = new Map(document.providers.map((p) => [p.registerEntryId, p]));
  }

  static loadFromFiles(documentPath: string, signaturePath: string, pinnedBodyKeyPath: string): StandingRegistry {
    const bytes = readFileSync(documentPath);
    const signature = readFileSync(signaturePath, 'utf8').trim();
    const pinned = readFileSync(pinnedBodyKeyPath, 'utf8');
    const document = JSON.parse(bytes.toString('utf8')) as StandingDocument;
    return new StandingRegistry(document, verifyDocument(bytes, signature, pinned));
  }

  static empty(): StandingRegistry {
    return new StandingRegistry(
      {
        airpStandingVersion: '0.1',
        body: { id: 'none', publicKeyPem: '' },
        issuedAt: new Date(0).toISOString(),
        thresholds: { warnRate: 0.05, exclusionRate: 0.15, minimumQuorumSources: 25 },
        providers: [],
      },
      false,
    );
  }

  entry(registerEntryId: string | undefined): StandingEntry | undefined {
    if (!registerEntryId) return undefined;
    return this.#byEntry.get(registerEntryId);
  }

  /**
   * Standing for a provider, scoped to the user's jurisdiction. A provider can be excluded
   * for one jurisdiction's users and not another's. Paper Section 5.
   */
  stateFor(registerEntryId: string | undefined, jurisdictionId: string): StandingState {
    const entry = this.entry(registerEntryId);
    if (!entry) return 'unknown';
    if (entry.quorumSources < this.document.thresholds.minimumQuorumSources && entry.state !== 'good') {
      // Below quorum a rate does not move standing. Paper Section 5, "How it aggregates".
      return 'unknown';
    }
    if (entry.state === 'excluded' && entry.excludedInJurisdictions) {
      return entry.excludedInJurisdictions.includes(jurisdictionId) ? 'excluded' : 'elevated_scrutiny';
    }
    return entry.state;
  }
}
