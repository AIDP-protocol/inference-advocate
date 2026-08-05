// Bubble field parametrization for the exchange status trail.
//
// Paper: step 12. Spec §1.1. Arrival activity drives how many inbound chips are visible, not
// whether the field is rebuilt. Remounting or rewriting animation-duration on each chunk would
// restart the CSS cycle and read as stutter. Compose follows the same rule for keystrokes.
// Linear timing is deliberate: easing would read as a false pause mid-flight.

export interface BubbleSpec {
  size: number;
  path: 0 | 1 | 2 | 3;
  duration: number;
  delay: number;
}

/**
 * Build a bubble set. Used to mint the fixed inbound pool once; live code should not call this
 * on every activity sample.
 */
export function buildBubbles(density: number): BubbleSpec[] {
  const d = Math.max(0, density);
  const count = Math.max(3, Math.round(9 * d));
  const bubbles: BubbleSpec[] = [];
  for (let i = 0; i < count; i++) {
    const seed = (i * 47) % 97;
    const size = 2 + (seed % 5) * 0.5;
    const baseDur = 0.85 - Math.min(d, 1.8) * 0.32;
    const dur = Math.max(0.28, baseDur + ((seed % 13) / 13 - 0.5) * 0.22);
    bubbles.push({
      size: +size.toFixed(1),
      path: (i % 4) as 0 | 1 | 2 | 3,
      duration: +dur.toFixed(2),
      delay: +(((seed % 29) / 29) * dur).toFixed(2),
    });
  }
  return bubbles;
}

/** Fixed inbound pool at full density. Visibility, not membership, tracks arrival. */
export const INBOUND_BUBBLES: BubbleSpec[] = buildBubbles(1.8);

/**
 * Fixed outbound set. Always the same four chips so React never remounts mid-phrase and the
 * CSS animations keep their phase while keystrokes only refresh the decay timer.
 */
export const COMPOSE_BUBBLES: BubbleSpec[] = [
  { size: 3, path: 0, duration: 1.05, delay: 0 },
  { size: 2.4, path: 1, duration: 0.92, delay: 0.22 },
  { size: 2.8, path: 2, duration: 1.18, delay: 0.48 },
  { size: 2.2, path: 3, duration: 1.0, delay: 0.7 },
];

export function buildComposeBubbles(): BubbleSpec[] {
  return COMPOSE_BUBBLES;
}

/** Map a decaying activity scalar in [0, 1] to inbound bubble density. */
export function densityFromActivity(activity: number): number {
  if (activity <= 0.02) return 0;
  return Math.min(2, Math.max(0.2, activity * 2));
}

/**
 * How many inbound chips are visible. The rest stay mounted and animating at opacity 0 so
 * raising density only reveals chips already in flight.
 */
export function inboundVisibleCount(activity: number): number {
  const d = densityFromActivity(activity);
  if (d <= 0) return 0;
  const raw = Math.round(3 + d * ((INBOUND_BUBBLES.length - 3) / 2));
  return Math.max(3, Math.min(INBOUND_BUBBLES.length, raw));
}
