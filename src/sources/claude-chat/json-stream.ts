/**
 * Reads the elements of one large JSON array a chunk at a time, keeping only the keys a spec names. A chat
 * export is one JSON array that grows with the person's history (tens to hundreds of MB), so it is never read
 * into one string or parsed whole: each element is built on its own, with every string, array, nesting level and
 * node count capped, and handed over before the next one starts. Malformed input never throws: what cannot be
 * read is reported as an issue and reading stops at the first syntax error.
 */

/**
 * Which parts of an element to build. `true` keeps a scalar (a container in its place becomes null); an object
 * spec keeps the named keys of an object; `[spec]` keeps the items of an array. A key the spec does not name is
 * skipped without being built, so its contents never reach memory beyond the bytes being scanned.
 */
export type Spec = true | { readonly [key: string]: Spec } | readonly [Spec];

export interface JsonLimits {
  /** Input bytes read at most; reading stops there. */
  maxBytes: number;
  /** Elements handed over at most; reading stops there. */
  maxElements: number;
  /** Containers nested inside one element at most; a deeper element is skipped. */
  maxDepth: number;
  /** Bytes kept of one string; the rest is scanned and dropped. */
  maxStringBytes: number;
  /** Items kept of one array; the rest are scanned and counted in `dropped`. */
  maxArrayItems: number;
  /** Values built inside one element at most; a larger element is skipped. */
  maxNodes: number;
}

export const DEFAULT_JSON_LIMITS: JsonLimits = {
  maxBytes: 8 * 1024 * 1024 * 1024,
  maxElements: 100_000,
  maxDepth: 64,
  maxStringBytes: 16 * 1024,
  maxArrayItems: 10_000,
  maxNodes: 2_000_000,
};

export type ElementResult =
  | { kind: "element"; value: unknown; dropped: number; truncated: number }
  | { kind: "issue"; reason: "syntax" | "truncated" | "too_deep" | "too_large" | "too_many" | "byte_limit" | "not_an_array" };

const MAX_KEY_BYTES = 256;
const MAX_LITERAL_BYTES = 64;

interface Frame {
  array: boolean;
  /** What is being built, or null when this container is scanned and dropped. */
  target: unknown[] | Record<string, unknown> | null;
  spec: Spec | null;
  /** The key whose value comes next (objects). */
  key: string | null;
  /** 0: first item or close, 1: item after a comma, 2: comma or close, 3: colon, 4: value after a colon. */
  state: 0 | 1 | 2 | 3 | 4;
  items: number;
  /** Its completed values are elements to hand over. */
  emit: boolean;
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const decoder = new TextDecoder("utf-8");

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

function childSpec(spec: Spec | null, array: boolean, key: string | null): Spec | null {
  if (spec === null || spec === true) return null;
  if (array) return Array.isArray(spec) ? (spec as readonly [Spec])[0] : null;
  if (Array.isArray(spec) || key === null) return null;
  return Object.prototype.hasOwnProperty.call(spec, key) ? (spec as { readonly [key: string]: Spec })[key]! : null;
}

/**
 * A push parser: feed it chunks, collect the finished elements. The root may be the array itself or an object
 * holding it under `arrayKey` (other keys are skipped).
 */
export class ArrayElementParser {
  private readonly stack: Frame[] = [];
  private readonly out: ElementResult[] = [];
  private rootSeen = false;
  private rootDone = false;
  private dead = false;
  private bytes = 0;
  private elements = 0;
  /** Index into `stack` of the frame whose values are elements, or -1 before it opens. */
  private emitAt = -1;

  // Element bookkeeping.
  private nodes = 0;
  private dropped = 0;
  private truncated = 0;
  private broken: "too_deep" | "too_large" | null = null;

  // Lexer state.
  private inString = false;
  private escape = 0; // 0 none, 1 after backslash, 2..5 reading \u hex digits
  private hex = 0;
  private highSurrogate = -1;
  private strCollect = false;
  private strIsKey = false;
  private strCap = 0;
  private strBuf = Buffer.alloc(0);
  private strLen = 0;
  private strOver = false;
  private literal = "";
  private inLiteral = false;
  private literalKeep = false;
  /** Containers opened past `maxDepth`, scanned by depth alone. */
  private rawDepth = 0;

