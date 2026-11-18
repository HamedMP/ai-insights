import { isChatHarness, type Finding, type FindingKind, type Harness, type Session, type UsageTotals } from "../schema/types.js";
import { activeSpans, buildActivity, unionSpans } from "./activity.js";
import { detectFindings } from "./findings/index.js";
import { periodUsage, type UsageRange } from "./period-usage.js";
import { makeClock, shiftDay, type Clock } from "./time.js";
import { addRequest, emptyTotals, summarizeUsage, uniqueRequests } from "./usage.js";
import { uniqueSessions } from "./sessions.js";
import { TIP_LEADS } from "../nudge/tips.js";

/**
 * Today, this week, this month: the numbers behind the quick views and `--json`. Aggregates only: counts, minutes,
 * tokens, cost, agent and model names, and a tip in fixed wording. Project names appear only when asked for.
 */

export type PeriodKind = "today" | "week" | "month";
export const PERIOD_KINDS: readonly PeriodKind[] = ["today", "week", "month"];

export interface PeriodRange extends UsageRange {
  /** today, week, month, or `range` for --since/--until. */
  kind: PeriodKind | "range";
  /** How a tip names the period ("today", "in the last 5 days"); default from `kind`. */
  scope?: string;
}

export interface PeriodTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface AgentRow {
  agent: Harness;
  label: string;
  sessions: number;
  /** Null when not measured (chat exports) or nothing could be priced. */
  costUsd: number | null;
  /** Model requests the agent recorded in the period; 0 for an agent that records no usage (Cursor). */
  requests: number;
}

export interface ModelRow {
  model: string;
  costUsd: number | null;
  tokens: number;
}

export interface ProjectRow {
  project: string;
  sessions: number;
  activeMinutes: number;
  costUsd: number | null;
}

export interface Tip {
  /** The finding kind it comes from: stable, and never carries a command, path or prompt. */
  id: FindingKind;
  text: string;
}

export interface PeriodSummary {
  kind: PeriodRange["kind"];
  from: number;
  to: number;
  /** Sessions with activity inside the period. */
  sessions: number;
  /** Wall-clock minutes inside the period with at least one session active. */
  activeMinutes: number;
  /** The person's prompts sent inside the period. */
  prompts: number;
  /** Null when every session in the period is a chat export, which records no tokens. */
  tokens: PeriodTokens | null;
  /** API list-price estimate; null when not measured or nothing could be priced. */
  costUsd: number | null;
  requests: number;
  unpricedRequests: number;
  /** 0..1. */
  unpricedRequestShare: number;
  byAgent: AgentRow[];
  byModel: ModelRow[];
  /** Only when asked for (`--by project`). */
  byProject?: ProjectRow[];
  tip: Tip | null;
}

const DAY_MS = 86_400_000;

/** The instant a local calendar day (`YYYY-MM-DD`) starts in `clock`'s zone. */
export function startOfDay(day: string, clock: Clock): number {
  let at = clock.nextMidnight(Date.parse(`${day}T00:00:00Z`) - 2 * DAY_MS);
  for (let step = 0; step < 6 && clock.dayOfMs(at) < day; step += 1) at = clock.nextMidnight(at);
  return at;
}

