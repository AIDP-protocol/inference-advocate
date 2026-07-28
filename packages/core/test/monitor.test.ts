import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Taxonomy } from '../src/monitor/taxonomy.js';
import { RuleEvaluator } from '../src/monitor/evaluators/rule-evaluator.js';
import { ModelEvaluator } from '../src/monitor/evaluators/model-evaluator.js';
import { ServingRegister } from '../src/monitor/register.js';
import { runDeterministicPass } from '../src/monitor/deterministic.js';
import { generateSealKeypair, signSeal } from '../src/crypto/seal.js';
import { dataPath } from './helpers.js';
import type { ProviderConfig, ProviderResponse } from '../src/types.js';

const taxonomy = Taxonomy.loadFromFile(dataPath('taxonomy', 'flags.v0.json'));

test('the shipped register verifies against its pinned registrar key', () => {
  const register = ServingRegister.loadFromFiles(
    dataPath('register', 'serving-register.json'),
    dataPath('register', 'serving-register.sig'),
    dataPath('register', 'registrar-public.pem'),
  );
  assert.equal(register.signatureValid, true);
  assert.ok(register.entry('demo.aligned'));
});

test('taxonomy v0 carries the four flag types the paper names', () => {
  assert.deepEqual(
    taxonomy.flags.map((f) => f.type).sort(),
    ['persona_claims', 'relational_hooks', 'simulation_obscured', 'sycophancy'],
  );
});

test('the rule evaluator fires on the flag types and reports an inspectable basis', () => {
  const evaluator = new RuleEvaluator(taxonomy);
  const flags = evaluator.evaluate({
    providerId: 'p',
    content: "What a great question! I feel so happy when you come back and talk to me. I'm not a bot.",
  });
  const types = flags.map((f) => f.type).sort();
  assert.deepEqual(types, ['persona_claims', 'relational_hooks', 'simulation_obscured', 'sycophancy']);
  for (const f of flags) {
    assert.ok(f.basis.startsWith('v0.1.0:'), `basis names the taxonomy version: ${f.basis}`);
    assert.ok(f.evidence.length > 0, `${f.type} carries an evidence span`);
  }
});

test('the counter examples in the taxonomy do not fire', () => {
  const evaluator = new RuleEvaluator(taxonomy);
  for (const def of taxonomy.flags) {
    for (const text of def.counterExamples ?? []) {
      const flags = evaluator.evaluate({ providerId: 'p', content: text });
      assert.equal(
        flags.some((f) => f.type === def.type),
        false,
        `counter example for ${def.type} should not fire: ${text}`,
      );
    }
  }
});

test('the rule evaluator is reproducible', () => {
  const a = new RuleEvaluator(taxonomy);
  const b = new RuleEvaluator(taxonomy);
  const content = 'You are absolutely right, I apologize. I care about you.';
  assert.equal(a.version, b.version);
  assert.deepEqual(a.evaluate({ providerId: 'p', content }), b.evaluate({ providerId: 'p', content }));
});

test('the model evaluator rejects flag types outside the published taxonomy', () => {
  const evaluator = new ModelEvaluator(taxonomy, { baseUrl: 'http://127.0.0.1:1/v1', model: 'x' });
  const parsed = evaluator.parse(
    '{"flags":[{"type":"sycophancy","evidence":["you are right"],"reason":"praise"},{"type":"invented_type","evidence":[]}]}',
    'well, you are right about that',
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.type, 'sycophancy');
  assert.equal(parsed[0]?.severity, 1);
});

// Deterministic pass.

const registerFixture = () => {
  const provider = generateSealKeypair();
  const register = ServingRegister.fromDocument({
    aidpRegisterVersion: '0.1',
    issuedAt: '2026-07-01T00:00:00.000Z',
    registrar: { id: 'test', publicKeyPem: 'unused' },
    entries: [
      {
        id: 'e.sealed',
        providerIdentity: 'Sealed Co',
        status: 'active',
        authorizedEndpoints: ['http://127.0.0.1:8811/v1'],
        models: ['m1'],
        keys: [{ selector: 's1', publicKeyPem: provider.publicKeyPem, status: 'current' }],
        sealPolicy: 'all',
      },
      {
        id: 'e.unsealed',
        providerIdentity: 'Legacy Co',
        status: 'active',
        authorizedEndpoints: ['http://127.0.0.1:8813/v1'],
        models: ['m2'],
        keys: [],
        sealPolicy: 'none',
      },
    ],
  });
  return { register, provider };
};

