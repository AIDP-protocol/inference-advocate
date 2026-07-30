// Preference store. User configuration, Delivery Policy selections, jurisdiction profile.
//
// Provisional: Section 2.2. Sealed under the preference key.

import type { StoreKey } from '../crypto/keys.js';
import type { StoreBackend } from './port.js';

export class PreferenceStore {
  readonly #store: StoreBackend;
  readonly #key: StoreKey;

  constructor(store: StoreBackend, key: StoreKey) {
    if (key.store !== 'preference') throw new Error('PreferenceStore requires the preference key');
    this.#store = store;
    this.#key = key;
  }

  get<T>(key: string): T | undefined {
    const sealed = this.#store.getPreferenceSealed(key);
    if (sealed === undefined) return undefined;
    return JSON.parse(this.#key.open(sealed)) as T;
  }

  set<T>(key: string, value: T): void {
    this.#store.setPreferenceSealed(key, this.#key.seal(JSON.stringify(value)));
  }

  keys(): string[] {
    return this.#store.listPreferenceKeys();
  }
}