/** ISO weekday 1 (Monday) to 7 (Sunday) of a calendar day. */
function isoWeekday(day: string): number {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function shiftMonth(day: string, months: number): string {
  const [year, month] = day.split("-").map(Number) as [number, number];
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** The calendar day a period of `kind` that contains `day` starts on, `back` periods earlier. */
export function periodStartDay(kind: PeriodKind, day: string, back = 0): string {
  if (kind === "today") return shiftDay(day, -back);
  if (kind === "week") return shiftDay(day, -(isoWeekday(day) - 1) - 7 * back);
  return shiftMonth(day, -back);
}

/** The current period of `kind` up to `now`, extended back over `last - 1` earlier periods. */
export function currentRange(kind: PeriodKind, now: Date, timeZone: string, last = 1): PeriodRange {
  const clock = makeClock(timeZone);
  const today = clock.dayOfMs(now.getTime());
  const units = { today: "days", week: "weeks", month: "months" } as const;
  const scope = last > 1 ? { scope: `in the last ${last} ${units[kind]}` } : {};
  return { kind, from: startOfDay(periodStartDay(kind, today, Math.max(0, last - 1)), clock), to: now.getTime() + 1, ...scope };
}

/** Each period of `kind` in `range`, oldest first; the last one ends at the range's end. */
export function splitRange(kind: PeriodKind, range: PeriodRange, timeZone: string): PeriodRange[] {
  const clock = makeClock(timeZone);
  const out: PeriodRange[] = [];
  let day = clock.dayOfMs(range.from);
  for (let guard = 0; guard < 400; guard += 1) {
    const from = startOfDay(day, clock);
    if (from >= range.to) break;
    const next = kind === "today" ? shiftDay(day, 1) : kind === "week" ? shiftDay(day, 7) : shiftMonth(day, 1);
    out.push({ kind, from, to: Math.min(range.to, startOfDay(next, clock)) });
    day = next;
  }
  return out;
}

/** `YYYY-MM-DD` to `YYYY-MM-DD`, both days included. */
export function calendarRange(since: string | undefined, until: string | undefined, now: Date, timeZone: string): PeriodRange {
  const clock = makeClock(timeZone);
  const from = since ? startOfDay(since, clock) : 0;
  const to = until ? startOfDay(shiftDay(until, 1), clock) : now.getTime() + 1;
  return { kind: "range", from, to: Math.min(to, now.getTime() + 1) };
}

/** `2026-11-18T00:00:00+02:00`: the instant as wall time in the zone, with its offset. */
export function isoInZone(ms: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) if (part.type !== "literal") parts[part.type] = part.value;
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  const minutes = Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const offset = `${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
  return `${parts.year}-${parts.month}-${parts.day}T${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}:${parts.second}${sign}${offset}`;
}

// -- the numbers ----------------------------------------------------------------

function overlaps(session: Session, range: UsageRange): boolean {
  const start = Date.parse(session.startTime);
  const end = Date.parse(session.endTime);
  return Number.isFinite(start) && Number.isFinite(end) && start < range.to && end >= range.from;
}

function activeMinutesIn(sessions: Session[], range: UsageRange): number {
  const spans: Array<[number, number]> = [];
  for (const session of sessions) {
    for (const [start, end] of activeSpans(session)) {
      const from = Math.max(start, range.from);
      const to = Math.min(end, range.to);
      if (to > from) spans.push([from, to]);
    }
  }
  return Math.round(unionSpans(spans).reduce((sum, [from, to]) => sum + (to - from), 0) / 60_000);
}

function promptsIn(sessions: Session[], range: UsageRange): number {
  let count = 0;
  for (const session of sessions) {
    for (const prompt of session.prompts) {
      const at = Date.parse(prompt.timestamp);
      if (at >= range.from && at < range.to) count += 1;
    }
  }
  return count;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const cost = (totals: UsageTotals | undefined) => (totals?.estimatedUsd === null || totals?.estimatedUsd === undefined ? null : round2(totals.estimatedUsd));

function projectName(session: Session): string | null {
  const path = session.projectRoot ?? session.projectPath;
  if (!path) return null;
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? null;
}

// -- the tip ----------------------------------------------------------------------

/** Kinds that coach how the person works; history and coverage notices are left to the full report. */
const LEADS: Partial<Record<FindingKind, (scope: string) => string>> = TIP_LEADS;

export function scopeText(range: Pick<PeriodRange, "kind" | "scope">): string {
  if (range.scope) return range.scope;
  return range.kind === "today" ? "today" : range.kind === "week" ? "this week" : range.kind === "month" ? "this month" : "in this period";
}

/** The first finding that coaches, as one line in fixed wording plus the suggestion's own (fixed) title. */
export function tipFrom(findings: Finding[], range: Pick<PeriodRange, "kind" | "scope">): Tip | null {
  for (const finding of findings) {
    const lead = LEADS[finding.kind];
    const title = finding.suggestion?.title?.trim();
    if (!lead || !title) continue;
    return { id: finding.kind, text: `${lead(scopeText(range))} ${title.replace(/[.!]$/u, "")}.` };
  }
  return null;
}

function findingsFor(sessions: Session[], clock: Clock, now: Date): Finding[] {
  const coding = uniqueSessions(sessions.filter((session) => !isChatHarness(session.harness)));
  if (coding.length === 0) return [];
  const requests = uniqueRequests(coding);
  const usage = summarizeUsage(requests, clock);
  const activity = buildActivity(coding, clock);
  try {
    return detectFindings({ sessions: coding, requests, usage, activity, coverage: [], now, clock });
  } catch {
    return [];
  }
}

export interface SummarizeOptions {
  timeZone: string;
  now: Date;
  labels: (harness: Harness) => string;
  byProject?: boolean;
  /** Skip the findings pass (series rows need only the numbers). */
  noTip?: boolean;
}

/**
 * The numbers for each range, from full sessions. Usage is counted exactly as the report counts it (`periodUsage`);
 * a session belongs to every period it was active in.
 */
export function summarizePeriods(all: Session[], ranges: PeriodRange[], options: SummarizeOptions): PeriodSummary[] {
  const sessions = uniqueSessions(all);
  const usage = periodUsage(sessions, ranges);
  const clock = makeClock(options.timeZone);
  return ranges.map((range, index) => {
    const inside = sessions.filter((session) => overlaps(session, range));
    const totals = usage[index]!;
    const measured = inside.length === 0 || inside.some((session) => !isChatHarness(session.harness));
    const agents = new Map<Harness, number>();
    for (const session of inside) agents.set(session.harness, (agents.get(session.harness) ?? 0) + 1);
    const byAgent: AgentRow[] = [...agents]
      .map(([agent, count]) => ({ agent, label: options.labels(agent), sessions: count, costUsd: isChatHarness(agent) ? null : cost(totals.byHarness.get(agent)), requests: totals.byHarness.get(agent)?.requests ?? 0 }))
      .sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1) || b.sessions - a.sessions || a.agent.localeCompare(b.agent));
    const models = new Map<string, { costUsd: number | null; tokens: number }>();
    for (const row of totals.byModel.values()) {
      const entry = models.get(row.model) ?? { costUsd: null, tokens: 0 };
      entry.tokens += row.tokens;
      if (row.estimatedUsd !== null) entry.costUsd = (entry.costUsd ?? 0) + row.estimatedUsd;
      models.set(row.model, entry);
    }
    const byModel: ModelRow[] = [...models]
      .map(([model, entry]) => ({ model, costUsd: entry.costUsd === null ? null : round2(entry.costUsd), tokens: entry.tokens }))
      .sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1) || b.tokens - a.tokens || a.model.localeCompare(b.model))
      .slice(0, 10);
    const t = totals.totals;
    const summary: PeriodSummary = {
      kind: range.kind,
      from: range.from,
      to: range.to,
      sessions: inside.length,
      activeMinutes: activeMinutesIn(inside, range),
      prompts: promptsIn(inside, range),
      tokens: measured ? { input: t.input, output: t.output, cacheRead: t.cachedInput, cacheWrite: t.cacheWrite, total: t.tokens } : null,
      costUsd: !measured ? null : t.estimatedUsd !== null ? round2(t.estimatedUsd) : t.requests === 0 && inside.length === 0 ? 0 : null,
      requests: t.requests,
      unpricedRequests: t.unpriced,
      unpricedRequestShare: t.requests > 0 ? Math.round((t.unpriced / t.requests) * 1000) / 1000 : 0,
      byAgent,
      byModel,
      tip: options.noTip ? null : tipFrom(findingsFor(inside, clock, options.now), range),
    };
    if (options.byProject) summary.byProject = projectRows(inside, range, sessions);
    return summary;
  });
}

function projectRows(inside: Session[], range: PeriodRange, all: Session[]): ProjectRow[] {
  const groups = new Map<string, { sessions: Session[]; totals: UsageTotals }>();
  const group = (session: Session) => {
    const name = projectName(session) ?? "(no project)";
    let entry = groups.get(name);
    if (!entry) groups.set(name, (entry = { sessions: [], totals: emptyTotals() }));
    return entry;
  };
  for (const session of inside) group(session).sessions.push(session);
  // A request counts once, for the session that owns it in the report, so projects add up to the period's total.
  for (const { session, request, usd } of uniqueRequests(all)) {
    const at = Date.parse(request.timestamp);
    if (!(at >= range.from && at < range.to)) continue;
    addRequest(group(session).totals, request.usage, usd);
  }
  return [...groups]
    .map(([project, entry]) => ({ project, sessions: entry.sessions.length, activeMinutes: activeMinutesIn(entry.sessions, range), costUsd: cost(entry.totals) }))
    .sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1) || b.activeMinutes - a.activeMinutes || a.project.localeCompare(b.project))
    .slice(0, 20);
}
