// Shared motion swatch for the exchange status trail and the outbound compose glass.
//
// Paper: step 12 (and step 1 for compose). Four kinds: bubble field (inbound stream or outbound
// compose, direction flipped), wandering dot (held / non-streamed transport), escapement
// (verify / evaluate / decide), hairline at rest.
//
// Both bubble fields use fixed chip lists. Arrival and keystrokes only keep a decay timer alive
// and change how many chips are visible. Remounting or rewriting animation-duration on each
// sample would restart the CSS cycle and read as stutter.

import {
  COMPOSE_BUBBLES,
  INBOUND_BUBBLES,
  inboundVisibleCount,
} from './bubbles';

export type TrailAnimKind = 'flow' | 'flow-out' | 'wait' | 'work' | 'still';

export function TrailSwatch(props: {
  kind: TrailAnimKind;
  /** Decaying activity in [0, 1]. Visibility for flow; on/off for flow-out. */
  activity?: number;
  reducedMotion?: boolean;
}) {
  const { kind, activity = 0, reducedMotion = false } = props;
  const composeOn = activity > 0.02;
  const visibleInbound = inboundVisibleCount(activity);

  if (kind === 'still') {
    return (
      <span className="trail-swatch trail-swatch-still" aria-hidden="true">
        <span className="trail-hairline" />
      </span>
    );
  }

  if (kind === 'wait') {
    return (
      <span className="trail-swatch trail-swatch-glass trail-swatch-wait" aria-hidden="true">
        <span className="trail-glass-window">
          <span className={`trail-wander${reducedMotion ? ' trail-frozen' : ''}`} />
        </span>
      </span>
    );
  }

  if (kind === 'work') {
    return (
      <span className="trail-swatch trail-swatch-glass trail-swatch-work" aria-hidden="true">
        <span className="trail-glass-window">
          <span className={`trail-escapement${reducedMotion ? ' trail-frozen' : ''}`} />
          <span className="trail-escapement-pivot" />
        </span>
      </span>
    );
  }

  const outward = kind === 'flow-out';
  // Inbound stays mounted for the whole receive phase so a quiet gap between chunks does not
  // tear down the field. Outbound only shows the rectangle while composing.
  if (outward && !composeOn) {
    return <span className="trail-swatch trail-swatch-out-idle" aria-hidden="true" />;
  }

  const bubbles = outward ? COMPOSE_BUBBLES : INBOUND_BUBBLES;
  const flowing = outward ? composeOn : visibleInbound > 0;

  return (
    <span
      className={`trail-swatch trail-swatch-glass${flowing ? ' flowing' : ''}${
        outward ? ' trail-swatch-out' : ''
      }`}
      aria-hidden="true"
    >
      <span className="trail-glass-window">
        {bubbles.map((b, i) => {
          const latent = !outward && i >= visibleInbound;
          return (
            <span
              key={outward ? `out-${i}` : `in-${i}`}
              className={`trail-bubble trail-bubble-${b.path}${
                reducedMotion ? ' trail-bubble-frozen' : ''
              }${latent ? ' trail-bubble-latent' : ''}`}
              style={{
                width: b.size,
                height: b.size,
                animationDuration: reducedMotion ? undefined : `${b.duration}s`,
                animationDelay: reducedMotion ? undefined : `${b.delay}s`,
                ['--bubble-freeze-x' as string]: `${6 + ((i * 7) % 18)}px`,
                ['--bubble-freeze-y' as string]: `${4 + ((i * 5) % 10)}px`,
                opacity: reducedMotion && !latent ? 0.55 + (i % 3) * 0.12 : undefined,
              }}
            />
          );
        })}
      </span>
    </span>
  );
}

/** Pick the inbound trail animation from transport and the active core-ish phase. */
export function animForTrail(opts: {
  held: boolean;
  receiving: boolean;
  working: boolean;
  settled: boolean;
}): TrailAnimKind {
  if (opts.settled) return 'still';
  if (opts.receiving) return opts.held ? 'wait' : 'flow';
  if (opts.working) return 'work';
  return 'still';
}
