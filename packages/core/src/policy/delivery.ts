// Gate resolution: the four outcomes.
//
// Paper: step 11. "It can deliver. It can deliver with a notice. It can withhold, pending
// release by an authorized superior user. Or the evaluation can end in refusal."
// Provisional: Sections 1.5 (classification-keyed release authority) and 4.8 (mode floors).

import type {
  DeliveryDecision,
  DeterministicVerdict,
  Flag,
  Notice,
  OperatingMode,
  StandingState,
} from '../types.js';
import type { DeliveryPolicy } from './config.js';
import type { Jurisdiction } from './jurisdiction.js';
import { computeScore, type ScoreInput } from './score.js';
import { selectNotices, type NoticeState } from './notices.js';

export interface ResolveInput {
  providerId: string;
  deterministic: DeterministicVerdict;
  flags: Flag[];
  policy: DeliveryPolicy;
  jurisdiction: Jurisdiction;
  standing: StandingState;
  isMinor: boolean;
  noticeState: NoticeState;
  now?: Date;
  /** Everything the score needs that is not already on this object. */
  scoring: Omit<ScoreInput, 'instantSeverities' | 'thresholds' | 'standing' | 'standingSeed' | 'carryoverConfig' | 'providerId' | 'now'>;
}

export interface ResolveResult {
  decision: DeliveryDecision;
  /** Flags after jurisdictional severity floors are applied. These are what the ledger records. */
  adjustedFlags: Flag[];
}

