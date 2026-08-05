// Shared types for the inference advocate.
//
// Paper: Accountable Inference Reputation Protocol (AIRP), Section 4 (the fourteen-step path).
// Steps: all. This module names the things the other modules pass to each other.

/** A provider is the party performing the serving function. Paper, Definitions. */
export interface ProviderConfig {
  /** Stable local identifier. Also the ledger partition key. */
  id: string;
  /** Human-readable name shown in the UI. */
  label: string;
  /** Base URL of an OpenAI-compatible endpoint. Paper step 3 (Interchange bootstrap). */
  baseUrl: string;
  /** Model name passed on the wire. */
  model: string;
  /**
   * API key, held locally. Read from the environment variable named here rather than
   * stored in the config file, so a shared config never carries a secret.
   */
  apiKeyEnv?: string;
  /** Literal key. Discouraged; present because a reference implementation should show the tradeoff. */
  apiKey?: string;
  /** The register entry this provider claims. Verified at step 7. */
  registerEntryId?: string;
  /** Extra headers, if the endpoint needs them. */
  headers?: Record<string, string>;
}

/** One turn of conversation as the advocate holds it. Paper step 9 (local transcript). */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Step 2: the attribute attestation package. Paper Section 6. */
export interface AttestationPackage {
  /** Proven true without proving who the person is. */
  isAdult: boolean;
  /** Jurisdiction ruleset id the advocate will apply at delivery. */
  jurisdiction: string;
  /** Other qualifying attributes, name to boolean. */
  attributes?: Record<string, boolean>;
  /** Issuer identifier. Stubbed at reference stage. */
  issuer?: string;
}

/** The Provenance Seal. Paper step 5, ancestry DKIM. Spec §3. */
export interface ProvenanceSeal {
  /** Register entry the signing key belongs to. */
  registerEntryId: string;
  /** Key selector within that entry, so keys can rotate. */
  selector: string;
  /** Model identifier the provider asserts produced the output. */
  model: string;
  /** Provider identity as registered. */
  providerIdentity: string;
  /** Echo of AIRP-Exchange-Id. Required on AIRP seals. Spec §3.8.1. */
  exchangeId?: string;
  /** Request body digest. Required on AIRP seals. Spec §3.4. */
  requestDigest?: string;
  /** RFC3339 timestamp of signing. */
  signedAt: string;
  /** Algorithm. Only ed25519 at reference stage. */
  alg: 'ed25519';
  /** Base64url signature over the canonical seal payload. */
  signature: string;
}

/** Header field that carried the seal. Selects the payload reconstruction path. Spec §7.1. */
export type SealHeaderField = 'airp-seal';

/**
 * How the response body was carried. Spec §3.8.2 (non-streamed) and §3.8.3 (streamed).
 *
 * Both modes are permanent and both are tested. `streamed` buys an arrival indicator and
 * costs a window in which accumulated content sits in this process while the gate holds it.
 * `non_streamed` closes that window, because plaintext does not exist on the device until the
 * whole response has arrived, and costs the indicator. Where the user sets their own delivery
 * policy there is nothing to defend against and streamed is better; where the party subject
 * to the policy is not the party who set it, non-streamed is the stronger of the two.
 */
export type TransportMode = 'streamed' | 'non_streamed';

