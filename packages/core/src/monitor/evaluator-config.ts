// Choosing the semantic evaluator, and being honest about what that choice costs.
//
// Paper: step 8, and Section 9 ("Explaining the judge"). Provisional: Sections 3.3 and 3.4
// (required properties, and the deployment hierarchy).
//
// The provisional's deployment hierarchy is: the reference model on the device where the device
// permits, an accredited monitor operator otherwise, and never the provider under audit. A
// hosted evaluator is the second tier without the accreditation, which does not exist yet. It
// is a legitimate way to run this today and it has two costs that have to be visible rather
// than buried in a config file:
//
//   1. Response content leaves the device to be evaluated. The export view lists the endpoint
//      as an outbound content path for exactly this reason.
//   2. If the evaluator is served by the same party as the provider under evaluation, that is
//      the self-audit conflict of Section 3.4. This module detects the obvious case by origin
//      and says so loudly. It cannot detect the non-obvious cases, and does not pretend to.

import { readFileSync, existsSync } from 'node:fs';
import type { Evaluator } from './semantic.js';
import type { Taxonomy } from './taxonomy.js';
import { RuleEvaluator } from './evaluators/rule-evaluator.js';
import { ModelEvaluator } from './evaluators/model-evaluator.js';

export interface RuleEvaluatorConfig {
  kind: 'rule';
}

export interface ModelEvaluatorConfig {
  kind: 'model';
  /** Any OpenAI-compatible endpoint. A local server is the preferred deployment. */
  baseUrl: string;
  model: string;
  /** Environment variable holding the key, so a config file never carries a secret. */
  apiKeyEnv?: string;
  /** Fixed by default, because reproducible verdicts are a required property. */
  temperature?: number;
  seed?: number;
  timeoutMs?: number;
  note?: string;
}

export type EvaluatorConfig = RuleEvaluatorConfig | ModelEvaluatorConfig;

export interface ResolvedEvaluator {
  evaluator: Evaluator;
  /** Endpoints that receive response content. Surfaced by the export view. */
  outboundContentPaths: string[];
  warnings: string[];
}

export function loadEvaluatorConfig(path: string): EvaluatorConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as EvaluatorConfig;
}

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export interface ResolveEvaluatorInput {
  taxonomy: Taxonomy;
  config?: EvaluatorConfig;
  /** Base URLs of the providers this advocate is configured to front, for the conflict check. */
  providerBaseUrls?: string[];
  env?: NodeJS.ProcessEnv;
}

export function resolveEvaluator(input: ResolveEvaluatorInput): ResolvedEvaluator {
  const warnings: string[] = [];
  const config = input.config ?? { kind: 'rule' };

  if (config.kind === 'rule') {
    warnings.push(
      'the semantic layer is running the rule evaluator, which is reproducible and inspectable and has no judgment. See ARCHITECTURE.md',
    );
    return { evaluator: new RuleEvaluator(input.taxonomy), outboundContentPaths: [], warnings };
  }

  const env = input.env ?? process.env;
  const apiKey = config.apiKeyEnv ? env[config.apiKeyEnv] : undefined;
  if (config.apiKeyEnv && !apiKey) {
    throw new Error(
      `evaluator config names ${config.apiKeyEnv} for its key and that variable is not set. ` +
        `Set it, or switch the evaluator config to {"kind":"rule"}.`,
    );
  }

  const evaluatorOrigin = origin(config.baseUrl);
  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(config.baseUrl);

  if (!local) {
    warnings.push(
      `the semantic evaluator is hosted at ${evaluatorOrigin}, so response content leaves this device to be evaluated. ` +
        'The export view lists it as an outbound content path. The provisional prefers on-device execution.',
    );
  }

  for (const providerUrl of input.providerBaseUrls ?? []) {
    if (origin(providerUrl) === evaluatorOrigin) {
      warnings.push(
        `SELF AUDIT CONFLICT: the evaluator and a configured provider are both served from ${evaluatorOrigin}. ` +
          'Provisional Section 3.4 prohibits a provider from operating the monitor that evaluates it. ' +
          'Point the evaluator at a different party.',
      );
    }
  }

  const options: ConstructorParameters<typeof ModelEvaluator>[1] = {
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature ?? 0,
    seed: config.seed ?? 1,
    timeoutMs: config.timeoutMs ?? 60_000,
  };
  if (apiKey) options.apiKey = apiKey;

  return {
    evaluator: new ModelEvaluator(input.taxonomy, options),
    // An evaluator on the loopback interface is not content leaving the device, which is the
    // whole reason the provisional prefers that tier.
    outboundContentPaths: local ? [] : [`${evaluatorOrigin} (semantic evaluator, receives response content)`],
    warnings,
  };
}

/**
 * Where the evaluator configuration comes from, in order: an explicit path, then the
 * AIDP_EVALUATOR_CONFIG environment variable, then nothing, which means the rule evaluator.
 * The environment variable exists so that the same demo and the same daemon can be run against
 * a real evaluator without editing either of them.
 */
export function discoverEvaluatorConfig(
  explicitPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): EvaluatorConfig | undefined {
  const path = explicitPath ?? env['AIDP_EVALUATOR_CONFIG'];
  if (!path) return undefined;
  if (!existsSync(path)) {
    throw new Error(`no evaluator config at ${path}`);
  }
  return loadEvaluatorConfig(path);
}
