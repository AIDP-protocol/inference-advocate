# Build Plan: Inference Advocate (Reference Implementation)

Working plan for the reference advocate. It maps to the AIDP paper's fourteen-step response path and to the component inventory findings behind it. The governing rule from the inventory: adopt the mature pieces, build the missing primitives. The missing primitives are the loyalty posture, the independent monitor feeding rate-based standing, and client-side delivery policy with jurisdiction applied at delivery. Those are where the reference advocate earns its existence.

## What this repo is for

An existence proof. The survey verdict was that no shipping product is simultaneously user-loyal, local-first, and audit-carrying. This repo assembles that product in reference form. It is not a startup, not a gateway for developers, and not a moderation product for institutions. It is the client half of the protocol the paper describes, small enough to read.

## Stack

TypeScript throughout. Core logic as a provider-agnostic library with no UI dependencies. React for the UI shell. Local persistence in SQLite as a single on-device file, which makes local-first residency literal rather than aspirational. Desktop packaging (Tauri) has a first slice in `packages/desktop`: a window over the loopback daemon sidecar. Replacing that HTTP seam with HostSession invoke is the next desktop step; a local web app remains supported.

## Phases

### Phase 0: Foundations (done)
- README, this plan, Apache 2.0 LICENSE (done)
- ARCHITECTURE.md mapping every module to its paper section and step, so the code and the paper stay in register with each other (done)

### Phase 1: The pipe (steps 1, 3, 6) (done)
- Provider adapter speaking the OpenAI-compatible wire format as the Interchange bootstrap
- Provider configuration: multiple named providers, keys held locally
- Local transcript store, on device, single SQLite file
- No cloud component anywhere in this phase or any later one

### Phase 2: The monitor and the ledger (steps 7, 8, 9) (done)
- Deterministic pass: Provenance Seal verification against the Serving Register, implemented against a local, signed register document whose format is designed so a real register could replace it; unsealed responses labeled honestly, since no frontier lab currently signs text
- Semantic pass: flag taxonomy v0, versioned in the repo as data, not code: persona claims, relational hooks, sycophancy, simulation obscured
- Severity weighting per flag class
- Per-provider ledger, local, append-only

### Phase 3: Delivery Policy (steps 2, 10, 11) (done)
- Score computed over the ledger across a rolling window, severity-weighted, with warn and exclusion lines at demo scale, clearly labeled as demo scale
- The four outcomes: deliver, deliver with notice, withhold pending release by an authorized superior user, refuse
- Policy as a published, human-readable file in the repo, visible in the UI
- Jurisdiction ruleset slot loaded at setup and applied at delivery, stubbed with one or two example rulesets

### Phase 4: Telemetry (steps 13, 14) (done)
- Rates, never content: aggregate incident rates derived from the ledger
- A reporting interface stubbed against a standing body that does not yet exist, so the wire format is defined even though nothing receives it
- Global standing consumed as a local document with the same design rule as the register: the format is real, the body is stubbed
- Export function so a demo shows exactly what would leave the device and what never does

### Phase 5: UI shell (steps 1, 12) (done)
- Chat surface fronting the pipe, deliberately familiar; the apparatus is invisible when nothing is wrong
- Pinned notices, non-dismissable, including the person-simulation notice, with display windows
- Monitor state visible: per-provider rates, threshold proximity, standing
- Delivery Policy visible and readable in-app

## Demo milestone (running; `npm run demo`)

The repo is done at reference stage when one scripted scenario runs end to end: a user converses through the advocate with two providers, the monitor flags one of them at an accumulating rate, the rate crosses the warn line and then the exclusion line, the Delivery Policy responds visibly at each stage, and the telemetry export shows rates leaving and words staying. That scenario is the paper's argument, executable. Target venue: live demo, August 2026.

## Status note

Phases 0 through 5 are implemented and the demo milestone runs end to end. Desktop packaging has
started as scaffolding (Tauri shell + daemon sidecar), not as an in-process bridge. What is not
built is listed in ARCHITECTURE.md rather than left to be discovered, and the advocate reports
several of those gaps about itself at startup. The open decisions that need a human are in
DECISIONS.md.

## Non-goals at reference stage

- Attribute attestation package: adopt-not-build, and the EUDI and mDL rails are still arriving. Design the slot, do not implement it.
- Real thresholds: calibration is an open question in the paper and stays open here.
- DNS deployment of the register and standing checks (paper section 4.1): the local-document formats are designed to be replaceable by it.
- Any hosted component, account system, or analytics.

## Working agreements

- Every module comments its paper section and step at the top.
- No em-dashes in any prose file in this repo.
- Commits are small and message-disciplined so the repo history is legible as a build narrative.
