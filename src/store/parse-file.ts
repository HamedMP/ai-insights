import { join } from "node:path";
import type { Session, SessionFile, Source } from "../schema/types.js";
import { parseClaudeTranscript } from "../sources/claude/parse.js";
import { readClaudeUsage, type UsageOnly } from "../sources/claude/usage.js";
import { parseCodexFamily } from "../sources/codex/index.js";
import { buildRollout, type BuiltRollout } from "../sources/codex/parse.js";
import { sourceFor } from "../sources/index.js";
import { WorkerUnavailable, type ParsePool } from "./parse-pool.js";
import { TailCheckpoints } from "./tail.js";

/** Where tail checkpoints for one harness live inside a store. */
export function tailDir(home: string, harness: SessionFile["harness"]): string {
  return join(home, "tail", harness);
}

export interface FileParseOptions {
  /** The store's home: Claude Code transcripts that only grew are then read from their last checkpoint. */
  home?: string;
  /** Ignore checkpoints (still write fresh ones). */
  refresh?: boolean;
  /** Smallest transcript worth a checkpoint; tests lower it. */
  tailMinBytes?: number;
}

/**
 * Parses one transcript with the built-in source for its harness, giving exactly what `source.parse` gives, but
 * resuming appended Claude Code transcripts from a checkpoint when a store is given. Never throws.
 */
export async function parseFile(file: SessionFile, options: FileParseOptions = {}): Promise<Session | null> {
  const source = sourceFor(file.harness);
  if (!source) return null;
  if (file.harness !== "claude-code" || !options.home) return source.parse(file);
  try {
    const checkpoints = new TailCheckpoints(tailDir(options.home, file.harness), {
      read: !options.refresh,
      ...(options.tailMinBytes !== undefined ? { minBytes: options.tailMinBytes } : {}),
    });
    return await parseClaudeTranscript(file, undefined, { checkpoints });
  } catch {
    // Same contract as the source: an unreadable transcript holds no session.
    return null;
  }
}

/** True when `source` is the built-in one, so a worker that loads the built-in sources parses the same way. */
export function isBuiltIn(source: Source): boolean {
  return sourceFor(source.harness) === source;
}

export interface FileParserOptions {
  pool: ParsePool | null;
  home: string;
  tailMinBytes?: number;
}

/**
 * The scan's parse step for the CLI. Built-in sources resume appended Claude Code transcripts and, given a pool, run
 * on worker threads: a whole transcript per task, except Codex, whose rollout and the guardian and subagent rollouts
 * it started are built side by side and folded here. Whatever a worker cannot do is done on this thread. Any other
 * source is called as it is.
 */
export function fileParser(options: FileParserOptions) {
  return async (source: Source, file: SessionFile, flags: { refresh?: boolean } = {}): Promise<Session | null> => {
    if (!isBuiltIn(source)) return source.parse(file);
    const parseOptions: FileParseOptions = {
      home: options.home,
      ...(flags.refresh ? { refresh: true } : {}),
      ...(options.tailMinBytes !== undefined ? { tailMinBytes: options.tailMinBytes } : {}),
    };
    const pool = options.pool;
    if (!pool?.handles(file.harness)) return parseFile(file, parseOptions);
    if (file.harness === "codex") return parseCodexFamily(file, (rollouts) => Promise.all(rollouts.map((rollout) => buildOn(pool, rollout))));
    try {
      return await pool.run({ kind: "file", file, options: parseOptions });
    } catch (error) {
      if (!(error instanceof WorkerUnavailable)) throw error;
      return parseFile(file, parseOptions);
    }
  };
}

async function buildOn(pool: ParsePool, rollout: { path: string; mtimeMs: number }): Promise<BuiltRollout> {
  try {
    return await pool.run({ kind: "rollout", path: rollout.path, mtimeMs: rollout.mtimeMs });
  } catch (error) {
    if (!(error instanceof WorkerUnavailable)) throw error;
    return buildRollout(rollout.path, rollout.mtimeMs);
  }
}

/** The usage-only reading for `usageScan`: Claude Code transcripts of the built-in source, on a worker when there is one. */
export function usageReader(pool: ParsePool | null) {
  return async (source: Source, file: SessionFile): Promise<UsageOnly | null> => {
    if (file.harness !== "claude-code" || !isBuiltIn(source)) return null;
    if (pool?.handles(file.harness)) {
      try {
        return await pool.run({ kind: "usage", file });
      } catch (error) {
        if (!(error instanceof WorkerUnavailable)) return null;
      }
    }
    return readClaudeUsage(file);
  };
}
