/**
 * Codex token accounting, ported from the Matrix OS ai-usage parser (same author, MIT).
 *
 * Codex records usage two ways. Newer builds write a `token_usage_record` per model response with a
 * native response id. Every build writes `event_msg`/`token_count` with cumulative thread counters.
 * Cumulative counters become per-request deltas against a high-water mark; when native records exist,
 * the counter ranges they already cover are subtracted so a response is counted once.
 */
import type { ModelRequest } from "../../schema/types.js";
import type { RawRecord } from "./read.js";

export const MAX_REQUESTS = 50_000;

type Counters = { input: number; cached: number; output: number };
const FIELDS = ["input", "cached", "output"] as const;

export interface UsageEvent {
  id: string;
  session: string;
  model: string;
  timestamp: string;
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  sourceKind: "response" | "cumulative";
  cumulative?: Counters;
}

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 ? value : fallback;

class BadCounter extends Error {}

function count(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1e12) throw new BadCounter();
  return value;
}

/** Feeds records in file order; keeps the high-water mark and native totals between calls. */
export class UsageParser {
  private session: string;
  private nativeTotals: Counters | undefined;
  private previous: Counters = { input: 0, cached: 0, output: 0 };
  private inherited = false;
  private readonly events = new Map<string, UsageEvent>();
  issues = 0;

  constructor(fallbackSession: string) {
    this.session = fallbackSession;
  }

  setSession(id: string): void {
    this.session = id;
  }

  /**
   * A thread forked from another one carries the source thread's counters forward. Its first counter is
   * the inherited baseline, already counted in the source thread, not usage of its own.
   */
  inheritCounters(): void {
    this.inherited = true;
  }

  /** `model` is whatever the caller knows to be active for this record's turn. */
  push(record: RawRecord, model: string): void {
    const payload = obj(record.payload);
    const isNative = record.type === "token_usage_record";
    const isCumulative = record.type === "event_msg" && payload.type === "token_count";
    if (!isNative && !isCumulative) return;
    const timestamp = typeof record.timestamp === "string" && Number.isFinite(Date.parse(record.timestamp)) ? record.timestamp : "";
    try {
      if (!timestamp) throw new BadCounter();
      const event = isNative ? this.native(payload, model, timestamp) : this.cumulative(payload, model, timestamp);
      if (event) this.add(event);
    } catch (error) {
      if (!(error instanceof BadCounter)) throw error;
      this.issues += 1;
    }
  }

