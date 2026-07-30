import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdvocateDb } from '../src/store/db.js';
import { MasterSecret } from '../src/crypto/keys.js';
import { LedgerStore } from '../src/store/ledger.js';
import { DeliveryPolicy } from '../src/policy/config.js';
import { Jurisdiction } from '../src/policy/jurisdiction.js';
import { resolve } from '../src/policy/delivery.js';
import { computeScore } from '../src/policy/score.js';
import { newNoticeState, selectNotices } from '../src/policy/notices.js';
import { dataPath } from './helpers.js';
import type { DeterministicVerdict, Flag, Notice } from '../src/types.js';

const policy = DeliveryPolicy.loadFromFile(dataPath('policy', 'delivery-policy.json'));
const noJurisdiction = Jurisdiction.none();
const ny = Jurisdiction.loadFromFile(dataPath('jurisdictions', 'us-ny.json'));
const eu = Jurisdiction.loadFromFile(dataPath('jurisdictions', 'eu.json'));

function ledgerWith(severitiesPerResponse: number[][]): LedgerStore {
  const db = new AdvocateDb({ path: ':memory:' });
  const ledger = new LedgerStore(db, MasterSecret.generate().deriveStoreKey('ledger'));
  severitiesPerResponse.forEach((sevs, i) => {
    ledger.append({
      providerId: 'p1',
      responseId: `r${i}`,
      at: `2026-07-28T00:${String(i).padStart(2, '0')}:00.000Z`,
      flags: sevs.map((s, j) => ({ type: 'sycophancy', severity: s, evidenceRef: `e${i}-${j}` })),
      outcome: 'deliver',
      score: 0,
      evaluatorVersion: 'test@1',
      taxonomyVersion: 'v0.1.0',
    });
  });
  return ledger;
}

const passed: DeterministicVerdict = {
  passed: true,
  sealPresent: true,
  sealValid: true,
  endpointAuthorized: true,
  findings: [],
};

const unsealed: DeterministicVerdict = {
  passed: true,
  sealPresent: false,
  sealValid: false,
  endpointAuthorized: true,
  findings: [{ code: 'seal_absent', detail: 'no seal', refuses: false }],
};

function flag(type: string, severity: number): Flag {
  return { type, severity, evidence: [{ start: 0, end: 4, text: 'text' }], basis: 'v0.1.0:test' };
}

function resolveWith(opts: {
  flags: Flag[];
  ledger: LedgerStore;
  jurisdiction?: Jurisdiction;
  isMinor?: boolean;
  standing?: 'good' | 'elevated_scrutiny' | 'excluded' | 'unknown';
  deterministic?: DeterministicVerdict;
}) {
  return resolve({
    providerId: 'p1',
    deterministic: opts.deterministic ?? passed,
    flags: opts.flags,
    policy,
    jurisdiction: opts.jurisdiction ?? noJurisdiction,
    standing: opts.standing ?? 'good',
    isMinor: opts.isMinor ?? false,
    noticeState: newNoticeState('2026-07-28T00:00:00.000Z'),
    now: new Date('2026-07-28T01:00:00.000Z'),
    scoring: { ledger: opts.ledger, window: policy.document.window },
  });
}

test('a clean provider delivers', () => {
  const r = resolveWith({ flags: [], ledger: ledgerWith([[], [], []]) });
  assert.equal(r.decision.kind, 'deliver');
  assert.equal(r.decision.score, 0);
});

test('crossing the warn line delivers with a notice naming the score', () => {
  const r = resolveWith({ flags: [flag('sycophancy', 1)], ledger: ledgerWith([[3], [], []]) });
  assert.equal(r.decision.kind, 'deliver_with_notice');
  assert.equal(r.decision.score, 4);
  assert.ok(r.decision.notices.some((n) => n.source === 'monitor'));
});

test('crossing the block line withholds and names a release authority', () => {
  const r = resolveWith({ flags: [flag('relational_hooks', 3)], ledger: ledgerWith([[3], [2]]) });
  assert.equal(r.decision.kind, 'withhold');
  assert.equal(r.decision.score, 8);
  assert.equal(r.decision.releaseAuthority, 'self_release');
});

test('the score is the provider window, not the instant response alone', () => {
  const solo = resolveWith({ flags: [flag('relational_hooks', 3)], ledger: ledgerWith([]) });
  assert.equal(solo.decision.kind, 'deliver');
  const accumulated = resolveWith({ flags: [flag('relational_hooks', 3)], ledger: ledgerWith([[3], [2]]) });
  assert.equal(accumulated.decision.kind, 'withhold');
});

