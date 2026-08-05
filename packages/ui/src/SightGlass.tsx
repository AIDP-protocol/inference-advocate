// The delivery indicator: a sight glass, plus the stage of the check that is running.
//
// Paper: steps 6 and 12. Spec: draft-flores-airp-provenance-00 §1.1.
//
// None of this is normative. §1.1 puts delivery presentation outside the protocol's scope, so
// what follows is one defensible answer and not a requirement. It is written down with its
// argument attached for a specific reason: if the reference implementation ships a spinner,
// spinner becomes the convention by default, and nobody ever has to decide anything. Shipping a
// considered answer with the reasoning next to it is what leaves Edverity, or anyone else, free
// to choose differently on purpose rather than by inheritance.
//
// The problem. A delivery gate that a person experiences only as slowness reads as a defect, and
// defects get disabled. That makes presentation a design problem rather than a user education
// problem: no amount of explaining why the wait is good will survive the wait feeling like a
// bug. The one question a waiting person actually has is whether anything is happening at all,
// and that question can be answered honestly without answering any of the questions that would
// require showing them the response.
//
// The sight glass. A fuel pump has a small window with an impeller spinning in it while fuel is
// moving. That is the prior art, named here on purpose so this is legible as a design tradition
// rather than as decoration. It promises no completion time, it quantifies nothing, and it fails
// honestly: if flow stops the motion stops, and the person knows immediately without an error
// state having to be designed for them. Motion here is driven by arrival, from a decaying scalar
// the transport emits (core/src/interchange/arrival.ts), so what the view reads is one number in
// [0, 1] and never a count of tokens, bytes, or anything else countable.
//
// No minimum duration and no artificial dwell. An exchange that verifies in 200ms shows almost
// nothing and delivers immediately, which is correct. Padding the wait so the animation gets
// seen would make diligence feel slower than negligence, and that points the advocate's loyalty
// at its own machinery instead of at the person using it.
//
// The limit, stated because this comment will otherwise be read as claiming more than it can
// deliver. The hold is a conformance property of this client, not a cryptographic one. Plaintext
// has to exist on the device for evaluation to happen at all, so where the party subject to the
// delivery policy also controls the device, the gate is advisory: real enforcement belongs to
// platform controls or to moving the boundary off the device entirely. The non-streamed mode
// narrows the window in which unverified plaintext exists locally; it does not remove the
// requirement to trust the client. What this file can honestly claim is narrower and still worth
// claiming: response text is not in the document before release. It is not blurred, clipped or
// faded out, it is absent, because it has not crossed the progress channel yet. A gate that is
// only a stylesheet is one devtools inspection from being disproved.
//
// The protocol constrains what a verifier must find, not what a client must show. Other clients
// will decide this differently, including in directions the author considers bad for the people
// using them, and nothing here is meant to prevent that.

import { useEffect, useRef, useState } from 'react';
import { STAGE_LABELS, type StageId } from './stages';

/** Degrees per second at full flow. Fast enough to read as motion, slow enough not to blur. */
const IMPELLER_DEGREES_PER_SECOND = 300;

const ELAPSED_TICK_MS = 100;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function useElapsedMs(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return Math.max(0, now - startedAt);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SightGlass(props: {
  stage: StageId | null;
  /** Decaying arrival scalar in [0, 1]. Zero means nothing is arriving right now. */
  activity: number;
  startedAt: number;
  /** True when the transport is holding everything until it is verified: no arrival to show. */
  held: boolean;
  /** Median of this client's own recent exchanges with this model, or null without history. */
  typicalMs: number | null;
}) {
  const { stage, activity, startedAt, held, typicalMs } = props;
  const reducedMotion = usePrefersReducedMotion();
  const elapsedMs = useElapsedMs(startedAt);
  const impeller = useRef<SVGGElement | null>(null);
  const activityRef = useRef(activity);
  activityRef.current = activity;

  // The angle is written straight to the node. It is animation state, not application state,
  // and putting it through React would re-render the component sixty times a second to move one
  // attribute.
  useEffect(() => {
    if (reducedMotion || held) return;
    let frame = 0;
    let previous = performance.now();
    let angle = 0;
    const tick = (now: number) => {
      const dt = now - previous;
      previous = now;
      angle = (angle + (dt / 1000) * IMPELLER_DEGREES_PER_SECOND * activityRef.current) % 360;
      impeller.current?.setAttribute('transform', `rotate(${angle.toFixed(2)} 17 9)`);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, held]);

  const flowing = activity > 0.02;
  const label = stage ? STAGE_LABELS[stage] : 'Working';

  return (
    <div className="sight" data-flowing={flowing ? 'yes' : 'no'}>
      {held ? (
        <span className="sight-held" aria-hidden="true">
          <span className="sight-held-bar" />
        </span>
      ) : (
        <span
          className={`sight-glass ${flowing ? 'flowing' : 'settled'}`}
          aria-hidden="true"
          style={{ ['--sight-activity' as string]: activity.toFixed(3) }}
        >
          <svg viewBox="0 0 34 18" role="presentation" focusable="false">
            <rect className="sight-glass-window" x="0.75" y="0.75" width="32.5" height="16.5" rx="8.25" />
            <g ref={impeller} className="sight-glass-impeller" transform="rotate(0 17 9)">
              <line x1="17" y1="3.6" x2="17" y2="14.4" />
              <line x1="11.6" y1="9" x2="22.4" y2="9" />
            </g>
          </svg>
        </span>
      )}

      <span className="sight-stage" role="status" aria-live="polite">
        {label}
      </span>

      {held && (
        <span className="sight-held-meta">
          {seconds(elapsedMs)}
          {typicalMs !== null
            ? ` elapsed, typically ${seconds(typicalMs)} for this model`
            : ' elapsed'}
        </span>
      )}
    </div>
  );
}
