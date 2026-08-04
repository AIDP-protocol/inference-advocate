// The advocate host session: core opened once, API operations as function calls.
//
// Paper: steps 1 and 12.
// Desktop packaging constructs HostSession in-process in the Node launcher and reaches it
// from the Tauri UI shell over host-rpc.ts (loopback NDJSON, not HTTP). The browser-tab UI
// still reaches the same methods through the loopback HTTP daemon (server.ts).
//
// Why this file exists separately from server.ts. The daemon is an HTTP surface because the
// UI runs in a browser tab that cannot open SQLite. Desktop packaging wants the same
// operations as library calls. Extracting the session means the HTTP server and the desktop
// RPC bridge share one implementation.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ProviderRegistry,
  type ExchangeResult,
  type OpenedAdvocate,
} from '@airp/core';
import { openAdvocate } from '@airp/store-sqlite';

export interface HostPaths {
  dataDir: string;
  runDir: string;
  providersPath: string;
  storePath: string;
  devKeyfile: string;
  jurisdictionId: string;
}

export interface PinnedNotice {
  notice: ExchangeResult['decision']['notices'][number];
  raisedAt: string;
}

/**
 * Gaps that belong to how the advocate is packaged, not to openAdvocate itself.
 * Surfaced the same way as core warnings so the UI does not invent a second channel.
 */
export function packagingWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  if (env['AIRP_DESKTOP'] === '1') {
    out.push(
      'desktop packaging runs HostSession in-process in the Node launcher (library calls over a loopback RPC socket into the Tauri UI shell); HostSession is not embedded inside the Tauri binary, which would need an in-process JS runtime or a Rust port of the host and store',
    );
  }
  return out;
}

/**
 * Named operations shared by the HTTP daemon and the desktop HostSession RPC bridge.
 * Keeping the method table in one place means the two seams cannot drift.
 */
export async function dispatchHostMethod(
  host: HostSession,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  switch (method) {
    case 'state':
      return host.state();
    case 'policy':
      return { markdown: host.policyMarkdown() };
    case 'transcript':
      return host.transcript();
    case 'ask':
      return host.ask(String(params['providerId'] ?? ''), String(params['text'] ?? ''));
    case 'release': {
      const actor = params['actor'] === 'custodian' ? 'custodian' : 'self';
      return host.release(
        String(params['providerId'] ?? ''),
        String(params['responseId'] ?? ''),
        actor,
      );
    }
    case 'session.new':
      return host.newSession();
    case 'attestations.set':
      return host.setIsAdult(Boolean(params['isAdult']));
    case 'reputation.reset': {
      const providerId = params['providerId'];
      return host.resetReputation(
        typeof providerId === 'string' && providerId.length > 0 ? providerId : undefined,
      );
    }
    case 'export': {
      const floor = params['floor'];
      const n =
        floor === undefined || floor === null || floor === '' ? undefined : Number(floor);
      return host.exportView(n !== undefined && Number.isFinite(n) ? n : undefined);
    }
    default:
      throw new Error(`unknown host method: ${method}`);
  }
}

export class HostSession {
  readonly opened: OpenedAdvocate;
  readonly paths: HostPaths;
  readonly pinned: PinnedNotice[] = [];
  private readonly packaging: string[];

  constructor(paths: HostPaths, packaging: string[] = packagingWarnings()) {
    this.paths = paths;
    this.packaging = packaging;
    this.opened = openAdvocate({
      dataDir: paths.dataDir,
      storePath: paths.storePath,
      providersPath: paths.providersPath,
      jurisdictionId: paths.jurisdictionId,
      devKeyfile: paths.devKeyfile,
    });
  }

  get warnings(): string[] {
    return [...this.opened.warnings, ...this.packaging];
  }

  /**
   * Re-read the provider file on every state poll. Configuration that only takes effect on
   * restart is a trap in a reference implementation people are supposed to be able to poke at.
   */
  reloadProviders(): void {
    if (!existsSync(this.paths.providersPath)) return;
    try {
      const fresh = ProviderRegistry.load(this.paths.providersPath);
      for (const p of fresh.list()) this.opened.providers.add(p);
      for (const existing of this.opened.providers.list()) {
        if (!fresh.get(existing.id)) this.opened.providers.remove(existing.id);
      }
    } catch {
      // A half-written file during an edit is not worth taking the host down for.
    }
  }

