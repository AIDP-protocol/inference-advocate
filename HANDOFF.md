# Handoff

Where this stands, and how to pick it up in an editor.

## State

All five phases of PLAN.md and the demo milestone are implemented. 59 tests passing, clean
typecheck, the demo runs end to end, the interface builds and runs. Verified on Linux and on
Windows with Node 24.

```bash
git clone https://github.com/AIDP-protocol/inference-advocate
cd inference-advocate
npm install
npm test          # 59 passing
npm run doctor    # what this advocate resolved: paths, config, providers, what would leave
npm run demo      # the scripted scenario, about 40 seconds
```

To use the interface, in three terminals:

```bash
mkdir -p .advocate && cp data/providers.demo.json .advocate/providers.json
npm run mocks     # the demo providers on 8811, 8812, 8813
npm run daemon    # the advocate on 127.0.0.1:8790
npm run build:ui  # then open http://127.0.0.1:8790
```

## Read in this order

1. **ARCHITECTURE.md.** The module-to-paper map, the design decisions worth arguing with, and
   the section titled "What this build does not have". That last list is deliberate and as
   complete as I know it to be.
2. **DECISIONS.md.** Open decisions with a recommendation attached to each. Three are live:
   repository visibility, whether to build escalation at all, and how to label a law that has
   not been signed.
3. **`packages/core/src/advocate.ts`.** One response through the paper's fourteen steps, top to
   bottom. If that file stops matching the numbered list in its header, one of the two is wrong.
4. The demo output. It is the fastest way to see whether the thing does what the paper says.

## Working in an editor

`.cursor/rules/inference-advocate.mdc` carries the working agreements so an assistant follows
them without being told each time: paper-section headers on every module, no em-dashes, data
before code, honesty about gaps, and the structural boundaries that hold the privacy claims up.
If your editor reads a root `.cursorrules` file instead, copy that file's body there.

## Continuous integration

`.github/workflows/ci.yml` runs the typecheck, the test suite, the demo end to end, and the
interface build on Node 22 and 24, on every push and pull request.

The demo is in CI on purpose rather than only the unit tests. This repository's central claim is
that one scripted scenario executes the paper's argument, and a claim like that should break the
build when it stops being true.

Several commits on `main` were pushed through a bridge that authored file contents by hand
rather than uploading bytes. The first green CI run is the check on that. Look at it before
linking this repository anywhere.

## Known good next steps

- **Run the semantic evaluator against a real endpoint.** Everything is wired: copy
  `data/evaluator.example.json` to `.advocate/evaluator.json`, set `AIDP_EVALUATOR_CONFIG`, and
  `npm run doctor` confirms it resolved. What is missing is a run, and what it produces is the
  first real data on whether the demo-scale thresholds mean anything.
- **Desktop packaging.** PLAN.md defers Tauri until the core demo works. It works.
