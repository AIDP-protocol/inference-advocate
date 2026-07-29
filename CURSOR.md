# Starting a Cursor session on this repository

Paste everything below the line as the first message in a new Cursor chat, with this repository
open. It is written to be pasted as is.

---

This repository is the reference implementation of the client side of the Accountable Inference
Delivery Protocol (AIDP), from a paper I wrote. Before doing anything, read these four, in order:

1. `HANDOFF.md` for where it stands and how to run it
2. `ARCHITECTURE.md`, especially the section "What this build does not have"
3. `.cursor/rules/inference-advocate.mdc` for the working agreements, which are binding
4. `packages/core/src/advocate.ts`, which is one response through the paper's fourteen steps

Then verify it runs before changing anything:

```
npm install
npm test        # expect 59 passing
npm run doctor  # prints the configuration that actually resolved
npm run demo    # the scripted end-to-end scenario, about 40 seconds
```

Report back with three things: whether CI is green on the latest commit, what the demo printed,
and anything in that output that does not match what `ARCHITECTURE.md` claims. Do not start
making changes until we have agreed on the first task.

Context you should have. This is not a product and not a startup. It is an existence proof: the
survey behind the paper found that no shipping product is simultaneously user-loyal, local-first
and audit-carrying, and this repository assembles that, small enough to read. Legibility beats
cleverness everywhere. The code is meant to stay in register with the paper, which is why every
module states its paper section and step at the top of the file.

Three things about this codebase that look like quirks and are load-bearing:

- Taxonomies, delivery policy and jurisdiction rulesets are versioned documents under `data/`,
  not constants in TypeScript. Whose values define a flag is a contested question the paper puts
  in Section 9, and that argument cannot be held over a compiled constant.
- The telemetry emitter is constructed with a ledger-scoped key and nothing else. That is what
  makes "it cannot transmit conversation content" structurally true rather than a promise.
  Evidence spans are conversation content, so they live under the transcript key and the ledger
  holds only an opaque reference. There are tests that read raw SQLite rows and assert the words
  are not there.
- The advocate reports its own gaps at startup and the interface renders them. Anything partial
  gets said out loud, in the code, in `ARCHITECTURE.md` and in the runtime warnings. A reference
  implementation that overstates itself is worse than none.

One caveat about the history. Several commits on `main` were pushed through a bridge that
authored file contents by hand rather than uploading bytes, so the first green CI run is the
check on them. If CI is red, fixing it is the first task and everything else waits.

Otherwise, `HANDOFF.md` has a list under "Known good next steps" and `DECISIONS.md` has three
live decisions. We will pick from those together.