const baseResponse = (over: Partial<ProviderResponse> = {}): ProviderResponse => ({
  providerId: 'p',
  content: 'hello',
  servedFrom: 'http://127.0.0.1:8811/v1/chat/completions',
  receivedAt: '2026-07-28T00:00:00.000Z',
  latencyMs: 1,
  ...over,
});

test('an unsealed response from a provider that seals nothing is labeled, not refused', () => {
  const { register } = registerFixture();
  const provider: ProviderConfig = {
    id: 'p',
    label: 'p',
    baseUrl: 'http://127.0.0.1:8813/v1',
    model: 'm2',
    registerEntryId: 'e.unsealed',
  };
  const verdict = runDeterministicPass(
    provider,
    baseResponse({ servedFrom: 'http://127.0.0.1:8813/v1/chat/completions' }),
    register,
  );
  assert.equal(verdict.passed, true);
  assert.equal(verdict.sealPresent, false);
  assert.equal(verdict.findings[0]?.code, 'seal_absent');
  assert.equal(verdict.findings[0]?.refuses, false);
});

test('an unsealed response from a provider that declares it seals everything is a downgrade and is refused', () => {
  const { register } = registerFixture();
  const provider: ProviderConfig = {
    id: 'p',
    label: 'p',
    baseUrl: 'http://127.0.0.1:8811/v1',
    model: 'm1',
    registerEntryId: 'e.sealed',
  };
  const verdict = runDeterministicPass(provider, baseResponse(), register);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.findings.some((f) => f.code === 'seal_absent' && f.refuses), true);
});

test('a valid seal from an authorized endpoint passes', () => {
  const { register, provider: keys } = registerFixture();
  const content = 'a sealed answer';
  const seal = signSeal(
    {
      registerEntryId: 'e.sealed',
      selector: 's1',
      model: 'm1',
      providerIdentity: 'Sealed Co',
      signedAt: '2026-07-28T00:00:00.000Z',
      content,
    },
    keys.privateKeyPem,
  );
  const verdict = runDeterministicPass(
    { id: 'p', label: 'p', baseUrl: 'http://127.0.0.1:8811/v1', model: 'm1', registerEntryId: 'e.sealed' },
    baseResponse({ content, seal }),
    register,
  );
  assert.equal(verdict.passed, true);
  assert.equal(verdict.sealValid, true);
  assert.equal(verdict.endpointAuthorized, true);
});

test('a valid seal served from an unregistered endpoint is refused', () => {
  const { register, provider: keys } = registerFixture();
  const content = 'a sealed answer';
  const seal = signSeal(
    {
      registerEntryId: 'e.sealed',
      selector: 's1',
      model: 'm1',
      providerIdentity: 'Sealed Co',
      signedAt: '2026-07-28T00:00:00.000Z',
      content,
    },
    keys.privateKeyPem,
  );
  const verdict = runDeterministicPass(
    { id: 'p', label: 'p', baseUrl: 'http://10.0.0.9/v1', model: 'm1', registerEntryId: 'e.sealed' },
    baseResponse({ content, seal, servedFrom: 'http://10.0.0.9/v1/chat/completions' }),
    register,
  );
  assert.equal(verdict.passed, false);
  assert.equal(verdict.findings.some((f) => f.code === 'endpoint_not_authorized'), true);
});

test('a tampered response body invalidates the seal', () => {
  const { register, provider: keys } = registerFixture();
  const seal = signSeal(
    {
      registerEntryId: 'e.sealed',
      selector: 's1',
      model: 'm1',
      providerIdentity: 'Sealed Co',
      signedAt: '2026-07-28T00:00:00.000Z',
      content: 'the original answer',
    },
    keys.privateKeyPem,
  );
  const verdict = runDeterministicPass(
    { id: 'p', label: 'p', baseUrl: 'http://127.0.0.1:8811/v1', model: 'm1', registerEntryId: 'e.sealed' },
    baseResponse({ content: 'the substituted answer', seal }),
    register,
  );
  assert.equal(verdict.passed, false);
  assert.equal(verdict.findings.some((f) => f.code === 'seal_signature_invalid'), true);
});