  constructor(
    private readonly spec: Spec,
    private readonly limits: JsonLimits = DEFAULT_JSON_LIMITS,
    private readonly arrayKey = "conversations",
  ) {}

  /** Feeds bytes; returns the elements and issues finished so far. */
  write(chunk: Uint8Array): ElementResult[] {
    if (this.dead) return this.drain();
    if (this.bytes + chunk.length > this.limits.maxBytes) {
      chunk = chunk.subarray(0, Math.max(0, this.limits.maxBytes - this.bytes));
      this.scan(chunk);
      this.bytes = this.limits.maxBytes;
      if (!this.dead) this.fail("byte_limit");
      return this.drain();
    }
    this.bytes += chunk.length;
    this.scan(chunk);
    return this.drain();
  }

  /** The input ended; reports a truncated document. */
  end(): ElementResult[] {
    if (!this.dead) {
      if (this.inLiteral) this.finishLiteral();
      if (!this.dead && (!this.rootSeen || this.stack.length > 0 || this.inString || this.rawDepth > 0)) this.fail(this.rootSeen ? "truncated" : "not_an_array");
      this.dead = true;
    }
    return this.drain();
  }

  private drain(): ElementResult[] {
    return this.out.splice(0, this.out.length);
  }

  private fail(reason: Extract<ElementResult, { kind: "issue" }>["reason"]): void {
    this.out.push({ kind: "issue", reason });
    this.dead = true;
  }

  private scan(chunk: Uint8Array): void {
    const length = chunk.length;
    for (let index = 0; index < length && !this.dead; index += 1) {
      const byte = chunk[index]!;
      if (this.inString) {
        // The hot path: plain string bytes, copied in a run until a quote or backslash.
        if (this.escape === 0) {
          let end = index;
          while (end < length) {
            const b = chunk[end]!;
            if (b === 0x22 || b === 0x5c) break;
            end += 1;
          }
          if (end > index) {
            this.appendBytes(chunk, index, end);
            index = end - 1;
            continue;
          }
          if (byte === 0x22) this.finishString();
          else this.escape = 1;
          continue;
        }
        this.escapeByte(byte);
        continue;
      }
      if (this.inLiteral) {
        if (isWhitespace(byte) || byte === 0x2c || byte === 0x5d || byte === 0x7d) {
          this.finishLiteral();
          if (this.dead) return;
        } else {
          if (this.literal.length >= MAX_LITERAL_BYTES) return this.fail("syntax");
          this.literal += String.fromCharCode(byte);
          continue;
        }
      }
      if (isWhitespace(byte)) continue;
      if (this.rawDepth > 0) {
        if (byte === 0x22) this.startString(false, false);
        else if (byte === 0x7b || byte === 0x5b) this.rawDepth += 1;
        else if (byte === 0x7d || byte === 0x5d) {
          this.rawDepth -= 1;
          if (this.rawDepth === 0) this.completeValue(null);
        }
        continue;
      }
      this.token(byte);
    }
  }

  private token(byte: number): void {
    if (this.rootDone) return;
    const frame = this.stack[this.stack.length - 1];
    if (!frame) {
      // The root value.
      if (this.rootSeen) return;
      this.rootSeen = true;
      if (byte === 0x5b) this.open(true, [this.spec], true);
      else if (byte === 0x7b) this.open(false, { [this.arrayKey]: [this.spec] }, false);
      else this.fail("not_an_array");
      return;
    }
    if (frame.array) {
      if (byte === 0x5d && (frame.state === 0 || frame.state === 2)) return this.close();
      if (frame.state === 2) {
        if (byte === 0x2c) frame.state = 1;
        else this.fail("syntax");
        return;
      }
      return this.value(byte, childSpec(frame.spec, true, null), frame);
    }
    switch (frame.state) {
      case 0:
      case 1:
        if (byte === 0x7d && frame.state === 0) return this.close();
        if (byte !== 0x22) return this.fail("syntax");
        this.startString(true, true);
        return;
      case 3:
        if (byte === 0x3a) frame.state = 4;
        else this.fail("syntax");
        return;
      case 4:
        return this.value(byte, childSpec(frame.spec, false, frame.key), frame);
      default:
        if (byte === 0x7d) return this.close();
        if (byte === 0x2c) frame.state = 1;
        else this.fail("syntax");
    }
  }

