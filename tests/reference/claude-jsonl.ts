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

const NEWLINE = 0x0a;

/**
 * Stream a JSONL file one object at a time without ever holding the whole file
 * or an oversized line in memory. Never throws for bad content; a missing or
 * unreadable file yields a single issue.
 */
export async function* readJsonl(path: string, limits: JsonlLimits = DEFAULT_LIMITS): AsyncGenerator<JsonlRow> {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let oversized = false;
  let bytes = 0;
  let lines = 0;

  function* flushLine(): Generator<JsonlRow> {
    if (oversized) {
      oversized = false;
      pending = [];
      pendingBytes = 0;
      lines += 1;
      yield { kind: "issue", reason: "line_too_large" };
      return;
    }
    if (pendingBytes === 0) return;
    const line = Buffer.concat(pending, pendingBytes).toString("utf8");
    pending = [];
    pendingBytes = 0;
    if (line.trim() === "") return;
    lines += 1;
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        yield { kind: "record", value: value as Record<string, unknown> };
      } else {
        yield { kind: "issue", reason: "not_an_object" };
      }
    } catch {
      yield { kind: "issue", reason: "bad_json" };
    }
  }

  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(path, { highWaterMark: 256 * 1024 });
  } catch {
    yield { kind: "issue", reason: "unreadable" };
    return;
  }

  try {
    for await (const raw of stream) {
      let chunk = raw as Buffer;
      if (bytes + chunk.length > limits.maxBytes) {
        chunk = chunk.subarray(0, Math.max(0, limits.maxBytes - bytes));
      }
      bytes += chunk.length;
      let start = 0;
      while (start < chunk.length) {
        const end = chunk.indexOf(NEWLINE, start);
        const piece = chunk.subarray(start, end === -1 ? chunk.length : end);
        if (!oversized) {
          if (pendingBytes + piece.length > limits.maxLineBytes) {
            oversized = true;
            pending = [];
            pendingBytes = 0;
          } else if (piece.length > 0) {
            // Copy: the stream may reuse its buffer.
            pending.push(Buffer.from(piece));
            pendingBytes += piece.length;
          }
        }
        if (end === -1) break;
        yield* flushLine();
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
  yield* flushLine();
}
