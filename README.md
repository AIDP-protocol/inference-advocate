# Inference Advocate

Reference implementation of the client side of the **Accountable Inference Delivery Protocol (AIDP)**, as described in the paper [*Accountable Inference Delivery Protocol (AIDP): An Advocate for AI Users and a Surface for Policy Implementation*](https://doi.org/10.5281/zenodo.21610185) (Justin Philip Flores, 2026).

An inference advocate is an independent layer between AI model providers and the person using them, with its duties running to the person. This repository is the reference design: the protocol's client half, small enough to read, built so anyone can implement, inspect, or improve on it. It is the reference client named in [*We can pace the frontier today. Here's how.*](https://logosanalog.com/p/we-can-pace-the-frontier-today-heres), which argues for AIDP as a concrete answer to what pacing would require as instrumentation rather than a pause.

## The problem

AI is the only consumer technology of its reach where no layer in the pipeline answers to the user. The provider owns the model, the serving stack, the application, the logs, and the safety system that audits the logs. Mail acquired receiving infrastructure. The web acquired the browser. Medicine has the pharmacist. AI has the vendor's app, dressed as the user's.

Survey work behind this project found that every component a user-loyal layer needs already exists somewhere: an interchange wire format, cryptographic provenance, attribute attestation, content moderation, even the mediating-client pattern itself. No shipping product assembles them under a duty to the end user. No product is simultaneously user-loyal (paid by and answerable to the user), local-first (data on device or under user-held keys), and audit-carrying (independently monitoring what providers deliver). This repository is that assembly, in reference form.

## What the advocate does

The paper follows a single response through the architecture in fourteen steps. This client implements the client-side portion of that path:

- **Speaks the AIDP Interchange.** An open client-to-provider wire standard, bootstrapped here on the OpenAI-compatible de facto format. Any certified advocate can front any registered provider; interchangeable advocates are what keep this layer from becoming anyone's moat.
- **Holds everything locally.** Transcripts, the per-provider ledger, configuration, and keys live on the user's device in a single local store. Nothing aggregates anywhere. A breach's blast radius is one device. A subpoena's honest answer is that no operator possesses anything responsive.
- **Runs the monitor in two passes.** A deterministic pass verifies the Provenance Seal against the Serving Register: valid seal, authorized endpoint, decidable by arithmetic, no model involved. A semantic pass evaluates response content against a versioned, published flag taxonomy (the paper's formation flags, plus a reference harm set: profanity, self-harm, sexual content, child sexual exploitation, violence, hate, criminal assistance).
- **Keeps the ledger.** Flags append to a per-provider ledger held locally: one user's accumulated experience of one provider, for them.
- **Applies the Delivery Policy.** A score computed over the ledger, across a rolling window, weighted by severity, resolves each response into one of four outcomes: deliver, deliver with a notice, withhold pending release by an authorized superior user, or refuse. Thresholds are user-configurable except where the user's jurisdiction overrides. The jurisdiction ruleset is loaded by the advocate and applied at delivery: the provider serves inference, the advocate applies law.
- **Verifies provenance where it exists.** Responses that carry no seal are labeled unsealed. The label is not a workaround; the absence of the seal is part of the finding.
- **Emits rates, never content.** Incident Telemetry that would feed a standing body carries aggregate rates only. No transcript ever leaves the advocate. The export function exists so you can see exactly what would cross the wire and what never does.
- **Pins notices.** Delivery notices, including the standing notice that the party on the other end is a person simulation, are displayed by the advocate and cannot be removed by any provider. The notice belongs to the layer whose duty is to the user, which is what makes it credible.

## What this is not

Not a gateway for developers. Not a moderation product for schools or employers. Not a hosted service. Not funded by anything that reads the conversation. The funding rule this architecture exists to enforce is that whoever funds the agent owns its loyalty, so a reference advocate funded by advertising against conversation content would refute itself.

## Running it

Requires Node 22.5 or later. Core has no npm runtime dependencies: Provenance Seal sign and
verify are pure TypeScript (vendored Ed25519), ledger hashing is pure TypeScript SHA-256, and
store custody crypto in `crypto/keys.ts` (scrypt, HKDF, AES-GCM) is pure TypeScript (vendored
`@noble/hashes` and `@noble/ciphers`). Persistence is injected through `StoreBackend`
(`@aidp/store-sqlite` uses `node:sqlite`).

```bash
npm install
npm test          # build the core and run the test suite
npm run demo      # the scripted end-to-end scenario
```

The demo starts three mock providers on the loopback interface, runs a conversation through the
advocate, and prints the gate resolving at every turn: a provider in good standing delivering
cleanly, a provider under elevated scrutiny drifting across the warn line and then the block
line, a withheld response and who may release it, the ledger forgetting at exactly the rate the
policy states, a provider excluded at population level refused before a request is sent, an
unsealed response under a jurisdiction that requires provenance to be noticed, and finally the
telemetry export showing the exact bytes that would leave beside an inventory of what does not.

To use the interface:

```bash
mkdir -p .advocate && cp data/providers.demo.json .advocate/providers.json
npm run mocks     # terminal one, the demo providers
npm run daemon    # terminal two, the local advocate on 127.0.0.1:8790
npm run build:ui  # then open http://127.0.0.1:8790
```

`npm run ui` runs the Vite dev server instead, on port 5173, proxying to the daemon. To point
the advocate at real providers, copy `data/providers.example.json` to `.advocate/providers.json`
and edit it. API keys are read from named environment variables so that a provider file can be
shared without carrying a secret.

Desktop shell (optional; needs Rust and Tauri 2 system libraries, see
`packages/desktop/README.md`):

```bash
npm run mocks     # if using demo providers
npm run desktop   # Tauri window; HostSession in the Node launcher over loopback RPC (no HTTP for the core API)
```

## The semantic evaluator

The monitor's second pass is the one that requires reading meaning. By default this repository
runs a **rule evaluator**: lexical criteria from `data/taxonomy/flags.v0.json`. It satisfies all
three properties the paper requires of a reference evaluator, reproducible verdicts, inspectable
basis, and provenance independent of any audited provider, and it has no judgment whatsoever. It
cannot tell a relational hook from innocent warmth, which is the determination the semantic
layer exists to make. That is stated here rather than discovered later.

To run a real evaluator, point the advocate at any OpenAI-compatible endpoint:

```bash
cp data/evaluator.example.json .advocate/evaluator.json   # then edit it
export AIDP_EVALUATOR_API_KEY=...                          # only if the endpoint needs a key
export AIDP_EVALUATOR_CONFIG=.advocate/evaluator.json
npm run demo                                               # or npm run daemon
```

In PowerShell:

```powershell
Copy-Item data\evaluator.example.json .advocate\evaluator.json
$env:AIDP_EVALUATOR_API_KEY = "..."
$env:AIDP_EVALUATOR_CONFIG = ".advocate\evaluator.json"
npm run demo
```

A local server is the preferred deployment: set `baseUrl` to `http://127.0.0.1:11434/v1` for
Ollama and drop `apiKeyEnv`. Decoding is pinned to temperature 0 and a fixed seed, because
reproducible verdicts are a required property rather than a nicety.

Two costs of a hosted evaluator, both surfaced by the advocate rather than buried:

- Response content leaves the device to be evaluated. The endpoint is listed in the export view
  as an outbound content path, and the advocate warns about it at startup. An evaluator on the
  loopback interface is not listed, because nothing left.
- An evaluator served by the same party as a provider it evaluates is the self-audit conflict of
  the provisional's Section 3.4. The advocate detects the obvious case by comparing origins and
  says so loudly. It cannot detect the non-obvious cases and does not pretend to.

## Layout

```
packages/core          the advocate itself. Provider agnostic, no UI dependencies.
packages/store-sqlite  SQLite StoreBackend adapter (Node). The only shipped persistence implementation.
packages/daemon        local HTTP server on 127.0.0.1 for the browser tab, and HostSession (also loopback RPC for desktop).
packages/ui            React chat surface. Client shell is ordinary chat; monitor, export,
                       scenario, gaps, and attributes live in a bottom instrument drawer.
packages/desktop       Tauri shell (HostSession in the Node launcher over loopback RPC; no HTTP listener for the core API).
packages/demo          mock providers and the scripted scenario.
data/                  taxonomy, Delivery Policy, jurisdiction rulesets, register, standing.
```

See **ARCHITECTURE.md** for the module-to-paper map, the design decisions worth arguing with,
and an honest list of what this build does not have. Every module states the paper section and
step it implements at the top of the file.

The Delivery Policy is published in plain language at `data/policy/delivery-policy.md` and in
machine-readable form beside it. The flag taxonomy is `data/taxonomy/flags.v0.json`. Both are
data rather than code on purpose: whose values define a flag is an open question the paper puts
in Section 9, and that argument cannot be held over a compiled constant.

## Status

Pre-alpha. The fourteen-step client path and the scripted demo run end to end. Thresholds in
this repository are demo-scale and labeled as such; calibrating real ones is an open question,
stated as such in the paper. ARCHITECTURE.md lists what is not built, including attribute
attestation, hardware-backed keys, external ledger anchoring, monitor integrity attestation,
the telemetry admission gate, and DNS deployment. The advocate reports several of those gaps
about itself at startup, which is the intended posture: a reference implementation that
overstates itself is worse than none.

## Licensing and patent posture

This repository is licensed under the **Apache License 2.0**, which includes an express patent grant. The AIDP protocol, architecture, and methods are dedicated to open use under **Creative Commons Attribution 4.0** in the [paper](https://doi.org/10.5281/zenodo.21610185). The author has filed a United States provisional patent application covering client-side implementation mechanisms, including the deferred-delivery gate, the local custody split, the independent monitor, and the statistical enforcement engine. The filing is defensive: royalty-free for anyone who builds to the standard. The division between what is filed and what is open is deliberate, and is discussed in Section 8 of the paper (and disclosed in the [essay](https://logosanalog.com/p/we-can-pace-the-frontier-today-heres) above). An open protocol is what keeps a certification regime from becoming a moat, and provisions of this kind have to exist before the position they govern is valuable enough to be worth capturing.

The keys under `data/demo-keys/` are demonstration fixtures, committed on purpose so that the
signed register and standing documents can actually be verified by anyone who clones this. They
protect nothing. Regenerate them with `npm run keys`.
