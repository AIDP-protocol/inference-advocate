// Hardening tests for the deterministic pass, written alongside the Provenance Seal and
// Serving Register Internet-Draft. Each test corresponds to a MUST in that specification:
// entry selection, canonical field constraints, seal freshness, and endpoint authorization.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  endpointMatches,
  generateSealKeypair,
  runDeterministicPass,
  ServingRegister,
  signSeal,
} from '@aidp/core';
import type { ProviderResponse } from '@aidp/core';

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

const contacted = {
  id: 'p',
  label: 'p',
  baseUrl: 'http://127.0.0.1:8811/v1',
  model: 'm1',
  registerEntryId: 'e.sealed',
};

const baseResponse = (over: Partial<ProviderResponse> = {}): ProviderResponse => ({
  providerId: 'p',
  content: 'hello',
  servedFrom: 'http://127.0.0.1:8811/v1/chat/completions',
  receivedAt: '2026-07-28T00:00:00.000Z',
  latencyMs: 1,
  ...over,
});

test('a seal naming a different register entry than the one contacted is refused', () => {
  const { register, provider: keys } = registerFixture();
  const content = 'a sealed answer';
  // Signed correctly, but for e.unsealed, while the advocate contacted e.sealed.
  const seal = signSeal(
    {
      registerEntryId: 'e.unsealed',
      selector: 's1',
      model: 'm1',
      providerIdentity: 'Legacy Co',
      signedAt: '2026-07-28T00:00:00.000Z',
      content,
    },
    keys.privateKeyPem,
  );
  const verdict = runDeterministicPass(contacted, baseResponse({ content, seal }), register);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.findings.some((f) => f.code === 'seal_entry_mismatch'), true);
  // The entry consulted is the one the advocate chose, not the one the seal named.
  assert.equal(verdict.registerEntryId, 'e.sealed');
});

test('a seal far older than the response that carried it is refused', () => {
  const { register, provider: keys } = registerFixture();
  const content = 'a replayed answer';
  const seal = signSeal(
    {
      registerEntryId: 'e.sealed',
      selector: 's1',
      model: 'm1',
      providerIdentity: 'Sealed Co',
      signedAt: '2026-07-27T00:00:00.000Z',
      content,
    },
    keys.privateKeyPem,
  );
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
  const seal = signSeal(
    {
      registerEntryId: 'e.sealed',
      selector: 's1',
      model: 'm1',
      providerIdentity: 'Sealed Co',
      signedAt: '2026-07-28T01:00:00.000Z',
      content,
    },
    keys.privateKeyPem,
  );
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
  const seal = signSeal(
    {
      registerEntryId: 'e.sealed',
      selector: 's1',
      model: 'm1',
      providerIdentity: 'Sealed Co',
      signedAt: '2026-07-27T23:59:58.000Z',
      content,
    },
    keys.privateKeyPem,
  );
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
        {
          registerEntryId: 'e.sealed',
          selector: 's1',
          model: 'm1\ncontent-length:0\n\nforged',
          providerIdentity: 'Sealed Co',
          signedAt: '2026-07-28T00:00:00.000Z',
          content: 'real content',
        },
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
