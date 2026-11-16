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
