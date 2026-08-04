# Architecture

This document keeps the code and the paper in register with each other. Every module in the
repository states the paper section and step it implements at the top of its file; this is the
index of those statements, plus an honest list of what the reference implementation does not
do.

The paper is *Accountable Inference Delivery Protocol (AIDP): An Advocate for AI Users and a
Surface for Policy Implementation* (Justin Philip Flores, 2026). The on-the-wire name is now
AIRP; the paper title is unchanged. Section 4 follows a single response through fourteen
steps. That path is the spine of this repository. The public demo is at `https://tryairp.com`.

## Shape of the repository

```
packages/core          provider-agnostic library, no UI dependencies, no network beyond providers
packages/store-sqlite  SQLite StoreBackend adapter (Node). The only shipped persistence implementation
packages/daemon        local HTTP server on 127.0.0.1, and HostSession (HTTP + desktop loopback RPC)
packages/ui            React chat surface. Product chrome is ordinary chat; the monitor
                       (including a demo-only reputation reset), export view, scenario
                       register, gaps, and attributes sit in a bottom instrument drawer
                       (demonstration only).
packages/desktop       Tauri shell (HostSession in the Node launcher over loopback RPC, no HTTP for the core API)
packages/demo          mock providers and the scripted end-to-end scenario
data/                  taxonomy, policy, jurisdictions, register, standing: documents, not code
tools/                 demo key minting and additive public-entry re-sign
deploy/                idempotent Apache/TLS/PM2 setup for the public AIRP domains
```

Three deliberate boundaries.

The core has no UI dependency and no framework. It is a library that could be driven by a CLI,
a desktop shell, or a phone. Persistence is a capability the host injects through
`StoreBackend` (`packages/core/src/store/port.ts`). The SQLite adapter lives in
`packages/store-sqlite` and is the only shipped implementation. The daemon exists because
filesystem paths and a browser tab do not meet; it constructs the SQLite adapter and calls
into core. Desktop packaging constructs the same `HostSession` (`packages/daemon/src/host.ts`)
in-process in the Node launcher and reaches it from Tauri over loopback RPC
(`packages/daemon/src/host-rpc.ts`), with Tauri commands as the UI bridge. There is no Node
stdio IPC child. The browser-tab path still uses the loopback HTTP listener. HostSession is
still not inside the Rust binary; embedding it there needs an in-process JS runtime or a Rust
port of the host and store. `AIDP_DESKTOP=1` makes the advocate say so at startup.

The trust artifacts are data files with detached signatures and pinned public keys, not
hardcoded constants. The Serving Register, the Standing document, the flag taxonomy, the
Delivery Policy and the jurisdiction rulesets are all loaded, all versioned, and all
replaceable. That is what makes the swap from local file to signed HTTPS fetch a transport
change rather than a redesign.

The key scopes are real. A component is handed the store keys its function requires and no
others, which is checked at construction. The telemetry emitter is the case that matters, and
it is discussed below.

## The fourteen steps, and where each one lives

| Step | Paper | Module |
| --- | --- | --- |
| before | attestation package assembled at setup, Section 4 and Section 6 | `core/src/setup.ts`, `AttestationPackage` in `core/src/types.ts` |
| 1 | the prompt | `ui/src/App.tsx`, `core/src/advocate.ts` (`ask`), desktop: `packages/desktop` |
| 2 | attach the attestations, jurisdiction already loaded | `core/src/interchange/openai-adapter.ts`, `core/src/policy/jurisdiction.ts` |
| 3 | the request goes out over the Interchange | `core/src/interchange/wire.ts`, `openai-adapter.ts` |
| 4 | the provider serves from a registered endpoint | `demo/src/mock-provider.ts` (the provider half, for the demo) |
| 5 | the provider seals | `core/src/crypto/seal.ts` (`signSeal`) |
| 6 | the sealed response returns | `core/src/interchange/openai-adapter.ts` |
| 7 | deterministic layer | `core/src/monitor/deterministic.ts`, `core/src/monitor/register.ts`, `core/src/crypto/seal.ts` |
| 8 | semantic layer | `core/src/monitor/semantic.ts`, `core/src/monitor/taxonomy.ts`, `core/src/monitor/evaluators/` |
| 9 | the ledger | `core/src/store/ledger.ts`, `core/src/store/port.ts`, adapter: `store-sqlite` |
| 10 | the score | `core/src/policy/score.ts`, `core/src/policy/config.ts` |
| 11 | the resolution | `core/src/policy/delivery.ts`, `core/src/policy/jurisdiction.ts` |
| 12 | delivery, with pinned notices | `core/src/policy/notices.ts`, `ui/src/App.tsx`, host: `daemon/src/host.ts` |
| 13, 14 | telemetry as rates, standing consumed back into step 10 | `core/src/telemetry/rates.ts`, `emitter.ts`, `standing.ts`, `export.ts` |

