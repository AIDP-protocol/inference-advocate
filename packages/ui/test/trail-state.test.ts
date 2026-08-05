import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBubbles,
  buildComposeBubbles,
  densityFromActivity,
  inboundVisibleCount,
  INBOUND_BUBBLES,
} from '../src/bubbles.js';
import {
  emptyTrail,
  trailAfterResult,
  trailAfterStage,
  trailIsComplete,
  trailIsHalted,
} from '../src/trail-state.js';

describe('trailAfterStage', () => {
  it('lights send on standing check', () => {
    const marks = trailAfterStage(emptyTrail(), 'checking_standing');
    assert.deepEqual(marks, ['active', 'pending', 'pending', 'pending', 'pending', 'pending']);
  });

  it('settles send and lights receive while streaming', () => {
    let marks = trailAfterStage(emptyTrail(), 'checking_standing');
    marks = trailAfterStage(marks, 'receiving');
    assert.deepEqual(marks, ['done', 'active', 'pending', 'pending', 'pending', 'pending']);
  });

  it('walks verify through deliver', () => {
    let marks = emptyTrail();
    for (const stage of [
      'checking_standing',
      'receiving',
      'verifying_seal',
      'evaluating_content',
      'resolving_delivery',
      'delivering',
    ] as const) {
      marks = trailAfterStage(marks, stage);
    }
    assert.deepEqual(marks, ['done', 'done', 'done', 'done', 'done', 'active']);
  });
});

describe('trailAfterResult', () => {
  const base = {
    decision: {
      kind: 'deliver' as const,
      score: 0,
      windowScore: 0,
      instantScore: 0,
      effectiveWarn: 4,
      effectiveBlock: 8,
      notices: [],
      rationale: [],
      standing: 'clear',
      mode: 'enforce',
    },
    deterministic: {
      passed: true,
      sealPresent: true,
      sealValid: true,
      endpointAuthorized: true,
      findings: [],
    },
    semantic: {
      flags: [],
      evaluatorId: 'demo',
      evaluatorVersion: '1',
      taxonomyVersion: '0.3.0',
    },
    timings: {
      totalMs: 100,
      providerMs: 40,
      deterministicMs: 10,
      semanticMs: 20,
      resolveMs: 5,
    },
  };

  it('marks every stage done on deliver', () => {
    const marks = trailAfterResult(
      trailAfterStage(emptyTrail(), 'delivering'),
      base,
    );
    assert.ok(trailIsComplete(marks));
    assert.equal(trailIsHalted(marks), false);
  });

  it('stops at decide on withhold and leaves deliver undecided', () => {
    const live = trailAfterStage(
      trailAfterStage(emptyTrail(), 'resolving_delivery'),
      'recording',
    );
    const marks = trailAfterResult(live, {
      ...base,
      decision: { ...base.decision, kind: 'withhold' },
    });
    assert.deepEqual(marks, ['done', 'done', 'done', 'done', 'stopped', 'pending']);
    assert.ok(trailIsHalted(marks));
  });

  it('skips evaluate and stops at decide when provenance refuses', () => {
    const live = trailAfterStage(emptyTrail(), 'resolving_delivery');
    const marks = trailAfterResult(live, {
      ...base,
      decision: { ...base.decision, kind: 'refuse' },
      deterministic: { ...base.deterministic, passed: false, sealPresent: false },
      semantic: { ...base.semantic, evaluatorId: 'none', evaluatorVersion: 'none' },
    });
    assert.deepEqual(marks, ['done', 'done', 'done', 'skipped', 'stopped', 'pending']);
  });

  it('stops at send when connection is refused before the request', () => {
    const marks = trailAfterResult(trailAfterStage(emptyTrail(), 'checking_standing'), {
      ...base,
      decision: { ...base.decision, kind: 'refuse' },
      deterministic: {
        passed: false,
        sealPresent: false,
        sealValid: false,
        endpointAuthorized: false,
        findings: [],
      },
      semantic: { ...base.semantic, evaluatorId: 'none', evaluatorVersion: 'none' },
      timings: {
        totalMs: 5,
        providerMs: 0,
        deterministicMs: 0,
        semanticMs: 0,
        resolveMs: 5,
      },
    });
    assert.deepEqual(marks, ['stopped', 'pending', 'pending', 'pending', 'pending', 'pending']);
  });
});

describe('buildBubbles', () => {
  it('scales count with density and never drops below three', () => {
    assert.equal(buildBubbles(0).length, 3);
    assert.equal(buildBubbles(1).length, 9);
    assert.ok(buildBubbles(2).length >= 9);
  });

  it('maps near-zero activity to no density', () => {
    assert.equal(densityFromActivity(0), 0);
    assert.equal(densityFromActivity(0.01), 0);
    assert.ok(densityFromActivity(0.5) > 0);
  });

  it('keeps compose bubbles to a fixed outbound set', () => {
    const a = buildComposeBubbles();
    const b = buildComposeBubbles();
    assert.equal(a.length, 4);
    assert.equal(b.length, 4);
    assert.deepEqual(a, b);
  });

  it('keeps a fixed inbound pool and only varies visible count', () => {
    assert.ok(INBOUND_BUBBLES.length >= 9);
    assert.equal(inboundVisibleCount(0), 0);
    const low = inboundVisibleCount(0.2);
    const high = inboundVisibleCount(1);
    assert.ok(low >= 3);
    assert.ok(high >= low);
    assert.ok(high <= INBOUND_BUBBLES.length);
  });
});
