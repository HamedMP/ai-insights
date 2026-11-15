/** Local-time bucketing. Formatters are built once per report because constructing one is far costlier than using one. */

export const DAY_MS = 86_400_000;

/** A zone Intl accepts, falling back to UTC so a bad setting degrades instead of throwing. */
export function resolveTimeZone(timeZone: string | undefined): string {
  const candidate = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate });
    return candidate;
  } catch {
    return "UTC";
  }
}

export interface Clock {
  /** `YYYY-MM-DD` in the report zone, or null for an unparseable timestamp. */
  day(timestamp: string): string | null;
  /** 0..23 in the report zone, or null for an unparseable timestamp. */
  hour(timestamp: string): number | null;
}

export function makeClock(timeZone: string): Clock {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = (timestamp: string) => {
    const ms = Date.parse(timestamp);
    if (!Number.isFinite(ms)) return null;
    const out: Record<string, string> = {};
    for (const part of formatter.formatToParts(new Date(ms))) out[part.type] = part.value;
    return out;
  };
  return {
    day(timestamp) {
      const p = parts(timestamp);
      return p ? `${p.year}-${p.month}-${p.day}` : null;
    },
    hour(timestamp) {
      const p = parts(timestamp);
      if (!p) return null;
      const hour = Number(p.hour);
      return Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : null;
    },
  };
}

export function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T12:00:00Z`) - Date.parse(`${fromDay}T12:00:00Z`)) / DAY_MS);
}

/** Every day from the first to the last given day, oldest first, keeping only the newest `maxDays`. */
export function continuousDays(days: Iterable<string>, maxDays: number): string[] {
  let first: string | null = null;
  let last: string | null = null;
  for (const day of days) {
    if (first === null || day < first) first = day;
    if (last === null || day > last) last = day;
  }
  if (first === null || last === null) return [];
  const span = Math.min(daysBetween(first, last) + 1, maxDays);
  return Array.from({ length: span }, (_, index) => shiftDay(last!, index - span + 1));
}

export function parseMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}
