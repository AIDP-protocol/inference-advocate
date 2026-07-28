# Handoff

What this is, how to get it into the repository, and what to read first.

## What happened

The session that built this had GitHub access through the desktop bridge. The bridge went
offline partway through, so the work could not be pushed. Everything is here instead, as a
working tree with a commit-replay script, so the history still lands as a build narrative rather
than as one enormous commit.

## Getting it into the repository

```bash
git clone https://github.com/AIDP-protocol/inference-advocate
cd inference-advocate

# copy everything from the extracted bundle over the clone.
# README.md, PLAN.md and .gitignore are updated versions of the files already there.
rsync -a --exclude .git /path/to/inference-advocate-build/ .

bash tools/commit-sequence.sh
git push
```

`tools/commit-sequence.sh` stages and commits in fifteen steps, skipping anything that is
already committed, so it is safe to run more than once. Read it before running it if you would
rather commit by hand; the messages are in there.

If you prefer the history exactly as it was built, `inference-advocate.bundle` in the same
directory is a git bundle of the local repository. It has no ancestor in common with the remote,
so it is a reference rather than something to merge.

## Verify it works

```bash
npm install
npm test        # builds the core, runs 52 tests
npm run demo    # the scripted scenario, about 40 seconds of output
```

The demo needs ports 8811, 8812 and 8813 on the loopback interface. Nothing else touches the
network.

## Read first

1. **DECISIONS.md** is the short list of things that need you. Nine items, each with a
   recommendation attached. Items 1 through 4 are the ones with consequences.
2. **ARCHITECTURE.md** has the module-to-paper map and, more usefully, the section titled
   "What this build does not have". That list is deliberate and complete as far as I know it.
3. The demo output is the fastest way to see whether the thing does what the paper says.

## What was built

All five phases of PLAN.md and the demo milestone.

- **Phase 1**, the pipe: Interchange over the OpenAI-compatible format, named providers with
  keys read from environment variables, transcripts in a single on-device SQLite file.
- **Phase 2**, monitor and ledger: seal verification against a pinned signed Serving Register,
  taxonomy v0 as versioned data, severity weighting, append-only hash-chained per-provider
  ledger.
- **Phase 3**, Delivery Policy: rolling window scoring seeded by standing, the four outcomes,
  release authority keyed to classification, carryover, mode floors, the policy published as
  readable prose and loaded as JSON, and two illustrative jurisdiction rulesets that visibly
  change outcomes.
- **Phase 4**, telemetry: rates with a granularity floor and a traffic-class denominator, an
  emitter that holds the ledger key and refuses any other, a stubbed reporting wire format, and
  an export view that puts the outbound bytes beside an inventory of what stays.
- **Phase 5**, UI: chat surface, pinned non-dismissable notices, monitor panel with threshold
  proximity per provider, the Delivery Policy readable in-app, and the export view.

The demo runs the whole argument in one script: clean delivery, drift across the warn line,
withholding at the block line, release authority, the ledger forgetting at the stated rate, a
provider excluded at population level refused before a request is sent, an unsealed response
under a jurisdiction that requires provenance to be noticed, and the export.

## A note on what I did not do

I did not build anything the paper describes as adopt-not-build, and I did not build the
escalation channel. Both are in DECISIONS.md. Where a mechanism is missing, the code says so
rather than pretending: the advocate prints its own gaps at startup and the UI renders them in
the monitor panel under "What this build does not have". That posture is deliberate. A reference
implementation that overstates itself is worse than none.
