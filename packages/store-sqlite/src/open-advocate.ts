// Path-based openAdvocate convenience for the SQLite host.
//
// Paper: setup before the prompt. Core's openAdvocate takes an injected StoreBackend.
// Hosts that still open from a filesystem path construct the SQLite adapter here so the
// import change is one line and the core stays free of node:sqlite.

import {
  openAdvocate as openAdvocateCore,
  type OpenedAdvocate,
  type SetupOptions,
} from '@airp/core';
import { openSqliteStore } from './sqlite-store.js';

export type SqliteSetupOptions = Omit<SetupOptions, 'store'> & {
  /** The single on-device store file. */
  storePath: string;
};

export function openAdvocate(opts: SqliteSetupOptions): OpenedAdvocate {
  const { storePath, ...rest } = opts;
  return openAdvocateCore({ ...rest, store: openSqliteStore(storePath) });
}
