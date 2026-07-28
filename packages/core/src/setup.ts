// Bootstrapping an advocate from the documents in the repository's data directory.
//
// Paper: "Before the prompt: the attestation package" and step 2 (the jurisdiction ruleset is
// already loaded by the time a prompt is typed).
//
// Everything the advocate trusts arrives here as a file: the register and its pinned registrar
// key, the standing document and its pinned body key, the taxonomy, the Delivery Policy, and
// the jurisdiction ruleset. That is the shape a deployed advocate has too, with the files
// arriving over a signed channel instead of from disk.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AdvocateDb } from './store/db.js';
import { MasterSecret } from './crypto/keys.js';
import { ProviderRegistry } from './interchange/providers.js';
import { ServingRegister } from './monitor/register.js';
import { StandingRegistry } from './telemetry/standing.js';
import { Taxonomy } from './monitor/taxonomy.js';
import { SemanticMonitor, type Evaluator } from './monitor/semantic.js';
import {
  discoverEvaluatorConfig,
  resolveEvaluator,
  type EvaluatorConfig,
} from './monitor/evaluator-config.js';
import { DeliveryPolicy } from './policy/config.js';
import { Jurisdiction } from './policy/jurisdiction.js';
import { Advocate } from './advocate.js';
import type { AttestationPackage } from './types.js';

export interface SetupOptions {
  /** Directory holding taxonomy, policy, jurisdictions, register and standing documents. */
  dataDir: string;
  /** The single on-device store file. */
  storePath: string;
  /** Path to the providers file. Keys are read from named environment variables. */
  providersPath?: string;
  jurisdictionId?: string;
  attestations?: AttestationPackage;
  /** An evaluator instance, if you are constructing one yourself. Wins over evaluatorPath. */
  evaluator?: Evaluator;
  /**
   * Path to an evaluator config file. Falls back to the AIDP_EVALUATOR_CONFIG environment
   * variable, and then to the rule evaluator. See data/evaluator.example.json.
   */
  evaluatorPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /**
   * Development convenience only. A deployed advocate derives the master secret from a
   * user-held passphrase or from secure hardware; a keyfile on the same disk as the store is
   * not custody, it is a note taped to the safe. Labeled as such and used by the demo.
   */
  devKeyfile?: string;
}

export interface OpenedAdvocate {
  advocate: Advocate;
  db: AdvocateDb;
  register: ServingRegister;
  standing: StandingRegistry;
  taxonomy: Taxonomy;
  policy: DeliveryPolicy;
  jurisdiction: Jurisdiction;
  providers: ProviderRegistry;
  warnings: string[];
}

export function openAdvocate(opts: SetupOptions): OpenedAdvocate {
  const warnings: string[] = [];
  const d = opts.dataDir;

  const taxonomy = Taxonomy.loadFromFile(join(d, 'taxonomy', 'flags.v0.json'));
  const policy = DeliveryPolicy.loadFromFile(join(d, 'policy', 'delivery-policy.json'));

  const register = ServingRegister.loadFromFiles(
    join(d, 'register', 'serving-register.json'),
    join(d, 'register', 'serving-register.sig'),
    join(d, 'register', 'registrar-public.pem'),
  );
  if (!register.signatureValid) {
    warnings.push('the serving register document did not verify against the pinned registrar key');
  }

  let standing = StandingRegistry.empty();
  const standingDoc = join(d, 'standing', 'standing.json');
  if (existsSync(standingDoc)) {
    standing = StandingRegistry.loadFromFiles(
      standingDoc,
      join(d, 'standing', 'standing.sig'),
      join(d, 'standing', 'standing-body-public.pem'),
    );
    if (!standing.signatureValid) {
      warnings.push('the standing document did not verify against the pinned standing body key');
    }
  } else {
    warnings.push('no standing document loaded; every provider will be treated as unknown standing');
  }

  const jurisdictionId = opts.jurisdictionId ?? 'none';
  const jurisdictionPath = join(d, 'jurisdictions', `${jurisdictionId}.json`);
  const jurisdiction = existsSync(jurisdictionPath) ? Jurisdiction.loadFromFile(jurisdictionPath) : Jurisdiction.none();
  if (!existsSync(jurisdictionPath) && jurisdictionId !== 'none') {
    warnings.push(`no ruleset found for jurisdiction ${jurisdictionId}; running with no jurisdictional overrides`);
  }

  const providers = opts.providersPath ? ProviderRegistry.load(opts.providersPath) : new ProviderRegistry();

  const db = new AdvocateDb({ path: opts.storePath });
  const master = loadOrCreateMaster(db, opts.devKeyfile, warnings);

  let evaluator: Evaluator;
  let outboundContentPaths: string[] = [];
  if (opts.evaluator) {
    evaluator = opts.evaluator;
  } else {
    let config: EvaluatorConfig | undefined;
    try {
      config = discoverEvaluatorConfig(opts.evaluatorPath);
    } catch (err) {
      warnings.push(`${(err as Error).message}; falling back to the rule evaluator`);
    }
    const resolved = resolveEvaluator({
      taxonomy,
      ...(config ? { config } : {}),
      providerBaseUrls: providers.list().map((p) => p.baseUrl),
    });
    evaluator = resolved.evaluator;
    outboundContentPaths = resolved.outboundContentPaths;
    warnings.push(...resolved.warnings);
  }
  const monitor = new SemanticMonitor(evaluator, taxonomy);

  const attestations: AttestationPackage = opts.attestations ?? {
    isAdult: true,
    jurisdiction: jurisdictionId,
    issuer: 'unverified-local-assertion',
  };
  if (attestations.issuer === 'unverified-local-assertion') {
    warnings.push(
      'attribute attestations are locally asserted, not issued. The attestation package is an adopt-not-build slot; see ARCHITECTURE.md',
    );
  }

  const advocate = new Advocate({
    db,
    master,
    providers,
    register,
    standing,
    policy,
    jurisdiction,
    monitor,
    attestations,
    outboundContentPaths,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });

  return { advocate, db, register, standing, taxonomy, policy, jurisdiction, providers, warnings };
}

function loadOrCreateMaster(db: AdvocateDb, devKeyfile: string | undefined, warnings: string[]): MasterSecret {
  if (!devKeyfile) {
    warnings.push('no key material configured; using an ephemeral master secret, so this store will not reopen');
    return MasterSecret.generate();
  }
  warnings.push(
    `development key material at ${devKeyfile}. This is not custody. A deployed advocate derives the master secret from a user-held passphrase or secure hardware`,
  );
  if (existsSync(devKeyfile)) {
    return MasterSecret.fromBytes(Buffer.from(readFileSync(devKeyfile, 'utf8').trim(), 'base64'));
  }
  const bytes = randomBytes(32);
  mkdirSync(join(devKeyfile, '..'), { recursive: true });
  writeFileSync(devKeyfile, bytes.toString('base64') + '\n', { mode: 0o600 });
  db.setMeta('key.created_at', new Date().toISOString());
  return MasterSecret.fromBytes(bytes);
}
