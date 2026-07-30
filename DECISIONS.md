# Open decisions

Things I could not settle without you. Each one has my recommendation, because a list of
questions with no view attached is just work handed back.

Items 2, 4 and 8 are resolved and kept here with their resolutions rather than deleted, so the
reasoning stays visible. The live ones are 1 and 3: make the repository public, and decide
whether escalation gets built at all.

## 1. Repository visibility (LIVE)

The push problem is solved. `main` carries the full build, replayed as fifteen commits from your
machine, plus several pushed through the GitHub bridge from the session. What remains is the
question underneath it.

`git clone https://github.com/AIDP-protocol/inference-advocate` without credentials fails, so
the repository is private. If the paper or the essay is going to name it as the reference
implementation, a link to it is a 404 for every reader.

**Recommendation:** make it public at the same time the essay goes out, not before. The
repository's honesty is an asset for the audience you are writing for: a reference
implementation that lists what it does not have, and prints its own gaps at startup, reads as
the work of someone who is not selling anything. Do not sand any of that down before publishing.

One caveat worth acting on before it goes public. Several commits on `main` were pushed through
the bridge, which means the file contents were authored by hand rather than uploaded as bytes.
`npm test` and the CI workflow are the check on that. Run one or the other before you link the
repository anywhere.

## 2. The semantic evaluator for the August demo (RESOLVED, needs a run)

Resolved on 2026-07-28. The evaluator is now selected by configuration rather than compiled in.
Copy `data/evaluator.example.json` to `.advocate/evaluator.json`, point it at any
OpenAI-compatible endpoint, set `AIDP_EVALUATOR_CONFIG`, and the same demo and the same daemon
run against it with no code change. A local server is one line of config away when you want the
on-device tier the paper prefers.

Two guards ship with it. A hosted evaluator is named at startup and listed in the export view as
an outbound content path, because response content leaving the device is what that choice costs.
An evaluator served from the same origin as a provider under evaluation is reported as the
self-audit conflict of the provisional's Section 3.4.

What is left is not a decision, it is a run. Point it at a real endpoint and see what the flags
look like when a model is doing the reading. `npm run doctor` will tell you in one screen
whether the configuration took effect, which was the thing that was hard to tell on the first
attempt.

## 3. Whether to build escalation at all

Section 1.6 of the provisional discloses de-identified escalation for designated severe
categories. I did not build it. The `escalating` release-authority class exists in the type
system and nothing implements it, which is deliberate: your own notes flag whether to build it
as an open design-ethics question pending comparables research, and building it quietly would
have been the wrong way to answer that.

**Recommendation:** leave it unbuilt through the August demo and say so on the slide. An
architecture that ships a reporting channel before it has settled who receives the report is
exactly the thing the paper's Section 6 argues against.

## 4. Shipping an unsigned bill's provisions as active policy (RESOLVED)

Resolved on 2026-07-30. `data/jurisdictions/us-ny.json` still encodes both article 47 (in force)
and S 9051 (passed, unsigned). Each provision now carries a `status` of `in_force` or
`pending`. Only `in_force` rules change delivery thresholds, severity floors, mode floors,
mandatory non-delivery, provenance treatment, or pinned notices. Pending provisions are listed
in startup warnings, in `npm run doctor`, and in the policy view, with the explicit statement
that they are not applied as law.

That overrides the earlier recommendation to apply pending rules with a UI label. Warning plus
enacted-only enforcement is the honest reading of "not signed yet," and it keeps the demo from
quietly treating a bill as statute.

## 5. Demo-scale thresholds

Warn 4, block 8, window of 10 responses, severity 1 to 3. These come from the provisional's
worked example and they are labeled as demonstration scale in the policy JSON, the policy
markdown, the README, and the demo output. They are still arbitrary.

**Recommendation:** keep them and keep the labels. Calibration is an open question in the paper,
and inventing better-looking numbers for a demo would quietly close a question the paper says is
open. If you want a stronger answer for the demo, the honest version is a slide showing the same
conversation under three threshold settings.

## 6. Ledger anchoring

The hash chain detects local rewriting and there is a test for it. It does not detect deletion
of the whole store. The provisional pairs the chain with a periodic content-free commitment to
somewhere outside the user's unilateral control, and I did not build that, because every
concrete option (a transparency log, a timestamping service, a blockchain) drags in an
infrastructure dependency and a metadata-exposure argument that the reference stage does not
need to settle.

**Recommendation:** leave it as a named gap. The Standing floor is the complementary defense and
it is built, so the laundering-by-deletion story already has an answer in the demo.

## 7. Committed demo private keys

`data/demo-keys/` contains four Ed25519 private keys: a registrar, a standing body, and two mock
providers. They are committed on purpose so that anyone who clones the repository can verify the
signed register and standing documents rather than taking their signatures on faith. They
protect nothing and `npm run keys` regenerates them.

This is ordinary test-fixture practice, but this repository is specifically about key custody, so
somebody will screenshot it. The files carry a loud comment in `tools/mint-demo-keys.mjs` and a
note in the README.

**Recommendation:** keep them, and add a `data/demo-keys/README.md` saying it in the directory
itself so the screenshot includes the explanation. I did not add that file because it is your
call whether the tradeoff is worth the optics.

## 8. `node:sqlite` is experimental (RESOLVED)

Resolved by evidence rather than by argument, with a version-scoped caveat. On Node 24 (including
24.18 used for local runs) the built-in prints no `ExperimentalWarning`. On Node 22, which is
the CI floor, the warning still appears. Keep the built-in and the zero runtime dependencies.
CI runs the suite on 22 and 24, so a regression on the floor version shows up as a failed build
rather than as a surprise. Do not suppress the warning in code: the version difference is the
honest signal.

## 9. Small things I picked a default for

- **Package scope `@aidp/*`.** Not published to npm, workspace-internal only. Say if you want a
  different scope before anything is published.
- **No SPDX headers.** Files carry a paper-section comment at the top instead. Adding
  `SPDX-License-Identifier: Apache-2.0` to every source file is a one-command change if you want
  it for the Apache posture.
- **The daemon has no authentication.** It binds to 127.0.0.1 and has no remote surface. That is
  correct for the reference stage and would need revisiting if anyone ever ran it on a shared
  machine.
- **Desktop packaging (Tauri) not started.** PLAN.md defers it until the core demo works. The
  core demo works now, so it is unblocked whenever you want it.
