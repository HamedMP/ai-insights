import {
  RECAP_VERSION,
  type Activity,
  type FacetAggregate,
  type Finding,
  type Recap,
  type RecapModel,
  type RecapPersona,
  type RecapTip,
  type RecapUsage,
  type Session,
  type UsageSummary,
} from "../../schema/types.js";
import { daysBetween, type Clock } from "../time.js";
import { buildRhythm, weekdayOf } from "./rhythm.js";
import { modelLabel } from "./text.js";
import { AUTO_REVIEW_MODEL, TIP_TITLES } from "./vocabulary.js";
import { buildVoice } from "./voice.js";
import { buildLanes } from "./lanes.js";
import { buildApprovals, buildFailures, buildFeatures, buildLongestSession, buildReplies, buildShell, buildSlash, buildThinking, toolCallsCapped } from "./work.js";

export { MAX_REPLY_SEC, toolCallsCapped } from "./work.js";

/** Days kept in `Recap.daily`: more than a year, so a year recap has every day. */
export const MAX_RECAP_DAYS = 400;
const MAX_MODELS = 4;
const MAX_TIPS = 3;
/** About 0.75 words per output token and 90,000 words per novel. */
const WORDS_PER_TOKEN = 0.75;
const WORDS_PER_NOVEL = 90_000;

export interface RecapInput {
  /** De-duplicated sessions, the ones the report was built from. */
  sessions: Session[];
  activity: Activity;
  usage: UsageSummary;
  findings: Finding[];
  facets: FacetAggregate | null;
  clock: Clock;
  timeZone: string;
  generatedAt: string;
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2, info: 3 } as const;

function range(sessions: Session[], clock: Clock): Recap["range"] | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const session of sessions) {
    for (const value of [session.startTime, session.endTime]) {
      const day = clock.day(value);
      if (!day) continue;
      if (from === null || day < from) from = day;
      if (to === null || day > to) to = day;
    }
  }
  return from && to ? { from, to, days: daysBetween(from, to) + 1 } : null;
}

function streakOf(daily: Recap["daily"]): Recap["streak"] {
  let best = { days: 0, end: null as string | null };
  let run = 0;
  for (const day of daily) {
    run = day.prompts > 0 || day.minutes > 0 ? run + 1 : 0;
    if (run > best.days) best = { days: run, end: day.day };
  }
  const endIndex = best.end === null ? -1 : daily.findIndex((day) => day.day === best.end);
  return { days: best.days, start: endIndex >= 0 ? daily[endIndex - best.days + 1]!.day : null, end: best.end };
}

function modelsOf(usage: UsageSummary): { models: RecapModel[]; requests: number } {
  const chosen = usage.models.filter((model) => model.model !== AUTO_REVIEW_MODEL);
  const requests = chosen.reduce((sum, model) => sum + model.requests, 0);
  const rows = new Map<string, Omit<RecapModel, "share">>();
  for (const model of chosen) {
    const key = modelLabel(model.model);
    const row = rows.get(key) ?? { key, harness: model.harness, requests: 0 };
    row.requests += model.requests;
    rows.set(key, row);
  }
  const models = [...rows.values()]
    .filter((row) => row.requests > 0)
    .sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key))
    .slice(0, MAX_MODELS)
    .map((row) => ({ ...row, share: requests ? row.requests / requests : 0 }));
  return { models, requests };
}

function winRateOf(facets: FacetAggregate | null): number | undefined {
  if (!facets || facets.sessionsWithFacets <= 0) return undefined;
  const count = (key: string) => facets.outcomes.find((entry) => entry.key === key)?.count ?? 0;
  return (count("fully_achieved") + count("mostly_achieved")) / facets.sessionsWithFacets;
}

const TIME_WORDS = { night_owl: "Night", early_bird: "Dawn", evening: "Golden-Hour", afternoon: "Afternoon", morning: "Morning" } as const;

/** Rules over the numbers, so the persona needs no facets; the win-rate clause appears only when they exist. */
export function personaOf(input: {
  verdict: keyof typeof TIME_WORDS;
  maxConcurrent: number;
  subagents: number;
  sessions: number;
  toolsPerPrompt: number;
  commitShare: number;
  winRate?: number;
}): RecapPersona {
  const time = TIME_WORDS[input.verdict];
  let role: RecapPersona["role"];
  let reason: string;
  if (input.maxConcurrent >= 5 || input.subagents / Math.max(1, input.sessions) >= 1) {
    role = "Orchestrator";
    reason = `${input.maxConcurrent} agents at once, ${Math.round(input.toolsPerPrompt)} tool calls for every prompt you typed`;
  } else if (input.commitShare >= 0.4) {
    role = "Shipper";
    reason = `${Math.round(input.commitShare * 100)}% of your sessions ended in a commit`;
  } else {
    role = "Delegator";
    reason = `${Math.round(input.toolsPerPrompt)} tool calls ran for every prompt you typed`;
  }
  reason += input.winRate === undefined ? "." : `, and ${Math.round(input.winRate * 100)}% of sessions hit their goal.`;
  return { title: `The ${time} ${role}`, time, role, reason };
}

