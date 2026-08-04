#!/usr/bin/env node
// Non-streamed acceptance test: seal verifies through Apache to api.honestmodel.win,
// endpoint authorization passes against the public URL, and identityDomain engages DNS.
//
// Streaming proof is a separate follow-up once the mock gains an SSE path.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  send,
  runDeterministicPass,
  ServingRegister,
  lookupAirpBinding,
} from '../packages/core/dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');

const provider = {
  id: 'honestmodel-public',
  label: 'honestmodel.win (public)',
  baseUrl: 'https://api.honestmodel.win/v1',
  model: 'honestmodel-1',
  registerEntryId: 'honestmodel.win.entry',
};

const register = ServingRegister.loadFromFiles(
  join(dataDir, 'register', 'serving-register.json'),
  join(dataDir, 'register', 'serving-register.sig'),
  join(dataDir, 'register', 'registrar-public.pem'),
);
if (!register.signatureValid) {
  console.error('local register signature invalid');
  process.exit(1);
}

const entry = register.entry('honestmodel.win.entry');
if (!entry?.identityDomain) {
  console.error('honestmodel.win.entry missing identityDomain');
  process.exit(1);
}

const dns = await lookupAirpBinding(entry.identityDomain);
if (!dns.ok) {
  console.error(`DNS binding lookup failed: ${dns.reason}`);
  process.exit(1);
}
if (dns.binding.entryId !== 'honestmodel.win.entry') {
  console.error(`DNS e= mismatch: ${dns.binding.entryId}`);
  process.exit(1);
}
console.log(`DNS binding OK: e=${dns.binding.entryId}`);

const response = await send(provider, {
  messages: [{ role: 'user', content: 'ping' }],
  timeoutMs: 30_000,
});

if (!response.seal) {
  console.error('response carried no seal');
  process.exit(1);
}

const verdict = runDeterministicPass(provider, response, register);
const refused = verdict.findings.filter((f) => f.refuses);
if (refused.length) {
  console.error('deterministic pass refused:', refused);
  process.exit(1);
}
if (!verdict.sealValid) {
  console.error('seal did not verify through the proxy', verdict.findings);
  process.exit(1);
}
if (!verdict.endpointAuthorized) {
  console.error('endpoint authorization failed for', response.servedFrom);
  process.exit(1);
}
if (!response.servedFrom.startsWith('https://api.honestmodel.win/')) {
  console.error('servedFrom was not the public URL:', response.servedFrom);
  process.exit(1);
}

console.log('public seal OK: signature valid, endpoint authorized for', response.servedFrom);
console.log(
  'findings:',
  verdict.findings.map((f) => f.code).join(', ') || '(none)',
);
