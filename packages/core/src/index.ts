// Public surface of the advocate core. Provider agnostic, no UI dependencies.
//
// Paper: Accountable Inference Reputation Protocol (AIRP), Justin Philip Flores, 2026.
// Every module below states the paper section and step it implements at the top of its file.

export * from './types.js';

export { MasterSecret, StoreKey, type StoreName } from './crypto/keys.js';
export {
  canonicalSealPayload,
  canonicalAirpSealPayload,
  canonicalAirpPresealPayload,
  computeRequestDigest,
  generateExchangeId,
  generateSealKeypair,
  signSeal,
  verifySeal,
  signDocument,
  verifyDocument,
  pemSpkiBody,
  type SealHeaderFields,
  type SealSubject,
  type SealFieldName,
} from './crypto/seal.js';

export {
  type StoreBackend,
  type LedgerRow,
  type CarryoverRow,
  type BlockRow,
  type TranscriptRow,
  type EvidenceRow,
  type ResidencyCounts,
} from './store/port.js';
export { runStoreConformance, type StoreFactory } from './store/conformance.js';
export { TranscriptStore, type StoredTurn } from './store/transcripts.js';
export {
  LedgerStore,
  type LedgerReader,
  type AppendInput,
  type CarryoverState,
  type BlockRecord,
} from './store/ledger.js';
export { PreferenceStore } from './store/preferences.js';
export { sha256Hex } from './crypto/sha256.js';
export { sha512 } from './crypto/sha512.js';

export * from './interchange/wire.js';
export { parseJsonNoDuplicates, DuplicateJsonMemberError } from './interchange/json-strict.js';
export { send, resolveApiKey, ProviderError, type SendOptions } from './interchange/openai-adapter.js';
export {
  ArrivalActivity,
  ARRIVAL_BUMP,
  ARRIVAL_HALF_LIFE_MS,
  ARRIVAL_SAMPLE_MS,
} from './interchange/arrival.js';
export { ProviderRegistry, type ProvidersFile } from './interchange/providers.js';

export {
  ServingRegister,
  endpointMatches,
  computeKeySetDigest,
  type RegisterDocument,
  type RegisterEntry,
  type RegisterKey,
  type EntryStatus,
  type KeyStatus,
} from './monitor/register.js';
export {
  runDeterministicPass,
  MAX_SEAL_AGE_MS,
  MAX_SEAL_FUTURE_SKEW_MS,
  type DeterministicPassOptions,
} from './monitor/deterministic.js';
export {
  ContentBindingRegistry,
  defaultContentBindings,
  accumulateBoundContent,
  accumulateStream,
  SSE_CHAT_DELTA_V1,
  SSE_CONTENT_BLOCK_DELTA_V1,
  parseSseStream,
  SseStreamParser,
  type ContentBinding,
  type StreamSealEvent,
} from './monitor/content-bindings.js';
export {
  parseAirpTxt,
  selectAirpTxtRecords,
  lookupAirpBinding,
  isForbiddenAutoFetchHost,
  type AirpDnsBinding,
  type AirpDnsLookupResult,
  type ResolveTxtFn,
} from './monitor/dns-binding.js';
export { Taxonomy, type TaxonomyDocument, type FlagDefinition, type Criterion } from './monitor/taxonomy.js';
export { SemanticMonitor, type Evaluator, type EvaluationRequest } from './monitor/semantic.js';
export { RuleEvaluator } from './monitor/evaluators/rule-evaluator.js';
export { ModelEvaluator, type ModelEvaluatorOptions } from './monitor/evaluators/model-evaluator.js';
export {
  resolveEvaluator,
  loadEvaluatorConfig,
  discoverEvaluatorConfig,
  type EvaluatorConfig,
  type ModelEvaluatorConfig,
  type ResolvedEvaluator,
} from './monitor/evaluator-config.js';

export {
  DeliveryPolicy,
  type TransportPolicyConfig,
  type DeliveryPolicyDocument,
  type WindowConfig,
  type ThresholdConfig,
  type CarryoverConfig,
  type StandingSeedConfig,
  type TelemetryConfig,
} from './policy/config.js';
export {
  Jurisdiction,
  type JurisdictionRuleset,
  type CategoryTreatment,
  type PendingProvision,
} from './policy/jurisdiction.js';
export { computeScore, windowEntries, type ScoreInput, type ScoreResult } from './policy/score.js';
export { resolve as resolveDelivery, type ResolveInput, type ResolveResult } from './policy/delivery.js';
export { newNoticeState, selectNotices, stillDisplayed, type NoticeState } from './policy/notices.js';

export { StandingRegistry, type StandingDocument, type StandingEntry } from './telemetry/standing.js';
export { computeRates, canonicalBatch, type TelemetryBatch, type ProviderRates } from './telemetry/rates.js';
export { TelemetryEmitter, type EmitterOptions, type EmitResult } from './telemetry/emitter.js';
export { buildExportView, type ExportView, type ResidencyReport } from './telemetry/export.js';

export {
  Advocate,
  type AdvocateOptions,
  type AskOptions,
  type TransportSetting,
} from './advocate.js';
export { openAdvocate, type SetupOptions, type OpenedAdvocate } from './setup.js';
