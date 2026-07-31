// Busy indicator for an in-flight ask: rotating process phrases plus a light motion cue.
//
// Paper: steps 1 and 12. Same job as the old "evaluating..." line, but closer to ordinary
// chat clients. Phrases stay non-anthropomorphic on purpose.

import { useEffect, useState } from 'react';
import { pickWorkingPhrase, ROTATE_MS } from './working-phrases';

export function WorkingIndicator() {
  const [phrase, setPhrase] = useState(() => pickWorkingPhrase());

  useEffect(() => {
    setPhrase(pickWorkingPhrase());
    const id = window.setInterval(() => {
      setPhrase((current) => pickWorkingPhrase(current));
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <p className="working" role="status" aria-live="polite">
      <span className="working-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="working-phrase">{phrase}</span>
    </p>
  );
}
