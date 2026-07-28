# Open decisions

Things I could not settle without you. Each one has my recommendation, because a list of
questions with no view attached is just work handed back.

## 1. The repository could not be pushed from this session

Blocker, and the reason this arrived as a bundle rather than as commits.

The GitHub access in this session came through the desktop bridge, and the bridge went offline
partway through the build, presumably when the laptop slept. Everything is committed to a local
git repository with a legible history. Restore it with the instructions in HANDOFF.md and push,
or reconnect the desktop and I will push it.

Related: `git clone https://github.com/AIDP-protocol/inference-advocate` without credentials
fails, so the repository is private. If the paper is going to name it as the reference
implementation, it has to be public before the paper circulates. **Recommendation:** make it
public at the same time the paper goes out, not before.

## 2. The semantic evaluator for the August demo

The default evaluator is a rule evaluator: lexical patterns from the taxonomy file. It satisfies
all three properties the paper requires of a reference evaluator (reproducible verdicts,
inspectable basis, independent provenance) and has no judgment whatsoever. It cannot tell a
relational hook from innocent warmth, which is precisely the determination the semantic layer
exists to make.

Three options for the demo:

- **(a) Rule evaluator only.** Honest, reproducible, and visibly crude. A hostile reviewer says
  "this is a regex."
- **(b) A local model as the evaluator, rule evaluator as fallback.** `ModelEvaluator` is built
  and points at any OpenAI-compatible endpoint, so a local llama.cpp or Ollama server works
  today with a pinned model and fixed decoding. This is the paper's preferred tier, on-device
  execution, and it demonstrates the thing the paper actually claims.
- **(c) A hosted frontier model.** Fastest, and it breaks the independence property in the way
  the paper spends a section warning about.

**Recommendation: (b).** It needs a model choice and a laptop that can run it during the demo.
If neither is available on the day, (a) with the crudeness named out loud beats (c).

## 3. Whether to build escalation at all

Section 1.6 of the provisional discloses de-identified escalation for designated severe
categories. I did not build it. The `escalating` release-authority class exists in the type
system and nothing implements it, which is deliberate: your own notes flag whether to build it
as an open design-ethics question pending comparables research, and building it quietly would
have been the wrong way to answer that.

**Recommendation:** leave it unbuilt through the August demo and say so on the slide. An
architecture that ships a reporting channel before it has settled who receives the report is
exactly the thing the paper's Section 6 argues against.

## 4. Shipping an unsigned bill's provisions as active policy

`data/jurisdictions/us-ny.json` encodes two different things. The article 47 notice cadence is
law in force. The S 9051 prohibitions for users under eighteen are passed but unsigned, and the
Governor has until the end of 2026. I put them in a `minorOnly` block that becomes active
whenever the attestation package says the user is not an adult, and I documented the status in
the file's `citations` array.

That is defensible for a demo and slightly wrong as a matter of fact: an advocate applying an
unsigned bill is applying something that is not law.

Options: leave as is with the citation carrying the caveat; move the S 9051 block into a
separate `us-ny-pending.json` that has to be selected deliberately; or add a `status` field per
rule so the UI can label a provision "pending" where it appears.

**Recommendation:** the third. It costs one field and one line of UI, and "your advocate is
applying a law that has not been signed, and here is where it says so" is a better demo moment
than either alternative.

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

## 8. `node:sqlite` is experimental

Local persistence uses Node's built-in SQLite, which means zero runtime dependencies and no
native compilation for anyone cloning this. It is marked experimental in Node 22 and prints a
warning on every run, including in the demo output.

Alternatives: `better-sqlite3` (mature, needs prebuilt binaries or a compiler), or suppress the
warning with `--no-warnings`, which I did not do because suppressing a warning in a repository
about honest labeling seemed like the wrong instinct.

**Recommendation:** keep it and let the warning print. Node 22 is in long-term support and the
API surface used here is small enough to swap in an afternoon if it ever changes.

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
