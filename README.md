# Inference Advocate

Reference implementation of the client side of the **Accountable Inference Delivery Protocol (AIDP)**, as described in the paper *Accountable Inference Delivery Protocol (AIDP): An Advocate for AI Users and a Surface for Policy Implementation* (Justin Philip Flores, 2026).

An inference advocate is an independent layer between AI model providers and the person using them, with its duties running to the person. This repository is the reference design: the protocol's client half, small enough to read, built so anyone can implement, inspect, or improve on it.

## The problem

AI is the only consumer technology of its reach where no layer in the pipeline answers to the user. The provider owns the model, the serving stack, the application, the logs, and the safety system that audits the logs. Mail acquired receiving infrastructure. The web acquired the browser. Medicine has the pharmacist. AI has the vendor's app, dressed as the user's.

Survey work behind this project found that every component a user-loyal layer needs already exists somewhere: an interchange wire format, cryptographic provenance, attribute attestation, content moderation, even the mediating-client pattern itself. No shipping product assembles them under a duty to the end user. No product is simultaneously user-loyal (paid by and answerable to the user), local-first (data on device or under user-held keys), and audit-carrying (independently monitoring what providers deliver). This repository is that assembly, in reference form.

## What the advocate does

The paper follows a single response through the architecture in fourteen steps. This client implements the client-side portion of that path:

- **Speaks the AIDP Interchange.** An open client-to-provider wire standard, bootstrapped here on the OpenAI-compatible de facto format. Any certified advocate can front any registered provider; interchangeable advocates are what keep this layer from becoming anyone's moat.
- **Holds everything locally.** Transcripts, the per-provider ledger, configuration, and keys live on the user's device in a single local store. Nothing aggregates anywhere. A breach's blast radius is one device. A subpoena's honest answer is that no operator possesses anything responsive.
- **Runs the monitor in two passes.** A deterministic pass verifies the Provenance Seal against the Serving Register: valid seal, authorized endpoint, decidable by arithmetic, no model involved. A semantic pass evaluates response content against a versioned, published flag taxonomy (persona claims, relational hooks, sycophancy, simulation obscured).
- **Keeps the ledger.** Flags append to a per-provider ledger held locally: one user's accumulated experience of one provider, for them.
- **Applies the Delivery Policy.** A score computed over the ledger, across a rolling window, weighted by severity, resolves each response into one of four outcomes: deliver, deliver with a notice, withhold pending release by an authorized superior user, or refuse. Thresholds are user-configurable except where the user's jurisdiction overrides. The jurisdiction ruleset is loaded by the advocate and applied at delivery: the provider serves inference, the advocate applies law.
- **Verifies provenance where it exists.** Responses that carry no seal are labeled unsealed. The label is not a workaround; the absence of the seal is part of the finding.
- **Emits rates, never content.** Incident Telemetry that would feed a standing body carries aggregate rates only. No transcript ever leaves the advocate. The export function exists so you can see exactly what would cross the wire and what never does.
- **Pins notices.** Delivery notices, including the standing notice that the party on the other end is a person simulation, are displayed by the advocate and cannot be removed by any provider. The notice belongs to the layer whose duty is to the user, which is what makes it credible.

## What this is not

Not a gateway for developers. Not a moderation product for schools or employers. Not a hosted service. Not funded by anything that reads the conversation. The funding rule this architecture exists to enforce is that whoever funds the agent owns its loyalty, so a reference advocate funded by advertising against conversation content would refute itself.

## Status

Pre-alpha. See PLAN.md for the build phases and the demo milestone. Thresholds in this repository are demo-scale and labeled as such; calibrating real ones is an open question, stated as such in the paper.

## Layout

See ARCHITECTURE.md (forthcoming) for the module-to-paper map. Every module states the paper section and step it implements at the top of the file.

## Licensing and patent posture

This repository is licensed under the **Apache License 2.0**, which includes an express patent grant. The AIDP protocol, architecture, and methods are dedicated to open use under **Creative Commons Attribution 4.0** in the paper. The author has filed a United States provisional patent application covering client-side implementation mechanisms, including the deferred-delivery gate, the local custody split, the independent monitor, and the statistical enforcement engine; the division between what is filed and what is open is deliberate, and is discussed in Section 8 of the paper. An open protocol is what keeps a certification regime from becoming a moat, and provisions of this kind have to exist before the position they govern is valuable enough to be worth capturing.
