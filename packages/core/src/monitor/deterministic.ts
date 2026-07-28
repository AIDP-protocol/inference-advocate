// The deterministic pass. Decidable by arithmetic, so no model participates.
//
// Paper: step 7. Provisional: Section 3.2 (mandatory determinism where decidable).
// PLAN: Phase 2.
//
// Honest labeling is the design rule here. No frontier lab currently signs text, so almost
// every real response reaching this code will be unsealed. Unsealed is reported as unsealed
// and the exchange continues, unless the provider's register entry declares that it seals
// everything, in which case a missing seal is a downgrade and the response is refused.

import type { DeterministicFinding, DeterministicVerdict, ProviderConfig, ProviderResponse } from '../types.js';
import { verifySeal } from '../crypto/seal.js';
import type { ServingRegister } from './register.js';

export function runDeterministicPass(
  provider: ProviderConfig,
  response: ProviderResponse,
  register: ServingRegister,
): DeterministicVerdict {
  const findings: DeterministicFinding[] = [];
  const entryId = response.seal?.registerEntryId ?? provider.registerEntryId;
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
