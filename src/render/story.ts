import type { Finding, FindingKind, Report, Suggestion } from "../schema/types.js";
import { count, dayNumber, formatCompact, formatDay, formatHours, formatInt, formatUsd, plural, shortenPath } from "./format.js";
import { harnessLabel } from "./labels.js";

/**
 * Turns a Report into plain second-person sentences, each stating one fact with
 * its number. Pure and deterministic. A line is null when the data behind it is
 * missing or too thin to call a pattern: no line beats an invented one.
 */

export interface Segment {
  text: string;
  /** The number or name the sentence is about; the page emphasises it. */
  strong?: boolean;
}
export type Line = Segment[];

export function lineText(line: Line): string {
  return line.map((segment) => segment.text).join("");
}

const s = (text: string): Segment => ({ text });
const b = (text: string): Segment => ({ text, strong: true });

export interface HookNumber {
  value: string;
  label: string;
  /** A caveat the number needs, e.g. requests left out of a cost. */
  note?: string;
}

export interface Story {
  headline: Line;
  subline: Line | null;
  numbers: HookNumber[];
  hours: Line | null;
  week: Line | null;
  delegation: Line | null;
  parallel: Line | null;
  where: Line | null;
  tokens: Line | null;
  friction: Line | null;
  history: Line | null;
}

/** Below these, a "most of the time" claim would rest on a handful of points. */
const MIN_MESSAGES_FOR_HOURS = 10;
const MIN_SPAN_DAYS_FOR_WEEK = 14;
const MIN_ACTIVE_DAYS_FOR_WEEK = 5;
/** The headline calls out parallel work or heavy delegation only when it is striking. */
const HEADLINE_MIN_CONCURRENT = 3;
const HEADLINE_MIN_STEPS = 8;
const PEAK_WINDOW_HOURS = 4;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Kinds that are opportunities or history notes, not problems. */
export const NOT_A_PROBLEM: ReadonlySet<string> = new Set(["unused_feature", "history_disk_usage", "short_history", "single_harness_only"]);

const ERROR_PHRASES: Record<string, string> = {
  command_failed: "a failed command",
  file_not_found: "a missing file",
  file_changed: "a file that changed underneath",
  edit_mismatch: "an edit that did not match",
  permission_denied: "a denied permission",
  user_rejected: "you rejecting the call",
  timeout: "a timeout",
  too_large: "output that was too large",
};

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Home-relative path when under home (it names the folder without the username), else the folder name. */
function projectName(path: string): string {
  const short = shortenPath(path).replace(/[\\/]+$/, "");
  if (short.startsWith("~")) return short.length > 48 ? `…${short.slice(-47)}` : short;
  return short.split(/[\\/]/).pop() || short;
}

function stepsPerMessage(report: Report): number | null {
  const user = count(report.activity.userMessages);
  const agent = count(report.activity.assistantMessages);
  return user > 0 && agent > 0 ? agent / user : null;
}

function harnessNames(report: Report): string[] {
  return (report.activity.byHarness ?? []).filter((entry) => count(entry.sessions) > 0).map((entry) => harnessLabel(entry.harness));
}

/** "between Jun 18 and Nov 13, 2026", or "on Nov 13, 2026" for a single day. */
function rangePhrase(report: Report): string | null {
  const days = (report.activity.daily ?? []).map((entry) => dayNumber(entry.day)).filter((day): day is number => day !== null);
  if (days.length === 0) return null;
  const first = Math.min(...days);
  const last = Math.max(...days);
  const full: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  if (first === last) return `on ${formatDay(last, full)}`;
  const sameYear = formatDay(first, { year: "numeric" }) === formatDay(last, { year: "numeric" });
  return `between ${formatDay(first, sameYear ? { month: "short", day: "numeric" } : full)} and ${formatDay(last, full)}`;
}

function headline(report: Report): Line {
  const { activity } = report;
  const sessions = count(activity.sessions);
  if (sessions === 0) return [s("Hindsight did not find any coding-agent history on this machine yet.")];
  const concurrent = count(activity.parallelSessions?.maxConcurrent);
  if (concurrent >= HEADLINE_MIN_CONCURRENT && count(activity.parallelSessions?.overlapEvents) > 0) {
    return [s("You ran up to "), b(`${formatInt(concurrent)} agent sessions`), s(" at the same time.")];
  }
  const steps = stepsPerMessage(report);
  if (steps !== null && steps >= HEADLINE_MIN_STEPS) {
    return [s("Every message you sent set off about "), b(`${formatInt(steps)} agent steps`), s(".")];
  }
  const days = count(activity.activeDays);
  return [s("You spent "), b(formatHours(activity.totalActiveMinutes)), s(" hands-on with coding agents"), ...(days > 0 ? [s(" over "), b(plural(days, "day")), s(".")] : [s(".")])];
}

