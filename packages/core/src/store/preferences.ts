// Preference store. User configuration, Delivery Policy selections, jurisdiction profile.
//
// Provisional: Section 2.2. Sealed under the preference key.

import type { AdvocateDb } from './db.js';
import type { StoreKey } from '../crypto/keys.js';

export class PreferenceStore {
  readonly #db: AdvocateDb;
  readonly #key: StoreKey;

  constructor(db: AdvocateDb, key: StoreKey) {
    if (key.store !== 'preference') throw new Error('PreferenceStore requires the preference key');
    this.#db = db;
    this.#key = key;
  }

  get<T>(key: string): T | undefined {
    const row = this.#db.raw.prepare('SELECT sealed FROM preferences WHERE key = ?').get(key) as
      | { sealed: string }
      | undefined;
    if (!row) return undefined;
    return JSON.parse(this.#key.open(row.sealed)) as T;
  }

  set<T>(key: string, value: T): void {
    this.#db.raw
      .prepare('INSERT INTO preferences(key, sealed) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET sealed = excluded.sealed')
      .run(key, this.#key.seal(JSON.stringify(value)));
  }

  keys(): string[] {
    const rows = this.#db.raw.prepare('SELECT key FROM preferences ORDER BY key').all() as Array<{ key: string }>;
    return rows.map((r) => r.key);
  }
}
