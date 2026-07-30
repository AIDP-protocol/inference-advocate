// Pinned notices.
//
// Paper: step 12. "If there is a notice, it is pinned: not something the user can dismiss,
// and no provider can remove it. It stays up for its window before it can wear off."
// The notice belongs to the layer whose duty runs to the user, which is what makes it
// credible. Nothing in the provider's response can suppress one, because the provider's
// response never reaches the renderer without passing through here first.

import type { Notice } from '../types.js';

export interface NoticeState {
  /** Notice id to RFC3339 timestamp it was last raised. */
  lastRaised: Record<string, string>;
  sessionStartedAt: string;
}

export function newNoticeState(sessionStartedAt: string): NoticeState {
  return { lastRaised: {}, sessionStartedAt };
}

export interface SelectInput {
  candidates: Notice[];
  state: NoticeState;
  now: Date;
  /** True when the response resolved into the warn band. */
  inWarnBand: boolean;
}

/** Returns the notices to pin for this delivery, and mutates the state to record them. */
export function selectNotices(input: SelectInput): Notice[] {
  const out: Notice[] = [];
  const nowIso = input.now.toISOString();

  for (const notice of input.candidates) {
    const trigger = notice.trigger ?? 'session_start';
    let raise = false;

    if (trigger === 'always') {
      raise = true;
    } else if (trigger === 'on_warn') {
      raise = input.inWarnBand;
    } else {
      const last = input.state.lastRaised[notice.id];
      if (!last) {
        raise = true;
      } else if (notice.repeatMinutes) {
        raise = input.now.getTime() - new Date(last).getTime() >= notice.repeatMinutes * 60_000;
      }
    }

    if (raise) {
      out.push(notice);
      input.state.lastRaised[notice.id] = nowIso;
    }
  }
  return out;
}

/** A notice whose display window has elapsed is no longer shown. Used by the UI. */
export function stillDisplayed(notice: Notice, raisedAt: string, now: Date): boolean {
  if (notice.windowMinutes === null) return true;
  return now.getTime() - new Date(raisedAt).getTime() < notice.windowMinutes * 60_000;
}