function subline(report: Report): Line | null {
  const sessions = count(report.activity.sessions);
  if (sessions === 0) return null;
  const names = harnessNames(report);
  const range = rangePhrase(report);
  return [s("You ran "), b(plural(sessions, "session")), s(names.length > 0 ? ` in ${list(names)}` : ""), s(range ? ` ${range}.` : ".")];
}

function numbers(report: Report): HookNumber[] {
  const { activity, usage } = report;
  if (count(activity.sessions) === 0) return [];
  const lines = count(activity.linesAdded) + count(activity.linesRemoved);
  const out: HookNumber[] = [
    { value: formatHours(activity.totalActiveMinutes), label: "Hands-on time" },
    { value: formatInt(activity.sessions), label: "Sessions" },
    { value: formatCompact(lines), label: "Lines changed" },
  ];
  const usd = typeof usage.estimatedUsd === "number" && Number.isFinite(usage.estimatedUsd) ? usage.estimatedUsd : null;
  const unpriced = count(usage.unpriced);
  if (usd !== null) {
    out.push({ value: formatUsd(usd), label: "At API list prices", ...(unpriced > 0 ? { note: `excludes ${plural(unpriced, "unpriced request")}` } : {}) });
  } else {
    out.push({ value: formatCompact(usage.tokens), label: "Tokens" });
  }
  return out;
}

/** The busiest run of hours, wrapping past midnight. */
export function peakWindow(hours: number[], width = PEAK_WINDOW_HOURS): { start: number; share: number; total: number } | null {
  const values = Array.from({ length: 24 }, (_, hour) => count(hours[hour]));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  let best = -1;
  let start = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    let sum = 0;
    for (let offset = 0; offset < width; offset += 1) sum += values[(hour + offset) % 24]!;
    if (sum > best) {
      best = sum;
      start = hour;
    }
  }
  return { start, share: best / total, total };
}

function hoursLine(report: Report): Line | null {
  const peak = peakWindow(report.activity.hourHistogram ?? []);
  if (!peak || peak.total < MIN_MESSAGES_FOR_HOURS) return null;
  const from = `${String(peak.start).padStart(2, "0")}:00`;
  const to = `${String((peak.start + PEAK_WINDOW_HOURS) % 24).padStart(2, "0")}:00`;
  return [s("You do most of your work between "), b(`${from} and ${to}`), s(": "), b(pct(peak.share)), s(" of your messages land there.")];
}

/** Sessions per weekday (Monday first) over the daily buckets. */
export function weekdayTotals(report: Report): { totals: number[]; spanDays: number; activeDays: number } {
  const totals = new Array<number>(7).fill(0);
  const days: number[] = [];
  let activeDays = 0;
  for (const entry of report.activity.daily ?? []) {
    const day = dayNumber(entry.day);
    if (day === null) continue;
    days.push(day);
    const sessions = count(entry.sessions);
    if (sessions > 0) activeDays += 1;
    const weekday = (((day + 3) % 7) + 7) % 7;
    totals[weekday] = totals[weekday]! + sessions;
  }
  const spanDays = days.length > 0 ? Math.max(...days) - Math.min(...days) + 1 : 0;
  return { totals, spanDays, activeDays };
}

function weekLine(report: Report): Line | null {
  const { totals, spanDays, activeDays } = weekdayTotals(report);
  const sum = totals.reduce((total, value) => total + value, 0);
  if (sum === 0 || spanDays < MIN_SPAN_DAYS_FOR_WEEK || activeDays < MIN_ACTIVE_DAYS_FOR_WEEK) return null;
  const busiest = totals.indexOf(Math.max(...totals));
  const weekend = (totals[5]! + totals[6]!) / sum;
  return [s("Your busiest day is "), b(WEEKDAYS[busiest]!), s(", and "), b(pct(weekend)), s(" of your sessions fall on weekends.")];
}

function delegationLine(report: Report): Line | null {
  const steps = stepsPerMessage(report);
  if (steps === null) return null;
  const lines = count(report.activity.linesAdded) + count(report.activity.linesRemoved);
  const sessions = count(report.activity.sessions);
  const tail: Line = lines > 0 && sessions > 0 ? [s(", and your agents changed "), b(`${formatCompact(lines)} lines`), s(` across ${plural(sessions, "session")}.`)] : [s(".")];
  return [s("Each message you send gets about "), b(`${formatInt(Math.max(1, steps))} agent ${Math.round(steps) === 1 ? "step" : "steps"}`), s(" back"), ...tail];
}

