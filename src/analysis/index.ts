import { isChatHarness, REPORT_VERSION, type AnalysisStep, type BuildReportInput, type Recap, type RecapHistory, type Report, type Retention, type Session } from "../schema/types.js";
import { buildActivity } from "./activity.js";
import { buildFrictionCauses } from "./causes.js";
import { aggregateFacets, facetsBySession } from "./facets.js";
import { buildWorkRatios } from "./ratios.js";
import { detectFindings } from "./findings/index.js";
import { buildRecap } from "./recap/index.js";
import { historyDaysFrom, withHistoryDays } from "./history.js";
import { makeClock, parseMs, resolveTimeZone, type Clock } from "./time.js";
import { uniqueSessions } from "./sessions.js";
import { summarizeUsage, uniqueRequests } from "./usage.js";

export { DETECTORS, detectFindings } from "./findings/index.js";
export { estimateUsd, PRICING_VERSION } from "./usage.js";
export { historyDays } from "./history.js";
export { uniqueSessions } from "./sessions.js";
export { buildFrictionCauses, MIN_CAUSE_SESSIONS, MIN_JUDGED_SESSIONS } from "./causes.js";
export { buildWorkRatios } from "./ratios.js";
export { buildRecap, MAX_RECAP_DAYS, MAX_REPLY_SEC } from "./recap/index.js";

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
  // Calendar days from the first day through today, both included, so the card agrees with the recap's own range.
  const history: RecapHistory = { days: historyDaysFrom(from, now.getTime(), clock) + 1, firstDay: clock.dayOfMs(from), cachedOnly: retention.cachedOnly };
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
  const step = (name: AnalysisStep) => {
    try {
      input.onStep?.(name);
    } catch {
      // A progress display must never change or break the analysis.
    }
  };
  const sessions = uniqueSessions(input.sessions);
  step("usage");
  const requests = uniqueRequests(sessions);
  const usage = summarizeUsage(requests, clock);
  step("activity");
  // Chat exports have no shell, files, permissions, compactions or parallel agents: the coding findings, work
  // ratios, friction causes and parallel counts are built from coding sessions only, so chats neither trip
  // them nor dilute them. Activity, rhythm and the person's own words still count every session.
  const coding = sessions.filter((session) => !isChatHarness(session.harness));
  const allActivity = buildActivity(sessions, clock);
  const codingActivity = coding.length === sessions.length ? allActivity : buildActivity(coding, clock);
  // Chats left open side by side are not agents working in parallel.
  const activity = { ...allActivity, parallelSessions: codingActivity.parallelSessions, sessionSpans: codingActivity.sessionSpans ?? [] };
  const coverage = withHistoryDays(input.coverage, sessions, now.getTime(), clock);
  step("findings");
  const findings = detectFindings({ sessions: coding, requests, usage, activity: codingActivity, coverage, now, clock, ...(input.retention ? { retention: input.retention } : {}) });
  const facets = aggregateFacets(input.facets, sessions);
  const generatedAt = now.toISOString();
  const ratios = coding.length > 0 ? buildWorkRatios(coding, codingActivity) : undefined;
  const frictionCauses = buildFrictionCauses({ sessions: coding, facets: facetsBySession(input.facets, coding), findings, clock });
  step("recap");
  const recap = buildRecap({ sessions, activity, coding: { sessions: coding, activity: codingActivity }, usage, findings, facets, clock, timeZone, generatedAt, ...(ratios ? { ratios } : {}) });
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
    ...(frictionCauses ? { frictionCauses } : {}),
    ...(ratios ? { ratios } : {}),
  };
}
