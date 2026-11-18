import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tipText } from "./tips.js";

// The saved digest (docs/digest-json.md): counts for today, this week and this month that the commands a person
// runs write to the store, so the session-start hook, the statusline and scheduled notifications can show them
// without reading any history. Node built-ins only: this file is compiled into the plugin's hook.

export const DIGEST_FILE = "digest.json";
export const DIGEST_SCHEMA_VERSION = 1;
/** The file is a few hundred bytes; anything far bigger is not ours. */
const MAX_DIGEST_BYTES = 64 * 1024;

export type DigestPeriodKind = "today" | "week" | "month";

export interface DigestPeriod {
  /** Local ISO time with offset, e.g. 2026-11-16T00:00:00+02:00. */
  from: string;
  to: string;
  sessions: number;
  activeMinutes: number;
  prompts: number;
  contextResets: number;
  /** Null when not measured (chat exports only). */
  tokens: number | null;
  /** API list-price estimate; null when not measured or nothing could be priced. */
  costUsd: number | null;
  tip: { id: string } | null;
}

export interface Digest {
  schemaVersion: typeof DIGEST_SCHEMA_VERSION;
  writtenAt: string;
  timezone: string;
  periods: Record<DigestPeriodKind, DigestPeriod>;
}

const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;
const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1e12;
const nullableNumber = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);

function period(value: unknown): DigestPeriod | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.from !== "string" || !ISO_LOCAL.test(v.from) || typeof v.to !== "string" || !ISO_LOCAL.test(v.to)) return null;
  if (![v.sessions, v.activeMinutes, v.prompts, v.contextResets].every(count) || !nullableNumber(v.tokens) || !nullableNumber(v.costUsd)) return null;
  const tip = v.tip && typeof v.tip === "object" && typeof (v.tip as { id?: unknown }).id === "string" ? { id: (v.tip as { id: string }).id.slice(0, 64) } : null;
  return { from: v.from, to: v.to, sessions: v.sessions as number, activeMinutes: v.activeMinutes as number, prompts: v.prompts as number, contextResets: v.contextResets as number, tokens: v.tokens as number | null, costUsd: v.costUsd as number | null, tip };
}

/** The digest, or null when it is missing, damaged or of another version. Never throws. */
export async function readDigest(home: string): Promise<Digest | null> {
  try {
    const raw = await readFile(join(home, DIGEST_FILE), "utf8");
    if (raw.length > MAX_DIGEST_BYTES) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.schemaVersion !== DIGEST_SCHEMA_VERSION || typeof value.writtenAt !== "string" || !Number.isFinite(Date.parse(value.writtenAt))) return null;
    const periods = value.periods as Record<string, unknown> | undefined;
    if (!periods || typeof periods !== "object") return null;
    const today = period(periods.today);
    const week = period(periods.week);
    const month = period(periods.month);
    if (!today || !week || !month) return null;
    return { schemaVersion: DIGEST_SCHEMA_VERSION, writtenAt: value.writtenAt, timezone: typeof value.timezone === "string" ? value.timezone.slice(0, 64) : "UTC", periods: { today, week, month } };
  } catch {
    return null;
  }
}

// -- local calendar keys (the machine's time zone, as the hook runs there) --------------------------------------

const pad = (value: number) => String(value).padStart(2, "0");
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function shifted(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}
/** The Monday that starts the week containing `date`, as a day key. */
export function weekStartKey(date: Date): string {
  const weekday = (date.getDay() + 6) % 7;
  return dayKey(shifted(date, -weekday));
}
function monthStartKey(date: Date, back = 0): string {
  return dayKey(new Date(date.getFullYear(), date.getMonth() - back, 1, 12));
}

export type Cadence = "daily" | "weekly" | "monthly";
export const CADENCES: readonly Cadence[] = ["daily", "weekly", "monthly"];

const KIND: Record<Cadence, DigestPeriodKind> = { daily: "today", weekly: "week", monthly: "month" };
const NOUN: Record<Cadence, string> = { daily: "day", weekly: "week", monthly: "month" };

/**
 * Which saved period to talk about and how to name it: the current one ("this week") or the one just ended ("last
 * week"), whichever the digest holds. Null when the digest is about an older period, which would mislead.
 */
export function digestPeriod(digest: Digest, cadence: Cadence, now: Date): { period: DigestPeriod; scope: string } | null {
  const kind = KIND[cadence];
  const saved = digest.periods[kind];
  const start = saved.from.slice(0, 10);
  const current = cadence === "daily" ? dayKey(now) : cadence === "weekly" ? weekStartKey(now) : monthStartKey(now);
  const previous = cadence === "daily" ? dayKey(shifted(now, -1)) : cadence === "weekly" ? weekStartKey(shifted(now, -7)) : monthStartKey(now, 1);
  const noun = NOUN[cadence];
  const upTo = saved.to.slice(0, 10);
  // Counts from a run made before the period ended say how far they go, so a partial week never reads as a whole one.
  if (start === current) return { period: saved, scope: `${cadence === "daily" ? "today" : `this ${noun}`}${upTo === dayKey(now) ? "" : ` (to ${dayLabel(upTo)})`}` };
  if (start === previous) {
    const lastDay = dayKey(shifted(new Date(`${current}T12:00:00`), -1));
    const complete = cadence === "daily" ? saved.to.slice(11, 13) >= "23" : upTo === lastDay;
    return { period: saved, scope: `${cadence === "daily" ? "yesterday" : `last ${noun}`}${complete ? "" : ` (to ${cadence === "daily" ? saved.to.slice(11, 16) : dayLabel(upTo)})`}` };
  }
  return null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Wed 12 Nov" for a day key. */
function dayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function hours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const value = minutes / 60;
  return value >= 10 ? `${Math.round(value)} h` : `${value.toFixed(1)} h`;
}

const plural = (value: number, word: string) => `${value.toLocaleString("en-US")} ${word}${value === 1 ? "" : "s"}`;

/** One counts-only line for the period, or null when the digest has nothing current to say. */
export function digestLine(digest: Digest, cadence: Cadence, now: Date, off: string): string | null {
  const found = digestPeriod(digest, cadence, now);
  if (!found || found.period.sessions === 0) return null;
  const { period: p, scope } = found;
  const counts = [plural(p.sessions, "session"), `${hours(p.activeMinutes)} active`, ...(p.contextResets > 0 ? [plural(p.contextResets, "context reset")] : [])];
  const tip = p.tip ? tipText(p.tip.id, scope.replace(/ \(to [^)]*\)$/u, "")) : null;
  return `AI Insights: ${scope} ${counts.join(", ")}.${tip ? ` ${tip}` : ""} Run /analyze-ai-usage for the full review. (${off})`;
}