function parallelLine(report: Report): Line | null {
  const sessions = count(report.activity.sessions);
  if (sessions < 2) return null;
  const parallel = report.activity.parallelSessions;
  if (!parallel) return null;
  const concurrent = count(parallel.maxConcurrent);
  if (count(parallel.overlapEvents) > 0 && concurrent >= 2) {
    const involved = Math.min(count(parallel.sessionsInvolved), sessions);
    return [s("You ran up to "), b(`${formatInt(concurrent)} sessions at once`), s(", and "), b(`${formatInt(involved)} of ${formatInt(sessions)}`), s(" sessions overlapped with another.")];
  }
  return [s("You ran your "), b(plural(sessions, "session")), s(" one at a time.")];
}

function whereLine(report: Report): Line | null {
  const harnesses = (report.activity.byHarness ?? []).filter((entry) => count(entry.sessions) > 0);
  const total = harnesses.reduce((sum, entry) => sum + count(entry.sessions), 0);
  if (total === 0) return null;
  const projects = (report.activity.projects ?? []).filter((entry) => count(entry.activeMinutes) > 0 && typeof entry.projectPath === "string" && entry.projectPath);
  const projectMinutes = projects.reduce((sum, entry) => sum + count(entry.activeMinutes), 0);
  const top = [...projects].sort((a, b2) => count(b2.activeMinutes) - count(a.activeMinutes))[0];
  const projectPart: Line =
    top && projectMinutes > 0 && projects.length > 1
      ? [s("; "), b(pct(count(top.activeMinutes) / projectMinutes)), s(" of your time went to "), b(projectName(top.projectPath)), s(".")]
      : [s(".")];
  if (harnesses.length === 1) {
    return [s("All "), b(plural(total, "session")), s(" ran in "), b(harnessLabel(harnesses[0]!.harness)), ...projectPart];
  }
  const sorted = [...harnesses].sort((a, b2) => count(b2.sessions) - count(a.sessions)).slice(0, 4);
  const parts: Line = [s("You split your sessions between ")];
  sorted.forEach((entry, index) => {
    if (index > 0) parts.push(s(index === sorted.length - 1 ? " and " : ", "));
    parts.push(b(`${harnessLabel(entry.harness)} (${pct(count(entry.sessions) / total)})`));
  });
  return [...parts, ...projectPart];
}

function tokensLine(report: Report): Line | null {
  const { usage } = report;
  if (count(usage.tokens) === 0) return null;
  const line: Line = [s("Your agents moved "), b(`${formatCompact(usage.tokens)} tokens`)];
  const rate = typeof usage.cacheHitRate === "number" && Number.isFinite(usage.cacheHitRate) ? usage.cacheHitRate : null;
  line.push(rate !== null ? s("; ") : s("."));
  if (rate !== null) line.push(b(pct(rate)), s(" of their input came from cache."));
  const usd = typeof usage.estimatedUsd === "number" && Number.isFinite(usage.estimatedUsd) ? usage.estimatedUsd : null;
  if (usd !== null) {
    line.push(s(count(usage.unpriced) > 0 ? " At API list prices the priced part comes to about " : " At API list prices that is about "), b(formatUsd(usd)), s("."));
  }
  return line;
}

export function problemFindings(report: Report): Finding[] {
  return (report.findings ?? []).filter((finding) => !NOT_A_PROBLEM.has(finding.kind));
}

function frictionLine(report: Report): Line | null {
  const errors = (report.activity.toolErrors ?? []).filter((entry) => count(entry.count) > 0);
  const errorTotal = errors.reduce((sum, entry) => sum + count(entry.count), 0);
  const calls = (report.activity.toolCategories ?? []).reduce((sum, entry) => sum + count(entry.count), 0);
  const problems = problemFindings(report).length;
  const line: Line = [];
  if (calls > 0 && errorTotal > 0) {
    const top = [...errors].sort((a, b2) => count(b2.count) - count(a.count))[0]!;
    const share = errorTotal / calls;
    const shareText = share < 0.01 ? "Under 1%" : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
    line.push(b(shareText), s(" of your agents' tool calls failed"));
    const phrase = ERROR_PHRASES[top.key];
    line.push(s(phrase ? `, most often ${phrase}.` : "."));
  } else if (calls > 0) {
    line.push(s("Your agents' "), b(`${formatCompact(calls)} tool calls`), s(" ran without a recorded error."));
  }
  if (problems > 0) {
    if (line.length > 0) line.push(s(" "));
    line.push(s("Hindsight found "), b(plural(problems, "pattern")), s(" worth fixing."));
  }
  return line.length > 0 ? line : null;
}

