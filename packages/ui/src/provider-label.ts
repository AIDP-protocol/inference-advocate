// Split a provider label into the fictional org name and an optional secondary
// (model name, or mock annotation). The design puts org names first; the wire
// model stays secondary so the client does not read as a model zoo.

export function splitProviderLabel(label: string): { primary: string; secondary: string | null } {
  const m = label.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m?.[1] && m[2]) {
    return { primary: m[1].trim(), secondary: m[2].trim() };
  }
  return { primary: label, secondary: null };
}
