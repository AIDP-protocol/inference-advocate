// The jurisdiction ruleset: loaded at setup, applied at delivery.
//
// Paper: steps 2 and 11. "The provider serves inference, the advocate applies law." This is
// one of the two mechanisms the paper claims has no developed precedent.
// PLAN: Phase 3, "Jurisdiction ruleset slot loaded at setup and applied at delivery, stubbed
// with one or two example rulesets".
//
// A caution that belongs in the code and not only in the README. The rulesets shipped in
// data/jurisdictions are illustrative encodings written by an engineer, not legal advice and
// not a compliance product. They exist to prove that the slot is real and that a ruleset can
// change an outcome. A deployed advocate would load rulesets maintained by somebody competent
// and accountable for them.

import { readFileSync } from 'node:fs';
import type { Notice, OperatingMode } from '../types.js';

export interface CategoryTreatment {
  /** Raise the taxonomy severity to at least this. */
  severityFloor?: number;
  /** Refuse delivery of any response bearing this flag, in every mode. Provisional Section 4.8. */
  mandatoryNonDelivery?: boolean;
  /** A block from this category cannot be released locally. */
  nonReleasable?: boolean;
}

export interface JurisdictionRuleset {
  id: string;
  name: string;
  /** Version of the ruleset document, not of the law. */
  version: string;
  /** Illustrative only. Kept as a field so that a real ruleset can carry its citations. */
  citations?: string[];
  disclaimer: string;
  /** Overrides the user's configured thresholds where stricter. */
  thresholdOverrides?: { warn?: number; block?: number };
  /** Lowest mode this jurisdiction permits. Provisional Section 4.8, jurisdictional floors. */
  modeFloor?: OperatingMode;
  categoryTreatments?: Record<string, CategoryTreatment>;
  /**
   * How the jurisdiction wants unsealed responses treated. A provenance mandate that nobody
   * verifies at the point of delivery is the gap the paper names in Section 2; this is the
   * field where the mandate becomes an outcome.
   *   ignore  no consequence beyond the honest label
   *   notice  delivered with a pinned notice that provenance could not be established
   *   refuse  not delivered
   */
  provenance?: { unsealedTreatment: 'ignore' | 'notice' | 'refuse'; note?: string };
  /** Notices the jurisdiction requires the advocate to pin. */
  notices?: Notice[];
  /** Applies only where the user is a minor. */
  minorOnly?: {
    modeFloor?: OperatingMode;
    thresholdOverrides?: { warn?: number; block?: number };
    categoryTreatments?: Record<string, CategoryTreatment>;
  };
}

const MODE_RANK: Record<OperatingMode, number> = { observe: 0, annotate: 1, enforce: 2 };

export class Jurisdiction {
  readonly ruleset: JurisdictionRuleset;

  constructor(ruleset: JurisdictionRuleset) {
    this.ruleset = ruleset;
  }

  static loadFromFile(path: string): Jurisdiction {
    return new Jurisdiction(JSON.parse(readFileSync(path, 'utf8')) as JurisdictionRuleset);
  }

  /** The empty ruleset. An advocate with no jurisdiction loaded applies only user policy. */
  static none(): Jurisdiction {
    return new Jurisdiction({
      id: 'none',
      name: 'No jurisdiction ruleset loaded',
      version: '0',
      disclaimer: 'No jurisdictional overrides are in force.',
    });
  }

  treatments(isMinor: boolean): Record<string, CategoryTreatment> {
    return {
      ...(this.ruleset.categoryTreatments ?? {}),
      ...(isMinor ? (this.ruleset.minorOnly?.categoryTreatments ?? {}) : {}),
    };
  }

  /** Jurisdiction overrides the user only in the stricter direction. */
  effectiveThresholds(base: { warn: number; block: number }, isMinor: boolean): { warn: number; block: number } {
    const layers = [this.ruleset.thresholdOverrides, isMinor ? this.ruleset.minorOnly?.thresholdOverrides : undefined];
    let { warn, block } = base;
    for (const layer of layers) {
      if (!layer) continue;
      if (layer.warn !== undefined) warn = Math.min(warn, layer.warn);
      if (layer.block !== undefined) block = Math.min(block, layer.block);
    }
    return { warn, block };
  }

  /** A configured mode is raised to the jurisdiction's floor, never lowered by it. */
  effectiveMode(configured: OperatingMode, isMinor: boolean): OperatingMode {
    let mode = configured;
    for (const floor of [this.ruleset.modeFloor, isMinor ? this.ruleset.minorOnly?.modeFloor : undefined]) {
      if (floor && MODE_RANK[floor] > MODE_RANK[mode]) mode = floor;
    }
    return mode;
  }

  notices(): Notice[] {
    return this.ruleset.notices ?? [];
  }
}
