import type { Activity, Count, Harness, Session, SessionSpan } from "../schema/types.js";
import { IDLE_GAP_MS } from "../sources/shared.js";
import { continuousDays, daysBetween, parseMs, type Clock } from "./time.js";
import { isAgentDriven, projectKey } from "./sessions.js";
import { MAX_DAYS } from "./usage.js";

/** Long tails of tools and projects add nothing a reader can act on and bloat the report. */
const MAX_COUNTS = 100;
const MAX_PROJECTS = 50;
/** The contract caps spans so a long history does not bloat the report; the newest are the ones a reader recognises. */
const MAX_SESSION_SPANS = 400;
/** Stretches kept per span: a marathon resumed every day for months still costs a bounded few KB. */
const MAX_ACTIVE_STRETCHES = 50;

const RESPONSE_BUCKETS: Array<{ key: string; maxSec: number }> = [
  { key: "<10s", maxSec: 10 },
  { key: "10-30s", maxSec: 30 },
  { key: "30s-1m", maxSec: 60 },
  { key: "1-5m", maxSec: 300 },
  { key: "5-15m", maxSec: 900 },
  { key: ">15m", maxSec: Number.POSITIVE_INFINITY },
];

export function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** Largest first, then alphabetical, so equal counts render in a stable order. */
export function toCounts(map: Map<string, number>, limit = MAX_COUNTS): Count[] {
  return [...map]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Spans where a session was actually doing something. Wall-clock start..end is
 * misleading for overlap: a session resumed the next day would "overlap" everything in between.
 */
export function activeSpans(session: Session): Array<[number, number]> {
  // Several analyses ask for the same session's spans; parsing every timestamp again was a large share of a big report.
  const shape = sessionShape(session);
  const cached = spanMemo.get(session);
  if (cached && cached.shape === shape) return cached.spans.map(([start, end]) => [start, end]);
  const spans = computeSpans(session);
  spanMemo.set(session, { shape, spans });
  return spans.map(([start, end]) => [start, end]);
}

/** Changes whenever a session gains or loses events, so a memo never outlives what it was computed from. */
export function sessionShape(session: Session): string {
  return `${session.startTime}|${session.endTime}|${session.prompts.length}|${session.toolCalls.length}|${session.requests.length}`;
}

const spanMemo = new WeakMap<Session, { shape: string; spans: Array<[number, number]> }>();

function computeSpans(session: Session): Array<[number, number]> {
  const times: number[] = [];
  for (const value of [session.startTime, session.endTime]) {
    const ms = parseMs(value);
    if (ms !== null) times.push(ms);
  }
  for (const prompt of session.prompts) {
    const ms = parseMs(prompt.timestamp);
    if (ms !== null) times.push(ms);
  }
  for (const call of session.toolCalls) {
    const ms = parseMs(call.timestamp);
    if (ms !== null) times.push(ms);
  }
  for (const request of session.requests) {
    const ms = parseMs(request.timestamp);
    if (ms !== null) times.push(ms);
  }
  times.sort((a, b) => a - b);
  const spans: Array<[number, number]> = [];
  for (const ms of times) {
    const last = spans.at(-1);
    if (last && ms - last[1] <= IDLE_GAP_MS) last[1] = ms;
    else spans.push([ms, ms]);
  }
  return spans.filter(([start, end]) => end > start);
}

/** Merges overlapping spans so time when several sessions ran counts once. */
export function unionSpans(spans: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Wall-clock milliseconds of activity per local day, from already merged spans. */
function msPerDay(merged: Array<[number, number]>, clock: Clock): Map<string, number> {
  const out = new Map<string, number>();
  for (const [spanStart, spanEnd] of merged) {
    let start = spanStart;
    while (start < spanEnd) {
      const end = Math.min(spanEnd, clock.nextMidnight(start));
      const day = clock.dayOfMs(start);
      out.set(day, (out.get(day) ?? 0) + (end - start));
      start = end;
    }
  }
  return out;
}

const MINUTES_PER_DAY = 1440;

function parallelSessions(sessions: Session[]): Activity["parallelSessions"] {
  const events: Array<{ at: number; delta: 1 | -1; session: number }> = [];
  sessions.forEach((session, index) => {
    for (const [start, end] of activeSpans(session)) {
      events.push({ at: start, delta: 1, session: index }, { at: end, delta: -1, session: index });
    }
  });
  // Ends sort before starts at the same instant, so back-to-back sessions do not count as overlapping.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  const active = new Map<number, number>();
  const involved = new Set<number>();
  let overlapEvents = 0;
  let maxConcurrent = 0;
  for (const event of events) {
    if (event.delta === -1) {
      const left = (active.get(event.session) ?? 1) - 1;
      if (left <= 0) active.delete(event.session);
      else active.set(event.session, left);
      continue;
    }
    const others = [...active.keys()].filter((key) => key !== event.session);
    if (others.length > 0) {
      overlapEvents += 1;
      involved.add(event.session);
      for (const other of others) involved.add(other);
    }
    active.set(event.session, (active.get(event.session) ?? 0) + 1);
    maxConcurrent = Math.max(maxConcurrent, active.size);
  }
  return { overlapEvents, maxConcurrent, sessionsInvolved: involved.size };
}

function longestStreak(days: string[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    run = index > 0 && daysBetween(sorted[index - 1]!, sorted[index]!) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** One bar per session for a timeline; sessions without a usable start and end have nowhere to go. */
function sessionSpans(sessions: Session[]): SessionSpan[] {
  const timed: Array<{ session: Session; startMs: number }> = [];
  for (const session of sessions) {
    const startMs = parseMs(session.startTime);
    const endMs = parseMs(session.endTime);
    if (startMs === null || endMs === null || endMs < startMs) continue;
    timed.push({ session, startMs });
  }
  timed.sort(
    (a, b) =>
      a.startMs - b.startMs ||
      (a.session.harness < b.session.harness ? -1 : a.session.harness > b.session.harness ? 1 : 0) ||
      (a.session.id < b.session.id ? -1 : a.session.id > b.session.id ? 1 : 0),
  );
  return timed.slice(-MAX_SESSION_SPANS).map(({ session }) => {
    const span: SessionSpan = {
      sessionId: session.id,
      harness: session.harness,
      project: projectKey(session),
      start: session.startTime,
      end: session.endTime,
      activeMinutes: Math.max(0, session.activeMinutes || 0),
    };
    if (isAgentDriven(session)) span.agentDriven = true;
    const active = activeSpans(session);
    if (active.length) span.active = active.slice(0, MAX_ACTIVE_STRETCHES);
    return span;
  });
}

export function buildActivity(sessions: Session[], clock: Clock): Activity {
  const daily = new Map<string, { sessions: number; userMessages: number; activeMinutes: number }>();
  const dayRow = (day: string) => {
    let row = daily.get(day);
    if (!row) daily.set(day, (row = { sessions: 0, userMessages: 0, activeMinutes: 0 }));
    return row;
  };
  const hourHistogram = Array.from({ length: 24 }, () => 0);
  const byHarness = new Map<Harness, { sessions: number; activeMinutes: number }>();
  const projects = new Map<string, { sessions: number; activeMinutes: number; folders: Set<string> }>();
  const languages = new Map<string, number>();
  const tools = new Map<string, number>();
  const toolCategories = new Map<string, number>();
  const toolErrors = new Map<string, number>();
  const mcpServers = new Map<string, number>();
  const skills = new Map<string, number>();
  const slashCommands = new Map<string, number>();
  const files = new Set<string>();
  const responseTimes: number[] = [];
  const responseBuckets = new Map(RESPONSE_BUCKETS.map((bucket) => [bucket.key, 0]));
  const spans: Array<[number, number]> = [];
  const touched = new Set<string>();

  const activity: Activity = {
    sessions: sessions.length,
    activeDays: 0,
    longestStreakDays: 0,
    totalActiveMinutes: 0,
    wallClockActiveMinutes: 0,
    userMessages: 0,
    assistantMessages: 0,
    linesAdded: 0,
    linesRemoved: 0,
    filesModified: 0,
    gitCommits: 0,
    hourHistogram,
    daily: [],
    byHarness: [],
    projects: [],
    languages: [],
    tools: [],
    toolCategories: [],
    toolErrors: [],
    responseTimeBuckets: [],
    medianResponseTimeSec: null,
    parallelSessions: { overlapEvents: 0, maxConcurrent: 0, sessionsInvolved: 0 },
    features: {
      mcpServers: [],
      skills: [],
      slashCommands: [],
      sessionsWithSubagents: 0,
      sessionsWithPlanMode: 0,
      sessionsWithWeb: 0,
      compactions: 0,
    },
  };

  for (const session of sessions) {
    const startDay = clock.day(session.startTime) ?? clock.day(session.endTime);
    const startHour = clock.hour(session.startTime) ?? clock.hour(session.endTime);
    const minutes = Math.max(0, session.activeMinutes || 0);
    activity.totalActiveMinutes += minutes;
    activity.userMessages += session.userMessageCount;
    activity.assistantMessages += session.assistantMessageCount;
    activity.linesAdded += session.linesAdded;
    activity.linesRemoved += session.linesRemoved;
    activity.gitCommits += session.gitCommits;
    for (const file of session.filesModified) files.add(file);

    // Counted once, on the day it started, so daily and weekly sums equal the real session count.
    // The other days it touched are still active days through their messages and active minutes.
    if (startDay) dayRow(startDay).sessions += 1;
    for (const value of [session.endTime, ...session.prompts.map((p) => p.timestamp), ...session.toolCalls.map((c) => c.timestamp), ...session.requests.map((r) => r.timestamp)]) {
      const day = clock.day(value);
      if (day) touched.add(day);
    }
    spans.push(...activeSpans(session));
    // Prompts may be capped by the source; messages beyond the cap are placed at the session start.
    let placed = 0;
    for (const prompt of session.prompts) {
      const day = clock.day(prompt.timestamp);
      const hour = clock.hour(prompt.timestamp);
      if (day === null || hour === null) continue;
      dayRow(day).userMessages += 1;
      hourHistogram[hour]! += 1;
      placed += 1;
    }
    const unplaced = session.userMessageCount - placed;
    if (unplaced > 0 && startDay && startHour !== null) {
      dayRow(startDay).userMessages += unplaced;
      hourHistogram[startHour]! += unplaced;
    }

    const harness = byHarness.get(session.harness) ?? { sessions: 0, activeMinutes: 0 };
    harness.sessions += 1;
    harness.activeMinutes += minutes;
    byHarness.set(session.harness, harness);
    const key = projectKey(session);
    if (key) {
      const project = projects.get(key) ?? { sessions: 0, activeMinutes: 0, folders: new Set<string>() };
      project.sessions += 1;
      project.activeMinutes += minutes;
      if (session.projectPath) project.folders.add(session.projectPath);
      projects.set(key, project);
    }

    for (const [language, count] of Object.entries(session.languages)) bump(languages, language, count);
    for (const call of session.toolCalls) {
      bump(tools, call.name);
      bump(toolCategories, call.category);
      if (call.error) bump(toolErrors, call.error);
    }
    for (const seconds of session.userResponseTimesSec) {
      if (!Number.isFinite(seconds) || seconds < 0) continue;
      responseTimes.push(seconds);
      const bucket = RESPONSE_BUCKETS.find((candidate) => seconds < candidate.maxSec)!;
      bump(responseBuckets, bucket.key);
    }

    const features = session.features;
    for (const server of new Set(features.mcpServers)) bump(mcpServers, server);
    for (const skill of new Set(features.skills)) bump(skills, skill);
    for (const command of new Set(features.slashCommands)) bump(slashCommands, command);
    if (features.subagents > 0) activity.features.sessionsWithSubagents += 1;
    if (features.planMode) activity.features.sessionsWithPlanMode += 1;
    if (features.webSearch || features.webFetch) activity.features.sessionsWithWeb += 1;
    activity.features.compactions += features.compactions;
  }

  const merged = unionSpans(spans);
  activity.wallClockActiveMinutes = Math.round(merged.reduce((sum, [start, end]) => sum + (end - start), 0) / 60_000);
  for (const [day, ms] of msPerDay(merged, clock)) dayRow(day).activeMinutes = Math.min(MINUTES_PER_DAY, Math.round(ms / 60_000));

  for (const day of touched) dayRow(day);
  const activeDays = [...daily].filter(([day, row]) => row.sessions > 0 || row.userMessages > 0 || row.activeMinutes > 0 || touched.has(day)).map(([day]) => day);
  activity.activeDays = activeDays.length;
  activity.longestStreakDays = longestStreak(activeDays);
  activity.filesModified = files.size;
  activity.daily = continuousDays(daily.keys(), MAX_DAYS).map((day) => ({
    day,
    ...(daily.get(day) ?? { sessions: 0, userMessages: 0, activeMinutes: 0 }),
  }));
  activity.byHarness = [...byHarness]
    .map(([harness, row]) => ({ harness, ...row }))
    .sort((a, b) => b.sessions - a.sessions || a.harness.localeCompare(b.harness));
  activity.projects = [...projects]
    .map(([projectPath, { sessions, activeMinutes, folders }]) => ({ projectPath, sessions, activeMinutes, ...(folders.size > 1 ? { worktrees: folders.size } : {}) }))
    .sort((a, b) => b.activeMinutes - a.activeMinutes || b.sessions - a.sessions || a.projectPath.localeCompare(b.projectPath))
    .slice(0, MAX_PROJECTS);
  activity.languages = toCounts(languages);
  activity.tools = toCounts(tools);
  activity.toolCategories = toCounts(toolCategories);
  activity.toolErrors = toCounts(toolErrors);
  activity.responseTimeBuckets = RESPONSE_BUCKETS.map((bucket) => ({ key: bucket.key, count: responseBuckets.get(bucket.key) ?? 0 }));
  activity.medianResponseTimeSec = median(responseTimes);
  activity.parallelSessions = parallelSessions(sessions);
  activity.sessionSpans = sessionSpans(sessions);
  activity.features.mcpServers = toCounts(mcpServers);
  activity.features.skills = toCounts(skills);
  activity.features.slashCommands = toCounts(slashCommands);
  return activity;
}