  /** A value starts in `frame`, to be built to `spec` (null: scanned and dropped). */
  private value(byte: number, spec: Spec | null, frame: Frame): void {
    const keep = spec !== null && this.broken === null && frame.target !== null && !this.overflowing(frame);
    if (byte === 0x22) {
      this.startString(false, keep && spec === true);
      return;
    }
    if (byte === 0x7b || byte === 0x5b) {
      const array = byte === 0x5b;
      const fits = keep && spec !== true && Array.isArray(spec) === array;
      // An element nests no deeper than `maxDepth` below the array it sits in.
      if (this.emitAt >= 0 && this.stack.length - this.emitAt > this.limits.maxDepth) {
        if (this.broken === null) this.broken = "too_deep";
        this.rawDepth = 1;
        return;
      }
      if (!fits) {
        // A container where a scalar or another shape was expected is scanned, then stands as null.
        this.open(array, null, false);
        return;
      }
      this.open(array, spec, false);
      return;
    }
    if ((byte >= 0x30 && byte <= 0x39) || byte === 0x2d || byte === 0x74 || byte === 0x66 || byte === 0x6e) {
      this.inLiteral = true;
      this.literal = String.fromCharCode(byte);
      this.literalKeep = keep && spec === true;
      return;
    }
    this.fail("syntax");
  }

  private overflowing(frame: Frame): boolean {
    return frame.array && !frame.emit && frame.items >= this.limits.maxArrayItems;
  }

  private open(array: boolean, spec: Spec | null, emitRoot: boolean): void {
    const parent = this.stack[this.stack.length - 1];
    const emit = emitRoot || (!array ? false : this.isElementArray(parent));
    const target = spec === null ? null : array ? [] : {};
    if (spec !== null && this.emitAt >= 0) this.node();
    this.stack.push({ array, target, spec, key: null, state: 0, items: 0, emit });
    if (emit) this.emitAt = this.stack.length - 1;
    if (this.stack.length - 1 === this.emitAt + 1 && this.emitAt >= 0 && !emit) this.startElement();
  }

  /** The root object's `arrayKey` array holds the elements. */
  private isElementArray(parent: Frame | undefined): boolean {
    return parent !== undefined && this.stack.length === 1 && !parent.array && parent.key === this.arrayKey && this.emitAt < 0;
  }

  private startElement(): void {
    this.nodes = 0;
    this.dropped = 0;
    this.truncated = 0;
    this.broken = null;
  }

  private node(): void {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes && this.broken === null) this.broken = "too_large";
  }

  private close(): void {
    const frame = this.stack.pop()!;
    if (frame.emit) {
      this.emitAt = -1;
      if (this.stack.length === 0) {
        this.rootDone = true;
        return;
      }
    }
    if (this.stack.length === 0) {
      this.rootDone = true;
      return;
    }
    this.completeValue(frame.target);
  }

  /** A value finished: hand it to the frame it belongs to. */
  private completeValue(value: unknown): void {
    const frame = this.stack[this.stack.length - 1];
    if (!frame) return;
    if (frame.array) {
      if (frame.emit) this.emitElement(value);
      else if (frame.target !== null) {
        if (frame.items < this.limits.maxArrayItems) (frame.target as unknown[]).push(value);
        else this.dropped += 1;
      }
      frame.items += 1;
    } else if (frame.target !== null && frame.key !== null && childSpec(frame.spec, false, frame.key) !== null) {
      (frame.target as Record<string, unknown>)[frame.key] = value;
    }
    frame.state = 2;
  }

  private emitElement(value: unknown): void {
    if (this.broken !== null) this.out.push({ kind: "issue", reason: this.broken });
    else if (value !== null && typeof value === "object") this.out.push({ kind: "element", value, dropped: this.dropped, truncated: this.truncated });
    this.startElement();
    this.elements += 1;
    if (this.elements >= this.limits.maxElements) this.fail("too_many");
  }

  // -- strings ------------------------------------------------------------------

  private startString(isKey: boolean, collect: boolean): void {
    this.inString = true;
    this.escape = 0;
    this.highSurrogate = -1;
    this.strIsKey = isKey;
    this.strCollect = isKey || collect;
    this.strCap = isKey ? MAX_KEY_BYTES : this.limits.maxStringBytes;
    this.strLen = 0;
    this.strOver = false;
    if (this.strCollect && this.strBuf.length < this.strCap + 4) this.strBuf = Buffer.alloc(this.strCap + 4);
  }