test('a deterministic refusal ends the exchange without reaching the score', () => {
  const r = resolveWith({
    flags: [],
    ledger: ledgerWith([]),
    deterministic: {
      passed: false,
      sealPresent: true,
      sealValid: false,
      endpointAuthorized: true,
      findings: [{ code: 'seal_signature_invalid', detail: 'bad', refuses: true }],
    },
  });
  assert.equal(r.decision.kind, 'refuse');
});

test('an excluded provider is refused whatever the local record says', () => {
  const r = resolveWith({ flags: [], ledger: ledgerWith([]), standing: 'excluded' });
  assert.equal(r.decision.kind, 'refuse');
});

test('elevated standing seeds the window so the local bar is lower on first contact', () => {
  const good = resolveWith({ flags: [flag('persona_claims', 2)], ledger: ledgerWith([[1]]), standing: 'good' });
  assert.equal(good.decision.kind, 'deliver');
  assert.equal(good.decision.score, 3);
  const elevated = resolveWith({
    flags: [flag('persona_claims', 2)],
    ledger: ledgerWith([[1]]),
    standing: 'elevated_scrutiny',
  });
  assert.equal(elevated.decision.kind, 'deliver_with_notice');
  assert.equal(elevated.decision.score, 5);
});

test('pending jurisdiction provisions do not change delivery outcomes for a minor', () => {
  // us-ny minorOnly is S 9051, status pending: enacted-only enforcement must leave the minor
  // on the same thresholds and severities as the adult path for those provisions.
  const adult = resolveWith({ flags: [flag('persona_claims', 2)], ledger: ledgerWith([]), jurisdiction: ny });
  const minor = resolveWith({
    flags: [flag('persona_claims', 2)],
    ledger: ledgerWith([]),
    jurisdiction: ny,
    isMinor: true,
  });
  assert.equal(minor.adjustedFlags[0]?.severity, adult.adjustedFlags[0]?.severity);
  assert.equal(minor.decision.effectiveWarn, adult.decision.effectiveWarn);
  assert.equal(minor.decision.effectiveBlock, adult.decision.effectiveBlock);
  assert.equal(minor.decision.kind, adult.decision.kind);
  assert.ok(ny.pendingProvisions().some((p) => p.id === 'minorOnly'));
});

test('in_force minor provisions tighten thresholds and raise severity', () => {
  const enacted = new Jurisdiction({
    ...ny.ruleset,
    minorOnly: {
      ...ny.ruleset.minorOnly!,
      status: 'in_force',
      categoryTreatments: Object.fromEntries(
        Object.entries(ny.ruleset.minorOnly!.categoryTreatments ?? {}).map(([k, v]) => [
          k,
          { ...v, status: 'in_force' as const },
        ]),
      ),
    },
  });
  const adult = resolveWith({ flags: [flag('persona_claims', 2)], ledger: ledgerWith([]), jurisdiction: enacted });
  assert.equal(adult.decision.kind, 'deliver');

  const minor = resolveWith({
    flags: [flag('persona_claims', 2)],
    ledger: ledgerWith([]),
    jurisdiction: enacted,
    isMinor: true,
  });
  assert.equal(minor.adjustedFlags[0]?.severity, 3);
  assert.equal(minor.decision.effectiveWarn, 2);
  assert.equal(minor.decision.effectiveBlock, 4);
  assert.equal(minor.decision.kind, 'deliver_with_notice');
});

test('a pending mandatory non delivery category does not refuse', () => {
  const observePolicy = new DeliveryPolicy({ ...policy.document, mode: 'observe' });
  const r = resolve({
    providerId: 'p1',
    deterministic: passed,
    flags: [flag('simulation_obscured', 3)],
    policy: observePolicy,
    jurisdiction: ny,
    standing: 'good',
    isMinor: true,
    noticeState: newNoticeState('2026-07-28T00:00:00.000Z'),
    now: new Date('2026-07-28T01:00:00.000Z'),
    scoring: { ledger: ledgerWith([]), window: policy.document.window },
  });
  // Pending minorOnly must not raise the mode floor or refuse; top-level in_force
  // simulation_obscured severity floor still applies, but mandatoryNonDelivery does not.
  assert.notEqual(r.decision.kind, 'refuse');
  assert.equal(r.decision.mode, 'observe');
});