/** What the adapter hands back from a provider call. Paper step 6. Spec §3.8. */
export interface ProviderResponse {
  providerId: string;
  /** The assistant text extracted for delivery and semantic evaluation. */
  content: string;
  /**
   * Octets the seal covers: decompressed response body (non-streamed) or binding-extracted
   * stream bytes. Spec §3.8.2 / §3.8.3.
   */
  sealedContent: Uint8Array;
  /** Present only if the provider sealed. Absence is a finding, not an error. Paper step 7. */
  seal?: ProvenanceSeal;
  /** Which response header carried the seal, when present. Spec §7.1. */
  sealFieldName?: SealHeaderField;
  /** True when more than one AIRP-Seal header field was present. Spec §3.8.3. */
  multipleSeals?: boolean;
  /** Seal header was present but could not be decoded (malformed or duplicate JSON member). */
  sealDecodeFailed?: boolean;
  /** True when decode failed specifically because of a duplicate JSON member name. Spec §3.8. */
  sealDuplicateMember?: boolean;
  /** Exchange id the client sent on this request. Spec §3.8.1. */
  exchangeId: string;
  /** Digest of the request body the client retained. Spec §3.4 / §6.11. */
  requestDigest: string;
  /** Endpoint actually contacted, checked against the register at step 7. */
  servedFrom: string;
  /** Model name the wire response reported. */
  reportedModel?: string;
  /** Wall clock receipt time, RFC3339. */
  receivedAt: string;
  /** Raw latency in milliseconds, for the UI. */
  latencyMs: number;
  /** Which transport actually carried the body, decided by the response content-type. */
  transport: TransportMode;
  /**
   * Streamed path only: a data event arrived after the terminal-seal event, so unsigned bytes
   * were served under a sealed response. Refusing at step 7. Spec §3.8.3.
   */
  contentAfterTerminalSeal?: boolean;
  /**
   * DNS / key-set confirmation qualifier. Spec §4.8 / §6.3. Distinct from findings: an
   * attribution without a confirming digest must still be distinguishable in reporting.
   */
  entryUnconfirmed?: boolean;
}

/** Flag types of taxonomy v0. Paper, Definitions and step 8. */
export type FlagType = string;

/** One determination by the monitor. Paper step 8. */
export interface Flag {
  type: FlagType;
  /** 1 to 3 at reference stage, from the taxonomy file. */
  severity: number;
  /**
   * Bounded excerpt supporting the finding, with offsets into the evaluated text.
   * Evidence spans are conversation content. They live in the transcript store and never
   * in telemetry. Paper Section 5, "What leaves the client".
   */
  evidence: EvidenceSpan[];
  /** Which rule or criterion fired, so the basis is inspectable. Paper Section 3.3 of the provisional. */
  basis: string;
}

export interface EvidenceSpan {
  start: number;
  end: number;
  text: string;
}

/** The deterministic pass result. Paper step 7. Spec §6. */
export interface DeterministicVerdict {
  /** True when nothing in the deterministic layer refused the response. */
  passed: boolean;
  sealPresent: boolean;
  sealValid: boolean;
  endpointAuthorized: boolean;
  /** Machine-readable reasons, empty when passed with a valid seal. */
  findings: DeterministicFinding[];
  /** Register entry resolved, if any. */
  registerEntryId?: string;
  /** Whether DNS key-set digest confirmed the entry. Spec §4.8. */
  attribution: AttributionQualifier;
}

export type DeterministicFindingCode =
  | 'seal_absent'
  | 'seal_malformed'
  | 'seal_signature_invalid'
  | 'seal_key_unknown'
  | 'seal_key_compromised'
  | 'seal_key_retired'
  | 'seal_model_mismatch'
  | 'seal_provider_mismatch'
  | 'seal_entry_mismatch'
  | 'seal_not_fresh'
  | 'seal_multiple'
  | 'seal_duplicate_json_member'
  | 'request_modified'
  | 'exchange_id_mismatch'
  | 'content_after_terminal_seal'
  | 'unknown_content_binding'
  | 'key_set_digest_mismatch'
  | 'endpoint_not_authorized'
  | 'register_entry_unknown'
  | 'register_entry_revoked';

export interface DeterministicFinding {
  code: DeterministicFindingCode;
  detail: string;
  /** Refusing findings end evaluation without a semantic pass. Paper step 7. */
  refuses: boolean;
}

/**
 * Reporting qualifier on an otherwise attributable verdict. Spec §4.8: an entry taken from
 * a register document alone, without a confirming key set digest, is unconfirmed.
 */
export type AttributionQualifier = 'confirmed' | 'unconfirmed' | 'none';

/** The semantic pass result. Paper step 8. */
export interface SemanticVerdict {
  flags: Flag[];
  evaluatorId: string;
  evaluatorVersion: string;
  taxonomyVersion: string;
}

/** A row of the per-provider ledger. Paper step 9. */
export interface LedgerEntry {
  /** Monotonic sequence within the provider partition. */
  seq: number;
  providerId: string;
  responseId: string;
  /** RFC3339. */
  at: string;
  /** Zero or more flags. An entry with no flags is still an evaluated response, which the denominator needs. */
  flags: LedgerFlag[];
  /** Outcome the Delivery Policy reached. */
  outcome: DeliveryOutcomeKind;
  /** Windowed score at the moment of resolution. */
  score: number;
  evaluatorVersion: string;
  taxonomyVersion: string;
  /** Hash chain over prior entries. Paper Section 1.7 of the provisional (tamper evidence). */
  prevHash: string;
  hash: string;
}

