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
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { StoreBackend } from './store/port.js';
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
  /** Injected persistence. Constructed by the host (for example @airp/store-sqlite). */
  store: StoreBackend;
  /** Path to the providers file. Keys are read from named environment variables. */
  providersPath?: string;
  jurisdictionId?: string;
  attestations?: AttestationPackage;
  /** An evaluator instance, if you are constructing one yourself. Wins over evaluatorPath. */
  evaluator?: Evaluator;
  /**
   * Path to an evaluator config file. Falls back to the AIRP_EVALUATOR_CONFIG environment
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
  store: StoreBackend;
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
  const store = opts.store;

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
  const pending = jurisdiction.pendingProvisions();
  if (pending.length > 0) {
    warnings.push(
      `jurisdiction ${jurisdiction.ruleset.id} lists ${pending.length} pending provision(s) that are not applied as law: ` +
        pending.map((p) => p.summary).join('; ') +
        '. Delivery follows enacted (in_force) rules only',
    );
  }

  const providers = opts.providersPath ? ProviderRegistry.load(opts.providersPath) : new ProviderRegistry();

  const master = loadOrCreateMaster(store, opts.devKeyfile, warnings);

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

  const hasIdentityDomain = register.document.entries.some((e) => e.identityDomain);
  if (!hasIdentityDomain) {
    warnings.push(
      'DNS binding (_airp) and key set digest confirmation are implemented but unused: ' +
        'no register entry has identityDomain, so attributions stay unconfirmed by DNS. Spec §4.7 / §4.8',
    );
  } else if (!register.document.entries.every((e) => e.identityDomain)) {
    warnings.push(
      'DNS binding (_airp) is engaged only for register entries that set identityDomain; ' +
        'demo.* entries omit it, so their attributions stay unconfirmed by DNS. Spec §4.7 / §4.8',
    );
  }

  const advocate = new Advocate({
    store,
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

  // Reference convenience: restore a locally asserted adult/child choice from the preference
  // store. An issued attestation would replace this path entirely.
  const storedAdult = advocate.preferences.get<boolean>('attestations.isAdult');
  if (storedAdult !== undefined && storedAdult !== attestations.isAdult) {
    advocate.setIsAdult(storedAdult);
  }

  return { advocate, store, register, standing, taxonomy, policy, jurisdiction, providers, warnings };
}

function loadOrCreateMaster(store: StoreBackend, devKeyfile: string | undefined, warnings: string[]): MasterSecret {
  if (!devKeyfile) {
    warnings.push('no key material configured; using an ephemeral master secret, so this store will not reopen');
    return MasterSecret.generate();
  }
  // Basename only: the UI surfaces these warnings, and an absolute path would leak the host
  // layout on any publicly reachable advocate (the demo site, for example).
  warnings.push(
    `development key material (${basename(devKeyfile)}). This is not custody. A deployed advocate derives the master secret from a user-held passphrase or secure hardware`,
  );
  if (existsSync(devKeyfile)) {
    return MasterSecret.fromBytes(Buffer.from(readFileSync(devKeyfile, 'utf8').trim(), 'base64'));
  }
  const bytes = randomBytes(32);
  mkdirSync(join(devKeyfile, '..'), { recursive: true });
  writeFileSync(devKeyfile, bytes.toString('base64') + '\n', { mode: 0o600 });
  store.setMeta('key.created_at', new Date().toISOString());
  return MasterSecret.fromBytes(bytes);
}
