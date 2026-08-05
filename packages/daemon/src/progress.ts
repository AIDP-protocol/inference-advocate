// Progress frames for an in-flight ask.
//
// Paper: step 12 (delivery). Spec: draft-flores-airp-provenance-00 §1.1 puts delivery
// presentation outside the protocol, so nothing here is normative.
//
// This is the only channel that carries anything out of the host while an exchange is still
// being evaluated, and it is deliberately the narrowest thing that can drive an indicator: a
// stage name from a closed set, and a scalar. There is no partial text, no token count, no byte
// count and no offset, and the reason to build the frame here rather than inline at the call
// site is that a single constructor is something a test can hold to. If accumulated content
// could reach the UI mid-stream the delivery gate would be cosmetic, and one devtools
// inspection would disprove the whole claim.
//
// This is a local progress channel between the host and its own UI. It is not the AIRP SSE wire
// format, which is what a provider serves, and keeping the two shapes distinct means neither
// can be mistaken for the other.

export type ProgressFrame =
  | { kind: 'stage'; stage: string }
  | { kind: 'arrival'; activity: number };

/**
 * Rebuild a frame from its known members, so that an object carrying anything else cannot ride
 * along by accident. Activity is clamped, because an indicator reading an out-of-range number
 * is a rendering bug and not a signal.
 */
export function progressFrame(frame: ProgressFrame): ProgressFrame {
  if (frame.kind === 'arrival') {
    const activity = Number.isFinite(frame.activity)
      ? Math.min(1, Math.max(0, frame.activity))
      : 0;
    return { kind: 'arrival', activity };
  }
  return { kind: 'stage', stage: String(frame.stage) };
}

export function encodeProgressFrame(frame: ProgressFrame): string {
  return `${JSON.stringify(progressFrame(frame))}\n`;
}
