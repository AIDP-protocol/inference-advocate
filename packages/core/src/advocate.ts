// The advocate: one response through the fourteen-step path.
//
// Paper: Section 4 in full.
//   before  attestation package assembled at setup
//   1       the prompt
//   2       attach the attestations, jurisdiction ruleset already loaded
//   3       the request goes out over the Interchange
//   4       the provider serves from a registered endpoint
//   5       the provider seals
//   6       the sealed response returns
//   7       deterministic layer: seal against register
//   8       semantic layer: taxonomy against content
//   9       ledger append
//   10      the score
//   11      the resolution
//   12      delivery, with pinned notices
//   13, 14  telemetry as rates, and standing consumed back into step 10
//
// This file is deliberately readable top to bottom. If it stops matching the list above,
// one of the two is wrong.

import { randomUUID } from 'node:crypto';
import type {
  AttestationPackage,
  ExchangeResult,
  LedgerFlag,
  Message,
  ProviderConfig,
  StandingState,
} from './types.js';
import type { StoreBackend } from './store/port.js';
import { MasterSecret } from './crypto/keys.js';
import { TranscriptStore } from './store/transcripts.js';
import { LedgerStore } from './store/ledger.js';
import { PreferenceStore } from './store/preferences.js';
import { ProviderRegistry } from './interchange/providers.js';
import { send as sendToProvider } from './interchange/openai-adapter.js';
import { ServingRegister, computeKeySetDigest } from './monitor/register.js';
import { runDeterministicPass } from './monitor/deterministic.js';
import { lookupAirpBinding } from './monitor/dns-binding.js';
import { defaultContentBindings } from './monitor/content-bindings.js';
import { SemanticMonitor } from './monitor/semantic.js';
import { DeliveryPolicy } from './policy/config.js';
import { Jurisdiction } from './policy/jurisdiction.js';
import { resolve as resolveDelivery } from './policy/delivery.js';
import { newNoticeState, type NoticeState } from './policy/notices.js';
import { StandingRegistry } from './telemetry/standing.js';
import { TelemetryEmitter, type EmitterOptions } from './telemetry/emitter.js';
import { buildExportView, type ExportView } from './telemetry/export.js';

export interface AdvocateOptions {
  store: StoreBackend;
  master: MasterSecret;
  providers: ProviderRegistry;
  register: ServingRegister;
  standing: StandingRegistry;
  policy: DeliveryPolicy;
  jurisdiction: Jurisdiction;
  monitor: SemanticMonitor;
  attestations: AttestationPackage;
  /** Injected for tests and the demo. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Paths that send response content off the device, reported by the export view. */
  outboundContentPaths?: string[];
}

export interface AskOptions {
  providerId: string;
  text: string;
  sessionId?: string;
  systemPrompt?: string;
}

export class Advocate {
  readonly transcripts: TranscriptStore;
  readonly ledger: LedgerStore;
  readonly preferences: PreferenceStore;
  readonly #opts: AdvocateOptions;
  readonly #noticeStates = new Map<string, NoticeState>();
  #sessionId: string;

  constructor(opts: AdvocateOptions) {
    this.#opts = opts;
    this.transcripts = new TranscriptStore(opts.store, opts.master.deriveStoreKey('transcript'));
    this.ledger = new LedgerStore(opts.store, opts.master.deriveStoreKey('ledger'));
    this.preferences = new PreferenceStore(opts.store, opts.master.deriveStoreKey('preference'));
    this.#sessionId = randomUUID();
    this.#noticeStates.set(this.#sessionId, newNoticeState(this.#now().toISOString()));
  }

  #now(): Date {
    return this.#opts.now ? this.#opts.now() : new Date();
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  /**
   * Starting a new session severs the immediate interaction chain. For a low severity
   * accumulation block that is what restores delivery, and the carryover state is what stops
   * the new session from being amnesiac. Provisional Section 1.8.
   */
  newSession(): string {
    this.#sessionId = randomUUID();
    this.#noticeStates.set(this.#sessionId, newNoticeState(this.#now().toISOString()));
    return this.#sessionId;
  }