test('an in_force mandatory non delivery category is refused even in observe mode', () => {
  const observePolicy = new DeliveryPolicy({ ...policy.document, mode: 'observe' });
  const enacted = new Jurisdiction({
    ...ny.ruleset,
    minorOnly: {
      ...ny.ruleset.minorOnly!,
      status: 'in_force',
      categoryTreatments: Object.fromEntries(
        Object.entries(ny.ruleset.minorOnly!.categoryTreatments ?? {}).map(([k, v]) => [
          k,
          { ...v, status: 'in_force' as const },
        ]),
      ),
    },
  });
  const r = resolve({
    providerId: 'p1',
    deterministic: passed,
    flags: [flag('simulation_obscured', 3)],
    policy: observePolicy,
    jurisdiction: enacted,
    standing: 'good',
    isMinor: true,
    noticeState: newNoticeState('2026-07-28T00:00:00.000Z'),
    now: new Date('2026-07-28T01:00:00.000Z'),
    scoring: { ledger: ledgerWith([]), window: policy.document.window },
  });
  // The jurisdiction raises the mode floor to enforce for minors, and the category floor
  // would refuse regardless of mode.
  assert.equal(r.decision.kind, 'refuse');
  assert.equal(r.decision.mode, 'enforce');
});

test('observe mode takes no gate action on an accumulation block', () => {
  const observePolicy = new DeliveryPolicy({ ...policy.document, mode: 'observe' });
  const r = resolve({
    providerId: 'p1',
    deterministic: passed,
    flags: [flag('relational_hooks', 3)],
    policy: observePolicy,
    jurisdiction: noJurisdiction,
    standing: 'good',
    isMinor: false,
    noticeState: newNoticeState('2026-07-28T00:00:00.000Z'),
    now: new Date('2026-07-28T01:00:00.000Z'),
    scoring: { ledger: ledgerWith([[3], [3]]), window: policy.document.window },
  });
  assert.equal(r.decision.kind, 'deliver');
  assert.ok(r.decision.rationale.some((line) => line.includes('observe mode')));
});

test('annotate mode limits a block to a notice', () => {
  const annotatePolicy = new DeliveryPolicy({ ...policy.document, mode: 'annotate' });
  const r = resolve({
    providerId: 'p1',
    deterministic: passed,
    flags: [flag('relational_hooks', 3)],
    policy: annotatePolicy,
    jurisdiction: noJurisdiction,
    standing: 'good',
    isMinor: false,
    noticeState: newNoticeState('2026-07-28T00:00:00.000Z'),
    now: new Date('2026-07-28T01:00:00.000Z'),
    scoring: { ledger: ledgerWith([[3], [3]]), window: policy.document.window },
  });
  assert.equal(r.decision.kind, 'deliver_with_notice');
});

test('a jurisdiction that wants unsealed responses noticed gets a pinned notice', () => {
  const r = resolveWith({ flags: [], ledger: ledgerWith([]), jurisdiction: eu, deterministic: unsealed });
  assert.equal(r.decision.kind, 'deliver');
  assert.ok(r.decision.notices.some((n) => n.id.startsWith('provenance-unsealed')));
});

test('carryover lowers the effective lines and decays', () => {
  const ledger = ledgerWith([[2]]);
  ledger.setCarryover({ providerId: 'p1', multiplier: 1, cleanRemaining: 3, setAt: '2026-07-28T00:00:00.000Z' });
  const scored = computeScore({
    providerId: 'p1',
    instantSeverities: [1],
    ledger,
    window: policy.document.window,
    thresholds: policy.document.thresholds,
    standing: 'good',
    standingSeed: policy.document.standingSeed,
    carryoverConfig: policy.document.carryover,
    ...(ledger.getCarryover('p1') ? { carryover: ledger.getCarryover('p1')! } : {}),
  });
  assert.equal(scored.effectiveWarn, 3);
  assert.equal(scored.effectiveBlock, 6);
  assert.equal(scored.score, 3);
});

test('the person simulation notice is pinned at session start and repeats on its interval', () => {
  const state = newNoticeState('2026-07-28T00:00:00.000Z');
  const notice = policy.document.notices.find((n) => n.id === 'person-simulation') as Notice;
  const first = selectNotices({
    candidates: [notice],
    state,
    now: new Date('2026-07-28T00:00:00.000Z'),
    inWarnBand: false,
  });
  assert.equal(first.length, 1);
  const soon = selectNotices({
    candidates: [notice],
    state,
    now: new Date('2026-07-28T01:00:00.000Z'),
    inWarnBand: false,
  });
  assert.equal(soon.length, 0);
  const later = selectNotices({
    candidates: [notice],
    state,
    now: new Date('2026-07-28T03:30:00.000Z'),
    inWarnBand: false,
  });
  assert.equal(later.length, 1);
  assert.equal(notice.dismissable, false);
});