The provisional patent application's four mechanisms map on top of the same files:

| Mechanism | Provisional | Module |
| --- | --- | --- |
| 1. Deferred-delivery gate with rolling-window accumulation | Sections 1.1 to 1.9 | `core/src/policy/score.ts`, `delivery.ts`, `core/src/store/ledger.ts` |
| 2. Local-custody split with portable corpus | Sections 2.1 to 2.8 | `core/src/crypto/keys.ts`, `core/src/store/`, `store-sqlite` |
| 3. Independent monitor with integrity attestation | Sections 3.1 to 3.8 | `core/src/monitor/` |
| 4. Statistical enforcement engine | Sections 4.1 to 4.8 | `core/src/telemetry/` |

## Decisions worth stating

**The Interchange bootstraps on the OpenAI-compatible wire format.** A wire standard nobody
serves is not an existence proof. The advocate speaks the format every provider already speaks
and carries the AIRP additions in headers an unmodified server ignores: `AIRP-Exchange-Id` and
`X-AIDP-Attestations` outbound, `AIRP-Seal` inbound (with `AIDP-Seal` / `X-AIDP-Seal` still
accepted on read). A provider that has never heard of AIRP still answers, and its
responses arrive unsealed, which is a finding rather than an error. That is the migration path.

**Deferral is fully blocking.** Nothing streams to the user before evaluation completes. The
provisional discloses pipelined evaluation against a stream as an alternative embodiment. A
reference implementation should demonstrate the primary claim, not the optimization, and a
response that has already been rendered cannot be withheld. The public mock providers can
emit `text/event-stream` with a terminal-seal event when asked (`stream: true`), and
`deploy/verify-public-stream.mjs` proves that path through Apache. The advocate adapter
still requests non-streamed completions and evaluates only after the full response is in
hand.

**Evidence spans live in the transcript store, not the ledger.** This falls out of the paper
rather than being invented for the code. Section 5 says telemetry carries no evidence spans,
and the reason the emitter cannot transmit content is that it holds the ledger key and not the
transcript key. So an evidence span, which is conversation content, has to be under the
transcript key. The ledger row carries a type, a severity, and an opaque reference. There is a
test that reads the raw SQLite rows and asserts the words are not in them.

**The default semantic evaluator is a rule evaluator, not a model.** The paper's preferred
evaluator is a commons-maintained reference evaluation model, defined by three properties:
reproducible verdicts, inspectable basis, and provenance independent of any audited provider.
No such model exists. The shipped rule evaluator satisfies all three properties completely and
has no judgment at all, which is the opposite failure from the one a hosted frontier model
would have. A demo that quietly used a frontier model to police frontier models would be
arguing against its own paper.

The evaluator is chosen by configuration rather than by code: an evaluator config file, or the
`AIDP_EVALUATOR_CONFIG` environment variable, selects between the rule evaluator and any
OpenAI-compatible endpoint. `packages/core/src/monitor/evaluator-config.ts` is where the two
costs of that choice are made visible rather than buried. A hosted evaluator receives response
content, so its origin appears in the export view as an outbound content path and the advocate
names it at startup; an evaluator on the loopback interface does not, because nothing left. And
an evaluator served from the same origin as a provider under evaluation is reported as the
self-audit conflict of the provisional's Section 3.4. The origin check catches the obvious case
and cannot catch the subtle ones, which the code says in its own comments.

**`npm run doctor` prints the configuration that actually resolved.** It exists because of a
real failure: someone set an evaluator config, ran the demo, and could not tell from the output
whether it had taken effect. Configuration that silently does nothing is worse than
configuration that fails loudly, so there is now one command that answers what this advocate is
going to do with the files and environment variables it can see. It names the storage adapter
that resolved. It sends no requests to anyone.