  standingFor(provider: ProviderConfig): StandingState {
    return this.#opts.standing.stateFor(provider.registerEntryId, this.#opts.jurisdiction.ruleset.id);
  }

  /** Current attribute attestation package. Paper step 2; issuer is still a local assertion. */
  get attestations(): AttestationPackage {
    return this.#opts.attestations;
  }

  /**
   * Flip the adult attribute for the reference client. Not verified. Persisted under the
   * preference key so a demo restart keeps the last choice. A real advocate would take this
   * from an issuer, not from a UI toggle.
   */
  setIsAdult(isAdult: boolean): AttestationPackage {
    this.#opts.attestations = { ...this.#opts.attestations, isAdult };
    this.preferences.set('attestations.isAdult', isAdult);
    return this.#opts.attestations;
  }

  /** Steps 1 through 12 for one exchange. */
  async ask(opts: AskOptions): Promise<ExchangeResult> {
    const askStarted = Date.now();
    const provider = this.#opts.providers.require(opts.providerId);
    const sessionId = opts.sessionId ?? this.#sessionId;
    const noticeState = this.#noticeStates.get(sessionId) ?? newNoticeState(this.#now().toISOString());
    this.#noticeStates.set(sessionId, noticeState);
    const responseId = randomUUID();
    const standing = this.standingFor(provider);

    // Step 1: the prompt, recorded locally before anything leaves.
    const at = this.#now().toISOString();
    this.transcripts.append({ sessionId, providerId: provider.id, role: 'user', at, content: opts.text });

    // Steps 13 and 14 feeding back into step 10 before the request is even sent: a provider
    // already excluded at population level is refused connection. Provisional Section 1.4.
    if (standing === 'excluded' && this.#opts.policy.document.standingSeed.refuseExcluded) {
      return this.#recordRefusalWithoutSend(provider.id, responseId, standing, sessionId, noticeState, askStarted);
    }

    // Step 2 and 3: attestations attached, request over the Interchange.
    const history = this.transcripts.history(sessionId);
    const messages: Message[] = opts.systemPrompt
      ? [{ role: 'system', content: opts.systemPrompt }, ...history]
      : history;

    const providerStarted = Date.now();
    const response = await sendToProvider(provider, {
      messages,
      attestations: this.#opts.attestations,
      ...(this.#opts.fetchImpl ? { fetchImpl: this.#opts.fetchImpl } : {}),
    });
    const providerMs = Date.now() - providerStarted;

    // Step 7: deterministic pass. DNS may confirm the entry and its key set; absence leaves
    // the attribution unconfirmed rather than refused. Spec §4.7 / §6.3.
    const deterministicStarted = Date.now();
    const configuredEntry = provider.registerEntryId
      ? this.#opts.register.entry(provider.registerEntryId)
      : undefined;
    let effectiveProvider = provider;
    const passOpts: Parameters<typeof runDeterministicPass>[3] = {};

    if (configuredEntry?.identityDomain) {
      const dns = await lookupAirpBinding(configuredEntry.identityDomain);
      if (dns.ok) {
        const dnsEntry = this.#opts.register.entry(dns.binding.entryId);
        if (dnsEntry) {
          effectiveProvider = { ...provider, registerEntryId: dns.binding.entryId };
          if (dns.binding.keySetDigest) {
            passOpts.keySetDigestFromDns = dns.binding.keySetDigest;
            passOpts.keySetDigestComputed = computeKeySetDigest(dnsEntry);
          }
        }
        if (dnsEntry?.contentBinding && !defaultContentBindings.has(dnsEntry.contentBinding)) {
          passOpts.unknownContentBinding = true;
        }
      }
    } else if (configuredEntry?.contentBinding && !defaultContentBindings.has(configuredEntry.contentBinding)) {
      passOpts.unknownContentBinding = true;
    }

    const deterministic = runDeterministicPass(
      effectiveProvider,
      response,
      this.#opts.register,
      passOpts,
    );
    const deterministicMs = Date.now() - deterministicStarted;

    // Step 8: semantic pass. A response refused by the deterministic layer is not evaluated
    // semantically; the paper is explicit that it is refused without further evaluation.
    const semanticStarted = Date.now();
    const semantic = deterministic.passed
      ? await this.#opts.monitor.evaluate({
          content: response.content,
          prompt: opts.text,
          providerId: provider.id,
        })
      : { flags: [], evaluatorId: 'none', evaluatorVersion: 'none', taxonomyVersion: this.#opts.monitor.taxonomyVersion };
    const semanticMs = Date.now() - semanticStarted;

    // Steps 10 and 11: score and resolution.
    const resolveStarted = Date.now();
    const { decision, adjustedFlags } = resolveDelivery({
      providerId: provider.id,
      deterministic,
      flags: semantic.flags,
      policy: this.#opts.policy,
      jurisdiction: this.#opts.jurisdiction,
      standing,
      isMinor: !this.#opts.attestations.isAdult,
      noticeState,
      now: this.#now(),
      scoring: {
        ledger: this.ledger,
        window: this.#opts.policy.document.window,
        ...(this.ledger.getCarryover(provider.id) ? { carryover: this.ledger.getCarryover(provider.id)! } : {}),
        sessionStart: noticeState.sessionStartedAt,
      },
    });

    // Step 9: evidence goes to the transcript store, the ledger gets the reference.
    const ledgerFlags: LedgerFlag[] = adjustedFlags.map((f) => ({
      type: f.type,
      severity: f.severity,
      evidenceRef: this.transcripts.putEvidence(responseId, f.evidence),
    }));

    const entry = this.ledger.append({
      providerId: provider.id,
      responseId,
      at: response.receivedAt,
      flags: ledgerFlags,
      outcome: decision.kind,
      score: decision.score,
      evaluatorVersion: `${semantic.evaluatorId}@${semantic.evaluatorVersion}`,
      taxonomyVersion: semantic.taxonomyVersion,
    });

    // The response is retained as received-and-logged whatever the outcome, so that a withheld
    // response can be released later by an authority competent to release it.
    this.transcripts.append({
      sessionId,
      providerId: provider.id,
      role: 'assistant',
      at: response.receivedAt,
      content: response.content,
      id: responseId,
    });

    if (ledgerFlags.length === 0) this.ledger.decayCarryover(provider.id);

    if (decision.kind === 'withhold') {
      this.ledger.raiseBlock({
        providerId: provider.id,
        responseId,
        authority: decision.releaseAuthority ?? 'self_release',
        raisedAt: response.receivedAt,
      });
      // The new session after a cleared block begins on edge. Provisional Section 1.8.
      this.ledger.setCarryover({
        providerId: provider.id,
        multiplier: 1,
        cleanRemaining: this.#opts.policy.document.carryover.cleanResponses,
        setAt: response.receivedAt,
      });
    }

    const resolveMs = Date.now() - resolveStarted;
    const delivered = decision.kind === 'deliver' || decision.kind === 'deliver_with_notice' ? response.content : null;
    const result: ExchangeResult = {
      responseId,
      providerId: provider.id,
      decision,
      deterministic,
      semantic: { ...semantic, flags: adjustedFlags },
      delivered,
      ledgerSeq: entry.seq,
      timings: {
        totalMs: Date.now() - askStarted,
        providerMs,
        deterministicMs,
        semanticMs,
        resolveMs,
      },
    };
    if (delivered === null) result.withheldContent = response.content;
    return result;
  }

