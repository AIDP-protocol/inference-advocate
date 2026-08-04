// Strict JSON parse that rejects duplicate member names.
//
// Spec: draft-flores-airp-provenance-00 §3.8. JSON.parse silently keeps the last occurrence,
// so duplicate detection has to happen during parse, not after.

export class DuplicateJsonMemberError extends Error {
  constructor(member: string) {
    super(`duplicate JSON member name: ${member}`);
    this.name = 'DuplicateJsonMemberError';
  }
}

export function parseJsonNoDuplicates(text: string): unknown {
  let i = 0;

  function skipWs(): void {
    while (i < text.length && /[ \t\r\n]/.test(text[i]!)) i += 1;
  }

  function fail(msg: string): never {
    throw new SyntaxError(`${msg} at ${i}`);
  }

  function parseString(): string {
    if (text[i] !== '"') fail('expected string');
    i += 1;
    let out = '';
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"') {
        i += 1;
        return out;
      }
      if (c === '\\') {
        i += 1;
        const e = text[i];
        if (e === undefined) fail('truncated escape');
        const map: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        };
        if (e === 'u') {
          const hex = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad unicode escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
          continue;
        }
        if (!(e in map)) fail('bad escape');
        out += map[e]!;
        i += 1;
        continue;
      }
      if (c.charCodeAt(0) < 0x20) fail('control character in string');
      out += c;
      i += 1;
    }
    fail('unterminated string');
  }

  function parseNumber(): number {
    const start = i;
    if (text[i] === '-') i += 1;
    if (text[i] === '0') {
      i += 1;
    } else if (text[i] !== undefined && /[1-9]/.test(text[i]!)) {
      i += 1;
      while (text[i] !== undefined && /[0-9]/.test(text[i]!)) i += 1;
    } else fail('expected number');
    if (text[i] === '.') {
      i += 1;
      if (text[i] === undefined || !/[0-9]/.test(text[i]!)) fail('expected fraction digit');
      while (text[i] !== undefined && /[0-9]/.test(text[i]!)) i += 1;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i += 1;
      if (text[i] === '+' || text[i] === '-') i += 1;
      if (text[i] === undefined || !/[0-9]/.test(text[i]!)) fail('expected exponent digit');
      while (text[i] !== undefined && /[0-9]/.test(text[i]!)) i += 1;
    }
    return Number(text.slice(start, i));
  }

  function parseValue(): unknown {
    skipWs();
    const c = text[i];
    if (c === undefined) fail('unexpected end');
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    if (c === 't') {
      if (text.slice(i, i + 4) !== 'true') fail('expected true');
      i += 4;
      return true;
    }
    if (c === 'f') {
      if (text.slice(i, i + 5) !== 'false') fail('expected false');
      i += 5;
      return false;
    }
    if (c === 'n') {
      if (text.slice(i, i + 4) !== 'null') fail('expected null');
      i += 4;
      return null;
    }
    if (c === '-' || /[0-9]/.test(c)) return parseNumber();
    fail('unexpected character');
  }

  function parseObject(): Record<string, unknown> {
    i += 1;
    skipWs();
    const obj: Record<string, unknown> = {};
    const seen = new Set<string>();
    if (text[i] === '}') {
      i += 1;
      return obj;
    }
    for (;;) {
      skipWs();
      const key = parseString();
      if (seen.has(key)) throw new DuplicateJsonMemberError(key);
      seen.add(key);
      skipWs();
      if (text[i] !== ':') fail('expected colon');
      i += 1;
      obj[key] = parseValue();
      skipWs();
      if (text[i] === '}') {
        i += 1;
        return obj;
      }
      if (text[i] !== ',') fail('expected comma or }');
      i += 1;
    }
  }

  function parseArray(): unknown[] {
    i += 1;
    skipWs();
    const arr: unknown[] = [];
    if (text[i] === ']') {
      i += 1;
      return arr;
    }
    for (;;) {
      arr.push(parseValue());
      skipWs();
      if (text[i] === ']') {
        i += 1;
        return arr;
      }
      if (text[i] !== ',') fail('expected comma or ]');
      i += 1;
    }
  }

  const value = parseValue();
  skipWs();
  if (i !== text.length) fail('trailing content');
  return value;
}
