// Hardening tests for the deterministic pass, written alongside the Provenance Seal and
// Serving Register Internet-Draft. Each test corresponds to a MUST in that specification:
// entry selection, canonical field constraints, seal freshness, and endpoint authorization.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeSeal,
  encodeSeal,
  endpointMatches,
  generateSealKeypair,
  HEADER_SEAL,
  HEADER_SEAL_DEPRECATED,
  HEADER_SEAL_LEGACY,
  runDeterministicPass,
  selectSealHeader,
  ServingRegister,
  signAidpSeal,
  signSeal,
  verifySeal,
} from '@airp/core';
import type { ProviderResponse } from '@airp/core';

const utf8 = new TextEncoder();

const registerFixture = () => {
  const provider = generateSealKeypair();
  const register = ServingRegister.fromDocument({
    airpRegisterVersion: '1',
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

const contacted = {
  id: 'p',
  label: 'p',
  baseUrl: 'http://127.0.0.1:8811/v1',
  model: 'm1',
  registerEntryId: 'e.sealed',
};

const EXCHANGE = 'AAAAAAAAAAAAAAAAAAAAAA';
const DIGEST = 'sha-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const baseResponse = (over: Partial<ProviderResponse> = {}): ProviderResponse => {
  const content = over.content ?? 'hello';
  const sealedContent = over.sealedContent ?? utf8.encode(content);
  return {
    providerId: 'p',
    servedFrom: 'http://127.0.0.1:8811/v1/chat/completions',
    receivedAt: '2026-07-28T00:00:00.000Z',
    latencyMs: 1,
    sealFieldName: 'airp-seal',
    exchangeId: EXCHANGE,
    requestDigest: DIGEST,
    ...over,
    content,
    sealedContent,
  };
};

function subject(over: {
  registerEntryId?: string;
  model?: string;
  providerIdentity?: string;
  signedAt?: string;
  content: string | Uint8Array;
  exchangeId?: string;
  requestDigest?: string;
}) {
  const content = typeof over.content === 'string' ? utf8.encode(over.content) : over.content;
  return {
    registerEntryId: over.registerEntryId ?? 'e.sealed',
    selector: 's1',
    model: over.model ?? 'm1',
    providerIdentity: over.providerIdentity ?? 'Sealed Co',
    exchangeId: over.exchangeId ?? EXCHANGE,
    requestDigest: over.requestDigest ?? DIGEST,
    signedAt: over.signedAt ?? '2026-07-28T00:00:00.000Z',
    content,
  };
}

test('a seal naming a different register entry than the one contacted is refused', () => {
  const { register, provider: keys } = registerFixture();
  const content = 'a sealed answer';
  const seal = signSeal(subject({ registerEntryId: 'e.unsealed', providerIdentity: 'Legacy Co', content }), keys.privateKeyPem);
  const verdict = runDeterministicPass(contacted, baseResponse({ content, seal }), register);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.findings.some((f) => f.code === 'seal_entry_mismatch'), true);
  assert.equal(verdict.registerEntryId, 'e.sealed');
});

test('a seal far older than the response that carried it is refused', () => {
  const { register, provider: keys } = registerFixture();
  const content = 'a replayed answer';
  const seal = signSeal(subject({ signedAt: '2026-07-27T00:00:00.000Z', content }), keys.privateKeyPem);
  const verdict = runDeterministicPass(
    contacted,
    baseResponse({ content, seal, receivedAt: '2026-07-28T00:00:00.000Z' }),
    register,
  );
  assert.equal(verdict.passed, false);
  assert.equal(verdict.findings.some((f) => f.code === 'seal_not_fresh'), true);
});

test('a seal dated well after receipt is refused', () => {
  const { register, provider: keys } = registerFixture();
  const content = 'a sealed answer';
  const seal = signSeal(subject({ signedAt: '2026-07-28T01:00:00.000Z', content }), keys.privateKeyPem);
  const verdict = runDeterministicPass(
    contacted,
    baseResponse({ content, seal, receivedAt: '2026-07-28T00:00:00.000Z' }),
    register,
  );
  assert.equal(verdict.passed, false);
  assert.equal(verdict.findings.some((f) => f.code === 'seal_not_fresh'), true);
});

test('a seal within the skew and age bounds still verifies', () => {
  const { register, provider: keys } = registerFixture();
  const content = 'a sealed answer';
  const seal = signSeal(subject({ signedAt: '2026-07-27T23:59:58.000Z', content }), keys.privateKeyPem);
  const verdict = runDeterministicPass(
    contacted,
    baseResponse({ content, seal, receivedAt: '2026-07-28T00:00:00.000Z' }),
    register,
  );
  assert.equal(verdict.passed, true);
  assert.equal(verdict.sealValid, true);
});

test('a seal field containing a line break cannot be signed', () => {
  const keys = generateSealKeypair();
  assert.throws(
    () =>
      signSeal(
        subject({ model: 'm1\ncontent-length:0\n\nforged', content: 'real content' }),
        keys.privateKeyPem,
      ),
    /line break/,
  );
});

test('endpoint authorization does not treat a path prefix as a segment boundary', () => {
  assert.equal(endpointMatches('https://api.example.com/v1', 'https://api.example.com/v1/chat'), true);
  assert.equal(endpointMatches('https://api.example.com/v1', 'https://api.example.com/v1'), true);
  assert.equal(endpointMatches('https://api.example.com/v1/', 'https://api.example.com/v1/chat'), true);
  assert.equal(endpointMatches('https://api.example.com/v1', 'https://api.example.com/v1evil'), false);
  assert.equal(endpointMatches('https://api.example.com/v1', 'https://api.example.com.evil.net/v1'), false);
  assert.equal(endpointMatches('https://api.example.com/v1', 'http://api.example.com/v1'), false);
  assert.equal(endpointMatches('https://api.example.com/v1', 'https://api.example.com:8443/v1'), false);
  assert.equal(endpointMatches('https://api.example.com/v1', 'https://user:pw@api.example.com/v1'), false);
  assert.equal(endpointMatches('https://api.example.com/v1', 'not a url'), false);
});

test('AIRP-Seal is preferred over legacy names, and legacy remains readable', () => {
  const keys = generateSealKeypair();
  const seal = signSeal(subject({ content: 'registered' }), keys.privateKeyPem);
  const other = signAidpSeal(
    {
      registerEntryId: 'e.sealed',
      selector: 's1',
      model: 'm1',
      providerIdentity: 'Sealed Co',
      signedAt: '2026-07-28T00:00:00.000Z',
      content: utf8.encode('deprecated'),
    },
    keys.privateKeyPem,
  );

  assert.equal(HEADER_SEAL, 'airp-seal');
  assert.equal(HEADER_SEAL_LEGACY, 'aidp-seal');
  assert.notEqual(HEADER_SEAL, HEADER_SEAL_DEPRECATED);

  const legacyOnly = selectSealHeader(new Headers({ [HEADER_SEAL_DEPRECATED]: encodeSeal(other) }));
  assert.equal(legacyOnly.fieldName, 'x-aidp-seal');
  assert.equal(decodeSeal(legacyOnly.value!)?.providerIdentity, 'Sealed Co');

  const both = selectSealHeader(
    new Headers({
      [HEADER_SEAL]: encodeSeal(seal),
      [HEADER_SEAL_DEPRECATED]: encodeSeal(other),
    }),
  );
  assert.equal(both.fieldName, 'airp-seal');
  assert.equal(both.value, encodeSeal(seal));
});

test('legacy aidp-seal/v1 verifies under a legacy field name and fails under airp-seal', () => {
  const keys = generateSealKeypair();
  const content = utf8.encode('legacy body');
  const seal = signAidpSeal(
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
  assert.equal(verifySeal(seal, content, keys.publicKeyPem, 'aidp-seal'), true);
  assert.equal(verifySeal(seal, content, keys.publicKeyPem, 'x-aidp-seal'), true);
  assert.equal(verifySeal(seal, content, keys.publicKeyPem, 'airp-seal'), false);
});

test('provider identity mismatch is refused', () => {
  const { register, provider: keys } = registerFixture();
  const content = 'a sealed answer';
  const seal = signSeal(subject({ providerIdentity: 'Wrong Co', content }), keys.privateKeyPem);
  const verdict = runDeterministicPass(contacted, baseResponse({ content, seal }), register);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.findings.some((f) => f.code === 'seal_provider_mismatch'), true);
});

test('request digest mismatch is reported without refusing attribution', () => {
  const { register, provider: keys } = registerFixture();
  const content = 'a sealed answer';
  const seal = signSeal(subject({ requestDigest: 'sha-256=deadbeef', content }), keys.privateKeyPem);
  const verdict = runDeterministicPass(
    contacted,
    baseResponse({ content, seal, requestDigest: DIGEST }),
    register,
  );
  assert.equal(verdict.passed, true);
  assert.equal(verdict.sealValid, true);
  assert.equal(verdict.findings.some((f) => f.code === 'request_modified' && !f.refuses), true);
});

test('retired key rejects only seals at or after retiredAt', () => {
  const keys = generateSealKeypair();
  const register = ServingRegister.fromDocument({
    airpRegisterVersion: '1',
    issuedAt: '2026-07-01T00:00:00.000Z',
    registrar: { id: 'test', publicKeyPem: 'unused' },
    entries: [
      {
        id: 'e.sealed',
        providerIdentity: 'Sealed Co',
        status: 'active',
        authorizedEndpoints: ['http://127.0.0.1:8811/v1'],
        models: ['m1'],
        keys: [
          {
            selector: 's1',
            publicKeyPem: keys.publicKeyPem,
            status: 'retired',
            retiredAt: '2026-07-28T00:00:00.000Z',
          },
        ],
        sealPolicy: 'all',
      },
    ],
  });
  const before = signSeal(subject({ signedAt: '2026-07-27T23:00:00.000Z', content: 'before' }), keys.privateKeyPem);
  const after = signSeal(subject({ signedAt: '2026-07-28T00:00:00.000Z', content: 'after' }), keys.privateKeyPem);

  const beforeVerdict = runDeterministicPass(
    contacted,
    baseResponse({ content: 'before', seal: before, receivedAt: '2026-07-27T23:00:01.000Z' }),
    register,
  );
  assert.equal(beforeVerdict.sealValid, true);
  assert.equal(beforeVerdict.findings.some((f) => f.code === 'seal_key_retired'), false);

  const afterVerdict = runDeterministicPass(
    contacted,
    baseResponse({ content: 'after', seal: after }),
    register,
  );
  assert.equal(afterVerdict.sealValid, false);
  assert.equal(afterVerdict.findings.some((f) => f.code === 'seal_key_retired'), true);
});

test('compromised key is unattributed even for seals predating retiredAt', () => {
  const keys = generateSealKeypair();
  const register = ServingRegister.fromDocument({
    airpRegisterVersion: '1',
    issuedAt: '2026-07-01T00:00:00.000Z',
    registrar: { id: 'test', publicKeyPem: 'unused' },
    entries: [
      {
        id: 'e.sealed',
        providerIdentity: 'Sealed Co',
        status: 'active',
        authorizedEndpoints: ['http://127.0.0.1:8811/v1'],
        models: ['m1'],
        keys: [
          {
            selector: 's1',
            publicKeyPem: keys.publicKeyPem,
            status: 'compromised',
            retiredAt: '2026-07-28T00:00:00.000Z',
          },
        ],
        sealPolicy: 'all',
      },
    ],
  });
  const seal = signSeal(subject({ signedAt: '2026-07-27T00:00:00.000Z', content: 'old' }), keys.privateKeyPem);
  const verdict = runDeterministicPass(
    contacted,
    baseResponse({ content: 'old', seal, receivedAt: '2026-07-27T00:00:01.000Z' }),
    register,
  );
  assert.equal(verdict.sealValid, false);
  assert.equal(verdict.findings.some((f) => f.code === 'seal_key_compromised'), true);
});

test('the shipped register document declares the version the specification fixes', () => {
  const register = registerFixture().register;
  assert.equal(register.document.airpRegisterVersion, '1');
});