function historyLine(report: Report): Line | null {
  const found = (report.coverage ?? []).filter((entry) => entry.found);
  const oldest = found.map((entry) => Date.parse(entry.oldest ?? "")).filter(Number.isFinite);
  const newest = found.map((entry) => Date.parse(entry.newest ?? "")).filter(Number.isFinite);
  if (oldest.length === 0 || newest.length === 0) return null;
  const days = Math.max(1, Math.round((Math.max(...newest) - Math.min(...oldest)) / 86_400_000) + 1);
  return [s("Your local history goes back "), b(plural(days, "day")), s(".")];
}

export function buildStory(report: Report, _zone: string): Story {
  return {
    headline: headline(report),
    subline: subline(report),
    numbers: numbers(report),
    hours: hoursLine(report),
    week: weekLine(report),
    delegation: delegationLine(report),
    parallel: parallelLine(report),
    where: whereLine(report),
    tokens: tokensLine(report),
    friction: frictionLine(report),
    history: historyLine(report),
  };
}

// ---------------------------------------------------------------------------
// Tips per chapter and the ranked list of actions
// ---------------------------------------------------------------------------

export type ChapterId = "rhythm" | "delegation" | "parallel" | "coverage" | "usage" | "friction";

/** Which finding kinds speak to which chapter, strongest first within equal severity. */
const CHAPTER_KINDS: Record<ChapterId, FindingKind[]> = {
  rhythm: ["long_sessions"],
  delegation: ["frequent_interruptions", "slow_correction", "repeated_instruction", "unused_feature"],
  parallel: [],
  coverage: ["single_harness_only"],
  usage: ["cache_miss_cost", "expensive_model_for_simple_work", "context_resets"],
  friction: ["repeated_failed_command", "tool_error_hotspot", "permission_prompt_load", "no_tests_before_done"],
};

const SEVERITY_WEIGHT: Record<string, number> = { high: 40, medium: 30, low: 20, info: 10 };
const NARRATIVE_WEIGHT = 25;

function usable(suggestion: Suggestion | undefined): suggestion is Suggestion {
  return !!suggestion && typeof suggestion.title === "string" && suggestion.title.trim() !== "" && suggestion.type !== "matrix";
}

/** The strongest finding with a suggestion for each chapter; each finding is used once. */
export function chapterTips(report: Report): Record<ChapterId, Finding | null> {
  const used = new Set<Finding>();
  const out = {} as Record<ChapterId, Finding | null>;
  for (const chapter of Object.keys(CHAPTER_KINDS) as ChapterId[]) {
    const kinds = CHAPTER_KINDS[chapter];
    const candidates = (report.findings ?? [])
      .map((finding, index) => ({ finding, index }))
      .filter(({ finding }) => kinds.includes(finding.kind) && usable(finding.suggestion) && !used.has(finding))
      .sort(
        (a, b2) =>
          (SEVERITY_WEIGHT[b2.finding.severity] ?? 0) - (SEVERITY_WEIGHT[a.finding.severity] ?? 0) ||
          kinds.indexOf(a.finding.kind) - kinds.indexOf(b2.finding.kind) ||
          a.index - b2.index,
      );
    const pick = candidates[0]?.finding ?? null;
    if (pick) used.add(pick);
    out[chapter] = pick;
  }
  return out;
}

export interface RankedAction {
  suggestion: Suggestion;
  /** The finding behind it, or null for a suggestion from the narrative. */
  finding: Finding | null;
  /** Why this matters, in one line. */
  why: string;
  score: number;
}

/** Kinds whose suggestion belongs to a closing card rather than the action list. */
const CLOSING_KINDS: ReadonlySet<string> = new Set(["history_disk_usage", "short_history"]);

export function rankActions(report: Report): { top: RankedAction[]; rest: RankedAction[] } {
  const candidates: Array<RankedAction & { order: number }> = [];
  let order = 0;
  for (const finding of report.findings ?? []) {
    if (CLOSING_KINDS.has(finding.kind) || !usable(finding.suggestion)) continue;
    const suggestion = finding.suggestion;
    const score = (SEVERITY_WEIGHT[finding.severity] ?? 0) + (suggestion.instructionText ? 5 : 0) + (suggestion.url ? 3 : 0);
    candidates.push({ suggestion, finding, why: finding.title, score, order: order++ });
  }
  for (const suggestion of report.narrative?.suggestions ?? []) {
    if (!usable(suggestion)) continue;
    const score = NARRATIVE_WEIGHT + (suggestion.instructionText ? 5 : 0) + (suggestion.url ? 3 : 0);
    candidates.push({ suggestion, finding: null, why: "From your agent's review of your sessions.", score, order: order++ });
  }
  candidates.sort((a, b2) => b2.score - a.score || a.order - b2.order);
  const seen = new Set<string>();
  const unique: RankedAction[] = [];
  for (const { order: _order, ...candidate } of candidates) {
    const key = candidate.suggestion.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return { top: unique.slice(0, 3), rest: unique.slice(3) };
}
