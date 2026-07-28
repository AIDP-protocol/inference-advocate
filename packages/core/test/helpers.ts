import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, from packages/core/dist/test/helpers.js. */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const dataDir = join(repoRoot, 'data');

export function dataPath(...parts: string[]): string {
  return join(dataDir, ...parts);
}
