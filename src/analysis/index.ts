import { REPORT_VERSION, type BuildReportInput, type Report, type Session } from "../schema/types.js";
import { buildActivity } from "./activity.js";
import { aggregateFacets } from "./facets.js";
import { detectFindings } from "./findings/index.js";
import { withHistoryDays } from "./history.js";
import { makeClock, parseMs, resolveTimeZone } from "./time.js";
import { summarizeUsage, uniqueRequests } from "./usage.js";

export { DETECTORS, detectFindings } from "./findings/index.js";
export { estimateUsd, PRICING_VERSION } from "./usage.js";
export { historyDays } from "./history.js";

function byStart(a: Session, b: Session): number {
  return (
    (parseMs(a.startTime) ?? Number.POSITIVE_INFINITY) - (parseMs(b.startTime) ?? Number.POSITIVE_INFINITY) ||
    a.harness.localeCompare(b.harness) ||
    a.id.localeCompare(b.id)
  );
}

/** One copy per session: the scan may hand over the same transcript twice (a backup root, a moved file). */
function uniqueSessions(sessions: Session[]): Session[] {
  const seen = new Set<string>();
  const out: Session[] = [];
  for (const session of [...sessions].sort(byStart)) {
    const key = `${session.harness}\u0000${session.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(session);
  }
  return out;
}

function range(sessions: Session[]): Report["range"] {
  let from: number | null = null;
  let to: number | null = null;
  for (const session of sessions) {
    for (const value of [session.startTime, session.endTime]) {
      const ms = parseMs(value);
      if (ms === null) continue;
      if (from === null || ms < from) from = ms;
      if (to === null || ms > to) to = ms;
    }
  }
  return { from: from === null ? null : new Date(from).toISOString(), to: to === null ? null : new Date(to).toISOString() };
}

/**
 * Turns parsed sessions into a report. Pure and deterministic for a given `now` and
 * `timeZone`: no clock reads beyond the defaults, no file or network access.
 */
export function buildReport(input: BuildReportInput): Report {
  const now = input.now ?? new Date();
  const timeZone = resolveTimeZone(input.timeZone);
  const clock = makeClock(timeZone);
  const sessions = uniqueSessions(input.sessions);
  const requests = uniqueRequests(sessions);
  const usage = summarizeUsage(requests, clock);
  const activity = buildActivity(sessions, clock);
  const coverage = withHistoryDays(input.coverage, sessions, now.getTime(), clock);
  const findings = detectFindings({ sessions, requests, usage, activity, coverage, now, clock });
  return {
    version: REPORT_VERSION,
    generatedAt: now.toISOString(),
    timeZone,
    range: range(sessions),
    coverage,
    activity,
    usage,
    findings,
    facets: aggregateFacets(input.facets, sessions),
    narrative: input.narrative ?? null,
  };
}
