// The Delivery Policy, as a document the advocate loads rather than logic it compiles in.
//
// Paper: steps 10 and 11. Provisional: Sections 1.3, 1.5, 1.8, 4.8.
// The human-readable policy lives at data/policy/delivery-policy.md and is what the UI shows.
// This file is the machine half of the same document. They are meant to be read together and
// the repository keeps them adjacent so that drift between them is embarrassing.
//
// Every number here is demonstration scale and is labeled as such. Calibrating real thresholds
// is an open question in the paper and stays open here.

import { readFileSync } from 'node:fs';
import type { Notice, OperatingMode, ReleaseAuthority } from '../types.js';

export type WindowKind = 'count' | 'time';
export type WindowScope = 'session' | 'cross_session';

export interface WindowConfig {
  kind: WindowKind;
  /** Trailing N evaluated responses when kind is count. */
  n?: number;
  /** Trailing wall-clock hours when kind is time. */
  hours?: number;
  scope: WindowScope;
}

export interface ThresholdConfig {
  warn: number;
  block: number;
}

/**
 * After a block clears, the next session begins on edge rather than amnesiac. The provisional
 * discloses this as either an elevated severity weighting or a lowered effective threshold.
 * The reference implementation lowers the thresholds, because a number the user can see move
 * is easier to argue with than a multiplier buried in a sum.
 */
export interface CarryoverConfig {
  warnDelta: number;
  blockDelta: number;
  /** Clean responses required to decay it away. */
  cleanResponses: number;
}

export interface StandingSeedConfig {
  /** Score the window starts at when the provider is under elevated scrutiny. */
  elevatedSeedScore: number;
  /** Whether an excluded provider is refused before a request is even sent. */
  refuseExcluded: boolean;
  /** Standing state unknown, for example a provider with no entry in the standing document. */
  unknownSeedScore: number;
}

export interface TelemetryConfig {
  /** No reporting cell smaller than this is emitted. Paper Section 5. */
  granularityFloor: number;
  intervalHours: number;
  /** Consumer facing, agentic, and so on. Denominators must match the harm. Paper Section 5. */
  trafficClass: string;
  /** Where a batch would be sent. Nothing receives it yet, which is the point of the stub. */
  endpoint: string | null;
}

export interface DeliveryPolicyDocument {
  policyVersion: string;
  scale: 'demonstration';
  mode: OperatingMode;
  window: WindowConfig;
  thresholds: ThresholdConfig;
  carryover: CarryoverConfig;
  standingSeed: StandingSeedConfig;
  /** Flag type to the authority competent to release a block it produces. */
  releaseAuthority: { default: ReleaseAuthority; byFlagType?: Record<string, ReleaseAuthority> };
  /** Notices the advocate pins regardless of jurisdiction. Paper step 12. */
  notices: Notice[];
  telemetry: TelemetryConfig;
}

export class DeliveryPolicy {
  readonly document: DeliveryPolicyDocument;

  constructor(document: DeliveryPolicyDocument) {
    this.document = document;
  }

  static loadFromFile(path: string): DeliveryPolicy {
    return new DeliveryPolicy(JSON.parse(readFileSync(path, 'utf8')) as DeliveryPolicyDocument);
  }

  authorityFor(flagTypes: string[]): ReleaseAuthority {
    const map = this.document.releaseAuthority.byFlagType ?? {};
    const order: ReleaseAuthority[] = ['self_release', 'custodial_release', 'escalating', 'non_releasable'];
    let worst: ReleaseAuthority = this.document.releaseAuthority.default;
    for (const t of flagTypes) {
      const a = map[t];
      if (a && order.indexOf(a) > order.indexOf(worst)) worst = a;
    }
    return worst;
  }
}
