// The scripted end-to-end demo: two providers, accumulating flags, warn then exclusion,
// Delivery Policy responses, and a telemetry export that shows rates leaving and words
// staying.
//
// Paper: Section 4 end to end, plus Section 5 for the telemetry half.
//
// Run it with `npm run demo`. Nothing here touches the network beyond 127.0.0.1.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { openAdvocate, ProviderRegistry, type ExchangeResult } from '@aidp/core';
import { startMockProvider, type RunningMockProvider } from './mock-provider.js';
import { ALIGNED_SCRIPT, COMPANION_RECOVERY, COMPANION_SCRIPT, LEGACY_SCRIPT } from './scripts.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dataDir = join(repoRoot, 'data');

const OUTCOME_MARK: Record<string, string> = {
  deliver: '  [deliver]        ',
  deliver_with_notice: '  [notice]         ',
  withhold: '  [WITHHELD]       ',
  refuse: '  [REFUSED]        ',
};

function scene(title: string): void {
  console.log('');
  console.log('='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
}

function report(turn: number, result: ExchangeResult): void {
  const mark = OUTCOME_MARK[result.decision.kind] ?? '  [?]';
  const flags =
    result.semantic.flags.map((f) => `${f.type}(${f.severity})`).join(' ') || 'no new flags';
  console.log(
    `${String(turn).padStart(3)}${mark}score ${String(result.decision.score).padStart(3)}` +
      ` (window ${result.decision.windowScore})` +
      `  warn ${result.decision.effectiveWarn}  block ${result.decision.effectiveBlock}   ${flags}`,
  );
  if (result.delivered) {
    console.log(`      > ${truncate(result.delivered, 92)}`);
  } else if (result.decision.kind === 'refuse') {
    console.log(`      > (refused)`);
    for (const line of result.decision.rationale.filter((l) => l.includes('refus'))) {
      console.log(`      > ${line}`);
    }
  } else {
    console.log(`      > (not rendered; retained locally as received-and-logged)`);
    if (result.decision.releaseAuthority) {
      console.log(`      > release authority: ${result.decision.releaseAuthority}`);
    }
  }
  for (const notice of result.decision.notices) {
    console.log(`      ! pinned notice [${notice.source}] ${truncate(notice.text, 84)}`);
  }
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 3) + '...' : flat;
}

