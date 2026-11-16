import type { Activity, Count, FacetAggregate, Recap, UsageSummary, UsageTotals } from "../schema/types.js";
import { shortenPath } from "../render/format.js";

/** Weeks of history a digest series keeps, newest last. */
export const DIGEST_WEEKS = 8;

const DAY_MS = 86_400_000;

/** The Monday (UTC date) of the week a `YYYY-MM-DD` day falls in, or null for anything else. */
export function weekOf(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - weekday * DAY_MS).toISOString().slice(0, 10);
}

/** Group daily rows into weeks, summing the numeric fields named, and keep the newest `weeks`. */
function weekly<T extends { day: string }, K extends keyof T & string>(rows: T[], fields: K[], weeks: number): Array<{ week: string } & Record<K, number>> {
  const byWeek = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const week = weekOf(row.day);
    if (!week) continue;
    const sums = byWeek.get(week) ?? Object.fromEntries(fields.map((field) => [field, 0]));
    for (const field of fields) {
      const value = row[field];
      if (typeof value === "number" && Number.isFinite(value)) sums[field] = (sums[field] ?? 0) + value;
    }
    byWeek.set(week, sums);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-weeks)
    .map(([week, sums]) => ({ week, ...sums }) as { week: string } & Record<K, number>);
}

/** Top entries as a compact `{ key: count }` object. */
function top(counts: Count[], limit: number): Record<string, number> {
  return Object.fromEntries([...counts].sort((a, b) => b.count - a.count).slice(0, limit).map((entry) => [entry.key, entry.count]));
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const MAX_PROJECT_LABEL = 60;

/**
 * How a project is named everywhere the agent sees one: under home, the page's own form (`~/projects/app`),
 * which hides the username; elsewhere the last two folders. Long paths keep their tail, the part that names it.
 */
export function projectLabel(path: string): string {
  const short = shortenPath(path);
  const label = short.startsWith("~") ? short : path.split(/[\\/]+/).filter(Boolean).slice(-2).join("/") || path;
  return label.length <= MAX_PROJECT_LABEL ? label : `…${label.slice(-(MAX_PROJECT_LABEL - 1))}`;
}

export function activityDigest(activity: Activity, weeks = DIGEST_WEEKS) {
  const peakHours = activity.hourHistogram
    .map((count, hour) => ({ hour, count }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((entry) => entry.hour);
  return {
    sessions: activity.sessions,
    activeDays: activity.activeDays,
    longestStreakDays: activity.longestStreakDays,
    activeHours: typeof activity.wallClockActiveMinutes === "number" ? round(activity.wallClockActiveMinutes / 60) : null,
    agentHours: round(activity.totalActiveMinutes / 60),
    userMessages: activity.userMessages,
    linesAdded: activity.linesAdded,
    linesRemoved: activity.linesRemoved,
    gitCommits: activity.gitCommits,
    peakHours,
    medianResponseTimeSec: activity.medianResponseTimeSec,
    parallel: activity.parallelSessions.maxConcurrent,
    byHarness: Object.fromEntries(activity.byHarness.map((entry) => [entry.harness, entry.sessions])),
    projects: Object.fromEntries(
      [...activity.projects]
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 5)
        // Rows are keyed by repository root; the worktree count shows when several folders were folded in.
        .map((entry) => [projectLabel(entry.projectPath), (entry.worktrees ?? 1) > 1 ? { sessions: entry.sessions, worktrees: entry.worktrees } : entry.sessions]),
    ),
    languages: top(activity.languages, 5),
    tools: top(activity.tools, 8),
    toolErrors: top(activity.toolErrors, 5),
    features: {
      mcpServers: top(activity.features.mcpServers, 5),
      skills: top(activity.features.skills, 5),
      subagentSessions: activity.features.sessionsWithSubagents,
      planModeSessions: activity.features.sessionsWithPlanMode,
      compactions: activity.features.compactions,
    },
    weekly: weekly(activity.daily, ["sessions", "activeMinutes"], weeks),
  };
}

export function usageDigest(usage: UsageSummary, weeks = DIGEST_WEEKS) {
  const usd = (value: number | null) => (value === null ? null : round(value, 2));
  return {
    tokens: usage.tokens,
    requests: usage.requests,
    estimatedUsd: usd(usage.estimatedUsd),
    unpriced: usage.unpriced,
    cacheHitRate: usage.cacheHitRate === null ? null : round(usage.cacheHitRate, 3),
    // Keyed by model name: the name already says which vendor, and unpriced appears only when it matters.
    models: Object.fromEntries(
      [...usage.models]
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 5)
        .map((model, _index, list) => [
          list.filter((other) => other.model === model.model).length > 1 ? `${model.model} (${model.harness})` : model.model,
          { tokens: model.tokens, usd: usd(model.estimatedUsd), ...(model.unpriced > 0 ? { unpriced: model.unpriced } : {}) },
        ]),
    ),
    weekly: weekly(usage.daily as Array<UsageTotals & { day: string }>, ["tokens"], weeks),
  };
}

export function facetsDigest(facets: FacetAggregate | null) {
  if (!facets) return null;
  return {
    sessionsWithFacets: facets.sessionsWithFacets,
    goalCategories: top(facets.goalCategories, 6),
    sessionTypes: top(facets.sessionTypes, 5),
    outcomes: top(facets.outcomes, 6),
    helpfulness: top(facets.helpfulness, 5),
    satisfaction: top(facets.satisfaction, 5),
    frictions: top(facets.frictions, 6),
    successes: top(facets.successes, 5),
  };
}

/** The recap's headline numbers: what a share card would say, already free of names and text by construction. */
export function recapDigest(recap: Recap | undefined) {
  if (!recap) return null;
  return {
    range: recap.range,
    persona: recap.persona?.title ?? null,
    rhythm: recap.rhythm ? { verdict: recap.rhythm.verdict.label, peakHour: recap.rhythm.peakHour, nightShare: round(recap.rhythm.nightShare, 3) } : null,
    totals: {
      sessions: recap.totals.sessions,
      prompts: recap.totals.prompts,
      activeDays: recap.totals.activeDays,
      wallHours: round(recap.totals.wallHours),
      agentHours: round(recap.totals.agentHours),
      toolCalls: recap.totals.toolCalls,
      toolCallsCapped: recap.totals.toolCallsCapped,
      commits: recap.totals.commits,
    },
    streakDays: recap.streak.days,
    bigDayPrompts: recap.bigDay?.prompts ?? null,
    topWord: recap.voice.words[0]?.key ?? null,
    topSlash: recap.slash[0]?.key ?? null,
    topProgram: recap.shell.programs[0]?.key ?? null,
    topModel: recap.models[0]?.key ?? null,
    testPass: recap.shell.testPass === undefined ? null : round(recap.shell.testPass, 3),
    failureRate: round(recap.failures.rate, 3),
    maxParallel: recap.parallel.max,
    winRate: recap.winRate === undefined ? null : round(recap.winRate, 3),
  };
}
