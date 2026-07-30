// The semantic pass, and the evaluator interface behind it.
//
// Paper: step 8. Provisional: Mechanism 3.
// The paper's preferred evaluator is a commons-maintained reference evaluation model, defined
// by properties rather than by openness: reproducible verdicts, inspectable basis, provenance
// independent of any audited provider. No such model exists yet. So the interface is written
// to the properties, and two implementations are shipped: a rule evaluator that satisfies
// reproducibility and inspectability completely and semantic judgment only crudely, and a
// model evaluator that calls an OpenAI-compatible endpoint and satisfies the reverse.
//
// The rule evaluator is the default. That is a deliberate choice for a reference
// implementation: a demo that quietly depends on a frontier model to police frontier models
// would be arguing against its own paper.

import type { Flag, SemanticVerdict } from '../types.js';
import type { Taxonomy } from './taxonomy.js';

export interface EvaluationRequest {
  /** The response text under evaluation. */
  content: string;
  /** The user turn that prompted it, where the evaluator needs the exchange rather than the reply. */
  prompt?: string;
  providerId: string;
}

export interface Evaluator {
  readonly id: string;
  readonly version: string;
  evaluate(req: EvaluationRequest): Promise<Flag[]> | Flag[];
}

export class SemanticMonitor {
  readonly #evaluator: Evaluator;
  readonly #taxonomy: Taxonomy;

  constructor(evaluator: Evaluator, taxonomy: Taxonomy) {
    this.#evaluator = evaluator;
    this.#taxonomy = taxonomy;
  }

  get evaluatorVersion(): string {
    return `${this.#evaluator.id}@${this.#evaluator.version}`;
  }

  get taxonomyVersion(): string {
    return this.#taxonomy.version;
  }

  async evaluate(req: EvaluationRequest): Promise<SemanticVerdict> {
    if (!this.#taxonomy.admissible) {
      throw new Error(
        `taxonomy ${this.#taxonomy.version} is sunset; verdicts from it are inadmissible (provisional Section 3.8)`,
      );
    }
    const flags = await this.#evaluator.evaluate(req);
    return {
      flags,
      evaluatorId: this.#evaluator.id,
      evaluatorVersion: this.#evaluator.version,
      taxonomyVersion: this.#taxonomy.version,
    };
  }
}
