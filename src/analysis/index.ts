import { REPORT_VERSION, type BuildReportInput, type Recap, type RecapHistory, type Report, type Retention, type Session } from "../schema/types.js";
import { buildActivity } from "./activity.js";
import { aggregateFacets } from "./facets.js";
import { detectFindings } from "./findings/index.js";
import { buildRecap } from "./recap/index.js";
import { historyDaysFrom, withHistoryDays } from "./history.js";
import { makeClock, parseMs, resolveTimeZone, type Clock } from "./time.js";
import { summarizeUsage, uniqueRequests } from "./usage.js";

export { DETECTORS, detectFindings } from "./findings/index.js";
export { estimateUsd, PRICING_VERSION } from "./usage.js";
export { historyDays } from "./history.js";
export { buildRecap, MAX_RECAP_DAYS, MAX_REPLY_SEC } from "./recap/index.js";

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

/** The recap's share-safe history card: a day and counts, from the retention the scan measured. */
function withHistory(recap: Recap, retention: Retention, now: Date, clock: Clock): Recap {
  const from = parseMs(retention.coversFrom);
  if (from === null) return recap;
  const history: RecapHistory = { days: historyDaysFrom(from, now.getTime(), clock), firstDay: clock.dayOfMs(from), cachedOnly: retention.cachedOnly };
  return { ...recap, history };
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
  const findings = detectFindings({ sessions, requests, usage, activity, coverage, now, clock, ...(input.retention ? { retention: input.retention } : {}) });
  const facets = aggregateFacets(input.facets, sessions);
  const generatedAt = now.toISOString();
  const recap = buildRecap({ sessions, activity, usage, findings, facets, clock, timeZone, generatedAt });
  return {
    version: REPORT_VERSION,
    generatedAt,
    timeZone,
    range: range(sessions),
    coverage,
    activity,
    usage,
    findings,
    facets,
    narrative: input.narrative ?? null,
    ...(recap ? { recap: input.retention ? withHistory(recap, input.retention, now, clock) : recap } : {}),
    ...(input.retention ? { retention: input.retention } : {}),
  };
}
