// Local persistence. One SQLite file on the user's device. No cloud component anywhere.
//
// Paper: Section 6 ("an operator who never holds a thing cannot be compelled to produce it").
// Provisional: Mechanism 2, Section 2.2 (store segregation).
// The segregation is logical within one file and cryptographic by column: each store's
// content is sealed under that store's key. One file is the residency promise made literal;
// separate keys are what stop a compromise of one function from yielding the whole person.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface OpenOptions {
  /** Path to the single on-device file. Use ':memory:' in tests. */
  path: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Transcript store. Content is sealed under the transcript key.
CREATE TABLE IF NOT EXISTS transcripts (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  role        TEXT NOT NULL,
  at          TEXT NOT NULL,
  sealed      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transcripts_session ON transcripts(session_id, at);

-- Evidence spans are conversation content, so they live under the transcript key,
-- not the ledger key. This is what makes the telemetry emitter structurally unable
-- to transmit content: it holds the ledger key and nothing else.
CREATE TABLE IF NOT EXISTS evidence (
  ref         TEXT PRIMARY KEY,
  response_id TEXT NOT NULL,
  sealed      TEXT NOT NULL
);

-- Ledger store. Append only. Hash chained. No conversation content.
CREATE TABLE IF NOT EXISTS ledger (
  provider_id       TEXT NOT NULL,
  seq               INTEGER NOT NULL,
  response_id       TEXT NOT NULL,
  at                TEXT NOT NULL,
  outcome           TEXT NOT NULL,
  score             REAL NOT NULL,
  evaluator_version TEXT NOT NULL,
  taxonomy_version  TEXT NOT NULL,
  flags_json        TEXT NOT NULL,
  prev_hash         TEXT NOT NULL,
  hash              TEXT NOT NULL,
  PRIMARY KEY (provider_id, seq)
);
CREATE INDEX IF NOT EXISTS ledger_at ON ledger(provider_id, at);

-- Carryover: per-provider heightened sensitivity that survives a cleared block.
CREATE TABLE IF NOT EXISTS carryover (
  provider_id      TEXT PRIMARY KEY,
  multiplier       REAL NOT NULL,
  clean_remaining  INTEGER NOT NULL,
  set_at           TEXT NOT NULL
);

-- Blocks currently in force, and how they were resolved.
CREATE TABLE IF NOT EXISTS blocks (
  provider_id  TEXT NOT NULL,
  response_id  TEXT NOT NULL,
  authority    TEXT NOT NULL,
  raised_at    TEXT NOT NULL,
  released_at  TEXT,
  released_by  TEXT,
  PRIMARY KEY (provider_id, response_id)
);

-- Preference store. Sealed under the preference key.
CREATE TABLE IF NOT EXISTS preferences (
  key    TEXT PRIMARY KEY,
  sealed TEXT NOT NULL
);

-- Telemetry batches already emitted, so a run is not double counted.
CREATE TABLE IF NOT EXISTS telemetry_batches (
  id            TEXT PRIMARY KEY,
  window_start  TEXT NOT NULL,
  window_end    TEXT NOT NULL,
  emitted_at    TEXT NOT NULL,
  payload_json  TEXT NOT NULL
);
`;

export class AdvocateDb {
  readonly raw: DatabaseSync;
  readonly path: string;

  constructor(opts: OpenOptions) {
    this.path = opts.path;
    if (opts.path !== ':memory:') mkdirSync(dirname(opts.path), { recursive: true });
    this.raw = new DatabaseSync(opts.path);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec(SCHEMA);
  }

  getMeta(key: string): string | undefined {
    const row = this.raw.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.raw
      .prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  close(): void {
    this.raw.close();
  }
}