/** Up to three tips, the most severe first, one per suggestion title, fixed titles only. */
export function tipsOf(findings: Finding[]): RecapTip[] {
  const seen = new Set<string>();
  const tips: RecapTip[] = [];
  const ranked = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  for (const finding of ranked) {
    const suggestion = finding.suggestion;
    if (!suggestion || suggestion.type === "matrix" || suggestion.type === "plugin") continue;
    if (!TIP_TITLES.has(suggestion.title) || seen.has(suggestion.title)) continue;
    seen.add(suggestion.title);
    tips.push({ title: suggestion.title, kind: finding.kind, metric: finding.metric ? { value: finding.metric.value, unit: finding.metric.unit } : null });
    if (tips.length >= MAX_TIPS) break;
  }
  return tips;
}

/**
 * The shareable recap. Deterministic for the same sessions, report parts and clock. Holds counts, times,
 * shares and allowlisted names only: nothing here is copied from a prompt, path or project.
 */
export function buildRecap(input: RecapInput): Recap | undefined {
  const { sessions, activity, usage, clock } = input;
  const span = range(sessions, clock);
  if (!span) return undefined;

  const { rhythm, promptsByDay } = buildRhythm(sessions, clock, input.timeZone);
  const voice = buildVoice(sessions);
  const { shell, nemesis } = buildShell(sessions);
  const failures = buildFailures(sessions, nemesis);
  const { slash, slashTotal } = buildSlash(sessions);
  const { connectors, skills } = buildFeatures(sessions);

  let prompts = 0;
  let toolCalls = 0;
  let subagents = 0;
  let committed = 0;
  let interrupted = 0;
  let capped = false;
  for (const session of sessions) {
    prompts += session.prompts.length;
    toolCalls += session.toolCalls.length;
    subagents += session.features.subagents;
    if (session.gitCommits > 0) committed += 1;
    for (const prompt of session.prompts) if (prompt.interrupted) interrupted += 1;
    if (toolCallsCapped(session)) capped = true;
  }
  const commitShare = sessions.length ? committed / sessions.length : 0;
  const toolsPerPrompt = toolCalls / Math.max(1, prompts);

  const allDaily = activity.daily.map((day) => ({ day: day.day, sessions: day.sessions, prompts: day.userMessages, minutes: day.activeMinutes }));
  const daily = allDaily.slice(-MAX_RECAP_DAYS);
  let bigDay: Recap["bigDay"];
  for (const [day, count] of promptsByDay) {
    if (!bigDay || count > bigDay.prompts || (count === bigDay.prompts && day < bigDay.day)) bigDay = { day, prompts: count, weekday: weekdayOf(day) };
  }

  const { models, requests } = modelsOf(usage);
  const recapUsage: RecapUsage = {
    tokens: usage.tokens,
    output: usage.output,
    requests,
    unpriced: usage.unpriced,
    novels: (usage.output * WORDS_PER_TOKEN) / WORDS_PER_NOVEL,
  };
  if (usage.estimatedUsd !== null) recapUsage.usd = usage.estimatedUsd;
  if (usage.cacheHitRate !== null) recapUsage.cacheHitRate = usage.cacheHitRate;
  if (usage.estimatedUsd !== null && activity.gitCommits > 0) recapUsage.usdPerCommit = usage.estimatedUsd / activity.gitCommits;

  const winRate = winRateOf(input.facets);
  const recap: Recap = {
    version: RECAP_VERSION,
    generatedAt: input.generatedAt,
    timeZone: input.timeZone,
    range: span,
    totals: {
      sessions: activity.sessions,
      prompts,
      activeDays: activity.activeDays,
      wallHours: (activity.wallClockActiveMinutes ?? activity.totalActiveMinutes) / 60,
      agentHours: activity.totalActiveMinutes / 60,
      harnesses: activity.byHarness.map((row) => ({ key: row.harness, sessions: row.sessions })),
      commits: activity.gitCommits,
      commitShare,
      compactions: activity.features.compactions,
      toolCalls,
      toolsPerPrompt,
      toolCallsCapped: capped,
    },
    daily,
    dailyTruncated: allDaily.length > daily.length,
    streak: streakOf(allDaily),
    voice,
    interrupted,
    slash,
    slashTotal,
    connectors,
    skills,
    shell,
    parallel: { max: activity.parallelSessions.maxConcurrent, overlapEvents: activity.parallelSessions.overlapEvents, subagents },
    failures,
    models,
    usage: recapUsage,
    facetSessions: input.facets?.sessionsWithFacets ?? 0,
    tips: tipsOf(input.findings),
  };
  if (rhythm) {
    recap.rhythm = rhythm;
    recap.persona = personaOf({
      verdict: rhythm.verdict.key,
      maxConcurrent: activity.parallelSessions.maxConcurrent,
      subagents,
      sessions: sessions.length,
      toolsPerPrompt,
      commitShare,
      ...(winRate === undefined ? {} : { winRate }),
    });
  }
  if (bigDay) recap.bigDay = bigDay;
  const lanes = buildLanes(sessions, activity.parallelSessions.maxConcurrent);
  if (lanes) recap.parallel.lanes = lanes;
  const longest = buildLongestSession(sessions);
  if (longest) recap.longestSession = longest;
  const top = activity.projects[0];
  if (top && activity.totalActiveMinutes > 0) recap.topProjectShare = top.activeMinutes / activity.totalActiveMinutes;
  if (winRate !== undefined) recap.winRate = winRate;
  const thinking = buildThinking(sessions);
  if (thinking) recap.thinking = thinking;
  const approvals = buildApprovals(sessions);
  if (approvals) recap.approvals = approvals;
  const replies = buildReplies(sessions);
  if (replies) recap.replies = replies;
  return recap;
}
