// Shell appearance theme (light / dark / system).
//
// Paper: step 12 presentation. Spec §1.1. Theme is client chrome only; it does not change
// protocol behavior. Preference is stored in localStorage so the shell can paint before the
// daemon answers. "system" follows prefers-color-scheme.

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'airp-theme';

export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // private mode / blocked storage: fall through to system
  }
  return 'system';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export function writeThemePreference(preference: ThemePreference): ResolvedTheme {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // still apply in-session even if persistence fails
  }
  return applyTheme(preference);
}
