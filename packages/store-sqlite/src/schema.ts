// SQLite schema for the on-device advocate store.
//
// Paper: Section 6. Provisional: Mechanism 2, Section 2.2.
// Schema shape is a backend concern. Logical segregation lives in the table layout and in the
// seal column; cryptographic segregation is the per-store key held above the adapter.

export const SCHEMA = `
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
