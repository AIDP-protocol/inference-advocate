// Provider configuration. Multiple named providers, keys held locally.
//
// Paper: step 3 ("any certified advocate can front any registered provider").
// PLAN: Phase 1.
//
// The config file lives beside the store on the user's device. Keys are read from named
// environment variables by default so that a config file can be shared or committed without
// carrying a secret.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderConfig } from '../types.js';

export interface ProvidersFile {
  version: 1;
  providers: ProviderConfig[];
}

export class ProviderRegistry {
  #byId = new Map<string, ProviderConfig>();

  constructor(providers: ProviderConfig[] = []) {
    for (const p of providers) this.add(p);
  }

  static load(path: string): ProviderRegistry {
    if (!existsSync(path)) return new ProviderRegistry();
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ProvidersFile;
    if (parsed.version !== 1) throw new Error(`unsupported providers file version ${parsed.version}`);
    return new ProviderRegistry(parsed.providers);
  }

  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const file: ProvidersFile = { version: 1, providers: this.list() };
    writeFileSync(path, JSON.stringify(file, null, 2) + '\n', 'utf8');
  }

  add(provider: ProviderConfig): void {
    if (!provider.id) throw new Error('provider id is required');
    this.#byId.set(provider.id, provider);
  }

  remove(id: string): void {
    this.#byId.delete(id);
  }

  get(id: string): ProviderConfig | undefined {
    return this.#byId.get(id);
  }

  require(id: string): ProviderConfig {
    const p = this.#byId.get(id);
    if (!p) throw new Error(`no provider configured with id ${id}`);
    return p;
  }

  list(): ProviderConfig[] {
    return [...this.#byId.values()];
  }
}
