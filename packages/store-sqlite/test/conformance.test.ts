import { test } from 'node:test';
import { openSqliteStore } from '@airp/store-sqlite';
import { runStoreConformance } from '@airp/core';

test('the SQLite adapter satisfies store conformance', () => {
  runStoreConformance(() => openSqliteStore(':memory:'));
});
