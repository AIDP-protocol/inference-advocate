// Shared types for the inference advocate.
//
// Paper: Accountable Inference Delivery Protocol (AIDP), Section 4 (the fourteen-step path).
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

/** The Provenance Seal. Paper step 5, ancestry DKIM. */
export interface ProvenanceSeal {
  /** Register entry the signing key belongs to. */
  registerEntryId: string;
  /** Key selector within that entry, so keys can rotate. */
  selector: string;
  /** Model identifier the provider asserts produced the output. */
  model: string;
  /** Provider identity as registered. */
  providerIdentity: string;
  /** RFC3339 timestamp of signing. */
  signedAt: string;
  /** Algorithm. Only ed25519 at reference stage. */
  alg: 'ed25519';
  /** Base64url signature over the canonical seal payload. */
  signature: string;
}

/** What the adapter hands back from a provider call. Paper step 6. */
export interface ProviderResponse {
  providerId: string;
  /** The assistant text as served. */
  content: string;
  /** Present only if the provider sealed. Absence is a finding, not an error. Paper step 7. */
  seal?: ProvenanceSeal;
  /** Endpoint actually contacted, checked against the register at step 7. */
  servedFrom: string;
  /** Model name the wire response reported. */
  reportedModel?: string;
  /** Wall clock receipt time, RFC3339. */
  receivedAt: string;
  /** Raw latency in milliseconds, for the UI. */
  latencyMs: number;
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

/** The deterministic pass result. Paper step 7. */
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
}

export type DeterministicFindingCode =
  | 'seal_absent'
  | 'seal_malformed'
  | 'seal_signature_invalid'
  | 'seal_key_unknown'
  | 'seal_model_mismatch'
  | 'endpoint_not_authorized'
  | 'register_entry_unknown'
  | 'register_entry_revoked';

export interface DeterministicFinding {
  code: DeterministicFindingCode;
  detail: string;
  /** Refusing findings end evaluation without a semantic pass. Paper step 7. */
  refuses: boolean;
}

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
}

export type StandingState = 'good' | 'elevated_scrutiny' | 'excluded' | 'unknown';

export type OperatingMode = 'observe' | 'annotate' | 'enforce';

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
}
