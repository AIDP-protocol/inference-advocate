// Arrival activity: a decaying scalar an indicator can be driven from.
//
// Paper: step 12 (delivery). Spec: draft-flores-airp-provenance-00 §1.1 puts delivery
// presentation outside the protocol, so nothing in this file is normative.
//
// This exists so a waiting user can be shown that data is arriving without being shown what
// is arriving. Each chunk bumps the level, and the level decays continuously toward zero, so
// what a consumer reads is one number in [0, 1] rather than a count of anything. No token
// count, no byte count, no offset, and no text: those are not omitted from the callback, they
// are absent from the type. What the motion leaks is roughly what any loading state leaks,
// that something is happening and at what cadence, and nothing about content survives it.
//
// Continuous decay rather than discrete units is also why there is nothing countable in the
// resulting motion: between two samples the level is a function of elapsed time as much as of
// arrivals, so a viewer cannot read units off it even in principle.

/** Time for an unfed level to halve. Short enough that a stall is visible within a beat. */
export const ARRIVAL_HALF_LIFE_MS = 350;

/** How much one chunk arrival adds. Saturates at 1, so a fast stream reads as full flow. */
export const ARRIVAL_BUMP = 0.6;

/** Sampling interval while a stream is open. Cadence of the signal, not of the data. */
export const ARRIVAL_SAMPLE_MS = 90;

/** Below this the level is zero, so a settled indicator settles exactly rather than asymptotically. */
const ARRIVAL_FLOOR = 0.002;

export class ArrivalActivity {
  #level = 0;
  #at: number;

  constructor(now: number = Date.now()) {
    this.#at = now;
  }

  /** Record one chunk arrival. Returns the level after the bump. */
  observe(now: number = Date.now()): number {
    this.#decayTo(now);
    this.#level = Math.min(1, this.#level + ARRIVAL_BUMP);
    return this.#level;
  }

  /** The level as of now, decayed for the time since it was last touched. */
  value(now: number = Date.now()): number {
    this.#decayTo(now);
    return this.#level;
  }

  #decayTo(now: number): void {
    const elapsed = Math.max(0, now - this.#at);
    this.#at = now;
    if (this.#level <= 0) return;
    this.#level *= Math.pow(0.5, elapsed / ARRIVAL_HALF_LIFE_MS);
    if (this.#level < ARRIVAL_FLOOR) this.#level = 0;
  }
}
