#!/usr/bin/env node
// Compute key set digests for register entries that set identityDomain.
//
// Spec: draft-flores-airp-provenance-00 §4.8.
// Paper: Section 4.7 / 4.8 (DNS binding confirmation).
//
// Prints the digest for each such entry and a ready-to-paste `_airp` TXT line.
// Uses the same computeKeySetDigest path the verifier uses, so the value is
// regenerable from the deployed register rather than a number someone once wrote down.
// Does not edit DNS.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeKeySetDigest, ServingRegister } from '../packages/core/dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REGISTER = join(root, 'data/register/serving-register.json');
const DEFAULT_PIN = join(root, 'data/register/registrar-public.pem');
const DEFAULT_R = 'https://airegister.uk/airp/register.json';

function usage() {
  console.error(`Usage: node tools/key-set-digest.mjs [register.json [register.sig]]

Computes §4.8 key set digests for every entry with identityDomain and prints
ready-to-paste _airp TXT lines. Defaults to data/register/serving-register.json.

Environment:
  AIRP_REGISTER_R   register URL for the r= tag (default ${DEFAULT_R})
`);
}

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  usage();
  process.exit(0);
}

const documentPath = resolve(args[0] ?? DEFAULT_REGISTER);
const sigPath = resolve(args[1] ?? documentPath.replace(/\.json$/, '.sig'));
const pinPath = DEFAULT_PIN;
const registerUrl = process.env['AIRP_REGISTER_R'] ?? DEFAULT_R;

const register = ServingRegister.loadFromFiles(documentPath, sigPath, pinPath);
if (!register.signatureValid) {
  console.error(`register signature does not verify: ${documentPath}`);
  process.exit(1);
}

const withDomain = register.entries().filter((e) => e.identityDomain);
if (withDomain.length === 0) {
  console.error('no register entry sets identityDomain; nothing to publish');
  process.exit(1);
}

console.log(`# Key set digests from ${documentPath}`);
console.log(`# Spec §4.8. Paste into Cloudflare as TXT at _airp.<identityDomain>.`);
console.log(`# TTL 300. Do not edit DNS from this tool.`);
console.log('');

let maxLen = 0;
for (const entry of withDomain) {
  const digest = computeKeySetDigest(entry);
  const domain = entry.identityDomain;
  const payload = `v=airp1; e=${entry.id}; r=${registerUrl}; p=all; k=${digest}`;
  maxLen = Math.max(maxLen, payload.length);
  console.log(`# ${entry.id}`);
  console.log(`# digest: ${digest}`);
  console.log(`# TXT character-string length: ${payload.length} (limit 255)`);
  console.log(`_airp.${domain}  TXT  "${payload}"`);
  console.log('');
}

if (maxLen > 255) {
  console.error(
    `ERROR: at least one TXT payload is ${maxLen} octets; DNS single character-string limit is 255`,
  );
  process.exit(1);
}
