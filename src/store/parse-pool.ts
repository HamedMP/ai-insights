import { existsSync } from "node:fs";
import { availableParallelism, freemem, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Harness, Session, SessionFile } from "../schema/types.js";
import type { UsageOnly } from "../sources/claude/usage.js";
import type { BuiltRollout } from "../sources/codex/parse.js";
import type { FileParseOptions } from "./parse-file.js";

/**
 * Parses transcripts on worker threads so a cold scan uses more than one core. Each worker loads the built-in
 * sources and sends back a finished Session (or one built Codex rollout), so what crosses threads is small.
 * Anything that goes wrong with a worker (it cannot start, crashes, runs out of memory) is reported to the caller as
 * WorkerUnavailable, and the caller does that piece on its own thread: the result never depends on the workers.
 */

/** Harnesses whose parse only reads their own transcript files; the SQLite-backed ones stay on the main thread. */
export const POOLED_HARNESSES: ReadonlySet<Harness> = new Set<Harness>(["claude-code", "codex", "pi", "gemini"]);
/** The most `AI_INSIGHTS_WORKERS` may ask for. */
export const MAX_WORKERS = 8;
/** The most chosen by default: measured, more cost memory and gain little. */
export const DEFAULT_MAX_WORKERS = 4;
/**
 * Heap limits per worker. V8 lets an unlimited heap grow far past what a parse holds before collecting, and with
 * several workers that adds up; these limits keep a cold scan of 1.2 GB of history near 600 MB resident. A worker
 * that does run out is replaced and its transcript parsed on the calling thread, which has the usual limit.
 */
export const WORKER_YOUNG_MB = 16;
export const WORKER_OLD_MB = 256;
/** One transcript is bounded in size, so a parse this slow means something is wrong. */
export const TASK_TIMEOUT_MS = 5 * 60_000;
/**
 * Transcript bytes in flight across the pool. Each worker has its own heap, so the one-process budget would leave
 * workers idle behind one large session; this bound still keeps several large ones from all running at once.
 */
export const POOLED_PARSE_BUDGET_BYTES = 1024 * 1024 * 1024;
/** Workers replaced after a crash, at most, before the pool stops and the calling thread does the rest. */
const MAX_RESTARTS = 4;

/** The worker could not do it; do it on the calling thread instead. */
export class WorkerUnavailable extends Error {}
/** The task ran past the timeout; its worker was stopped. */
export class WorkerTimeout extends Error {}

/** What a worker can be asked to do. */
export type WorkerTask =
  | { kind: "file"; file: SessionFile; options: FileParseOptions }
  | { kind: "rollout"; path: string; mtimeMs: number }
  | { kind: "usage"; file: SessionFile };
export type WorkerResult<T extends WorkerTask> = T extends { kind: "file" } ? Session | null : T extends { kind: "usage" } ? UsageOnly | null : BuiltRollout;

interface Pending {
  id: number;
  task: WorkerTask;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  task: Pending | null;
  timer: NodeJS.Timeout | null;
}

export interface PoolOptions {
  size?: number;
  /** The compiled worker entry. Default: `parse-worker.js` next to this file, when it exists. */
  workerUrl?: URL;
  execArgv?: string[];
  timeoutMs?: number;
}

/** What a worker count is chosen from; tests pass made-up machines. */
export interface MachineInfo {
  cores: number;
  totalBytes: number;
  freeBytes: number;
}

const GB = 1024 ** 3;

function machine(): MachineInfo {
  let cores = 1;
  try {
    cores = availableParallelism();
  } catch {
    cores = 1;
  }
  return { cores, totalBytes: totalmem(), freeBytes: freemem() };
}

/**
 * Workers for a cold scan, from cores and memory. Each worker costs about 100 MB at its heap limits, and beyond four
 * they buy little (the largest session bounds the scan); one worker is slower than none. Free memory only lowers the
 * count when it is very low, because macOS reports file cache as used.
 */
export function defaultPoolSize(info: MachineInfo = machine()): number {
  const byMemory = info.totalBytes >= 12 * GB ? 4 : info.totalBytes >= 6 * GB ? 3 : info.totalBytes >= 3 * GB ? 2 : 0;
  let size = Math.min(DEFAULT_MAX_WORKERS, info.cores - 1, byMemory);
  if (info.freeBytes < GB / 2) size = Math.min(size, 2);
  return size >= 2 ? size : 0;
}