## Persistence port

`StoreBackend` in `packages/core/src/store/port.ts` is the seam between decisions and storage.
Core keeps the ledger's canonical serialization and hash chaining, sequence assignment,
`verifyChain`, key-scope guards, evidence-under-transcript, and carryover and block semantics.
The host supplies opening, closing, migrating, and row-level reads and writes.
`@aidp/store-sqlite` is the shipped adapter: schema, WAL, pragmas, and path handling.
`runStoreConformance` in core is the behavioral suite a second adapter must pass.

Ledger hashing uses a small pure-TypeScript SHA-256 in core so `hashEntry` stays synchronous
and free of `node:crypto`. Ed25519 seal sign/verify uses the same tradeoff: vendored
`@noble/ed25519` plus a pure-TypeScript SHA-512 in core, so `signSeal` / `verifySeal` stay
synchronous and portable. Store custody crypto in `crypto/keys.ts` (scrypt, HKDF-SHA256,
AES-256-GCM) uses vendored `@noble/hashes` and `@noble/ciphers` subsets for the same reason:
`MasterSecret` / `StoreKey` stay synchronous and free of `node:crypto`. Random seeds, master
secrets, salts, and IVs use `globalThis.crypto.getRandomValues` (Web Crypto), not
`node:crypto`. Web Crypto has no scrypt, so a SubtleCrypto-only path would still need a
pure-TS KDF and would force async seal/open.

**Carryover lowers thresholds rather than multiplying severities.** The provisional discloses
both. A number the user can watch move is easier to argue with than a multiplier buried in a
sum.

**The register's pinned key is not the key inside the register.** The registrar public key
ships as a separate pinned file. Verifying a document with a key the document supplies is not
verification.

## What this build does not have

These are gaps, not omissions of convenience, and the advocate reports several of them about
itself at startup. Listing them here is the point of the section.

**Attribute attestation.** The attestation package is a locally asserted object. There is no
issuer, no selective disclosure, and no wallet. The paper's position is adopt-not-build, and
the EUDI and mDL rails are still arriving. Design the slot, do not implement it. The slot is
`AttestationPackage`, it crosses the wire, and it holds attributes rather than an identity,
which is the property that has to survive when a real issuer is wired in. The reference UI
exposes a Child mode toggle that flips `isAdult` and persists it under the preference store.
That is a demonstration of the attribute path, not verification. The banner says so. Pending
`minorOnly` jurisdiction provisions still do not tighten thresholds when Child mode is on;
what does change immediately is that self-release of a withheld response is refused.

**Demo reputation reset.** After a block, carryover and the rolling window normally decay only
through clean responses. The instrument drawer's Monitor tab exposes a reference-only control
that clears a provider's ledger accumulation and carryover so a demo can continue without five
paid clean exchanges. It does not release withheld content and it is not a product path. The
paper's recovery mechanism remains decay (Provisional Section 1.8).

**Hardware-backed keys, recovery, and the wallet.** `MasterSecret.fromPassphrase` is real
scrypt and the per-store derivation is real HKDF, but the demo and the daemon use a development
keyfile that sits on the same disk as the store. That is not custody, it is a note taped to the
safe, and the advocate says so at startup. Secure-element storage, the recovery spectrum
(recovery code, social shares, custodial and organizational escrow), and the non-exportable
attestation wallet keys are all disclosed in the provisional and none are built.

**External anchoring of the ledger chain.** The hash chain detects local rewriting, and there
is a test for that. It does not detect deletion of the whole store, which is why the provisional
pairs it with a periodic content-free commitment to a location outside the user's unilateral
control. Not built. The Standing floor is the complementary defense and is built.

**Multi-device sync, portability export, and custodial configuration.** Mechanism 2 describes a
versioned interchange format over the corpus, end-to-end encrypted sync, and custodial and
organizational configurations with key-scoped authority. The release-authority classes exist and
are enforced; the configurations that would grant a supervising party its key scope do not. The
`release(..., 'custodian')` path is therefore a demonstration of the authority mapping, not of a
real custodial grant.

**Monitor integrity attestation and the population cross-check.** Reproducible signed builds,
runtime attestation, verdict signatures chaining to an attested build, and the statistical
cross-check of each monitor against the population of monitors observing the same provider are
Mechanism 3 and are not built. Verdicts do carry binding version attribution, which is the piece
the rest hangs from.

