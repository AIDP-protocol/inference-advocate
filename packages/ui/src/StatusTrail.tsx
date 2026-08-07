// Accumulating status trail: settled stages as dots, one live (or halted) full mark.
//
// Paper: steps 3 through 12. Settled marks shrink back to 4px dots so the row stays compact.
// Hover widens that slot to the right and crossfades the glyph in, so neighbors part instead of
// stacking. The trail sits on its own row with horizontal room; vertical footprint stays fixed
// so the transcript does not reflow. Nothing after a stop is shown: a halt has not decided the
// later stages, so pending dots past it would be a lie.

import { StageMark } from './StageMark';
import {
  TRAIL_STAGES,
  markTitle,
  type MarkState,
  type TrailMarks,
  type TrailStage,
} from './trail-state';

export function StatusTrail(props: {
  marks: TrailMarks;
  reducedMotion?: boolean;
}) {
  const { marks, reducedMotion = false } = props;

  const settled: Array<{ index: number; stage: TrailStage; state: 'done' | 'skipped' }> = [];
  let current: { stage: TrailStage; state: 'active' | 'stopped' } | null = null;
  const pending: TrailStage[] = [];
  let halted = false;
  let pastCurrent = false;

  for (let i = 0; i < TRAIL_STAGES.length; i++) {
    const stage = TRAIL_STAGES[i]!;
    const state = (marks[i] ?? 'pending') as MarkState;
    if (state === 'done' || state === 'skipped') {
      settled.push({ index: i, stage, state });
      continue;
    }
    if (state === 'active' || state === 'stopped') {
      current = { stage, state };
      pastCurrent = true;
      if (state === 'stopped') halted = true;
      continue;
    }
    // pending
    if (halted) continue;
    if (pastCurrent || !current) pending.push(stage);
  }

  // Before the first stage event, every mark is pending: show the full pending row.
  // After a current mark, pending are the yet-to-run stages (omitted past a halt).
  const showPending = pending.length > 0 && !halted;

  return (
    <div className="status-trail" aria-hidden="true">
      {settled.map((m) => {
        const title = markTitle(m.stage, m.state);
        return (
          <div key={m.stage} className="status-trail-settled" title={title}>
            <span
              className={`status-trail-dot status-trail-dot-${m.state}${
                reducedMotion ? '' : ' status-trail-dot-in'
              }`}
            />
            <StageMark stage={m.stage} state={m.state} reducedMotion={reducedMotion} />
          </div>
        );
      })}

      {current && (
        <div
          className={`status-trail-slot status-trail-current${
            reducedMotion ? '' : ' status-trail-mark-in'
          }`}
        >
          <StageMark stage={current.stage} state={current.state} reducedMotion={reducedMotion} />
        </div>
      )}

      {showPending && (
        <div className="status-trail-pending">
          {pending.map((stage) => (
            <span key={stage} className="status-trail-dot status-trail-dot-pending" />
          ))}
        </div>
      )}
    </div>
  );
}
