// The deterministic pass. Decidable by arithmetic, so no model participates.
//
// Paper: step 7. Provisional: Section 3.2 (mandatory determinism where decidable).
// Spec: draft-flores-airp-provenance-00 §6.
// Honest labeling is the design rule here. No frontier lab currently signs text, so almost
// every real response reaching this code will be unsealed. Unsealed is reported as unsealed
// and the exchange continues, unless the provider's register entry declares that it seals
// everything, in which case a missing seal is a downgrade and the response is refused.

import type {
  AttributionQualifier,
  DeterministicFinding,
  DeterministicVerdict,
  ProviderConfig,
  ProviderResponse,
} from '../types.js';
import { verifySeal } from '../crypto/seal.js';
import type { RegisterKey, ServingRegister } from './register.js';

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

/** Spec §4.3 / §6.7: locate by selector, then apply status. */
function keyStatusFinding(key: RegisterKey, signedAt: string): DeterministicFinding | undefined {
  if (key.status === 'compromised') {
    return {
      code: 'seal_key_compromised',
      detail: `key selector ${key.selector} is marked compromised`,
      refuses: false,
    };
  }
  if (key.status === 'retired') {
    const retiredAt = key.retiredAt ? Date.parse(key.retiredAt) : NaN;
    const signed = Date.parse(signedAt);
    if (Number.isNaN(retiredAt) || Number.isNaN(signed) || signed >= retiredAt) {
      return {
        code: 'seal_key_retired',
        detail: `key selector ${key.selector} was retired at ${key.retiredAt ?? 'unknown'}; seal signed-at is at or after retirement`,
        refuses: false,
      };
    }
  }
  if (key.status !== 'current' && key.status !== 'rotating' && key.status !== 'retired') {
    return {
      code: 'seal_key_unknown',
      detail: `key selector ${key.selector} has unrecognized status ${key.status}`,
      refuses: true,
    };
  }
  return undefined;
}

export interface DeterministicPassOptions {
  /**
   * DNS-derived key set digest for the selected entry, when the lookup completed.
   * Absent means unconfirmed rather than mismatched. Spec §4.8.
   */
  keySetDigestFromDns?: string;
  /** Computed digest over the selected entry's keys, when a DNS digest is available to check. */
  keySetDigestComputed?: string;
  /** Content arrived after a terminal-seal event on a stream. Spec §3.8.3. */
  contentAfterTerminalSeal?: boolean;
  /** Register entry named a content binding the client does not hold. Spec §3.8.3. */
  unknownContentBinding?: boolean;
}

