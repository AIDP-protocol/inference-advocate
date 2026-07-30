import { test } from 'node:test';
import { openSqliteStore } from '@aidp/store-sqlite';
import { runStoreConformance } from '@aidp/core';

test('the SQLite adapter satisfies store conformance', () => {
  runStoreConformance(() => openSqliteStore(':memory:'));
});
