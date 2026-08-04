#!/usr/bin/env bash
# Historical helper: replays an early build as a sequence of small commits.
# Commits are meant to stay small and message-disciplined so the history reads as a build
# narrative. Prefer ordinary git commits for new work.
#
# Usage, from inside a clone of the repository, after copying the files in:
#   bash tools/commit-sequence.sh
#
# It commits only paths that exist and only when something is staged, so it is safe to re-run.

set -euo pipefail

commit() {
  local message="$1"
  shift
  local existing=()
  for path in "$@"; do
    [ -e "$path" ] && existing+=("$path")
  done
  [ ${#existing[@]} -eq 0 ] && return 0
  git add -- "${existing[@]}"
  if git diff --cached --quiet; then
    return 0
  fi
  git commit -q -m "$message"
  echo "  $message"
}

echo "replaying the build history:"

commit "chore: npm workspaces, TypeScript configuration, and run scripts" \
  package.json package-lock.json tsconfig.base.json .gitignore

commit "docs: ARCHITECTURE.md, the module to paper map and the honest gap list" \
  ARCHITECTURE.md

commit "feat(core): key hierarchy and provenance seal primitives

Per-store keys derived from one user-held master secret, so a component
handed one store key cannot read another. Ed25519 sealing and detached
document signatures. Paper step 5 and Section 6; provisional Section 2.2a." \
  packages/core/package.json packages/core/tsconfig.json \
  packages/core/src/types.ts packages/core/src/crypto

commit "feat(core): local store, one SQLite file, segregated by key scope

Transcripts, ledger, and preferences in a single on-device file, each
sealed under its own derived key. Evidence spans live under the transcript
key rather than the ledger key, which is what makes the telemetry emitter
structurally unable to transmit content. Provisional Section 2.2." \
  packages/core/src/store

commit "feat(core): the pipe, Interchange bootstrap and provider config (phase 1)

OpenAI-compatible wire format as the Interchange bootstrap, with the AIRP
additions carried in headers an unmodified server ignores. Paper steps 3
and 6." \
  packages/core/src/interchange

commit "feat(core): the monitor, deterministic and semantic passes (phase 2)

Seal verification against a locally pinned, signed Serving Register, then
the flag taxonomy applied by a reproducible rule evaluator. Taxonomy v0
ships as versioned data rather than code. Paper steps 7 and 8." \
  packages/core/src/monitor data/taxonomy

commit "feat(core): Delivery Policy, four outcomes, jurisdiction at delivery (phase 3)

Rolling window scoring seeded by standing, warn and block lines, release
authority keyed to classification, carryover after a cleared block, mode
floors, and pinned notices. Paper steps 10 and 11." \
  packages/core/src/policy data/policy data/jurisdictions

commit "feat(core): telemetry as rates, standing, and the export view (phase 4)

Aggregate incident rates with a granularity floor and a traffic-class
denominator. The emitter takes a ledger-scoped key and refuses any other.
Paper steps 13 and 14, and Section 5." \
  packages/core/src/telemetry

commit "feat(core): the advocate, fourteen steps end to end" \
  packages/core/src/advocate.ts packages/core/src/setup.ts packages/core/src/index.ts

commit "chore(data): demo trust fabric, registrar and standing body keys

Demonstration fixtures, committed on purpose so that a signed register can
actually be verified by anyone who clones this. They protect nothing." \
  tools data/register data/standing data/demo-keys \
  data/providers.example.json data/providers.demo.json

commit "test(core): the gate, the key scopes, and the ledger chain

Including the two that matter most: raw SQLite rows contain no conversation
content, and a telemetry batch contains no words." \
  packages/core/test

commit "feat(demo): mock providers and the scripted scenario (demo milestone)

Two providers over a real socket, flags accumulating, the warn line and
then the block line crossed, and the telemetry export showing rates
leaving and words staying." \
  packages/demo

commit "feat(daemon): local HTTP daemon on 127.0.0.1 (phase 5)

The seam between a core that needs a filesystem and a UI that runs in a
browser tab. Desktop packaging replaces it with an in-process call." \
  packages/daemon

commit "feat(ui): chat surface, monitor panel, policy and export views (phase 5)

Deliberately familiar. The apparatus is invisible when nothing is wrong.
There is no close button on a notice anywhere in this package, which is
the entire implementation of non-dismissable." \
  packages/ui

commit "docs: run instructions and status" \
  README.md ARCHITECTURE.md

echo "done."
git --no-pager log --oneline | head -20
