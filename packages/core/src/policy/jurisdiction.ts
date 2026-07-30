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
//
// Provisions carry a status. Only in_force rules change delivery. Pending provisions (a bill
// that has passed but not been signed, for example) are surfaced as warnings and are not
// applied as law. That is the resolution recorded in DECISIONS.md item 4.

import { readFileSync } from 'node:fs';
import type { Notice, OperatingMode, ProvisionStatus } from '../types.js';

export interface CategoryTreatment {
  /** Raise the taxonomy severity to at least this. */
  severityFloor?: number;
  /** Refuse delivery of any response bearing this flag, in every mode. Provisional Section 4.8. */
  mandatoryNonDelivery?: boolean;
  /** A block from this category cannot be released locally. */
  nonReleasable?: boolean;
  /** Missing status is treated as in_force. */
  status?: ProvisionStatus;
}

export interface PendingProvision {
  /** Stable id for tests and UI keys. */
  id: string;
  /** One line naming what is pending and why it is not applied. */
  summary: string;
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
  thresholdOverrides?: { warn?: number; block?: number; status?: ProvisionStatus };
  /** Lowest mode this jurisdiction permits. Provisional Section 4.8, jurisdictional floors. */
  modeFloor?: OperatingMode;
  /** Enactment status of modeFloor. Missing means in_force. */
  modeFloorStatus?: ProvisionStatus;
  categoryTreatments?: Record<string, CategoryTreatment>;
  /**
   * How the jurisdiction wants unsealed responses treated. A provenance mandate that nobody
   * verifies at the point of delivery is the gap the paper names in Section 2; this is the
   * field where the mandate becomes an outcome.
   *   ignore  no consequence beyond the honest label
   *   notice  delivered with a pinned notice that provenance could not be established
   *   refuse  not delivered
   */
  provenance?: {
    unsealedTreatment: 'ignore' | 'notice' | 'refuse';
    note?: string;
    status?: ProvisionStatus;
  };
  /** Notices the jurisdiction requires the advocate to pin. */
  notices?: Notice[];
  /** Applies only where the user is a minor. */
  minorOnly?: {
    status?: ProvisionStatus;
    modeFloor?: OperatingMode;
    thresholdOverrides?: { warn?: number; block?: number };
    categoryTreatments?: Record<string, CategoryTreatment>;
  };
}

const MODE_RANK: Record<OperatingMode, number> = { observe: 0, annotate: 1, enforce: 2 };

function enacted(status: ProvisionStatus | undefined): boolean {
  return status !== 'pending';
}

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

  /**
   * Provisions labeled pending. Delivery ignores them; the UI, doctor, and demo warnings
   * surface them so a reader cannot mistake "listed in the ruleset" for "applied as law".
   */
  pendingProvisions(): PendingProvision[] {
    const out: PendingProvision[] = [];
    const r = this.ruleset;

    for (const n of r.notices ?? []) {
      if (n.status === 'pending') {
        out.push({ id: `notice:${n.id}`, summary: `notice "${n.id}" is pending and is not pinned` });
      }
    }
    for (const [type, t] of Object.entries(r.categoryTreatments ?? {})) {
      if (t.status === 'pending') {
        out.push({
          id: `category:${type}`,
          summary: `category treatment "${type}" is pending and does not change severity or delivery`,
        });
      }
    }
    if (r.thresholdOverrides?.status === 'pending') {
      out.push({
        id: 'thresholdOverrides',
        summary: 'threshold overrides are pending and do not tighten warn or block lines',
      });
    }
    if (r.modeFloor !== undefined && r.modeFloorStatus === 'pending') {
      out.push({
        id: 'modeFloor',
        summary: `mode floor "${r.modeFloor}" is pending and does not raise the operating mode`,
      });
    }
    if (r.provenance && r.provenance.status === 'pending') {
      out.push({
        id: 'provenance',
        summary: 'provenance treatment for unsealed responses is pending and is not applied',
      });
    }
    if (r.minorOnly?.status === 'pending') {
      out.push({
        id: 'minorOnly',
        summary:
          'provisions for users under eighteen are pending (passed but unsigned) and are not applied as law',
      });
    }
    return out;
  }

  treatments(isMinor: boolean): Record<string, CategoryTreatment> {
    const out: Record<string, CategoryTreatment> = {};
    for (const [type, t] of Object.entries(this.ruleset.categoryTreatments ?? {})) {
      if (enacted(t.status)) out[type] = t;
    }
    if (isMinor && this.ruleset.minorOnly && enacted(this.ruleset.minorOnly.status)) {
      for (const [type, t] of Object.entries(this.ruleset.minorOnly.categoryTreatments ?? {})) {
        if (enacted(t.status)) out[type] = t;
      }
    }
    return out;
  }

  /** Jurisdiction overrides the user only in the stricter direction. */
  effectiveThresholds(base: { warn: number; block: number }, isMinor: boolean): { warn: number; block: number } {
    const layers: Array<{ warn?: number; block?: number; status?: ProvisionStatus } | undefined> = [
      this.ruleset.thresholdOverrides,
    ];
    if (isMinor && this.ruleset.minorOnly && enacted(this.ruleset.minorOnly.status)) {
      layers.push(this.ruleset.minorOnly.thresholdOverrides);
    }
    let { warn, block } = base;
    for (const layer of layers) {
      if (!layer || !enacted(layer.status)) continue;
      if (layer.warn !== undefined) warn = Math.min(warn, layer.warn);
      if (layer.block !== undefined) block = Math.min(block, layer.block);
    }
    return { warn, block };
  }

  /** A configured mode is raised to the jurisdiction's floor, never lowered by it. */
  effectiveMode(configured: OperatingMode, isMinor: boolean): OperatingMode {
    let mode = configured;
    const floors: Array<{ floor: OperatingMode | undefined; status: ProvisionStatus | undefined }> = [
      { floor: this.ruleset.modeFloor, status: this.ruleset.modeFloorStatus },
    ];
    if (isMinor && this.ruleset.minorOnly && enacted(this.ruleset.minorOnly.status)) {
      floors.push({ floor: this.ruleset.minorOnly.modeFloor, status: this.ruleset.minorOnly.status });
    }
    for (const { floor, status } of floors) {
      if (floor && enacted(status) && MODE_RANK[floor] > MODE_RANK[mode]) mode = floor;
    }
    return mode;
  }

  /** In-force jurisdiction notices only. Pending notices are listed via pendingProvisions. */
  notices(): Notice[] {
    return (this.ruleset.notices ?? []).filter((n) => enacted(n.status));
  }

  /**
   * Unsealed-response treatment from an in_force provenance rule. Pending provenance is
   * ignored here and reported through pendingProvisions instead.
   */
  unsealedTreatment(): 'ignore' | 'notice' | 'refuse' {
    const p = this.ruleset.provenance;
    if (!p || !enacted(p.status)) return 'ignore';
    return p.unsealedTreatment;
  }
}
