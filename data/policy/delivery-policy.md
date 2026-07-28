# Delivery Policy

Version 0.1.0. Demonstration scale.

This is the policy your advocate applies to every response before you see it. It is published
here in plain language and in `delivery-policy.json` in machine-readable form. The two are meant
to be read together. If they disagree, that is a defect and should be filed as one.

## What the advocate does with a response

Nothing reaches your screen until the response has been evaluated. That costs latency, and the
latency is the point: a response that has already been rendered cannot be withheld.

Two passes run on every response.

The **deterministic pass** checks facts that arithmetic can settle. Is the Provenance Seal
valid? Was the endpoint that served this response authorized to serve that model? A response
that fails this pass is refused, and no further evaluation runs on it. A response that carries
no seal at all is labeled unsealed and continues, because at the time of writing no frontier
lab signs text and an advocate that refused every unsealed response would refuse everything.
The one exception: if a provider has published in the Serving Register that it seals all of its
responses, then a response arriving without a seal is a downgrade and is refused.

The **semantic pass** evaluates the response against the published flag taxonomy, currently
version v0.1.0, covering persona claims, relational hooks, sycophancy, and simulation obscured.
The taxonomy lives at `data/taxonomy/flags.v0.json`. You can read every criterion in it.

## How the score works

The advocate does not judge a response on its own. It judges the provider's recent conduct, and
treats the response in front of you as the increment that may cross a line.

- The window is the trailing **10 evaluated responses** from that provider, carried across
  sessions rather than reset by starting a new one.
- The score is the sum of the severity weights of every flag in the window, plus the flags on
  the response being resolved.
- Severity runs 1 to 3 and is set by the taxonomy. Sycophancy weighs 1. Persona claims weigh 2.
  Relational hooks and simulation obscured weigh 3.
- The **warn line is 4**. The **block line is 8**.

If the provider is under elevated scrutiny at population level, the window starts at **2**
rather than at zero, which lowers the local bar without changing the published thresholds. If
the provider has been excluded at population level, your advocate declines to relay to it at
all, before a request is sent.

## The four outcomes

1. **Deliver.** Score below the warn line. The response appears, and the apparatus stays out of
   the way. This is the normal case and should stay the normal case.
2. **Deliver with a notice.** Score at or above the warn line and below the block line. The
   response appears with a pinned notice naming the score and the lines it sits between.
3. **Withhold.** Score at or above the block line. The response is retained locally as
   received-and-logged, and is not rendered. It can be released by the authority competent to
   release it, and that release is recorded.
4. **Refuse.** The deterministic pass refused, or the provider is excluded at population level,
   or a category your jurisdiction designates as mandatory non-delivery was flagged. There is no
   local override for the third case, in any operating mode.

## Who can release a withheld response

Release authority is keyed to what caused the block, not to who asks.

| Authority | Who can release | Applies to |
| --- | --- | --- |
| Self release | You, on a verified adult attribute attestation | Accumulation blocks from formation-relevant flags |
| Custodial release | The supervising party, in a custodial configuration | Blocks raised in a supervised configuration |
| Non releasable | Nobody, at the advocate | Categories designated by law or policy as non-deliverable |
| Escalating | Handled outside the advocate | Designated severe categories |

## Carryover

Starting a new session severs the immediate interaction chain and restores delivery after an
accumulation block. It does not wipe the record. For the next **5 clean responses** from that
provider, the warn line drops by 1 and the block line by 2. The new session begins on edge
rather than amnesiac, and then the sensitivity decays.

## Operating mode

This advocate ships in **enforce** mode: the full gate behavior above.

Two lower modes exist. **Observe** evaluates, ledgers, and reports while taking no gate action.
**Annotate** limits action to notices. Both are for calibration, and both are bounded by floors:
your jurisdiction can require a higher mode, a supervised minor's configuration cannot ship
below enforce, and categories designated for mandatory non-delivery are refused in every mode.
Observe relaxes the accumulation gate. It never relaxes an absolute floor.

## Your jurisdiction

Your advocate loads one jurisdiction ruleset at setup and applies it at delivery. A ruleset can
tighten the thresholds, raise the severity of a category, require a notice, designate a category
for mandatory non-delivery, and set a floor on the operating mode. It can only tighten. Nothing
in a ruleset loosens what you have configured for yourself.

The rulesets shipped in this repository are illustrative encodings written by an engineer. They
are not legal advice and they are not a compliance product. They exist to prove the slot is real.

## What leaves your device

Rates. Never content.

On a schedule decoupled from your conversations, the advocate can emit a batch containing, per
provider: how many responses were evaluated, how many carried each flag type, the severity
weighted total, and the evaluator and taxonomy versions that produced them. No conversation
content. No evidence spans. No attributes about you. Any cell covering fewer than **20**
evaluated responses is suppressed rather than reported.

The component that builds that batch holds the ledger key and does not hold the transcript key,
so it cannot read the conversation even if it were asked to send it. Run the export view to see
the exact bytes that would cross the wire beside an inventory of what stays.

At present nothing receives these batches. No standing body exists yet. The format is defined so
that one could.

## What this policy does not do

It does not moderate you. Every mechanism here is pointed at what a provider sends, not at what
you write. The regulated conduct is the provider's output.

It does not claim its numbers are right. Every threshold on this page is demonstration scale.
Calibration against real traffic is an open question in the paper and it stays open here.
