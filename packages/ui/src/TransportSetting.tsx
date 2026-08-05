// The transport control, as the user sees it.
//
// Paper: steps 6 and 12. Spec §1.1: presentation is out of scope, so the wording here is a
// choice and not a requirement.
//
// The title names what is withheld rather than the mechanism. Not "stream", because with the
// setting on there is no stream, and a control named after something that does not exist in the
// state it describes is the kind of small wrongness people notice without being able to say why.
// The person choosing this is trading an indicator for a guarantee, so the name and the two state
// lines are about the guarantee.
//
// The state lines have to carry the real difference, which is whether unverified text ever lands
// on the machine and not merely when it is shown. "Arrives unverified, hidden until checked" says
// three things: the text is here, it has not been checked, and hiding is the only thing between
// the user and it. Hidden is a weaker claim than absent, and which one is in force is the entire
// substance of the setting.
//
// A locked setting renders disabled with a line naming who set it, rather than disappearing.
// Someone who can see the control, see that it is locked, and see why understands the arrangement
// they are in. A control that silently is not there teaches them nothing.

import { useState } from 'react';
import type { TransportState } from './types';

export function TransportSetting(props: {
  transport: TransportState | undefined;
  onChange: (withhold: boolean) => void;
  error?: string | null;
}) {
  const { transport, onChange, error } = props;
  const [open, setOpen] = useState(false);
  if (!transport) return null;

  const on = transport.withholdUnverifiedContent;

  return (
    <section className="transport-setting">
      <div className="transport-head">
        <span className="transport-title">Withhold Unverified Content</span>
        <button
          type="button"
          className="transport-info"
          aria-expanded={open}
          aria-label="About withholding unverified content"
          onClick={() => setOpen((o) => !o)}
        >
          i
        </button>
        <label className={`transport-toggle ${transport.locked ? 'locked' : ''}`}>
          <input
            type="checkbox"
            checked={on}
            disabled={transport.locked}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="transport-track" aria-hidden="true">
            <span className="transport-knob" />
          </span>
          <span className="transport-state">{on ? 'on' : 'off'}</span>
        </label>
      </div>

      <div className="transport-states">
        <span className={`transport-line ${on ? '' : 'in-force'}`}>
          <span className="transport-line-key">off</span>
          Arrives unverified, hidden until checked
        </span>
        <span className={`transport-line ${on ? 'in-force' : ''}`}>
          <span className="transport-line-key">on</span>
          Nothing arrives until verified
        </span>
      </div>

      {transport.locked && (
        <p className="transport-locked">
          Set by {transport.lockedBy ?? 'the Delivery Policy'}. You can see it and see that it is
          locked, which is more than a control that had been removed would tell you.
        </p>
      )}

      {error && <p className="transport-error">{error}</p>}

      {open && (
        <div className="transport-detail">
          <p>
            With this off, the response arrives as it is generated and sits unverified in this
            application's memory, hidden from you, until the checks finish. Nothing is rendered
            before then, and while it arrives you get an indicator driven by the arrival itself.
          </p>
          <p>
            With it on, nothing reaches this device until the whole response is ready and verified.
            There is elapsed time and the stage of each check, but no measure of arrival, because
            nothing is arriving yet.
          </p>
          <p>
            The difference is a small amount of exposure traded for a better wait. Which way to
            trade it turns on who set the policy: off where you set your own, because there is
            nothing to defend against; on where someone else set it, such as a managed device or a
            profile configured by another person, because the checks are then guarding against
            someone who may have access to this machine.
          </p>
          <p className="transport-detail-limit">
            Either way the hold is a property of this client honoring it, not of cryptography.
            Plaintext has to exist here for the checks to run at all, so on a device its user
            controls, this is a setting that narrows a window rather than a boundary that cannot be
            crossed.
          </p>
        </div>
      )}
    </section>
  );
}