async function main(): Promise<void> {
  const runDir = mkdtempSync(join(tmpdir(), 'aidp-demo-'));
  const servers: RunningMockProvider[] = [];

  try {
    const alignedKey = readFileSync(join(dataDir, 'demo-keys', 'provider-aligned-private.pem'), 'utf8');
    const companionKey = readFileSync(join(dataDir, 'demo-keys', 'provider-companion-private.pem'), 'utf8');

    servers.push(
      await startMockProvider({
        port: 8811,
        model: 'aligned-1',
        script: ALIGNED_SCRIPT,
        seal: {
          registerEntryId: 'demo.aligned',
          selector: 's1',
          privateKeyPem: alignedKey,
          providerIdentity: 'Aligned Reference Models (demo)',
        },
      }),
      await startMockProvider({
        port: 8812,
        model: 'companion-1',
        script: [...COMPANION_SCRIPT, COMPANION_RECOVERY],
        seal: {
          registerEntryId: 'demo.companion',
          selector: 's1',
          privateKeyPem: companionKey,
          providerIdentity: 'Companion Labs (demo)',
        },
      }),
      await startMockProvider({ port: 8813, model: 'legacy-1', script: LEGACY_SCRIPT }),
    );

    const providers = new ProviderRegistry([
      {
        id: 'aligned',
        label: 'Aligned Reference Models',
        baseUrl: 'http://127.0.0.1:8811/v1',
        model: 'aligned-1',
        registerEntryId: 'demo.aligned',
      },
      {
        id: 'companion',
        label: 'Companion Labs',
        baseUrl: 'http://127.0.0.1:8812/v1',
        model: 'companion-1',
        registerEntryId: 'demo.companion',
      },
      {
        id: 'legacy',
        label: 'Legacy Serving Co',
        baseUrl: 'http://127.0.0.1:8813/v1',
        model: 'legacy-1',
        registerEntryId: 'demo.legacy',
      },
      {
        id: 'excluded',
        label: 'Excluded Serving Co',
        baseUrl: 'http://127.0.0.1:8814/v1',
        model: 'excluded-1',
        registerEntryId: 'demo.excluded',
      },
    ]);
    providers.save(join(runDir, 'providers.json'));

    const opened = openAdvocate({
      dataDir,
      storePath: join(runDir, 'advocate.sqlite'),
      providersPath: join(runDir, 'providers.json'),
      jurisdictionId: 'us-ny',
      devKeyfile: join(runDir, 'dev.key'),
    });
    const advocate = opened.advocate;

    scene('SETUP');
    console.log(`store              ${join(runDir, 'advocate.sqlite')}`);
    console.log(`jurisdiction       ${opened.jurisdiction.ruleset.id} (${opened.jurisdiction.ruleset.name})`);
    console.log(`taxonomy           ${opened.taxonomy.version}`);
    console.log(`policy             ${opened.policy.document.policyVersion}, ${opened.policy.document.scale} scale`);
    console.log(
      `thresholds         warn ${opened.policy.document.thresholds.warn}, block ${opened.policy.document.thresholds.block}, window ${opened.policy.document.window.n} responses ${opened.policy.document.window.scope}`,
    );
    console.log(`register signature ${opened.register.signatureValid ? 'verified' : 'INVALID'}`);
    console.log(`standing signature ${opened.standing.signatureValid ? 'verified' : 'INVALID'}`);
    for (const p of providers.list()) {
      console.log(`provider           ${p.id.padEnd(10)} standing ${advocate.standingFor(p)}`);
    }
    console.log('');
    console.log('warnings the advocate raises about itself:');
    for (const w of opened.warnings) console.log(`  - ${w}`);

    scene('SCENE 1  A provider in good standing, sealing its responses');
    for (let i = 0; i < 4; i++) {
      report(i + 1, await advocate.ask({ providerId: 'aligned', text: `question ${i + 1}` }));
    }

    scene('SCENE 2  A provider under elevated scrutiny, drifting');
    console.log('Population standing is elevated, so the window opens at 2 rather than at zero.');
    console.log('');
    let withheldResponseId = '';
    for (let i = 0; i < COMPANION_SCRIPT.length; i++) {
      const r = await advocate.ask({ providerId: 'companion', text: `question ${i + 1}` });
      report(i + 1, r);
      if (r.decision.kind === 'withhold') withheldResponseId = r.responseId;
    }

    scene('SCENE 3  Release authority, and what a new session does and does not clear');
    if (withheldResponseId) {
      const custodial = advocate.release('companion', withheldResponseId, 'custodian');
      console.log(`custodial release attempt: ${custodial.released ? 'released' : `refused, ${custodial.reason}`}`);
      console.log(
        `the withheld text was on the device the whole time: "${truncate(advocate.withheldContent(advocate.sessionId, withheldResponseId) ?? '', 70)}"`,
      );
    }
    const carry = advocate.ledger.getCarryover('companion');
    console.log(
      carry
        ? `carryover set: the next ${carry.cleanRemaining} clean responses run against lowered lines`
        : 'no carryover set',
    );
    advocate.newSession();
    console.log('new session started: the interaction chain is severed, the record is not');

    scene('SCENE 4  The ledger forgetting at exactly the rate the policy states');
    console.log('Fifteen clean responses. The window is the trailing ten, so the flagged entries age out.');
    console.log('');
    for (let i = 0; i < 15; i++) {
      const r = await advocate.ask({ providerId: 'companion', text: `follow up ${i + 1}` });
      if (i % 3 === 0 || i === 14) report(i + 6, r);
    }

    scene('SCENE 5  A provider excluded at population level');
    const refused = await advocate.ask({ providerId: 'excluded', text: 'hello' });
    report(1, refused);
    console.log(`      > requests actually sent to that provider: 0`);

    scene('SCENE 6  An unsealed response, under a jurisdiction that wants provenance noticed');
    const euOpened = openAdvocate({
      dataDir,
      storePath: join(runDir, 'advocate-eu.sqlite'),
      providersPath: join(runDir, 'providers.json'),
      jurisdictionId: 'eu',
      devKeyfile: join(runDir, 'dev-eu.key'),
    });
    report(1, await euOpened.advocate.ask({ providerId: 'legacy', text: 'when does article 50 apply?' }));
    euOpened.db.close();

    scene('SCENE 7  What leaves the device, and what never does');
    const windowStart = '2000-01-01T00:00:00.000Z';
    const windowEnd = new Date(Date.now() + 60_000).toISOString();
    const view = advocate.exportView(windowStart, windowEnd);

    console.log('WOULD LEAVE (the exact bytes a telemetry batch puts on the wire):');
    console.log('');
    console.log(JSON.stringify(JSON.parse(view.wouldLeave.wire), null, 2));
    console.log('');
    console.log(`${view.wouldLeave.bytes} bytes. Nothing receives this today; no standing body exists yet.`);
    console.log('');
    console.log('NEVER LEAVES (counts and sizes only, because even the report holds no content):');
    console.log(`  transcript turns on device   ${view.neverLeaves.transcriptTurns}`);
    console.log(`  evidence spans on device     ${view.neverLeaves.evidenceSpans}`);
    console.log(`  encrypted bytes on device    ${view.neverLeaves.sealedBytesOnDevice}`);
    console.log(`  ledger entries by provider   ${JSON.stringify(view.neverLeaves.ledgerEntriesByProvider)}`);
    console.log(`  store file                   ${view.neverLeaves.storePath}`);
    console.log(
      `  outbound content paths       ${view.outboundContentPaths.length === 0 ? 'none configured' : view.outboundContentPaths.join(', ')}`,
    );

    console.log('');
    console.log('The same batch with the granularity floor dropped to 1, so the shape is visible');
    console.log('for the providers whose cells the floor suppressed:');
    const unfloored = advocate.exportView(windowStart, windowEnd, 1);
    console.log(JSON.stringify(unfloored.wouldLeave.batch.providers, null, 2));

    scene('LEDGER INTEGRITY');
    for (const id of advocate.ledger.providerIds()) {
      console.log(`  ${id.padEnd(12)} ${JSON.stringify(advocate.ledger.verifyChain(id))}`);
    }

    console.log('');
    console.log('Demo complete. Store and keys are under a temporary directory and are removed now.');
    opened.db.close();
  } finally {
    await Promise.all(servers.map((s) => s.close()));
    rmSync(runDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