/**
 * The ledger's view of a flag. Type and severity only.
 * Evidence lives in the transcript store under a different key scope, which is what makes
 * the telemetry emitter structurally unable to transmit content.
 */
export interface LedgerFlag {
  type: FlagType;
  severity: number;
  /** Pointer into the transcript store. Meaningless without the transcript key. */
  evidenceRef: string;
}

export type DeliveryOutcomeKind = 'deliver' | 'deliver_with_notice' | 'withhold' | 'refuse';

export type ReleaseAuthority =
  | 'self_release'
  | 'custodial_release'
  | 'non_releasable'
  | 'escalating';

/** Paper step 11: the four outcomes. */
export interface DeliveryDecision {
  kind: DeliveryOutcomeKind;
  /** Windowed, severity weighted score at resolution. Paper step 10. */
  score: number;
  /** Contribution from prior ledger entries in the window, excluding this response. */
  windowScore: number;
  /** Contribution from flags on this response alone. */
  instantScore: number;
  effectiveWarn: number;
  effectiveBlock: number;
  /** Present when kind is withhold. Paper Section 1.5 of the provisional. */
  releaseAuthority?: ReleaseAuthority;
  /** Notices pinned by the advocate. No provider can remove them. Paper step 12. */
  notices: Notice[];
  /** Human-readable account of why, for the UI and for the ledger. */
  rationale: string[];
  /** Standing state consulted. Paper steps 13 and 14. */
  standing: StandingState;
  /** Operating mode in force. Provisional Section 4.8. */
  mode: OperatingMode;
}

/**
 * Enactment status of a jurisdiction provision. Only `in_force` rules change delivery.
 * `pending` means the advocate surfaces the provision as a warning and does not apply it.
 */
export type ProvisionStatus = 'in_force' | 'pending';

export interface Notice {
  id: string;
  text: string;
  /** Notices are pinned and non-dismissable by design. Paper step 12. */
  dismissable: false;
  /** How long the notice stays up, in minutes. Null means for the life of the session. */
  windowMinutes: number | null;
  source: 'jurisdiction' | 'policy' | 'monitor';
  /**
   * When the notice is raised.
   *   session_start  once at the top of a session, then again every repeatMinutes
   *   on_warn        while the provider is in the warn band
   *   always         on every delivery
   */
  trigger?: 'session_start' | 'on_warn' | 'always';
  /** Re-raise interval for session_start notices. New York's companion law uses three hours. */
  repeatMinutes?: number;
  /**
   * Jurisdiction notices only. Omitted on policy and monitor notices. Missing status is
   * treated as in_force so older documents keep working.
   */
  status?: ProvisionStatus;
}

export type StandingState = 'good' | 'elevated_scrutiny' | 'excluded' | 'unknown';

export type OperatingMode = 'observe' | 'annotate' | 'enforce';

/** Wall-clock stages for one exchange. Paper steps 3 and 8 dominate when the evaluator is hosted. */
export interface ExchangeTimings {
  /** End to end inside ask(), milliseconds. */
  totalMs: number;
  /** Provider round trip (Interchange send). */
  providerMs: number;
  /** Deterministic seal/register pass. Local. */
  deterministicMs: number;
  /** Semantic evaluator. Hosted model evaluators are a second network hop. */
  semanticMs: number;
  /** Score, resolution, ledger, and transcript writes. Local. */
  resolveMs: number;
}

/** What the advocate returns for one exchange. */
export interface ExchangeResult {
  responseId: string;
  providerId: string;
  decision: DeliveryDecision;
  deterministic: DeterministicVerdict;
  semantic: SemanticVerdict;
  /** The text the user is allowed to see. Null when withheld or refused. */
  delivered: string | null;
  /** Always present locally. Withheld responses are retained as received-and-logged. */
  withheldContent?: string;
  ledgerSeq: number;
  /** Stage timings so the UI can show where deferral latency went. */
  timings: ExchangeTimings;
}
