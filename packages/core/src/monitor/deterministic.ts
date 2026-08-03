// The deterministic pass. Decidable by arithmetic, so no model participates.
//
// Paper: step 7. Provisional: Section 3.2 (mandatory determinism where decidable).
// Honest labeling is the design rule here. No frontier lab currently signs text, so almost
// every real response reaching this code will be unsealed. Unsealed is reported as unsealed
// and the exchange continues, unless the provider's register entry declares that it seals
// everything, in which case a missing seal is a downgrade and the response is refused.

import type { DeterministicFinding, DeterministicVerdict, ProviderConfig, ProviderResponse } from '../types.js';
import { verifySeal } from '../crypto/seal.js';
import type { ServingRegister } from './register.js';

/**
 * Tolerance for a seal dated after the response arrived. Signing precedes receipt, so any
 * forward offset is clock skew between the provider and the advocate.
 */
export const MAX_SEAL_FUTURE_SKEW_MS = 300_000;

/**
 * How stale a seal may be relative to the response that carried it. Without this bound a
 * captured seal replays against its content forever.
 */
export const MAX_SEAL_AGE_MS = 3_600_000;

/**
 * Freshness is measured against the response's own receipt time rather than wall clock, so
 * that verifying a stored exchange from the ledger produces the same verdict it produced on
 * the delivery path.
 */
function sealFreshness(signedAt: string, receivedAt: string): DeterministicFinding | undefined {
  const signed = Date.parse(signedAt);
  const received = Date.parse(receivedAt);
  if (Number.isNaN(signed)) {
    return {
      code: 'seal_malformed',
      detail: `seal signed-at ${signedAt} is not a parseable timestamp`,
      refuses: true,
    };
  }
  if (Number.isNaN(received)) return undefined;

  const offset = signed - received;
  if (offset > MAX_SEAL_FUTURE_SKEW_MS) {
    return {
      code: 'seal_not_fresh',
      detail: `seal is dated ${Math.round(offset / 1000)}s after the response was received`,
      refuses: true,
    };
  }
  if (-offset > MAX_SEAL_AGE_MS) {
    return {
      code: 'seal_not_fresh',
      detail: `seal is ${Math.round(-offset / 1000)}s older than the response that carried it`,
      refuses: true,
    };
  }
  return undefined;
}

export function runDeterministicPass(
  provider: ProviderConfig,
  response: ProviderResponse,
  register: ServingRegister,
): DeterministicVerdict {
  const findings: DeterministicFinding[] = [];

  // The register entry is selected from the provider the advocate intended to contact, never
  // from the response. Letting response.seal.registerEntryId choose the entry would let a
  // response name the authority that vouches for it, which is the attack DKIM's d= field
  // invites when a verifier trusts it without binding it to what it expected. A seal that
  // claims a different entry than the one selected is a refusing finding, not a redirect.
  const entryId = provider.registerEntryId;
  const entry = entryId ? register.entry(entryId) : undefined;

  if (entryId && !entry) {
    findings.push({
      code: 'register_entry_unknown',
      detail: `register entry ${entryId} is not in the loaded register`,
      refuses: true,
    });
  }

  if (entry && entry.status === 'revoked') {
    findings.push({
      code: 'register_entry_revoked',
      detail: `register entry ${entry.id} is revoked`,
      refuses: true,
    });
  }

  const sealPresent = Boolean(response.seal);
  let sealValid = false;

  if (!sealPresent) {
    const declaresSealAll = entry?.sealPolicy === 'all';
    findings.push({
      code: 'seal_absent',
      detail: declaresSealAll
        ? `provider declares sealPolicy "all" in the register, so a response without a seal is a downgrade`
        : 'response carries no Provenance Seal; labeled unsealed',
      refuses: declaresSealAll,
    });
  } else {
    const seal = response.seal!;
    const key = entry ? register.key(entry.id, seal.selector) : undefined;

    if (entryId && seal.registerEntryId !== entryId) {
      findings.push({
        code: 'seal_entry_mismatch',
        detail: `seal claims register entry ${seal.registerEntryId}, but the advocate contacted ${entryId}`,
        refuses: true,
      });
    }

    const freshness = sealFreshness(seal.signedAt, response.receivedAt);
    if (freshness) findings.push(freshness);

    if (!entry) {
      // Already recorded as unknown entry above, or no entry claimed at all.
      if (!entryId) {
        findings.push({
          code: 'seal_key_unknown',
          detail: 'sealed response claims no register entry',
          refuses: true,
        });
      }
    } else if (!key) {
      findings.push({
        code: 'seal_key_unknown',
        detail: `no active key with selector ${seal.selector} on entry ${entry.id}`,
        refuses: true,
      });
    } else {
      sealValid = verifySeal(seal, response.content, key.publicKeyPem);
      if (!sealValid) {
        findings.push({
          code: 'seal_signature_invalid',
          detail: 'seal signature does not verify over the served content',
          refuses: true,
        });
      }
      if (sealValid && !entry.models.includes(seal.model)) {
        findings.push({
          code: 'seal_model_mismatch',
          detail: `seal claims model ${seal.model}, which entry ${entry.id} is not registered to serve`,
          refuses: true,
        });
      }
    }
  }

  let endpointAuthorized = true;
  if (entry) {
    endpointAuthorized = register.endpointAuthorized(entry.id, response.servedFrom);
    if (!endpointAuthorized) {
      findings.push({
        code: 'endpoint_not_authorized',
        detail: `${response.servedFrom} is not an authorized serving endpoint for ${entry.id}`,
        refuses: true,
      });
    }
  }

  const verdict: DeterministicVerdict = {
    passed: !findings.some((f) => f.refuses),
    sealPresent,
    sealValid,
    endpointAuthorized,
    findings,
  };
  if (entry) verdict.registerEntryId = entry.id;
  return verdict;
}