export function runDeterministicPass(
  provider: ProviderConfig,
  response: ProviderResponse,
  register: ServingRegister,
  opts: DeterministicPassOptions = {},
): DeterministicVerdict {
  const findings: DeterministicFinding[] = [];
  let attribution: AttributionQualifier = 'none';

  // The register entry is selected from the provider the advocate intended to contact, never
  // from the response. Letting response.seal.registerEntryId choose the entry would let a
  // response name the authority that vouches for it, which is the attack DKIM's d= field
  // invites when a verifier trusts it without binding it to what it expected. A seal that
  // claims a different entry than the one selected is a refusing finding, not a redirect.
  // Spec §4.7 / §6.3: DNS may supply the identifier; local config is the fallback. Never take
  // an identifier from the response.
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

  if (opts.keySetDigestFromDns !== undefined && opts.keySetDigestComputed !== undefined) {
    if (opts.keySetDigestFromDns !== opts.keySetDigestComputed) {
      findings.push({
        code: 'key_set_digest_mismatch',
        detail: 'DNS key set digest does not match the selected register entry',
        refuses: true,
      });
    } else {
      attribution = 'confirmed';
    }
  } else if (entry) {
    attribution = 'unconfirmed';
  }

  if (response.multipleSeals) {
    findings.push({
      code: 'seal_multiple',
      detail: 'response carried more than one AIRP-Seal header field',
      refuses: true,
    });
  }

  if (response.sealDuplicateMember) {
    findings.push({
      code: 'seal_duplicate_json_member',
      detail: 'seal representation carried a duplicate JSON member name',
      refuses: true,
    });
  } else if (response.sealDecodeFailed) {
    findings.push({
      code: 'seal_malformed',
      detail: 'seal header was present but could not be decoded',
      refuses: true,
    });
  }

  if (opts.contentAfterTerminalSeal) {
    findings.push({
      code: 'content_after_terminal_seal',
      detail: 'content arrived after the terminal-seal event; unsigned bytes must not be released',
      refuses: true,
    });
  }

  if (opts.unknownContentBinding) {
    findings.push({
      code: 'unknown_content_binding',
      detail: `register entry names content binding ${entry?.contentBinding ?? '(unknown)'} which this client does not hold`,
      refuses: false,
    });
  }

  const sealPresent = Boolean(response.seal);
  let sealValid = false;

  if (!sealPresent && !response.sealDecodeFailed && !response.multipleSeals) {
    const declaresSealAll = entry?.sealPolicy === 'all';
    findings.push({
      code: 'seal_absent',
      detail: declaresSealAll
        ? `provider declares sealPolicy "all" in the register, so a response without a seal is a downgrade`
        : 'response carries no Provenance Seal; labeled unsealed',
      refuses: declaresSealAll,
    });
  } else if (response.seal) {
    const seal = response.seal;
    const key = entry ? register.key(entry.id, seal.selector) : undefined;

    if (entryId && seal.registerEntryId !== entryId) {
      findings.push({
        code: 'seal_entry_mismatch',
        detail: `seal claims register entry ${seal.registerEntryId}, but the advocate contacted ${entryId}`,
        refuses: true,
      });
    }

      const sealExchange = seal.exchangeId ?? '';
      if (sealExchange !== response.exchangeId) {
        findings.push({
          code: 'exchange_id_mismatch',
          detail: 'seal exchange-id does not match the AIRP-Exchange-Id the client sent',
          refuses: true,
        });
      }

    const freshness = sealFreshness(seal.signedAt, response.receivedAt);
    if (freshness) findings.push(freshness);

    if (!entry) {
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
        detail: `no key with selector ${seal.selector} on entry ${entry.id}`,
        refuses: true,
      });
    } else {
      const statusFinding = keyStatusFinding(key, seal.signedAt);
      if (statusFinding) {
        findings.push(statusFinding);
        // Compromised / post-retirement: unattributed, do not treat as signature-valid.
      } else {
        sealValid = verifySeal(seal, response.sealedContent, key.publicKeyPem);
        if (!sealValid) {
          findings.push({
            code: 'seal_signature_invalid',
            detail: 'seal signature does not verify over the served content',
            refuses: true,
          });
        }

        // Spec §6.8: provider identity check, between key resolution and model authorization.
        if (sealValid && seal.providerIdentity !== entry.providerIdentity) {
          findings.push({
            code: 'seal_provider_mismatch',
            detail: `seal claims provider ${seal.providerIdentity}, entry ${entry.id} is ${entry.providerIdentity}`,
            refuses: true,
          });
          sealValid = false;
        }

        if (sealValid && !entry.models.includes(seal.model)) {
          findings.push({
            code: 'seal_model_mismatch',
            detail: `seal claims model ${seal.model}, which entry ${entry.id} is not registered to serve`,
            refuses: true,
          });
        }

        // Spec §6.11: request digest is last, reported not refusing, response still attributable.
        if (
          sealValid &&
          seal.requestDigest !== undefined &&
          seal.requestDigest !== response.requestDigest
        ) {
          findings.push({
            code: 'request_modified',
            detail:
              'request digest in the seal does not match the request the client sent; the answer replies to something other than what was asked',
            refuses: false,
          });
        }
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

  // Compromised / retired findings are unattributed: clear sealValid and treat attribution.
  if (findings.some((f) => f.code === 'seal_key_compromised' || f.code === 'seal_key_retired')) {
    sealValid = false;
    if (attribution === 'confirmed') attribution = 'unconfirmed';
  }
  if (findings.some((f) => f.code === 'unknown_content_binding')) {
    sealValid = false;
    attribution = 'none';
  }

  const verdict: DeterministicVerdict = {
    passed: !findings.some((f) => f.refuses),
    sealPresent,
    sealValid,
    endpointAuthorized,
    findings,
    attribution,
  };
  if (entry) verdict.registerEntryId = entry.id;
  return verdict;
}
