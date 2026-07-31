// In-progress copy while the advocate is still working a turn.
//
// Paper: steps 1 and 12. The chat surface should feel like any other client when nothing is
// wrong. A fixed "evaluating..." label reads as stalled machinery. Rotating process language
// with a light motion cue matches what people already expect from chat clients, without
// pretending the advocate is a person (no "thinking", no "one moment", no affect).

const WORKING_PHRASES = [
  'Waiting on the provider',
  'Response not delivered yet',
  'Monitor pass in progress',
  'Checking against policy',
  'Holding until evaluation finishes',
  'Delivery still unresolved',
  'Request still in flight',
] as const;

const ROTATE_MS = 2800;

export function pickWorkingPhrase(exclude?: string): string {
  const pool = exclude ? WORKING_PHRASES.filter((p) => p !== exclude) : [...WORKING_PHRASES];
  const choices = pool.length > 0 ? pool : WORKING_PHRASES;
  return choices[Math.floor(Math.random() * choices.length)]!;
}

export { WORKING_PHRASES, ROTATE_MS };
