#!/usr/bin/env node
// Streamed acceptance test: terminal seal verifies through Apache to api.honestmodel.win.
//
// Requests stream:true, accumulates sse-chat-delta-v1 octets, reads the terminal-seal
// event, and runs the deterministic pass. A non-streamed verify does not exercise this path.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HEADER_EXCHANGE_ID,
  HEADER_VERSION,
  AIDP_VERSION,
  SSE_CHAT_DELTA_V1,
  ServingRegister,
  accumulateStream,
  computeRequestDigest,
  decodeSeal,
  generateExchangeId,
  lookupAirpBinding,
  parseSseStream,
  runDeterministicPass,
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
if (entry.contentBinding !== 'sse-chat-delta-v1') {
  console.error(`expected contentBinding sse-chat-delta-v1, got ${entry.contentBinding}`);
  process.exit(1);
}

const dns = await lookupAirpBinding(entry.identityDomain);
if (!dns.ok || dns.binding.entryId !== 'honestmodel.win.entry') {
  console.error('DNS binding lookup failed or mismatched', dns);
  process.exit(1);
}
console.log(`DNS binding OK: e=${dns.binding.entryId}`);

const exchangeId = generateExchangeId();
const bodyText = JSON.stringify({
  model: provider.model,
  messages: [{ role: 'user', content: 'stream ping' }],
  stream: true,
});
const bodyBytes = new TextEncoder().encode(bodyText);
const requestDigest = computeRequestDigest(bodyBytes);
const url = provider.baseUrl.replace(/\/$/, '') + '/chat/completions';

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    [HEADER_VERSION]: AIDP_VERSION,
    [HEADER_EXCHANGE_ID]: exchangeId,
  },
  body: bodyText,
});

if (!res.ok) {
  console.error(`provider returned HTTP ${res.status}`);
  process.exit(1);
}

const contentType = res.headers.get('content-type') ?? '';
if (!contentType.includes('text/event-stream')) {
  console.error(`expected text/event-stream, got ${contentType}`);
  process.exit(1);
}
if (res.headers.get('content-encoding')) {
  console.error(`stream must not be content-encoded, got ${res.headers.get('content-encoding')}`);
  process.exit(1);
}

const raw = await res.text();
const events = parseSseStream(raw);
const accumulated = accumulateStream(SSE_CHAT_DELTA_V1, events);

if (accumulated.contentAfterTerminalSeal) {
  console.error('content arrived after the terminal-seal event');
  process.exit(1);
}
if (accumulated.multipleTerminalSeals) {
  console.error('more than one terminal-seal event');
  process.exit(1);
}
if (!accumulated.terminalSealValue) {
  console.error('no terminal-seal event in the stream');
  process.exit(1);
}
if (accumulated.sealedContent.byteLength === 0) {
  console.error('no sealed content octets extracted under sse-chat-delta-v1');
  process.exit(1);
}

const seal = decodeSeal(accumulated.terminalSealValue);
if (!seal) {
  console.error('terminal-seal data did not decode');
  process.exit(1);
}

const text = new TextDecoder().decode(accumulated.sealedContent);
console.log(`extracted ${accumulated.sealedContent.byteLength} sealed octets: ${JSON.stringify(text)}`);

const response = {
  providerId: provider.id,
  content: text,
  sealedContent: accumulated.sealedContent,
  exchangeId,
  requestDigest,
  servedFrom: url,
  receivedAt: new Date().toISOString(),
  latencyMs: 0,
  seal,
  sealFieldName: 'airp-seal',
};

const verdict = runDeterministicPass(provider, response, register);
const refused = verdict.findings.filter((f) => f.refuses);
if (refused.length) {
  console.error('deterministic pass refused:', refused);
  process.exit(1);
}
if (!verdict.sealValid) {
  console.error('streamed seal did not verify through the proxy', verdict.findings);
  process.exit(1);
}
if (!verdict.endpointAuthorized) {
  console.error('endpoint authorization failed for', response.servedFrom);
  process.exit(1);
}

console.log('public streamed seal OK: signature valid, endpoint authorized for', response.servedFrom);
console.log(
  'findings:',
  verdict.findings.map((f) => f.code).join(', ') || '(none)',
);
