import { createReadStream } from "node:fs";

export interface JsonlLimits {
  /** Stop reading after this many bytes of the file. */
  maxBytes: number;
  /** Skip (and count) any single line longer than this. */
  maxLineBytes: number;
  /** Stop after this many lines. */
  maxLines: number;
}

// Transcripts embed whole tool outputs and pasted images, so single lines of
// several MB are normal; anything far beyond that is not worth parsing.
export const DEFAULT_LIMITS: JsonlLimits = {
  maxBytes: 512 * 1024 * 1024,
  maxLineBytes: 16 * 1024 * 1024,
  maxLines: 1_000_000,
};

export type JsonlRow = { kind: "record"; value: Record<string, unknown> } | { kind: "issue"; reason: string };

/** How far a read got on its last complete line, so a later read of the same, since appended, file can carry on. */
export interface JsonlPosition {
  /** Byte offset just after the last newline read. */
  offset: number;
  /** Lines counted so far, as `maxLines` counts them. */
  lines: number;
}

/**
 * What `scanJsonl` yields: the rows and, when the file ended without hitting a limit, the position of its last
 * complete line (`at`), given just before the trailing unterminated line, if any, is parsed.
 */
export type JsonlEvent = JsonlRow | { kind: "at"; position: JsonlPosition };

export interface ScanJsonlOptions {
  /** Start here instead of at the top. */
  from?: JsonlPosition;
  /** Lines without these bytes are counted but neither decoded nor parsed. */
  marker?: Buffer;
}

const NEWLINE = 0x0a;
const CHUNK_BYTES = 1024 * 1024;

/**
 * Stream a JSONL file one object at a time without ever holding the whole file
 * or an oversized line in memory. Never throws for bad content; a missing or
 * unreadable file yields a single issue.
 */
export async function* readJsonl(path: string, limits: JsonlLimits = DEFAULT_LIMITS): AsyncGenerator<JsonlRow> {
  for await (const event of scanJsonl(path, limits)) if (event.kind !== "at") yield event;
}

/**
 * `readJsonl` plus what an incremental or usage-only reader needs. A line is decoded straight from the chunk it sits
 * in; only a line that spans chunks is joined, so a large transcript is not copied piece by piece.
 */
export async function* scanJsonl(path: string, limits: JsonlLimits = DEFAULT_LIMITS, options: ScanJsonlOptions = {}): AsyncGenerator<JsonlEvent> {
  // The start of a line begun in an earlier chunk. fs streams hand out a fresh buffer for every read, so keeping a
  // view of one is safe.
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let oversized = false;
  let bytes = options.from?.offset ?? 0;
  let lines = options.from?.lines ?? 0;
  const marker = options.marker && options.marker.length > 0 ? options.marker : null;

  function parse(line: string): JsonlRow | null {
    if (line.trim() === "") return null;
    lines += 1;
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) return { kind: "record", value: value as Record<string, unknown> };
      return { kind: "issue", reason: "not_an_object" };
    } catch {
      return { kind: "issue", reason: "bad_json" };
    }
  }

  /** A line left unparsed by the marker still counts toward `maxLines`, unless it is blank. */
  function skip(line: Buffer): null {
    for (let index = 0; index < line.length; index += 1) {
      const byte = line[index]!;
      if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0d) {
        lines += 1;
        break;
      }
    }
    return null;
  }

  /** A finished line: whatever is pending from earlier chunks, then `chunk[start, end)`. */
  function finish(chunk: Buffer, start: number, end: number): JsonlRow | null {
    if (oversized) {
      oversized = false;
      pending = [];
      pendingBytes = 0;
      lines += 1;
      return { kind: "issue", reason: "line_too_large" };
    }
    if (pendingBytes === 0) {
      if (end === start) return null;
      if (marker && chunk.subarray(start, end).indexOf(marker) === -1) return skip(chunk.subarray(start, end));
      return parse(chunk.toString("utf8", start, end));
    }
    const parts = end > start ? [...pending, chunk.subarray(start, end)] : pending;
    const whole = parts.length === 1 ? parts[0]! : Buffer.concat(parts, pendingBytes + end - start);
    pending = [];
    pendingBytes = 0;
    if (marker && whole.indexOf(marker) === -1) return skip(whole);
    return parse(whole.toString("utf8"));
  }

  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(path, { highWaterMark: CHUNK_BYTES, ...(bytes > 0 ? { start: bytes } : {}) });
  } catch {
    yield { kind: "issue", reason: "unreadable" };
    return;
  }

  let lastNewline = bytes;
  try {
    for await (const raw of stream) {
      let chunk = raw as Buffer;
      const chunkStart = bytes;
      if (bytes + chunk.length > limits.maxBytes) {
        chunk = chunk.subarray(0, Math.max(0, limits.maxBytes - bytes));
      }
      bytes += chunk.length;
      let start = 0;
      while (start < chunk.length) {
        const end = chunk.indexOf(NEWLINE, start);
        const pieceEnd = end === -1 ? chunk.length : end;
        if (!oversized && pendingBytes + (pieceEnd - start) > limits.maxLineBytes) {
          oversized = true;
          pending = [];
          pendingBytes = 0;
        }
        if (end === -1) {
          if (!oversized && pieceEnd > start) {
            pending.push(chunk.subarray(start));
            pendingBytes += pieceEnd - start;
          }
          break;
        }
        const row = finish(chunk, start, end);
        lastNewline = chunkStart + end + 1;
        if (row) yield row;
        if (lines >= limits.maxLines) {
          yield { kind: "issue", reason: "too_many_lines" };
          return;
        }
        start = end + 1;
      }
      if (bytes >= limits.maxBytes) {
        // A partial trailing line would only parse by luck; report the truncation instead.
        yield { kind: "issue", reason: "file_too_large" };
        return;
      }
    }
  } catch {
    yield { kind: "issue", reason: "unreadable" };
    return;
  } finally {
    stream.destroy();
  }
  if (!oversized) yield { kind: "at", position: { offset: lastNewline, lines } };
  const tail = finish(Buffer.alloc(0), 0, 0);
  if (tail) yield tail;
}
