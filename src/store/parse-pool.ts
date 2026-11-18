import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
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
export const MAX_WORKERS = 8;
/** One transcript is bounded in size, so a parse this slow means something is wrong. */
export const TASK_TIMEOUT_MS = 5 * 60_000;
/**
 * Transcript bytes in flight across the pool. Each worker has its own heap, so the one-process budget would leave
 * workers idle behind one large session; this bound still keeps several large ones from all running at once.
 */
export const POOLED_PARSE_BUDGET_BYTES = 1536 * 1024 * 1024;
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

export function defaultPoolSize(): number {
  let cores = 1;
  try {
    cores = availableParallelism();
  } catch {
    cores = 1;
  }
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
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
    this.workers = Math.max(1, Math.min(MAX_WORKERS, Math.floor(options.size ?? defaultPoolSize())));
    this.execArgv = options.execArgv;
    this.timeoutMs = options.timeoutMs ?? TASK_TIMEOUT_MS;
  }

  /** A pool, or null when workers cannot run here (no compiled worker entry, as when running from source). */
  static create(options: PoolOptions = {}): ParsePool | null {
    const url = options.workerUrl ?? new URL("./parse-worker.js", import.meta.url);
    try {
      if (url.protocol !== "file:" || !existsSync(fileURLToPath(url))) return null;
    } catch {
      return null;
    }
    return new ParsePool(url, options);
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
      worker = new Worker(this.url, this.execArgv ? { execArgv: this.execArgv } : {});
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
