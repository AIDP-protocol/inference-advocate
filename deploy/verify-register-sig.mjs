#!/usr/bin/env node
// Confirm the published detached signature validates serving-register.json against
// the pinned registrar public key. Spec: draft-flores-airp-provenance-00 §4.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDocument } from '../packages/core/dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const localBytes = readFileSync(join(root, 'data/register/serving-register.json'));
const localSig = readFileSync(join(root, 'data/register/serving-register.sig'), 'utf8').trim();
const pub = readFileSync(join(root, 'data/register/registrar-public.pem'), 'utf8');

if (!verifyDocument(localBytes, localSig, pub)) {
  console.error('local register signature does not verify');
  process.exit(1);
}

const docRes = await fetch('https://airegister.uk/airp/register.json');
if (!docRes.ok) {
  console.error(`register fetch HTTP ${docRes.status}`);
  process.exit(1);
}
const servedBytes = Buffer.from(await docRes.arrayBuffer());
const contentType = docRes.headers.get('content-type') ?? '';
const cors = docRes.headers.get('access-control-allow-origin') ?? '';
const encoding = docRes.headers.get('content-encoding');

if (!contentType.includes('application/json')) {
  console.error(`expected application/json, got ${contentType}`);
  process.exit(1);
}
if (cors !== '*') {
  console.error(`expected Access-Control-Allow-Origin: *, got ${cors}`);
  process.exit(1);
}
if (encoding) {
  console.error(`register must not have Content-Encoding, got ${encoding}`);
  process.exit(1);
}
if (!servedBytes.equals(localBytes)) {
  console.error('served register bytes differ from local file');
  process.exit(1);
}

const sigRes = await fetch('https://airegister.uk/airp/register.json.sig');
if (!sigRes.ok) {
  console.error(`register.sig fetch HTTP ${sigRes.status}`);
  process.exit(1);
}
const servedSig = Buffer.from(await sigRes.arrayBuffer()).toString('utf8').trim();
const sigEncoding = sigRes.headers.get('content-encoding');
if (sigEncoding) {
  console.error(`.sig must not have Content-Encoding, got ${sigEncoding}`);
  process.exit(1);
}
if (!verifyDocument(servedBytes, servedSig, pub)) {
  console.error('served register.json.sig does not verify the served document');
  process.exit(1);
}

console.log('register + .sig OK: bytes match repo, signature verifies, CORS present, no Content-Encoding');
