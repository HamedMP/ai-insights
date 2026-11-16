import type { Coverage, Harness, Session } from "../schema/types.js";
import { daysBetween, makeClock, parseMs, resolveTimeZone, type Clock } from "./time.js";

/**
 * How many days of history a harness has: local calendar days from the day of its oldest session to today,
 * at least one. The short-history finding and the rendered coverage card both use this, so they agree.
 */
export function historyDays(oldest: string | null | undefined, now: Date, timeZone: string): number | null {
  const ms = parseMs(oldest);
  return ms === null ? null : historyDaysFrom(ms, now.getTime(), makeClock(resolveTimeZone(timeZone)));
}

export function historyDaysFrom(oldestMs: number, nowMs: number, clock: Clock): number {
  return Math.max(1, daysBetween(clock.dayOfMs(oldestMs), clock.dayOfMs(nowMs)));
}

/**
 * Coverage with `historyDays` filled per harness. The oldest point is the earlier of the scan's `oldest` and the
 * oldest session in the report, so the short-history finding and the page read one number. Inputs are not mutated.
 */
export function withHistoryDays(coverage: Coverage[], sessions: Session[], nowMs: number, clock: Clock): Coverage[] {
  const oldest = new Map<Harness, number>();
  for (const session of sessions) {
    const ms = parseMs(session.startTime);
    if (ms !== null && ms < (oldest.get(session.harness) ?? Number.POSITIVE_INFINITY)) oldest.set(session.harness, ms);
  }
  return coverage.map((entry) => {
    const { historyDays: _stale, ...rest } = entry;
    const candidates = [parseMs(entry.oldest), oldest.get(entry.harness) ?? null].filter((ms): ms is number => ms !== null);
    return candidates.length ? { ...rest, historyDays: historyDaysFrom(Math.min(...candidates), nowMs, clock) } : rest;
  });
}