**The admission gate for telemetry.** Certification, hardware-attested instance uniqueness,
issuance rate limiting, coordination detection, and contribution caps are the four layers that
make a rate mechanism resistant to farming. None are built. The instance credential is a UUID.
The batch format is defined, and the granularity floor and the traffic-class denominator are
implemented, because those two are properties of computing the rate honestly rather than of
defending it.

**DNS deployment.** draft-flores-airp-provenance §4.7 puts entry selection on `_airp` TXT
records beneath the provider identity domain, with a key set digest (`k`) confirming the
selected entry. The reference client parses those records, refuses unsafe `r` auto-fetch
targets, and computes the key set digest. Public demo DNS and Apache publish
`honestmodel.win` / `cheapai.win` bindings and serve the register at the `r=` URL
(`deploy/`), including a detached `.sig` alongside the document. The client still loads a
local signed register file rather than fetching `r` over HTTPS with `maxAge` caching, and
DNS `k` is not published yet. Entries without `identityDomain` (the `demo.*` fixtures behind
`tryairp.com`) stay unconfirmed by DNS.

**Real thresholds.** Every number in `data/policy/delivery-policy.json` is demonstration scale
and labeled as such in three places. Calibration is an open question in the paper and it stays
open here.

**Taxonomy v0.3.0 keeps the paper's four named flags and adds a reference harm set.** Persona
claims, relational hooks, sycophancy, and simulation obscured remain. The reference additions are
profanity, self-harm (encouragement and methods, not crisis referral), sexual content, child
sexual exploitation, graphic violence, hate, and criminal assistance. Lists are English-centric
and short on purpose. This is not a moderation product. Child sexual exploitation is mandatory
non-delivery and non-releasable under the illustrative New York ruleset. Self-harm encouragement
is non-releasable there as well. Pending `minorOnly` provisions raise floors further for minors
when enacted.

**The jurisdiction rulesets are illustrative.** They were written by an engineer to prove the
slot changes an outcome. They are not legal advice and no lawyer has reviewed them. Each file
carries that disclaimer in its own `disclaimer` field, and the UI renders it above the policy.
Provisions may be marked `in_force` or `pending`. Only `in_force` rules change delivery.
Pending provisions (for example New York's unsigned S 9051 minor-protection block) appear in
startup warnings, doctor output, and the policy view, and do not tighten thresholds or refuse
responses. That is deliberate: listing a bill is not the same as applying it as law.

**Escalation.** Section 1.6 of the provisional discloses de-identified escalation for
designated severe categories. The `escalating` release-authority class exists in the type
system and nothing implements it. Whether to build it at all is an open design-ethics question
in the author's own notes, and building it quietly would have been the wrong way to answer it.

**Desktop HostSession still lives under Node.** The Tauri shell loads the built UI from disk
and calls `HostSession` through Tauri commands over loopback RPC into a HostSession the Node
launcher constructed in-process (`packages/daemon/src/host-rpc.ts`). There is no HTTP listener
for advocate operations in the desktop path, and no Node stdio IPC child. The browser-tab path
still uses the loopback daemon. HostSession is not embedded inside the Tauri binary;
`AIDP_DESKTOP=1` reports that gap at startup. Bundled installers (`bundle.active`) are off.
App icons under `packages/desktop/src-tauri/icons/` and the web favicon set under
`packages/ui/public/` use the Inference Advocate mark. Building the shell needs Rust and
Tauri 2 system libraries (webkit2gtk 4.1 on Linux). See `packages/desktop/README.md`.

## Working agreements

- Every module comments its paper section and step at the top.
- No em-dashes in any prose file in this repository.
- Commits are small and message-disciplined, so the history reads as a build narrative.
- Data before code: taxonomies, policies, and rulesets are versioned documents, not constants.
- Every claim the code makes about itself should have a test that would fail if it stopped
  being true. The ones that matter most are in `packages/core/test/telemetry.test.ts` and
  `packages/core/test/store.test.ts`.
- CI runs the typecheck, the test suite, the demo end to end, and the interface build on Node
  22 and 24. The demo is in CI on purpose: the repository's central claim is that one scripted
  scenario executes the paper's argument, and a claim like that should break the build when it
  stops being true.