export function resolve(input: ResolveInput): ResolveResult {
  const now = input.now ?? new Date();
  const doc = input.policy.document;
  const rationale: string[] = [];
  const mode: OperatingMode = input.jurisdiction.effectiveMode(doc.mode, input.isMinor);
  if (mode !== doc.mode) {
    rationale.push(`operating mode raised from ${doc.mode} to ${mode} by the ${input.jurisdiction.ruleset.id} floor`);
  }

  // Jurisdictional category treatment, applied before scoring.
  const treatments = input.jurisdiction.treatments(input.isMinor);
  const adjustedFlags: Flag[] = input.flags.map((f) => {
    const t = treatments[f.type];
    if (t?.severityFloor && t.severityFloor > f.severity) {
      rationale.push(
        `${f.type} severity raised from ${f.severity} to ${t.severityFloor} by the ${input.jurisdiction.ruleset.id} ruleset`,
      );
      return { ...f, severity: t.severityFloor };
    }
    return f;
  });

  const base = input.jurisdiction.effectiveThresholds(doc.thresholds, input.isMinor);
  if (base.warn !== doc.thresholds.warn || base.block !== doc.thresholds.block) {
    rationale.push(
      `thresholds tightened by the ${input.jurisdiction.ruleset.id} ruleset to warn ${base.warn}, block ${base.block}`,
    );
  }

  const score = computeScore({
    ...input.scoring,
    providerId: input.providerId,
    instantSeverities: adjustedFlags.map((f) => f.severity),
    thresholds: base,
    standing: input.standing,
    standingSeed: doc.standingSeed,
    carryoverConfig: doc.carryover,
    now,
  });
  rationale.push(...score.rationale);

  /** Notices raised by a rule earlier in this function, pinned whatever the outcome. */
  const alwaysNotices: Notice[] = [];

  const finish = (
    kind: DeliveryDecision['kind'],
    extra: { releaseAuthority?: DeliveryDecision['releaseAuthority']; notices?: Notice[] } = {},
  ): ResolveResult => {
    const inWarnBand = kind === 'deliver_with_notice';
    const candidates: Notice[] = [...doc.notices, ...input.jurisdiction.notices()];
    const pinned = [
      ...selectNotices({ candidates, state: input.noticeState, now, inWarnBand }),
      ...alwaysNotices,
    ];
    const decision: DeliveryDecision = {
      kind,
      score: score.score,
      windowScore: score.windowScore,
      instantScore: score.instantScore,
      effectiveWarn: score.effectiveWarn,
      effectiveBlock: score.effectiveBlock,
      notices: [...pinned, ...(extra.notices ?? [])],
      rationale,
      standing: input.standing,
      mode,
    };
    if (extra.releaseAuthority) decision.releaseAuthority = extra.releaseAuthority;
    return { decision, adjustedFlags };
  };

  // 1. Standing exclusion. Refusal happens before a request is sent in the normal path;
  //    this branch catches a provider excluded between send and resolve.
  if (input.standing === 'excluded' && doc.standingSeed.refuseExcluded) {
    rationale.push('provider standing is excluded; the advocate declines to relay');
    return finish('refuse');
  }

  // 2. Deterministic refusals. Decidable by arithmetic, so they do not wait on the score.
  if (!input.deterministic.passed) {
    for (const f of input.deterministic.findings.filter((f) => f.refuses)) {
      rationale.push(`deterministic layer refused: ${f.code}, ${f.detail}`);
    }
    return finish('refuse');
  }
  for (const f of input.deterministic.findings) {
    rationale.push(`deterministic finding: ${f.code}, ${f.detail}`);
  }

  // 2a. Jurisdictional treatment of unsealed responses. This is where a provenance mandate
  //     becomes an outcome rather than a label nobody checks. Paper Section 2. Pending
  //     provenance rules are not applied (Jurisdiction.unsealedTreatment).
  const provenanceRule = input.jurisdiction.unsealedTreatment();
  if (!input.deterministic.sealPresent && provenanceRule !== 'ignore') {
    if (provenanceRule === 'refuse') {
      rationale.push(
        `the ${input.jurisdiction.ruleset.id} ruleset refuses responses whose provenance cannot be established`,
      );
      return finish('refuse');
    }
    rationale.push(`the ${input.jurisdiction.ruleset.id} ruleset requires a notice on unsealed responses`);
    alwaysNotices.push({
      id: `provenance-unsealed-${input.providerId}`,
      text:
        'This response carries no Provenance Seal, so your advocate cannot establish which model produced it ' +
        `or that the endpoint was authorized to serve it. Your jurisdiction ruleset (${input.jurisdiction.ruleset.id}) requires this notice.`,
      dismissable: false,
      windowMinutes: null,
      source: 'jurisdiction',
      trigger: 'always',
    });
  }

  // 3. Category floors. Mode-independent. Observe-only relaxes the accumulation gate and
  //    never an absolute floor. Provisional Section 4.8.
  const mandatory = adjustedFlags.find((f) => treatments[f.type]?.mandatoryNonDelivery);
  if (mandatory) {
    rationale.push(
      `${mandatory.type} is a mandatory non-delivery category in the ${input.jurisdiction.ruleset.id} ruleset; refused in every mode`,
    );
    return finish('refuse');
  }

  // 4. Mode gating.
  if (mode === 'observe') {
    rationale.push('observe mode: evaluated and ledgered, no gate action taken');
    return finish('deliver');
  }

  if (score.score >= score.effectiveBlock) {
    if (mode === 'annotate') {
      rationale.push(`score ${score.score} is at or above the block line ${score.effectiveBlock}, but annotate mode limits the action to a notice`);
      return finish('deliver_with_notice');
    }
    const flagTypes = adjustedFlags.map((f) => f.type);
    let authority = input.policy.authorityFor(flagTypes);
    if (flagTypes.some((t) => treatments[t]?.nonReleasable)) authority = 'non_releasable';
    rationale.push(
      `score ${score.score} is at or above the block line ${score.effectiveBlock}; withheld, release authority ${authority}`,
    );
    return finish('withhold', { releaseAuthority: authority });
  }

  if (score.score >= score.effectiveWarn) {
    rationale.push(`score ${score.score} is at or above the warn line ${score.effectiveWarn}; delivered with a notice`);
    return finish('deliver_with_notice', {
      notices: [
        {
          id: `monitor-warn-${input.providerId}`,
          text:
            `This provider is in the warn band of your Delivery Policy. Accumulated score ${score.score} ` +
            `against a warn line of ${score.effectiveWarn} and a block line of ${score.effectiveBlock}.`,
          dismissable: false,
          windowMinutes: null,
          source: 'monitor',
          trigger: 'always',
        },
      ],
    });
  }

  rationale.push(`score ${score.score} is below the warn line ${score.effectiveWarn}; delivered`);
  return finish('deliver');
}
