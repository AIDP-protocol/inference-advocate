// @airp/store-sqlite: the Node SQLite adapter for the advocate store port.
//
// Paper: Section 6. Provisional: Mechanism 2.
// Core defines StoreBackend. This package is the only shipped implementation.

export { SqliteStore, openSqliteStore, type OpenSqliteOptions } from './sqlite-store.js';
export { openAdvocate, type SqliteSetupOptions } from './open-advocate.js';
export { SCHEMA } from './schema.js';
