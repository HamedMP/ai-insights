import { createHash } from "node:crypto";
import { lstat, open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Checkpoints, ParseCheckpoint } from "../sources/claude/parse.js";
import { MAX_STORE_FILE_BYTES, readJsonFile, writeFileAtomic } from "./fs.js";

/**
 * Checkpoints for append-only transcripts, under `<home>/tail/<harness>/`. A checkpoint is used only while the
 * transcript is the same file (device and inode) and still starts with exactly the bytes it was made from: the
 * first and the last 64 KiB before the checkpoint are hashed. A truncated, rewritten or replaced transcript fails
 * that check and is read from the top.
 */

const FORMAT = 1;
const WINDOW_BYTES = 64 * 1024;
/** A checkpoint bigger than this is not worth writing; the store would refuse to read it back anyway. */
const MAX_STATE_CHARS = MAX_STORE_FILE_BYTES - 1024 * 1024;
/** A team session keeps one log per subagent file, so the cap is per file, not per session. */
export const MAX_TAIL_ENTRIES = 2048;
/** All checkpoints together, at most; the oldest go first. */
export const MAX_TAIL_BYTES = 512 * 1024 * 1024;
export const TAIL_TTL_MS = 30 * 86_400_000;
/** Transcripts smaller than this re-read faster than a checkpoint loads. */
export const DEFAULT_TAIL_MIN_BYTES = 4 * 1024 * 1024;

interface Identity {
  dev: string;
  ino: string;
  size: number;
}

async function identity(path: string): Promise<Identity | null> {
  try {
    const info = await stat(path, { bigint: true });
    if (!info.isFile()) return null;
    return { dev: String(info.dev), ino: String(info.ino), size: Number(info.size) };
  } catch {
    return null;
  }
}

/** A hash of the bytes a checkpoint at `offset` was made from: the first and last windows before it. */
async function fingerprint(path: string, offset: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, "r");
    const hash = createHash("sha256").update(String(offset));
    const head = Buffer.alloc(Math.min(WINDOW_BYTES, offset));
    const headRead = await handle.read(head, 0, head.length, 0);
    if (headRead.bytesRead !== head.length) return null;
    hash.update(head);
    const tailStart = Math.max(head.length, offset - WINDOW_BYTES);
    const tail = Buffer.alloc(offset - tailStart);
    const tailRead = await handle.read(tail, 0, tail.length, tailStart);
    if (tailRead.bytesRead !== tail.length) return null;
    return hash.update(tail).digest("hex");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export class TailCheckpoints implements Checkpoints {
  readonly dir: string;
  readonly minBytes: number;
  private readonly read: boolean;
  private readonly now: () => number;
  private pruned = false;

  /** `read: false` makes every load miss (a `--refresh` run) while still saving fresh checkpoints. */
  constructor(dir: string, options: { minBytes?: number; read?: boolean; now?: () => number } = {}) {
    this.dir = dir;
    this.minBytes = Math.max(0, options.minBytes ?? DEFAULT_TAIL_MIN_BYTES);
    this.read = options.read ?? true;
    this.now = options.now ?? Date.now;
  }

  private fileFor(path: string): string {
    return join(this.dir, `${createHash("sha256").update(path).digest("hex").slice(0, 40)}.json`);
  }

  async load(path: string, key: string): Promise<ParseCheckpoint | null> {
    if (!this.read) return null;
    const raw = await readJsonFile(this.fileFor(path));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const saved = raw as Record<string, unknown>;
    const offset = saved.offset;
    const lines = saved.lines;
    if (saved.format !== FORMAT || saved.path !== path || saved.key !== key || typeof saved.state !== "string") return null;
    if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset <= 0 || typeof lines !== "number" || !Number.isSafeInteger(lines) || lines < 0) return null;
    const now = await identity(path);
    if (!now || now.dev !== saved.dev || now.ino !== saved.ino || now.size < offset) return null;
    if ((await fingerprint(path, offset)) !== saved.fingerprint) return null;
    return { position: { offset, lines }, state: saved.state };
  }

  async save(path: string, key: string, checkpoint: ParseCheckpoint, minBytes = this.minBytes): Promise<void> {
    const { offset, lines } = checkpoint.position;
    if (offset < minBytes || checkpoint.state.length > MAX_STATE_CHARS) return;
    const before = await identity(path);
    if (!before || before.size < offset) return;
    const print = await fingerprint(path, offset);
    const after = await identity(path);
    // Replaced while we looked: the bytes hashed may not be the ones parsed.
    if (!print || !after || after.ino !== before.ino || after.dev !== before.dev || after.size < offset) return;
    const body = JSON.stringify({ format: FORMAT, path, key, dev: before.dev, ino: before.ino, offset, lines, fingerprint: print, savedAtMs: this.now(), state: checkpoint.state });
    await writeFileAtomic(this.fileFor(path), body);
    await this.prune();
  }

  /** Keeps the folder bounded: drops checkpoints past their TTL, then the oldest beyond the cap. Never follows links. */
  async prune(): Promise<void> {
    if (this.pruned) return;
    this.pruned = true;
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((name) => name.endsWith(".json"));
    } catch {
      return;
    }
    const entries: Array<{ path: string; mtimeMs: number; size: number }> = [];
    for (const name of names.slice(0, MAX_TAIL_ENTRIES * 8)) {
      const path = join(this.dir, name);
      try {
        const info = await lstat(path);
        if (info.isFile()) entries.push({ path, mtimeMs: info.mtimeMs, size: info.size });
      } catch {
        // Gone already.
      }
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const cutoff = this.now() - TAIL_TTL_MS;
    let bytes = 0;
    for (const [index, entry] of entries.entries()) {
      bytes += entry.size;
      if (index < MAX_TAIL_ENTRIES && entry.mtimeMs >= cutoff && bytes <= MAX_TAIL_BYTES) continue;
      await rm(entry.path, { force: true }).catch(() => undefined);
    }
  }
}
