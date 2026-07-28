// The flag taxonomy, versioned in the repository as data rather than as code.
//
// Paper: step 8 and Definitions. Provisional: Definitions, "Flag".
// PLAN: Phase 2, "flag taxonomy v0, versioned in the repo as data, not code".
//
// Keeping the taxonomy out of the code is not tidiness. Section 9 of the paper says the
// value judgments inside the taxonomy are an argument to be held in public, and an argument
// cannot be held over a compiled constant. A jurisdiction, a school, or a standards body
// should be able to ship a taxonomy file without shipping a build.

import { readFileSync } from 'node:fs';

export interface Criterion {
  id: string;
  description: string;
  /** JavaScript regular expression source. Applied case insensitively unless flags say otherwise. */
  pattern: string;
  flags?: string;
  /** If any of these match the candidate span, the criterion does not fire. */
  unless?: string[];
}

export interface FlagDefinition {
  type: string;
  title: string;
  definition: string;
  /** 1 to 3 at reference stage. */
  severity: number;
  criteria: Criterion[];
  /** Text that should not fire, kept beside the definition so the boundary is inspectable. */
  counterExamples?: string[];
}

export interface TaxonomyDocument {
  taxonomyVersion: string;
  status: 'current' | 'supported' | 'deprecated' | 'sunset';
  maintainer: string;
  notes?: string;
  flags: FlagDefinition[];
}

export class Taxonomy {
  readonly document: TaxonomyDocument;

  constructor(document: TaxonomyDocument) {
    this.document = document;
  }

  static loadFromFile(path: string): Taxonomy {
    return new Taxonomy(JSON.parse(readFileSync(path, 'utf8')) as TaxonomyDocument);
  }

  get version(): string {
    return this.document.taxonomyVersion;
  }

  get flags(): FlagDefinition[] {
    return this.document.flags;
  }

  severityOf(type: string): number {
    return this.document.flags.find((f) => f.type === type)?.severity ?? 1;
  }

  definition(type: string): FlagDefinition | undefined {
    return this.document.flags.find((f) => f.type === type);
  }

  /** Verdicts from a sunset build or taxonomy are inadmissible. Provisional Section 3.8. */
  get admissible(): boolean {
    return this.document.status !== 'sunset';
  }
}
