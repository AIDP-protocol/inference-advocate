// One stage glyph in one of five states. Paths from the design handoff StageMark reference.
//
// Paper: steps 3 through 12. Weight and shape carry the signal; colour confirms. Never distinguish
// state by colour alone: pending is a dot (rendered by StatusTrail), active breathes, done is
// heavy blue, skipped is light with a slash in faint yellow (deliberate, not pending or stopped),
// stopped is heaviest red with a hold bar.

import {
  TRAIL_STAGE_LABELS,
  type MarkState,
  type TrailStage,
} from './trail-state';

const GLYPHS: Record<TrailStage, string[]> = {
  send: ['M12 20.5 V6', 'M7.4 10.6 L12 6 L16.6 10.6'],
  receive: ['M12 3.5 V18', 'M7.4 13.4 L12 18 L16.6 13.4'],
  verify: ['M12 4.4 A7.6 7.6 0 1 1 11.99 4.4 Z', 'M12 12 h0.01'],
  evaluate: ['M9.6 4.2 H20 V19.8 H9.6 L3.4 12 Z'],
  decide: ['M3.4 12 H11', 'M11 12 V6.2 H20.6', 'M11 12 V17.8 H20.6'],
  deliver: ['M3.6 12.6 L9.4 18.4 L20.4 6'],
};

const STROKE: Record<Exclude<MarkState, 'pending'>, number> = {
  active: 2.1,
  done: 2.9,
  skipped: 1.5,
  stopped: 2.9,
};

export function StageMark(props: {
  stage: TrailStage;
  state: Exclude<MarkState, 'pending'>;
  reducedMotion?: boolean;
}) {
  const { stage, state, reducedMotion = false } = props;
  const paths = GLYPHS[stage];
  const sw = STROKE[state];
  const slash = state === 'skipped';
  const held = state === 'stopped';
  const pulse = state === 'active' && !reducedMotion;

  return (
    <svg
      className={`stage-mark stage-mark-${state}${pulse ? ' stage-mark-pulse' : ''}`}
      viewBox="0 0 24 27"
      width="14"
      height="15.75"
      fill="none"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={`${TRAIL_STAGE_LABELS[stage]}, ${state}`}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {slash && <path d="M4 20 L20 4" strokeWidth={1.5} />}
      {held && <path d="M4.6 24.4 H19.4" />}
    </svg>
  );
}
