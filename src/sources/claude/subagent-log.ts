import { scanJsonl, type JsonlLimits, type JsonlPosition } from "./jsonl.js";
import { subagentEvent, type Checkpoints, type ParseCheckpoint, type SubagentEvent } from "./parse.js";

/**
 * Subagent lines fold into their session after the main file, so when the main file grows every subagent line must
 * be folded in again. This keeps, per subagent file, its lines as SubagentEvents: exactly what the parse takes from a
 * subagent line (`SessionBuilder.applySubagentEvent` is the only way a subagent line reaches a session, from the file
 * or from this log). An event holds counts, ids, model names, token counters, line deltas and error categories, plus
 * commands and paths only as the session itself stores them (scrubbed, truncated): no prompts, no tool output, no
 * file contents, no assistant text.
 */

/** One subagent file's contribution: issue rows, how many records it had, and its events in order. */
export interface SubagentLog {
  issues: number;
  records: number;
  events: SubagentEvent[];
}

/** Bump with any change to SubagentEvent or to how a line becomes one. */
const LOG_FORMAT = "1";
/** Subagent files smaller than this are re-read; a checkpoint per tiny file costs more than it saves. */
export const SUBAGENT_LOG_MIN_BYTES = 256 * 1024;

function logKey(limits: JsonlLimits): string {
  return `claude-subagent:${LOG_FORMAT}:${limits.maxBytes}:${limits.maxLineBytes}:${limits.maxLines}`;
}

const KINDS = new Set(["system", "user", "assistant"]);

function restore(state: string): SubagentLog | null {
  try {
    const value: unknown = JSON.parse(state);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const { issues, records, events } = value as Record<string, unknown>;
    if (!Number.isSafeInteger(issues) || !Number.isSafeInteger(records) || !Array.isArray(events)) return null;
    // The store wrote this file; a shape check is enough to refuse one that is damaged.
    if (!events.every((event) => event && typeof event === "object" && KINDS.has((event as { kind?: string }).kind ?? "") && typeof (event as { envelope?: unknown }).envelope === "object")) return null;
    return { issues: issues as number, records: records as number, events: events as SubagentEvent[] };
  } catch {
    return null;
  }
}

/**
 * One subagent file's events, resumed from its saved log when the file has only grown since, and the log saved
 * again. The trailing unterminated line, if any, is in the result but not in what is saved.
 */
export async function readSubagentLog(path: string, limits: JsonlLimits, checkpoints: Checkpoints): Promise<SubagentLog> {
  const minBytes = Math.min(checkpoints.minBytes, SUBAGENT_LOG_MIN_BYTES);
  const key = logKey(limits);
  let log: SubagentLog = { issues: 0, records: 0, events: [] };
  let from: JsonlPosition | undefined;
  const saved = await checkpoints.load(path, key).catch(() => null);
  const restored = saved ? restore(saved.state) : null;
  if (saved && restored) {
    log = restored;
    from = saved.position;
  }
  let reached: ParseCheckpoint | null = null;
  for await (const row of scanJsonl(path, limits, from ? { from } : {})) {
    if (row.kind === "at") {
      if (row.position.offset >= minBytes && row.position.offset !== from?.offset) reached = { position: row.position, state: JSON.stringify(log) };
    } else if (row.kind === "issue") log.issues += 1;
    else {
      log.records += 1;
      const event = subagentEvent(row.value);
      if (event) log.events.push(event);
    }
  }
  if (reached) await checkpoints.save(path, key, reached, minBytes).catch(() => undefined);
  return log;
}