  private native(payload: Record<string, unknown>, model: string, timestamp: string): UsageEvent | null {
    const id = str(payload.response_id);
    const usage = obj(payload.usage);
    if (!id || typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") throw new BadCounter();
    const session = str(payload.thread_id, str(payload.session_id, this.session));
    const cachedInput = count(usage.cached_input_tokens);
    const cacheWrite = count(usage.cache_write_input_tokens);
    const input = count(usage.input_tokens) - cachedInput - cacheWrite;
    if (input < 0) throw new BadCounter();
    if (session !== this.session) {
      this.session = session;
      this.previous = { input: 0, cached: 0, output: 0 };
    }
    const event: UsageEvent = {
      id: `codex-response:${id}`,
      session,
      model,
      timestamp,
      input,
      cachedInput,
      cacheWrite,
      output: count(usage.output_tokens),
      sourceKind: "response",
    };
    if (payload.thread_token_usage) {
      const total = obj(payload.thread_token_usage);
      this.nativeTotals = {
        input: count(total.input_tokens),
        cached: count(total.cached_input_tokens),
        output: count(total.output_tokens),
      };
      event.cumulative = { ...this.nativeTotals };
    } else this.nativeTotals = undefined;
    return event;
  }

  private cumulative(payload: Record<string, unknown>, model: string, timestamp: string): UsageEvent | null {
    // A rate-limit-only update carries no counters.
    if (payload.info === null || payload.info === undefined) return null;
    const info = obj(payload.info);
    if (!info.total_token_usage) throw new BadCounter();
    const usage = obj(info.total_token_usage);
    const next = {
      input: count(usage.input_tokens),
      cached: count(usage.cached_input_tokens),
      output: count(usage.output_tokens),
    };
    if (this.inherited) {
      this.inherited = false;
      this.previous = next;
      return null;
    }
    const native = this.nativeTotals;
    if (native && next.input === native.input && next.cached === native.cached && next.output === native.output) {
      this.previous = next;
      return null;
    }
    // A counter that goes backwards is a reset (a resumed or rewritten thread), never negative usage.
    // The high-water mark stays, so replayed counters below it are not counted twice.
    if (
      next.cached > next.input ||
      next.input < this.previous.input ||
      next.cached < this.previous.cached ||
      next.output < this.previous.output
    ) {
      this.issues += 1;
      return null;
    }
    const input = next.input - this.previous.input;
    const cached = next.cached - this.previous.cached;
    const output = next.output - this.previous.output;
    if (input === 0 && cached === 0 && output === 0) return null;
    if (cached > input) throw new BadCounter();
    this.previous = next;
    return {
      id: `codex:${this.session}:${next.input}:${next.cached}:${next.output}`,
      session: this.session,
      model,
      timestamp,
      input: input - cached,
      cachedInput: cached,
      cacheWrite: 0,
      output,
      sourceKind: "cumulative",
      cumulative: { ...next },
    };
  }

  private add(event: UsageEvent): void {
    if (event.input + event.cachedInput + event.cacheWrite + event.output === 0) return;
    const old = this.events.get(event.id);
    if (old) {
      if (event.input < old.input || event.output < old.output || event.cachedInput < old.cachedInput || event.cacheWrite < old.cacheWrite) {
        this.issues += 1;
        return;
      }
    } else if (this.events.size >= MAX_REQUESTS) {
      this.issues += 1;
      return;
    }
    this.events.set(event.id, event);
  }

  /** Reconciled requests, oldest first. */
  finish(): ModelRequest[] {
    const { events, dropped } = reconcileUsageEvents([...this.events.values()]);
    this.issues += dropped;
    return events
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      .map((event) => ({
        id: event.id,
        timestamp: event.timestamp,
        model: event.model,
        usage: { input: event.input, cachedInput: event.cachedInput, cacheWrite: event.cacheWrite, output: event.output },
      }));
  }
}

type Range = [number, number];

function union(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Prefix totals over merged ranges, so each lookup is a binary search rather than a scan. */
function uncoveredLength(ranges: Range[]): (start: number, end: number) => number {
  const merged = union(ranges);
  const before: number[] = [];
  let total = 0;
  for (const [start, end] of merged) {
    before.push(total);
    total += end - start;
  }
  const below = (value: number): number => {
    let low = 0;
    let high = merged.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (merged[middle]![0] < value) low = middle + 1;
      else high = middle;
    }
    if (!low) return 0;
    const [start, end] = merged[low - 1]!;
    return before[low - 1]! + Math.min(value, end) - start;
  };
  return (start, end) => end - start - (below(end) - below(start));
}

/**
 * Codex writes each request twice: a native per-response record and a cumulative counter that can drift
 * from it. Subtract the counter ranges native records already cover. Counters that cannot be located
 * against native records are dropped and counted, never added.
 */
export function reconcileUsageEvents(events: UsageEvent[]): { events: UsageEvent[]; dropped: number } {
  const sessions = new Map<string, { native: UsageEvent[]; legacy: UsageEvent[] }>();
  for (const event of events) {
    let session = sessions.get(event.session);
    if (!session) sessions.set(event.session, (session = { native: [], legacy: [] }));
    (event.sourceKind === "response" ? session.native : session.legacy).push(event);
  }
  const replaced = new Map<UsageEvent, UsageEvent | null>();
  let dropped = 0;
  for (const { native, legacy: all } of sessions.values()) {
    if (!all.length || !native.length) continue;
    // Once Codex writes native records it writes one per response, so later counters only repeat them.
    // Their totals can sit on a shifted scale (forked threads), which range matching cannot line up.
    const firstNative = native.reduce((min, event) => Math.min(min, Date.parse(event.timestamp)), Infinity);
    const legacy = all.filter((event) => Date.parse(event.timestamp) < firstNative);
    for (const event of all) if (Date.parse(event.timestamp) >= firstNative) replaced.set(event, null);
    if (!legacy.length) continue;
    const covered: Record<keyof Counters, Range[]> = { input: [], cached: [], output: [] };
    let uncertain = false;
    const prior: Counters = { input: 0, cached: 0, output: 0 };
    native.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || (a.id < b.id ? -1 : 1));
    for (const event of native) {
      const total = event.cumulative;
      if (!total) {
        uncertain = true;
        break;
      }
      const actual: Counters = { input: event.input + event.cachedInput + event.cacheWrite, cached: event.cachedInput, output: event.output };
      for (const field of FIELDS) {
        const start = total[field] - actual[field];
        if (start < 0 || start < prior[field]) uncertain = true;
        covered[field].push([start, total[field]]);
        prior[field] = total[field];
      }
    }
    if (uncertain) {
      for (const event of legacy) replaced.set(event, null);
      dropped += legacy.length;
      continue;
    }
    const uncovered = {
      input: uncoveredLength(covered.input),
      cached: uncoveredLength(covered.cached),
      output: uncoveredLength(covered.output),
    };
    const totalOf = (event: UsageEvent): Counters => event.cumulative ?? { input: 0, cached: 0, output: 0 };
    legacy.sort((a, b) => {
      const x = totalOf(a);
      const y = totalOf(b);
      return x.input + x.output - (y.input + y.output) || x.input - y.input || x.cached - y.cached || (a.id < b.id ? -1 : 1);
    });
    let previous: Counters = { input: 0, cached: 0, output: 0 };
    for (const event of legacy) {
      const next = totalOf(event);
      const start = previous;
      previous = next;
      if (!event.cumulative || FIELDS.some((field) => next[field] < start[field])) {
        replaced.set(event, null);
        dropped += 1;
        continue;
      }
      const input = uncovered.input(start.input, next.input);
      const cached = uncovered.cached(start.cached, next.cached);
      const output = uncovered.output(start.output, next.output);
      if (input < cached) {
        replaced.set(event, null);
        dropped += 1;
      } else if (input + output === 0) replaced.set(event, null);
      else replaced.set(event, { ...event, input: input - cached, cachedInput: cached, cacheWrite: 0, output });
    }
  }
  if (!replaced.size) return { events, dropped };
  const result: UsageEvent[] = [];
  for (const event of events) {
    const value = replaced.get(event);
    if (value === undefined) result.push(event);
    else if (value) result.push(value);
  }
  return { events: result, dropped };
}
