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
  dayOfMs(ms: number): string;
  /** The first instant after `ms` that falls on the next local day. */
  nextMidnight(ms: number): number;
}

/** Every zone offset in use is a multiple of 15 minutes, so the local day and hour are constant within a 15-minute UTC slot. */
const SLOT_MS = 15 * 60_000;
/** Bounds the memo on very long histories; a year is about 35k slots. */
const MAX_MEMO = 200_000;

export function makeClock(timeZone: string): Clock {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const fields = (ms: number) => {
    const out: Record<string, number> = {};
    for (const part of formatter.formatToParts(new Date(ms))) if (part.type !== "literal") out[part.type] = Number(part.value);
    return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
  };
  const memo = new Map<number, { day: string; hour: number }>();
  const slot = (ms: number) => {
    const key = Math.floor(ms / SLOT_MS);
    let value = memo.get(key);
    if (!value) {
      const f = fields(key * SLOT_MS);
      value = { day: `${f.year}-${String(f.month).padStart(2, "0")}-${String(f.day).padStart(2, "0")}`, hour: f.hour % 24 };
      if (memo.size >= MAX_MEMO) memo.clear();
      memo.set(key, value);
    }
    return value;
  };
  /** Local wall-clock time minus UTC, in ms, at instant `ms`. */
  const offset = (ms: number) => {
    const f = fields(ms);
    return Date.UTC(f.year, f.month - 1, f.day, f.hour % 24, f.minute, f.second) - Math.floor(ms / 1000) * 1000;
  };
  return {
    day(timestamp) {
      const ms = Date.parse(timestamp);
      return Number.isFinite(ms) ? slot(ms).day : null;
    },
    hour(timestamp) {
      const ms = Date.parse(timestamp);
      return Number.isFinite(ms) ? slot(ms).hour : null;
    },
    dayOfMs(ms) {
      return slot(ms).day;
    },
    nextMidnight(ms) {
      const f = fields(ms);
      const nextWall = Date.UTC(f.year, f.month - 1, f.day + 1);
      // Re-read the offset at the candidate so a DST change during the day lands on the real midnight.
      const guess = nextWall - offset(ms);
      const exact = nextWall - offset(guess);
      return exact > ms ? exact : ms + DAY_MS;
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