  private appendBytes(chunk: Uint8Array, start: number, end: number): void {
    if (!this.strCollect || this.strOver) return;
    const room = this.strCap - this.strLen;
    const take = Math.min(room, end - start);
    if (take > 0) {
      this.strBuf.set(chunk.subarray(start, start + take), this.strLen);
      this.strLen += take;
    }
    if (end - start > take) this.strOver = true;
  }

  private appendCodePoint(code: number): void {
    if (!this.strCollect || this.strOver) return;
    const text = String.fromCodePoint(code);
    const bytes = Buffer.from(text, "utf8");
    if (this.strLen + bytes.length > this.strCap) {
      this.strOver = true;
      return;
    }
    bytes.copy(this.strBuf, this.strLen);
    this.strLen += bytes.length;
  }

  private escapeByte(byte: number): void {
    if (this.escape === 1) {
      const simple: Record<number, number> = { 0x22: 0x22, 0x5c: 0x5c, 0x2f: 0x2f, 0x62: 0x08, 0x66: 0x0c, 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09 };
      if (byte === 0x75) {
        this.escape = 2;
        this.hex = 0;
        return;
      }
      const mapped = simple[byte];
      if (mapped === undefined) return this.fail("syntax");
      this.flushSurrogate();
      this.appendCodePoint(mapped);
      this.escape = 0;
      return;
    }
    const digit = byte >= 0x30 && byte <= 0x39 ? byte - 0x30 : byte >= 0x61 && byte <= 0x66 ? byte - 0x57 : byte >= 0x41 && byte <= 0x46 ? byte - 0x37 : -1;
    if (digit < 0) return this.fail("syntax");
    this.hex = this.hex * 16 + digit;
    this.escape += 1;
    if (this.escape < 6) return;
    this.escape = 0;
    const code = this.hex;
    if (code >= 0xd800 && code <= 0xdbff) {
      this.flushSurrogate();
      this.highSurrogate = code;
    } else if (code >= 0xdc00 && code <= 0xdfff && this.highSurrogate >= 0) {
      this.appendCodePoint(0x10000 + ((this.highSurrogate - 0xd800) << 10) + (code - 0xdc00));
      this.highSurrogate = -1;
    } else {
      this.flushSurrogate();
      this.appendCodePoint(code >= 0xd800 && code <= 0xdfff ? 0xfffd : code);
    }
  }

  private flushSurrogate(): void {
    if (this.highSurrogate >= 0) this.appendCodePoint(0xfffd);
    this.highSurrogate = -1;
  }

  private finishString(): void {
    this.flushSurrogate();
    this.inString = false;
    if (this.rawDepth > 0) return;
    const text = this.strCollect ? decoder.decode(this.strBuf.subarray(0, this.strLen)) : null;
    if (this.strIsKey) {
      const frame = this.stack[this.stack.length - 1]!;
      frame.key = text;
      frame.state = 3;
      return;
    }
    if (this.strCollect) {
      this.node();
      if (this.strOver) this.truncated += 1;
    }
    this.completeValue(text);
  }

  private finishLiteral(): void {
    this.inLiteral = false;
    const text = this.literal;
    this.literal = "";
    let value: unknown;
    if (text === "true") value = true;
    else if (text === "false") value = false;
    else if (text === "null") value = null;
    else if (NUMBER.test(text)) value = Number(text);
    else return this.fail("syntax");
    if (this.rawDepth > 0) return;
    if (this.literalKeep) this.node();
    this.completeValue(this.literalKeep ? value : null);
  }
}

/** Every element of the array in `chunks`, one at a time, with the issues met on the way. Never throws. */
export async function* readArrayElements(
  chunks: AsyncIterable<Uint8Array>,
  spec: Spec,
  limits: Partial<JsonLimits> = {},
): AsyncGenerator<ElementResult> {
  const parser = new ArrayElementParser(spec, { ...DEFAULT_JSON_LIMITS, ...limits });
  try {
    for await (const chunk of chunks) {
      for (const result of parser.write(chunk)) yield result;
    }
  } catch {
    // A read error mid-stream (a truncated zip, a vanished file) ends the document where it stopped.
    yield { kind: "issue", reason: "truncated" };
    return;
  }
  for (const result of parser.end()) yield result;
}
