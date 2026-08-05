// Compose activity: a decaying scalar driven by the person writing, not by the transport.
//
// Paper: step 1 (the prompt) meeting step 12's presentation problem. The outbound sight glass
// uses the same bubble vocabulary as inbound arrival so the motion reads as thought moving
// between person and machine in both directions. Bumps are word-weighted: a space or paste is
// closer to "a thought left" than a single letter, so the glass does not flood on every key.
//
// Mirrors core/src/interchange/arrival.ts in spirit (decay toward zero). The numbers are
// intentionally softer than arrival: outbound is teaching the metaphor, not measuring a stream.

/** Longer than arrival so a pause between words does not empty the glass mid-phrase. */
export const COMPOSE_HALF_LIFE_MS = 700;
/** A letter or deletion. Small on purpose. */
export const COMPOSE_CHAR_BUMP = 0.1;
/** A word boundary (space, punctuation) or a paste chunk. */
export const COMPOSE_WORD_BUMP = 0.32;
const COMPOSE_FLOOR = 0.002;

export class ComposeActivity {
  #level = 0;
  #at: number;

  constructor(now: number = Date.now()) {
    this.#at = now;
  }

  /** One character of typing or a backspace. */
  observeChar(now: number = Date.now()): number {
    return this.#bump(COMPOSE_CHAR_BUMP, now);
  }

  /** A word boundary, or one unit of pasted text. */
  observeWord(now: number = Date.now()): number {
    return this.#bump(COMPOSE_WORD_BUMP, now);
  }

  /** Paste: roughly one word bump per whitespace-separated token, capped. */
  observePaste(text: string, now: number = Date.now()): number {
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const units = Math.min(4, Math.max(1, words));
    return this.#bump(COMPOSE_WORD_BUMP * units, now);
  }

  value(now: number = Date.now()): number {
    this.#decayTo(now);
    return this.#level;
  }

  reset(now: number = Date.now()): void {
    this.#level = 0;
    this.#at = now;
  }

  #bump(amount: number, now: number): number {
    this.#decayTo(now);
    this.#level = Math.min(1, this.#level + amount);
    return this.#level;
  }

  #decayTo(now: number): void {
    const elapsed = Math.max(0, now - this.#at);
    this.#at = now;
    if (this.#level <= 0) return;
    this.#level *= Math.pow(0.5, elapsed / COMPOSE_HALF_LIFE_MS);
    if (this.#level < COMPOSE_FLOOR) this.#level = 0;
  }
}

const WORD_BOUNDARY = /^[\s.,;:!?/'"()[\]{}]$/;

export function isComposeWordBoundary(key: string): boolean {
  return WORD_BOUNDARY.test(key);
}
