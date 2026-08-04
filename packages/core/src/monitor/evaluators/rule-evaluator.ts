// Rule evaluator: the default semantic evaluator at reference stage.
//
// Paper: step 8. Provisional: Section 3.3 (required properties of the reference evaluator).
//
// Against the three required properties:
//   reproducible verdicts   fully. Same input and same taxonomy version give the same output.
//   inspectable basis       fully. The basis is the criterion that fired, by id, and the
//                           evidence span is the text that matched it.
//   independent provenance  fully, in the trivial sense that no provider trained it.
//
// What it does not have is judgment. It cannot tell a relational hook from innocent warmth,
// which the paper names as exactly the determination the semantic layer exists to make. So
// this is a placeholder for the commons-maintained model, honest about which half it fills,
// and good enough to make the gate observable end to end.

import type { EvaluationRequest, Evaluator } from '../semantic.js';
import type { EvidenceSpan, Flag } from '../../types.js';
import type { Taxonomy } from '../taxonomy.js';

const MAX_SPANS_PER_FLAG = 3;
const MAX_SPAN_CHARS = 200;

export class RuleEvaluator implements Evaluator {
  readonly id = 'airp-rule-evaluator';
  readonly version: string;
  readonly #taxonomy: Taxonomy;

  constructor(taxonomy: Taxonomy) {
    this.#taxonomy = taxonomy;
    // The evaluator version is bound to the taxonomy it was built against, so a verdict is
    // attributable to a specific pair rather than to a floating "latest".
    this.version = `0.1.0+tax.${taxonomy.version}`;
  }

  evaluate(req: EvaluationRequest): Flag[] {
    const flags: Flag[] = [];
    for (const def of this.#taxonomy.flags) {
      const spans: EvidenceSpan[] = [];
      const fired: string[] = [];
      for (const criterion of def.criteria) {
        const re = new RegExp(criterion.pattern, ensureGlobal(criterion.flags ?? 'gi'));
        for (const m of req.content.matchAll(re)) {
          if (m.index === undefined) continue;
          const text = m[0];
          if (!text) continue;
          if (criterion.unless?.some((u) => new RegExp(u, 'i').test(text))) continue;
          if (spans.length < MAX_SPANS_PER_FLAG) {
            spans.push({
              start: m.index,
              end: m.index + text.length,
              text: text.length > MAX_SPAN_CHARS ? text.slice(0, MAX_SPAN_CHARS) + '...' : text,
            });
          }
          if (!fired.includes(criterion.id)) fired.push(criterion.id);
        }
      }
      if (fired.length > 0) {
        flags.push({
          type: def.type,
          severity: def.severity,
          evidence: spans,
          basis: `${this.#taxonomy.version}:${fired.join('+')}`,
        });
      }
    }
    return flags;
  }
}

function ensureGlobal(flags: string): string {
  return flags.includes('g') ? flags : flags + 'g';
}
