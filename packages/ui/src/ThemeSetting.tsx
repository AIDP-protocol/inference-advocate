// Appearance control for the client shell.
//
// Paper: step 12. Spec §1.1. Theme is presentation only. Warm dark tokens live in styles.css
// under [data-theme="dark"]; this control only writes the preference and applies it.

import type { ThemePreference } from './theme';

const OPTIONS: Array<{ id: ThemePreference; label: string; hint: string }> = [
  { id: 'system', label: 'System', hint: 'Follow the OS setting' },
  { id: 'light', label: 'Light', hint: 'Warm paper shell' },
  { id: 'dark', label: 'Dark', hint: 'Nearly neutral warm gray' },
];

export function ThemeSetting(props: {
  value: ThemePreference;
  onChange: (next: ThemePreference) => void;
}) {
  const { value, onChange } = props;

  return (
    <section className="theme-setting" aria-label="Appearance">
      <div className="theme-head">
        <span className="theme-title">Appearance</span>
      </div>
      <div className="theme-options" role="radiogroup" aria-label="Color theme">
        {OPTIONS.map((opt) => {
          const on = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`theme-option${on ? ' on' : ''}`}
              onClick={() => onChange(opt.id)}
            >
              <span className="theme-option-label">{opt.label}</span>
              <span className="theme-option-hint">{opt.hint}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
