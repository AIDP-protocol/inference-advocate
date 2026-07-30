// Windowed, severity weighted scoring over the per-provider ledger.
//
// Paper: step 10. Provisional: Sections 1.3 (windowing) and 1.4 (standing-seeded thresholds).
// The point of novelty in the paper is that the score is computed over the provider's recent
// conduct rather than over the instant response. The instant response is the increment that
// may cross a line. Everything in this file exists to keep that distinction literal.

import type { LedgerEntry, StandingState } from '../types.js';
import type { CarryoverConfig, StandingSeedConfig, ThresholdConfig, WindowConfig } from './config.js';
import type { CarryoverState, LedgerReader } from '../store/ledger.js';

export interface ScoreInput {
  providerId: string;
  /** Severities of the flags on the response being resolved right now. */
  instantSeverities: number[];
  ledger: LedgerReader;
  window: WindowConfig;
  thresholds: ThresholdConfig;
  standing: StandingState;
  standingSeed: StandingSeedConfig;
  carryoverConfig: CarryoverConfig;
  carryover?: CarryoverState;
  /** Only used when the window scope is session. */
  sessionStart?: string;
  now?: Date;
}

export interface ScoreResult {
  score: number;
  /** Contribution from the ledger window, excluding the instant response. */
  windowScore: number;
  instantScore: number;
  seedScore: number;
  effectiveWarn: number;
  effectiveBlock: number;
  windowSize: number;
  rationale: string[];
}

export function windowEntries(input: ScoreInput): LedgerEntry[] {
  const now = input.now ?? new Date();
  if (input.window.kind === 'time') {
    const hours = input.window.hours ?? 24;
    let since = new Date(now.getTime() - hours * 3_600_000).toISOString();
    if (input.window.scope === 'session' && input.sessionStart && input.sessionStart > since) {
      since = input.sessionStart;
    }
    return input.ledger.entriesInWindow(input.providerId, since, new Date(now.getTime() + 1000).toISOString());
  }
  const n = input.window.n ?? 10;
  const recent = input.ledger.recent(input.providerId, n);
  if (input.window.scope === 'session' && input.sessionStart) {
    return recent.filter((e) => e.at >= input.sessionStart!);
  }
  return recent;
}

export function computeScore(input: ScoreInput): ScoreResult {
  const rationale: string[] = [];
  const entries = windowEntries(input);

  const windowScore = entries.reduce(
    (sum, e) => sum + e.flags.reduce((s, f) => s + f.severity, 0),
    0,
  );
  const instantScore = input.instantSeverities.reduce((s, v) => s + v, 0);

  let seedScore = 0;
  if (input.standing === 'elevated_scrutiny') {
    seedScore = input.standingSeed.elevatedSeedScore;
    rationale.push(
      `provider standing is elevated scrutiny, so the window is seeded with ${seedScore} before local conduct is counted`,
    );
  } else if (input.standing === 'unknown') {
    seedScore = input.standingSeed.unknownSeedScore;
    if (seedScore > 0) rationale.push(`provider has no standing entry, so the window is seeded with ${seedScore}`);
  }

  let effectiveWarn = input.thresholds.warn;
  let effectiveBlock = input.thresholds.block;
  if (input.carryover && input.carryover.cleanRemaining > 0) {
    effectiveWarn = Math.max(1, effectiveWarn - input.carryoverConfig.warnDelta);
    effectiveBlock = Math.max(effectiveWarn + 1, effectiveBlock - input.carryoverConfig.blockDelta);
    rationale.push(
      `carryover in force from a prior block: warn ${input.thresholds.warn} to ${effectiveWarn}, ` +
        `block ${input.thresholds.block} to ${effectiveBlock}, decaying over ${input.carryover.cleanRemaining} more clean responses`,
    );
  }

  const score = windowScore + instantScore + seedScore;
  rationale.push(
    `score ${score} = window ${windowScore} over ${entries.length} evaluated responses ` +
      `+ this response ${instantScore} + standing seed ${seedScore}`,
  );

  return {
    score,
    windowScore,
    instantScore,
    seedScore,
    effectiveWarn,
    effectiveBlock,
    windowSize: entries.length,
    rationale,
  };
}