  #recordRefusalWithoutSend(
    providerId: string,
    responseId: string,
    standing: StandingState,
    _sessionId: string,
    _noticeState: NoticeState,
    askStarted = Date.now(),
  ): ExchangeResult {
    const at = this.#now().toISOString();
    const entry = this.ledger.append({
      providerId,
      responseId,
      at,
      flags: [],
      outcome: 'refuse',
      score: 0,
      evaluatorVersion: 'none',
      taxonomyVersion: this.#opts.monitor.taxonomyVersion,
    });
    return {
      responseId,
      providerId,
      decision: {
        kind: 'refuse',
        score: 0,
        windowScore: 0,
        instantScore: 0,
        effectiveWarn: this.#opts.policy.document.thresholds.warn,
        effectiveBlock: this.#opts.policy.document.thresholds.block,
        notices: [],
        rationale: [
          'provider standing is excluded at population level; the advocate refused connection before sending',
        ],
        standing,
        mode: this.#opts.jurisdiction.effectiveMode(
          this.#opts.policy.document.mode,
          !this.#opts.attestations.isAdult,
        ),
      },
      deterministic: {
        passed: false,
        sealPresent: false,
        sealValid: false,
        endpointAuthorized: false,
        findings: [],
        attribution: 'none',
      },
      semantic: { flags: [], evaluatorId: 'none', evaluatorVersion: 'none', taxonomyVersion: this.#opts.monitor.taxonomyVersion },
      delivered: null,
      ledgerSeq: entry.seq,
      timings: {
        totalMs: Date.now() - askStarted,
        providerMs: 0,
        deterministicMs: 0,
        semanticMs: 0,
        resolveMs: Date.now() - askStarted,
      },
    };
  }

  /**
   * Clear a provider's rolling score and carryover so the next exchange is not still on edge
   * from a prior demo block. Reference only: not a product override, and it does not release
   * withheld content. Exposed only through the instrument drawer.
   */
  resetProviderReputation(providerId: string): void {
    this.ledger.resetReputation(providerId);
  }

  /**
   * Release a withheld response. The authority that raised the block is the authority that
   * can clear it, and the exercise is recorded. Provisional Sections 1.5 and 1.8.
   */
  release(providerId: string, responseId: string, actor: 'self' | 'custodian'): { released: boolean; reason?: string } {
    const block = this.ledger.openBlocks(providerId).find((b) => b.responseId === responseId);
    if (!block) return { released: false, reason: 'no open block for that response' };
    if (block.authority === 'non_releasable') {
      return { released: false, reason: 'this classification has no local override' };
    }
    if (block.authority === 'custodial_release' && actor !== 'custodian') {
      return { released: false, reason: 'release requires the supervising party' };
    }
    if (block.authority === 'self_release' && actor === 'self' && !this.#opts.attestations.isAdult) {
      return { released: false, reason: 'self release requires a verified adult attribute attestation' };
    }
    this.ledger.releaseBlock(providerId, responseId, actor, this.#now().toISOString());
    return { released: true };
  }

  /** The withheld text, once an authority has released it. */
  withheldContent(sessionId: string, responseId: string): string | undefined {
    return this.transcripts.session(sessionId).find((t) => t.id === responseId)?.content;
  }

  /**
   * The emitter is handed a ledger-scoped key and nothing else. Overrides exist so that a
   * demo or a calibration run can lower the granularity floor and see the shape of a cell the
   * floor would suppress; they cannot widen what the emitter is able to read.
   */
  telemetryEmitter(overrides: Partial<Pick<EmitterOptions, 'granularityFloor' | 'trafficClass' | 'endpoint' | 'instanceCredential'>> = {}): TelemetryEmitter {
    const t = this.#opts.policy.document.telemetry;
    return new TelemetryEmitter(this.ledger, this.#opts.master.deriveStoreKey('ledger'), {
      trafficClass: t.trafficClass,
      granularityFloor: t.granularityFloor,
      evaluatorVersion: this.#opts.monitor.evaluatorVersion,
      taxonomyVersion: this.#opts.monitor.taxonomyVersion,
      endpoint: t.endpoint,
      ...overrides,
    });
  }

  exportView(windowStart: string, windowEnd: string, granularityFloor?: number): ExportView {
    const batch = this.telemetryEmitter(
      granularityFloor === undefined ? {} : { granularityFloor },
    ).build(windowStart, windowEnd);
    return buildExportView({
      batch,
      ledger: this.ledger,
      transcripts: this.transcripts,
      storePath: this.#opts.store.location,
      ...(this.#opts.outboundContentPaths ? { outboundContentPaths: this.#opts.outboundContentPaths } : {}),
      now: this.#now(),
    });
  }
}
