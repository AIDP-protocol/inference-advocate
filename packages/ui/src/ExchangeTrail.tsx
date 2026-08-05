// The exchange status trail: marks, one shared swatch, one text line.
//
// Paper: steps 6 and 12. Spec §1.1. Replaces the impeller sight glass. The wait is a design
// problem: a gate experienced only as slowness reads as a defect. This shows which check has
// already run and which is running, without implying a percentage or a completion time the
// client does not have.
//
// After a clean delivery the trail collapses to a single deliver mark (pill hit target); click
// expands the record. A withheld or refused trail stays expanded: a held response must not look
// casually dismissible.
//
// The hold remains a conformance property of this client, not a cryptographic one. Response text
// is absent from the document before release because it has not crossed the progress channel.

import { useEffect, useState } from 'react';
import { StatusTrail } from './StatusTrail';
import { StageMark } from './StageMark';
import { TrailSwatch, animForTrail, type TrailAnimKind } from './TrailSwatch';
import {
  trailIsComplete,
  trailIsHalted,
  type TrailMarks,
} from './trail-state';
import type { StageId } from './stages';
import { STAGE_LABELS } from './stages';

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

export function ExchangeTrail(props: {
  marks: TrailMarks;
  /** Live core stage, for the shared text line while an exchange runs. */
  stage: StageId | null;
  /** Optional override for the text line (settled outcomes). */
  label?: string | null;
  activity: number;
  held: boolean;
  /** When true, the exchange has a final result attached to this trail. */
  settled: boolean;
  /** Force expanded (withheld / refuse). */
  forceExpanded?: boolean;
}) {
  const { marks, stage, label, activity, held, settled, forceExpanded = false } = props;
  const reducedMotion = usePrefersReducedMotion();
  const halted = trailIsHalted(marks);
  const complete = trailIsComplete(marks);
  const [openRecord, setOpenRecord] = useState(false);

  const collapsed =
    settled && complete && !halted && !forceExpanded && !openRecord;

  const receiving =
    stage === 'receiving' || stage === 'awaiting_response' || stage === 'response_complete';
  const working =
    stage === 'checking_standing' ||
    stage === 'verifying_seal' ||
    stage === 'evaluating_content' ||
    stage === 'resolving_delivery' ||
    stage === 'recording' ||
    stage === 'delivering';

  const kind: TrailAnimKind = animForTrail({
    held,
    receiving: receiving && !settled,
    working: working && !settled && !receiving,
    settled: settled || (!receiving && !working),
  });

  const text =
    label ??
    (stage ? STAGE_LABELS[stage] : settled ? null : 'Working');

  if (collapsed) {
    return (
      <button
        type="button"
        className="exchange-trail-record"
        onClick={() => setOpenRecord(true)}
        title="Show exchange status record"
        aria-label="Show exchange status record"
      >
        <StageMark stage="deliver" state="done" reducedMotion={reducedMotion} />
      </button>
    );
  }

  return (
    <div className={`exchange-trail${halted ? ' exchange-trail-halted' : ''}`}>
      <div className="exchange-trail-row">
        <StatusTrail marks={marks} reducedMotion={reducedMotion} />
        {settled && complete && !halted && (
          <button
            type="button"
            className="exchange-trail-collapse"
            onClick={() => setOpenRecord(false)}
            title="Collapse status record"
            aria-label="Collapse status record"
          >
            Done
          </button>
        )}
      </div>
      <div className="exchange-trail-meta">
        <TrailSwatch kind={kind} activity={activity} reducedMotion={reducedMotion} />
        {text && (
          <span className="exchange-trail-label" role="status" aria-live="polite">
            {text}
          </span>
        )}
      </div>
    </div>
  );
}

/** Outbound compose glass: reverse bubble field driven by composing activity.
 * Always mounted so the composer does not reflow when activity crosses the floor. */
export function ComposeGlass(props: {
  activity: number;
  /** When true (exchange in flight), keep the reserved slot but show no motion. */
  idle?: boolean;
}) {
  const { activity, idle = false } = props;
  const reducedMotion = usePrefersReducedMotion();
  const level = idle ? 0 : activity;
  return (
    <div
      className={`compose-glass${level > 0.02 ? ' compose-glass-active' : ''}`}
      title={level > 0.02 ? 'You are composing' : undefined}
      aria-hidden="true"
    >
      <TrailSwatch kind="flow-out" activity={level} reducedMotion={reducedMotion} />
    </div>
  );
}
