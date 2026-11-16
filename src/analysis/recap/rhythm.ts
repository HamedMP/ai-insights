import type { Harness, RecapRhythm, RecapVerdictKey, RecapWeekday, Session } from "../../schema/types.js";
import type { Clock } from "../time.js";

export const WEEKDAYS: RecapWeekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function weekdayOf(day: string): RecapWeekday {
  return WEEKDAYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]!;
}

const NIGHT = [22, 23, 0, 1, 2, 3, 4];
const EARLY = [5, 6, 7, 8, 9];

const VERDICTS: Record<RecapVerdictKey, string> = {
  night_owl: "Night owl",
  early_bird: "Early bird",
  evening: "Golden-hour builder",
  afternoon: "Afternoon engine",
  morning: "Morning mind",
};

export interface RhythmResult {
  rhythm?: RecapRhythm;
  /** Prompts per local day. */
  promptsByDay: Map<string, number>;
}

function peakOf(hours: number[]): number {
  let peak = 0;
  for (let hour = 1; hour < 24; hour += 1) if (hours[hour]! > hours[peak]!) peak = hour;
  return peak;
}

/** Longest run of zero-prompt hours, wrapping midnight; the earliest start wins a tie. */
function quietHours(hours: number[]): RecapRhythm["quiet"] {
  let best = { len: 0, start: null as number | null };
  for (let start = 0; start < 24; start += 1) {
    let len = 0;
    while (len < 24 && hours[(start + len) % 24] === 0) len += 1;
    if (len > best.len) best = { len, start };
  }
  return best;
}

export function verdictFor(nightShare: number, earlyShare: number, peakHour: number): RecapVerdictKey {
  if (nightShare >= 0.2 && earlyShare < 0.05) return "night_owl";
  if (earlyShare >= 0.2) return "early_bird";
  if (peakHour >= 17) return "evening";
  if (peakHour >= 12) return "afternoon";
  return "morning";
}

/** When the person types: every prompt counts here, templates and agent-driven sessions included. */
export function buildRhythm(sessions: Session[], clock: Clock, timeZone: string): RhythmResult {
  const hours = Array.from({ length: 24 }, () => 0);
  const byHarness = new Map<Harness, number[]>();
  const weekdays = new Map<RecapWeekday, number>(WEEKDAYS.map((day) => [day, 0]));
  const promptsByDay = new Map<string, number>();
  let latestNightMs: number | null = null;
  let latestNightHour = -1;
  let total = 0;
  for (const session of sessions) {
    for (const prompt of session.prompts) {
      const hour = clock.hour(prompt.timestamp);
      const day = clock.day(prompt.timestamp);
      if (hour === null || day === null) continue;
      total += 1;
      hours[hour]! += 1;
      let own = byHarness.get(session.harness);
      if (!own) byHarness.set(session.harness, (own = Array.from({ length: 24 }, () => 0)));
      own[hour]! += 1;
      const weekday = weekdayOf(day);
      weekdays.set(weekday, weekdays.get(weekday)! + 1);
      promptsByDay.set(day, (promptsByDay.get(day) ?? 0) + 1);
      // Only the night's latest prompt needs its minute; the hour narrows it down without a formatter call each.
      if (hour < 5 && hour >= latestNightHour) {
        latestNightHour = hour;
        const ms = Date.parse(prompt.timestamp);
        if (latestNightMs === null || minuteOfDay(ms, timeZone) > minuteOfDay(latestNightMs, timeZone)) latestNightMs = ms;
      }
    }
  }
  if (total === 0) return { promptsByDay };
  const share = (list: number[]) => list.reduce((sum, hour) => sum + hours[hour]!, 0) / total;
  const nightShare = share(NIGHT);
  const earlyShare = share(EARLY);
  const peakHour = peakOf(hours);
  const key = verdictFor(nightShare, earlyShare, peakHour);
  const rhythm: RecapRhythm = {
    hours,
    peakHour,
    nightShare,
    earlyShare,
    verdict: { key, label: VERDICTS[key] },
    quiet: quietHours(hours),
    harnessPeaks: [...byHarness]
      .map(([harness, own]) => ({ key: harness, peak: peakOf(own), prompts: own.reduce((a, b) => a + b, 0), hours: own }))
      .sort((a, b) => b.prompts - a.prompts || a.key.localeCompare(b.key)),
    weekdays: WEEKDAYS.map((day) => ({ key: day, count: weekdays.get(day)! })),
  };
  if (latestNightMs !== null) rhythm.latestNight = minuteOfDay(latestNightMs, timeZone);
  return { rhythm, promptsByDay };
}

const minuteFormatters = new Map<string, Intl.DateTimeFormat>();

function minuteOfDay(ms: number, timeZone: string): number {
  let formatter = minuteFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if (minuteFormatters.size > 20) minuteFormatters.clear();
    minuteFormatters.set(timeZone, formatter);
  }
  let hour = 0;
  let minute = 0;
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type === "hour") hour = Number(part.value) % 24;
    else if (part.type === "minute") minute = Number(part.value);
  }
  return hour * 60 + minute;
}
