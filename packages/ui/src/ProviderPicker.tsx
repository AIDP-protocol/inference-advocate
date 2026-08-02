// Custom provider picker for the composer.
//
// Closed: org name only, so the chip stays short. Open: each row shows the org
// name plus a small light pill with the model (or mock annotation). Native
// <select> cannot style those parts separately.

import { useEffect, useId, useRef, useState } from 'react';
import { splitProviderLabel } from './provider-label';

export interface ProviderOption {
  id: string;
  label: string;
}

export function ProviderPicker(props: {
  providers: ProviderOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { providers, value, onChange } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = providers.find((p) => p.id === value) ?? providers[0];
  const selectedPrimary = selected ? splitProviderLabel(selected.label).primary : 'Provider';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (providers.length === 0) return null;

  return (
    <div className={`provider-picker ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="provider-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="provider-picker-primary">{selectedPrimary}</span>
        <span className="provider-picker-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <ul className="provider-picker-menu" role="listbox" id={listId}>
          {providers.map((p) => {
            const { primary, secondary } = splitProviderLabel(p.label);
            const active = p.id === value;
            return (
              <li key={p.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`provider-picker-option ${active ? 'on' : ''}`}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <span className="provider-picker-primary">{primary}</span>
                  {secondary && <span className="provider-model-pill">{secondary}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
