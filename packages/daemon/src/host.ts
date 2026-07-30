// The advocate host session: core opened once, API operations as function calls.
//
// Paper: steps 1 and 12.
// Desktop packaging replaces this HTTP seam with an in-process (or IPC) call from a
// Tauri shell.
//
// Why this file exists separately from server.ts. The daemon is an HTTP surface because the
// UI runs in a browser tab that cannot open SQLite. Desktop packaging wants the same
// operations without pretending HTTP is the product. Extracting the session means the loopback
// server and a future Tauri command bridge share one implementation. The first Tauri slice
// still speaks HTTP to this host; the next slice should call these methods without a listener.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ProviderRegistry,
  openAdvocate,
  type ExchangeResult,
  type OpenedAdvocate,
} from '@aidp/core';

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
  if (env['AIDP_DESKTOP'] === '1') {
    out.push(
      'desktop packaging is a Tauri shell over the loopback daemon; the UI still talks HTTP to 127.0.0.1. Replacing that with in-process Tauri commands is the next slice',
    );
  }
  return out;
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
        warn: policy.thresholds.warn,
        block: policy.thresholds.block,
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
    return {
      sessionId: this.opened.advocate.sessionId,
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

  exportView(floor?: number) {
    return this.opened.advocate.exportView(
      '2000-01-01T00:00:00.000Z',
      new Date(Date.now() + 60_000).toISOString(),
      floor,
    );
  }
}