  monitorState() {
    const policy = this.opened.policy.document;
    const isMinor = !this.opened.advocate.attestations.isAdult;
    const thresholds = this.opened.jurisdiction.effectiveThresholds(policy.thresholds, isMinor);
    return this.opened.providers.list().map((p) => {
      const entries = this.opened.advocate.ledger.recent(p.id, policy.window.n ?? 10);
      const windowScore = entries.reduce((s, e) => s + e.flags.reduce((t, f) => t + f.severity, 0), 0);
      const flagCounts: Record<string, number> = {};
      for (const e of entries) for (const f of e.flags) flagCounts[f.type] = (flagCounts[f.type] ?? 0) + 1;
      const carryover = this.opened.advocate.ledger.getCarryover(p.id);
      return {
        id: p.id,
        label: p.label,
        model: p.model,
        registerEntryId: p.registerEntryId ?? null,
        standing: this.opened.advocate.standingFor(p),
        windowScore,
        windowSize: entries.length,
        warn: thresholds.warn,
        block: thresholds.block,
        flagCounts,
        carryover: carryover ? { cleanRemaining: carryover.cleanRemaining } : null,
        openBlocks: this.opened.advocate.ledger.openBlocks(p.id),
        chain: this.opened.advocate.ledger.verifyChain(p.id),
        evaluatedTotal: this.opened.advocate.ledger.recent(p.id, Number.MAX_SAFE_INTEGER).length,
      };
    });
  }

  state() {
    this.reloadProviders();
    const attestations = this.opened.advocate.attestations;
    const isMinor = !attestations.isAdult;
    const thresholds = this.opened.jurisdiction.effectiveThresholds(
      this.opened.policy.document.thresholds,
      isMinor,
    );
    return {
      sessionId: this.opened.advocate.sessionId,
      attestations: {
        isAdult: attestations.isAdult,
        jurisdiction: attestations.jurisdiction,
        issuer: attestations.issuer ?? 'unverified-local-assertion',
      },
      effectiveThresholds: thresholds,
      jurisdiction: this.opened.jurisdiction.ruleset,
      pendingProvisions: this.opened.jurisdiction.pendingProvisions(),
      policy: this.opened.policy.document,
      taxonomy: {
        version: this.opened.taxonomy.version,
        status: this.opened.taxonomy.document.status,
        flags: this.opened.taxonomy.flags.map((f) => ({
          type: f.type,
          title: f.title,
          definition: f.definition,
          severity: f.severity,
        })),
      },
      register: {
        signatureValid: this.opened.register.signatureValid,
        entries: this.opened.register.entries().length,
      },
      standing: {
        signatureValid: this.opened.standing.signatureValid,
        issuedAt: this.opened.standing.document.issuedAt,
      },
      providers: this.monitorState(),
      warnings: this.warnings,
      pinned: this.pinned,
    };
  }

  policyMarkdown(): string {
    return readFileSync(join(this.paths.dataDir, 'policy', 'delivery-policy.md'), 'utf8');
  }

  transcript() {
    return {
      sessionId: this.opened.advocate.sessionId,
      turns: this.opened.advocate.transcripts.session(this.opened.advocate.sessionId),
    };
  }

  async ask(providerId: string, text: string) {
    const result = await this.opened.advocate.ask({ providerId, text });
    const at = new Date().toISOString();
    for (const notice of result.decision.notices) {
      if (!this.pinned.some((p) => p.notice.id === notice.id)) {
        this.pinned.push({ notice, raisedAt: at });
      }
    }
    return { result, providers: this.monitorState(), pinned: this.pinned };
  }

  release(providerId: string, responseId: string, actor: 'self' | 'custodian') {
    const outcome = this.opened.advocate.release(providerId, responseId, actor);
    const content = outcome.released
      ? this.opened.advocate.withheldContent(this.opened.advocate.sessionId, responseId)
      : undefined;
    return { ...outcome, content, providers: this.monitorState() };
  }

  newSession() {
    this.pinned.length = 0;
    return { sessionId: this.opened.advocate.newSession() };
  }

  /**
   * Reference-only adult/child flip. Locally asserted, persisted in preferences, starts a new
   * session so the interaction chain matches the new attribute.
   */
  setIsAdult(isAdult: boolean) {
    const attestations = this.opened.advocate.setIsAdult(isAdult);
    const session = this.newSession();
    return {
      attestations: {
        isAdult: attestations.isAdult,
        jurisdiction: attestations.jurisdiction,
        issuer: attestations.issuer ?? 'unverified-local-assertion',
      },
      sessionId: session.sessionId,
      providers: this.monitorState(),
      effectiveThresholds: this.opened.jurisdiction.effectiveThresholds(
        this.opened.policy.document.thresholds,
        !attestations.isAdult,
      ),
    };
  }

  /**
   * Demo-only wipe of rolling scores and carryover. Omitting providerId resets every configured
   * provider. Open blocks stay open; use release for withheld content.
   */
  resetReputation(providerId?: string) {
    const ids = providerId
      ? [providerId]
      : this.opened.providers.list().map((p) => p.id);
    for (const id of ids) this.opened.advocate.resetProviderReputation(id);
    return { reset: ids, providers: this.monitorState() };
  }

  exportView(floor?: number) {
    return this.opened.advocate.exportView(
      '2000-01-01T00:00:00.000Z',
      new Date(Date.now() + 60_000).toISOString(),
      floor,
    );
  }
}