export class ParsePool {
  readonly workers: number;
  private readonly url: URL;
  private readonly execArgv: string[] | undefined;
  private readonly timeoutMs: number;
  private readonly slots: Slot[] = [];
  private readonly queue: Pending[] = [];
  private nextId = 0;
  private restarts = 0;
  private closed = false;

  private constructor(url: URL, options: PoolOptions) {
    this.url = url;
    this.workers = Math.max(1, Math.min(MAX_WORKERS, Math.floor(options.size ?? 1)));
    this.execArgv = options.execArgv;
    this.timeoutMs = options.timeoutMs ?? TASK_TIMEOUT_MS;
  }

  /** A pool, or null when workers cannot or should not run here (no compiled worker entry, or a size of 0). */
  static create(options: PoolOptions = {}): ParsePool | null {
    const size = Math.min(MAX_WORKERS, Math.floor(options.size ?? defaultPoolSize()));
    if (!(size >= 1)) return null;
    const url = options.workerUrl ?? new URL("./parse-worker.js", import.meta.url);
    try {
      if (url.protocol !== "file:" || !existsSync(fileURLToPath(url))) return null;
    } catch {
      return null;
    }
    return new ParsePool(url, { ...options, size });
  }

  handles(harness: Harness): boolean {
    return !this.closed && POOLED_HARNESSES.has(harness);
  }

  /** Rejects with WorkerUnavailable when the caller should do the task itself, WorkerTimeout when it ran too long. */
  run<T extends WorkerTask>(task: T): Promise<WorkerResult<T>> {
    if (this.closed) return Promise.reject(new WorkerUnavailable("pool closed"));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: (this.nextId += 1), task, resolve: resolve as (value: unknown) => void, reject });
      this.pump();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failAll("pool closed");
    const slots = this.slots.splice(0);
    for (const slot of slots) {
      if (slot.timer) clearTimeout(slot.timer);
      slot.task?.reject(new WorkerUnavailable("pool closed"));
      slot.task = null;
    }
    await Promise.all(slots.map((slot) => slot.worker.terminate().catch(() => 0)));
  }

  private pump(): void {
    while (this.queue.length) {
      let slot = this.slots.find((candidate) => candidate.task === null);
      if (!slot && this.slots.length < this.workers) slot = this.spawn() ?? undefined;
      if (!slot) {
        if (this.slots.length === 0) this.failAll("workers could not start");
        return;
      }
      const pending = this.queue.shift()!;
      const current = slot;
      current.task = pending;
      // A busy worker keeps the process alive; an idle one must not.
      current.worker.ref();
      current.timer = setTimeout(() => this.fail(current, new WorkerTimeout("task timed out"), false), this.timeoutMs);
      current.worker.postMessage({ id: pending.id, task: pending.task });
    }
  }

  private spawn(): Slot | null {
    if (this.closed) return null;
    let worker: Worker;
    try {
      worker = new Worker(this.url, { ...(this.execArgv ? { execArgv: this.execArgv } : {}), resourceLimits: { maxYoungGenerationSizeMb: WORKER_YOUNG_MB, maxOldGenerationSizeMb: WORKER_OLD_MB } });
    } catch {
      return null;
    }
    const slot: Slot = { worker, task: null, timer: null };
    worker.on("message", (message: { id?: number; value?: unknown; failed?: boolean }) => {
      const pending = slot.task;
      if (!pending || message?.id !== pending.id) return;
      this.settle(slot);
      if (message.failed) pending.reject(new WorkerUnavailable("worker task failed"));
      else pending.resolve(message.value ?? null);
      this.pump();
    });
    worker.on("error", () => this.fail(slot, new WorkerUnavailable("worker error"), true));
    worker.on("exit", () => this.fail(slot, new WorkerUnavailable("worker exited"), true));
    worker.unref();
    this.slots.push(slot);
    return slot;
  }

  private settle(slot: Slot): void {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.task = null;
    slot.worker.unref();
  }

  /** Drops a broken or stuck worker and hands its task back. Too many crashes close the pool. */
  private fail(slot: Slot, error: Error, crashed: boolean): void {
    const index = this.slots.indexOf(slot);
    if (index === -1) return;
    this.slots.splice(index, 1);
    const pending = slot.task;
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.task = null;
    void slot.worker.terminate().catch(() => 0);
    pending?.reject(error);
    if (crashed) this.restarts += 1;
    if (this.restarts > MAX_RESTARTS) this.closed = true;
    if (this.closed) this.failAll("too many worker failures");
    else this.pump();
  }

  private failAll(reason: string): void {
    for (const pending of this.queue.splice(0)) pending.reject(new WorkerUnavailable(reason));
  }
}
