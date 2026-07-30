// Shapes the daemon returns. Kept as a hand-written mirror rather than an import of the core
// package, so that the UI has no build dependency on a Node-only module.
//
// Paper: steps 1 and 12. PLAN: Phase 5.

export interface Notice {
  id: string;
  text: string;
  dismissable: false;
  windowMinutes: number | null;
  source: 'jurisdiction' | 'policy' | 'monitor';
  trigger?: string;
  repeatMinutes?: number;
}

export interface Flag {
  type: string;
  severity: number;
  basis: string;
  evidence: Array<{ start: number; end: number; text: string }>;
}

export interface Decision {
  kind: 'deliver' | 'deliver_with_notice' | 'withhold' | 'refuse';
  score: number;
  windowScore: number;
  instantScore: number;
  effectiveWarn: number;
  effectiveBlock: number;
  releaseAuthority?: string;
  notices: Notice[];
  rationale: string[];
  standing: string;
  mode: string;
}

export interface ExchangeResult {
  responseId: string;
  providerId: string;
  decision: Decision;
  deterministic: {
    passed: boolean;
    sealPresent: boolean;
    sealValid: boolean;
    endpointAuthorized: boolean;
    findings: Array<{ code: string; detail: string; refuses: boolean }>;
  };
  semantic: { flags: Flag[]; evaluatorId: string; evaluatorVersion: string; taxonomyVersion: string };
  delivered: string | null;
  withheldContent?: string;
  ledgerSeq: number;
}

export interface ProviderState {
  id: string;
  label: string;
  model: string;
  registerEntryId: string | null;
  standing: string;
  windowScore: number;
  windowSize: number;
  warn: number;
  block: number;
  flagCounts: Record<string, number>;
  carryover: { cleanRemaining: number } | null;
  openBlocks: Array<{ providerId: string; responseId: string; authority: string; raisedAt: string }>;
  chain: { ok: boolean; brokenAtSeq?: number };
  evaluatedTotal: number;
}

export interface PendingProvision {
  id: string;
  summary: string;
}

export interface AdvocateState {
  sessionId: string;
  jurisdiction: {
    id: string;
    name: string;
    version: string;
    disclaimer: string;
    citations?: string[];
  };
  pendingProvisions: PendingProvision[];
  policy: {
    policyVersion: string;
    scale: string;
    mode: string;
    window: { kind: string; n?: number; hours?: number; scope: string };
    thresholds: { warn: number; block: number };
    telemetry: { granularityFloor: number; trafficClass: string; endpoint: string | null };
  };
  taxonomy: {
    version: string;
    status: string;
    flags: Array<{ type: string; title: string; definition: string; severity: number }>;
  };
  register: { signatureValid: boolean; entries: number };
  standing: { signatureValid: boolean; issuedAt: string };
  providers: ProviderState[];
  warnings: string[];
  pinned: Array<{ notice: Notice; raisedAt: string }>;
}
