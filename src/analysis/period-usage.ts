import type { Harness, ModelRequest, UsageTotals } from "../schema/types.js";
import { uniqueSessions } from "./sessions.js";
import { addRequest, emptyTotals, uniqueRequests } from "./usage.js";

/** What period totals need from a session: a full Session has it, and so does the usage-only scan's reading. */
export interface UsageHolder {
  harness: Harness;
  id: string;
  /** Null when only the usage was read; such a session never shares a request with another (the scan checks). */
  startTime: string | null;
  requests: ModelRequest[];
}

/** Instants in ms, `from` included, `to` excluded. */
export interface UsageRange {
  from: number;
  to: number;
}

export interface PeriodUsage {
  totals: UsageTotals;
  byHarness: Map<Harness, UsageTotals>;
  /** Keyed by harness and model. */
  byModel: Map<string, UsageTotals & { harness: Harness; model: string }>;
}

/**
 * Tokens and estimated cost of the requests made inside each range, counted the way the report counts them: one copy
 * per session, every request once (the earliest session keeps a shared one), priced by `estimateUsd`.
 */
export function periodUsage(sessions: UsageHolder[], ranges: UsageRange[]): PeriodUsage[] {
  const owned = uniqueRequests(uniqueSessions(sessions));
  const out = ranges.map((): PeriodUsage => ({ totals: emptyTotals(), byHarness: new Map(), byModel: new Map() }));
  for (const { session, request, usd } of owned) {
    const at = Date.parse(request.timestamp);
    if (!Number.isFinite(at)) continue;
    ranges.forEach((range, index) => {
      if (at < range.from || at >= range.to) return;
      const period = out[index]!;
      addRequest(period.totals, request.usage, usd);
      let harness = period.byHarness.get(session.harness);
      if (!harness) period.byHarness.set(session.harness, (harness = emptyTotals()));
      addRequest(harness, request.usage, usd);
      const key = `${session.harness}\u0000${request.model}`;
      let model = period.byModel.get(key);
      if (!model) period.byModel.set(key, (model = { ...emptyTotals(), harness: session.harness, model: request.model }));
      addRequest(model, request.usage, usd);
    });
  }
  return out;
}
