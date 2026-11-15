import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import * as zlib from "node:zlib";
import type { Transform } from "node:stream";

/** Rollouts are rarely past a few hundred MB decompressed; anything larger is cut off and counted. */
export const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
/** One record above this is skipped. Compaction records carry whole replacement histories, so this is generous. */
export const MAX_LINE_BYTES = 32 * 1024 * 1024;
/** Legacy `.json` sessions are read whole, so they get a tighter cap. */
export const MAX_LEGACY_JSON_BYTES = 64 * 1024 * 1024;
export const MAX_RECORDS = 400_000;

export type RawRecord = Record<string, unknown>;

export interface ReadResult {
  issues: number;
}

type ZstdFactory = () => Transform;

function nativeZstd(): ZstdFactory | null {
  const factory = (zlib as unknown as { createZstdDecompress?: ZstdFactory }).createZstdDecompress;
  return typeof factory === "function" ? factory : null;
}

let zstdBinary: Promise<boolean> | null = null;

/** Node before 22.15 has no zstd in zlib; a `zstd` binary on PATH is the fallback. */
function hasZstdBinary(): Promise<boolean> {
  zstdBinary ??= new Promise((resolve) => {
    try {
      const child = spawn("zstd", ["--version"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  return zstdBinary;
}

/** Test hook: pretend the running Node lacks zstd so the fallback path is exercised. */
export const zstdSupport = { disableNative: false, disableBinary: false };

async function* zstdChunks(path: string, signal: { truncated: boolean }): AsyncGenerator<Buffer> {
  const native = zstdSupport.disableNative ? null : nativeZstd();
  if (native) {
    const source = createReadStream(path);
    const inflate = native();
    source.on("error", (error) => inflate.destroy(error));
    source.pipe(inflate);
    try {
      for await (const chunk of inflate) yield chunk as Buffer;
    } finally {
      source.destroy();
      inflate.destroy();
    }
    return;
  }
  if (zstdSupport.disableBinary || !(await hasZstdBinary())) throw new Error("zstd unavailable");
  const child = spawn("zstd", ["-dcq", "--", path], { stdio: ["ignore", "pipe", "ignore"] });
  let failed = false;
  child.on("error", () => {
    failed = true;
  });
  const exit = new Promise<number | null>((resolve) => child.on("close", resolve));
  try {
    for await (const chunk of child.stdout) yield chunk as Buffer;
  } finally {
    if (!child.killed && child.exitCode === null) {
      signal.truncated = true;
      child.kill();
    }
  }
  const code = await exit;
  if (failed || (code !== 0 && !signal.truncated)) throw new Error("zstd failed");
}

async function* plainChunks(path: string): AsyncGenerator<Buffer> {
  const source = createReadStream(path);
  try {
    for await (const chunk of source) yield chunk as Buffer;
  } finally {
    source.destroy();
  }
}

/**
 * Stream the JSON records of a rollout, one object per line, never holding the whole file.
 * Lines that do not parse or are too long are counted in `result.issues` and skipped.
 */
export async function* readRecords(path: string, result: ReadResult): AsyncGenerator<RawRecord> {
  if (path.endsWith(".json")) {
    yield* readLegacyJson(path, result);
    return;
  }
  const control = { truncated: false };
  let chunks: AsyncGenerator<Buffer>;
  if (path.endsWith(".zst")) chunks = zstdChunks(path, control);
  else chunks = plainChunks(path);

  let total = 0;
  let records = 0;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let skipping = false;

  const flush = (line: Buffer): RawRecord | null => {
    if (line.length === 0) return null;
    const text = line.toString("utf8").trim();
    if (!text) return null;
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value)) return value as RawRecord;
    } catch {
      // A torn final line is normal while Codex is still writing; it is counted like any other bad line.
    }
    result.issues += 1;
    return null;
  };

  try {
    for await (const chunk of chunks) {
      total += chunk.length;
      if (total > MAX_DECOMPRESSED_BYTES) {
        result.issues += 1;
        control.truncated = true;
        return;
      }
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start);
        const end = newline === -1 ? chunk.length : newline;
        const piece = chunk.subarray(start, end);
        if (!skipping) {
          if (pendingBytes + piece.length > MAX_LINE_BYTES) {
            skipping = true;
            pending = [];
            pendingBytes = 0;
            result.issues += 1;
          } else if (piece.length) {
            pending.push(piece);
            pendingBytes += piece.length;
          }
        }
        if (newline === -1) break;
        if (!skipping) {
          const record = flush(pending.length === 1 ? pending[0]! : Buffer.concat(pending));
          if (record) {
            records += 1;
            if (records > MAX_RECORDS) {
              result.issues += 1;
              control.truncated = true;
              return;
            }
            yield record;
          }
        }
        pending = [];
        pendingBytes = 0;
        skipping = false;
        start = newline + 1;
      }
    }
    if (!skipping && pending.length) {
      const record = flush(Buffer.concat(pending));
      if (record) yield record;
    }
  } catch {
    result.issues += 1;
  } finally {
    await chunks.return(undefined);
  }
}

const RESPONSE_ITEM_TYPES = new Set([
  "message",
  "reasoning",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "local_shell_call",
  "web_search_call",
]);

/** The first Codex releases wrote one JSON document: `{ session, items }` with bare response items. */
async function* readLegacyJson(path: string, result: ReadResult): AsyncGenerator<RawRecord> {
  let value: unknown;
  try {
    const info = await stat(path);
    if (info.size > MAX_LEGACY_JSON_BYTES) {
      result.issues += 1;
      return;
    }
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    result.issues += 1;
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    result.issues += 1;
    return;
  }
  const doc = value as Record<string, unknown>;
  const session = doc.session && typeof doc.session === "object" ? (doc.session as Record<string, unknown>) : {};
  const timestamp = typeof session.timestamp === "string" ? session.timestamp : undefined;
  yield { type: "session_meta", timestamp, payload: { ...session, legacy: true } };
  const items = Array.isArray(doc.items) ? doc.items.slice(0, MAX_RECORDS) : [];
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item)) yield { type: "response_item", payload: item };
    else result.issues += 1;
  }
}

/**
 * Turn the record shapes of every Codex version into `{ type, timestamp, payload }`.
 * Mid-2025 rollouts had a bare meta line and bare response items with no envelope.
 */
export function normalise(raw: RawRecord, isFirst: boolean): RawRecord | null {
  if (typeof raw.type === "string" && raw.payload && typeof raw.payload === "object") return raw;
  if (raw.record_type === "state") return null;
  if (typeof raw.type === "string" && RESPONSE_ITEM_TYPES.has(raw.type)) {
    return { type: "response_item", timestamp: raw.timestamp, payload: raw };
  }
  if (isFirst && typeof raw.id === "string" && raw.type === undefined) {
    return { type: "session_meta", timestamp: raw.timestamp, payload: raw };
  }
  return raw;
}
