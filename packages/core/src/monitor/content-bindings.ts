// Content bindings for streamed sealed responses.
//
// Spec: draft-flores-airp-provenance-00 §3.8.3, Appendix B.
// Bindings are a registry keyed by identifier. A verifier that does not hold the binding an
// entry names reports unattributed; there is no default fallback. Select on the `type` member
// of the data object, never on the SSE `event:` framing field.

export type ContentBinding = {
  id: string;
  /** Extract sealed text octets from one SSE data object. Empty array contributes nothing. */
  extract: (data: unknown) => Uint8Array;
};

const utf8 = new TextEncoder();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** OpenAI-compatible chat SSE: choices[0].delta.content when every member is present and a string. */
export const SSE_CHAT_DELTA_V1: ContentBinding = {
  id: 'sse-chat-delta-v1',
  extract(data: unknown): Uint8Array {
    const obj = asRecord(data);
    if (!obj) return new Uint8Array();
    const choices = obj.choices;
    if (!Array.isArray(choices) || choices.length === 0) return new Uint8Array();
    const choice = asRecord(choices[0]);
    if (!choice) return new Uint8Array();
    const delta = asRecord(choice.delta);
    if (!delta) return new Uint8Array();
    if (!Object.prototype.hasOwnProperty.call(delta, 'content')) return new Uint8Array();
    const content = delta.content;
    if (typeof content !== 'string') return new Uint8Array();
    return utf8.encode(content);
  },
};

/** Anthropic-style content block delta: type content_block_delta with delta.type text_delta. */
export const SSE_CONTENT_BLOCK_DELTA_V1: ContentBinding = {
  id: 'sse-content-block-delta-v1',
  extract(data: unknown): Uint8Array {
    const obj = asRecord(data);
    if (!obj) return new Uint8Array();
    if (obj.type !== 'content_block_delta') return new Uint8Array();
    const delta = asRecord(obj.delta);
    if (!delta) return new Uint8Array();
    if (delta.type !== 'text_delta') return new Uint8Array();
    if (typeof delta.text !== 'string') return new Uint8Array();
    return utf8.encode(delta.text);
  },
};

export class ContentBindingRegistry {
  readonly #byId = new Map<string, ContentBinding>();

  constructor(bindings: ContentBinding[] = [SSE_CHAT_DELTA_V1, SSE_CONTENT_BLOCK_DELTA_V1]) {
    for (const b of bindings) this.#byId.set(b.id, b);
  }

  get(id: string): ContentBinding | undefined {
    return this.#byId.get(id);
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }
}

export const defaultContentBindings = new ContentBindingRegistry();

/**
 * Accumulate sealed content from SSE data objects under a binding.
 * Events the binding does not name contribute zero octets. Concatenate in served order.
 * Spec §3.8.3.
 */
export function accumulateBoundContent(binding: ContentBinding, dataObjects: unknown[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const data of dataObjects) {
    const chunk = binding.extract(data);
    if (chunk.byteLength === 0) continue;
    parts.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export type StreamSealEvent = {
  kind: 'data' | 'terminal-seal' | 'pre-seal';
  data?: unknown;
  sealValue?: string;
};

/**
 * Walk a parsed SSE event list. Content after a terminal-seal event is refusing and must
 * not be released. At most one terminal-seal event. Spec §3.8.3.
 */
export function accumulateStream(
  binding: ContentBinding,
  events: StreamSealEvent[],
): {
  sealedContent: Uint8Array;
  terminalSealValue?: string;
  contentAfterTerminalSeal: boolean;
  multipleTerminalSeals: boolean;
} {
  const dataObjects: unknown[] = [];
  let terminalSealValue: string | undefined;
  let contentAfterTerminalSeal = false;
  let multipleTerminalSeals = false;
  let sealed = false;

  for (const event of events) {
    if (event.kind === 'terminal-seal') {
      if (sealed) multipleTerminalSeals = true;
      sealed = true;
      terminalSealValue = event.sealValue;
      continue;
    }
    if (event.kind === 'pre-seal') continue;
    if (event.kind === 'data') {
      if (sealed) {
        contentAfterTerminalSeal = true;
        continue;
      }
      if (event.data !== undefined) dataObjects.push(event.data);
    }
  }

  return {
    sealedContent: accumulateBoundContent(binding, dataObjects),
    ...(terminalSealValue !== undefined ? { terminalSealValue } : {}),
    contentAfterTerminalSeal,
    multipleTerminalSeals,
  };
}

/**
 * Parse an SSE byte stream into seal-oriented events. Spec §3.8.3.
 *
 * Content bindings select on the data object's members, never on the SSE `event:` field.
 * The `event:` field is how terminal-seal and pre-seal events are framed on the wire:
 * `event: airp-seal` / `event: airp-preseal` with `data:` holding the same base64url value
 * the AIRP-Seal header would carry on a non-streamed response. Ordinary chat chunks have no
 * event type (or an unrecognized one) and are treated as data objects when `data:` is JSON.
 * The OpenAI `[DONE]` marker ends the stream and contributes nothing.
 */
export function parseSseStream(raw: string): StreamSealEvent[] {
  const events: StreamSealEvent[] = [];
  // SSE events are separated by a blank line. Tolerate CRLF.
  const blocks = raw.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    let eventType = '';
    const dataLines: string[] = [];
    for (const line of trimmed.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        // Spec allows one leading space after the colon.
        dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
      }
      // Ignore id:, retry:, comments.
    }
    const dataText = dataLines.join('\n');
    if (dataText === '[DONE]') continue;

    if (eventType === 'airp-seal') {
      events.push({ kind: 'terminal-seal', sealValue: dataText });
      continue;
    }
    if (eventType === 'airp-preseal') {
      events.push({ kind: 'pre-seal', sealValue: dataText });
      continue;
    }

    if (!dataText) continue;
    try {
      events.push({ kind: 'data', data: JSON.parse(dataText) as unknown });
    } catch {
      // Non-JSON data that is not a known seal event contributes nothing.
    }
  }
  return events;
}
