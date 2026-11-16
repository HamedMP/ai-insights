import type {
  Harness,
  RecapApprovals,
  RecapCount,
  RecapFailures,
  RecapLongestSession,
  RecapReplies,
  RecapShell,
  RecapThinking,
  Session,
  ToolErrorCategory,
} from "../../schema/types.js";
import { bump, median, toCounts } from "../activity.js";
import { isAgentDriven } from "../sessions.js";
import { connectorLabel, FORCE_PUSH, isWrapped, programOf, RM_RF, skillLabel, SLEEP, slashLabel, slashName, TEST_RUN } from "./text.js";
import { ERROR_LABELS } from "./vocabulary.js";

/** Per-source tool-call caps, for sessions cached before `toolCallsDropped` existed. */
const TOOL_CALL_CAPS: Partial<Record<Harness, number>> = { codex: 10_000, "claude-code": 20_000 };
/** A reply gap longer than this is a session reopened later, not a reply. */
export const MAX_REPLY_SEC = 12 * 60 * 60;

export function toolCallsCapped(session: Session): boolean {
  if ((session.toolCallsDropped ?? 0) > 0) return true;
  const cap = TOOL_CALL_CAPS[session.harness] ?? 20_000;
  return session.toolCalls.length >= cap;
}

export function buildShell(sessions: Session[]): { shell: RecapShell; nemesis: RecapFailures["nemesis"] } {
  const runs = new Map<string, number>();
  const fails = new Map<string, number>();
  let calls = 0;
  let tests = 0;
  let testFails = 0;
  let rmrf = 0;
  let forcePush = 0;
  let sleeps = 0;
  for (const session of sessions) {
    for (const call of session.toolCalls) {
      if (call.name === "clock.sleep") sleeps += 1;
      if (call.category !== "shell" || !call.command) continue;
      const command = call.command;
      calls += 1;
      if (SLEEP.test(command)) sleeps += 1;
      const program = programOf(command);
      if (program) {
        bump(runs, program);
        if (call.error) bump(fails, program);
      }
      if (TEST_RUN.test(command)) {
        tests += 1;
        if (call.error) testFails += 1;
      }
      if (RM_RF.test(command)) rmrf += 1;
      if (FORCE_PUSH.test(command)) forcePush += 1;
    }
  }
  const shell: RecapShell = { calls, programs: toCounts(runs, 5) as RecapCount[], tests, rmrf, forcePush, sleeps };
  if (tests > 0) shell.testPass = 1 - testFails / tests;
  const nemesis = toCounts(fails, 4).map((entry) => ({ key: entry.key, count: entry.count, runs: runs.get(entry.key) ?? entry.count }));
  return { shell, nemesis };
}

export function buildFailures(sessions: Session[], nemesis: RecapFailures["nemesis"]): RecapFailures {
  const byCategory = new Map<string, number>();
  let total = 0;
  let calls = 0;
  for (const session of sessions) {
    calls += session.toolCalls.length;
    for (const call of session.toolCalls) {
      if (!call.error) continue;
      total += 1;
      bump(byCategory, call.error);
    }
  }
  return {
    total,
    calls,
    rate: calls ? total / calls : 0,
    categories: toCounts(byCategory).map((entry) => ({
      key: entry.key as ToolErrorCategory,
      label: ERROR_LABELS[entry.key] ?? ERROR_LABELS.other!,
      count: entry.count,
    })),
    nemesis,
  };
}

/**
 * Slash commands per invocation. Sessions with `slashCommandCounts` use it (it also has commands that left no
 * prompt); older cached sessions fall back to prompts that start with a slash.
 */
export function buildSlash(sessions: Session[]): { slash: RecapCount[]; slashTotal: number } {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const recorded = session.features.slashCommandCounts;
    if (recorded && Object.keys(recorded).length > 0) {
      for (const [name, count] of Object.entries(recorded)) if (Number.isFinite(count) && count > 0) bump(counts, slashLabel(name), Math.floor(count));
      continue;
    }
    for (const prompt of session.prompts) {
      const name = slashName(prompt.text);
      if (name) bump(counts, slashLabel(name));
    }
  }
  let slashTotal = 0;
  for (const count of counts.values()) slashTotal += count;
  return { slash: toCounts(counts, 5) as RecapCount[], slashTotal };
}

/** Connectors by sessions that used them, skills by invocations; private names fold into one label. */
export function buildFeatures(sessions: Session[]): { connectors: RecapCount[]; skills: RecapCount[] } {
  const connectors = new Map<string, number>();
  const skills = new Map<string, number>();
  for (const session of sessions) {
    for (const label of new Set(session.features.mcpServers.map(connectorLabel))) bump(connectors, label);
    let invoked = 0;
    for (const call of session.toolCalls) {
      if (call.category !== "skill" || !call.skill) continue;
      invoked += 1;
      bump(skills, skillLabel(call.skill));
    }
    // Sources that see a skill only as loaded, not as a call, still say which ones were used.
    if (invoked === 0) for (const skill of session.features.skills) bump(skills, skillLabel(skill));
  }
  return { connectors: toCounts(connectors, 5) as RecapCount[], skills: toCounts(skills, 5) as RecapCount[] };
}

export function buildLongest(sessions: Session[]): RecapLongestSession | undefined {
  let longest: Session | undefined;
  for (const session of sessions) if (!longest || session.activeMinutes > longest.activeMinutes) longest = session;
  if (!longest) return undefined;
  return {
    activeMinutes: Math.round(longest.activeMinutes),
    wallMinutes: Math.round(longest.durationMinutes),
    prompts: longest.prompts.length,
    toolCalls: longest.toolCalls.length,
    harness: longest.harness,
    compactions: longest.features.compactions,
    toolCallsCapped: toolCallsCapped(longest),
  };
}

export function buildThinking(sessions: Session[]): RecapThinking | undefined {
  let blocks = 0;
  let totalMs: number | undefined;
  let longestMs: number | undefined;
  let reporting = 0;
  for (const session of sessions) {
    const thinking = session.thinking;
    if (!thinking) continue;
    reporting += 1;
    blocks += thinking.blocks;
    if (thinking.totalMs !== null) totalMs = (totalMs ?? 0) + thinking.totalMs;
    if (thinking.longestMs !== null) longestMs = Math.max(longestMs ?? 0, thinking.longestMs);
  }
  if (reporting === 0 || blocks === 0) return undefined;
  const out: RecapThinking = { blocks, sessions: reporting };
  if (totalMs !== undefined) out.totalMs = totalMs;
  if (longestMs !== undefined) out.longestMs = longestMs;
  return out;
}

export function buildApprovals(sessions: Session[]): RecapApprovals | undefined {
  const out: RecapApprovals = { sessions: 0 };
  for (const session of sessions) {
    const approvals = session.approvals;
    if (!approvals) continue;
    out.sessions += 1;
    for (const key of ["auto", "byPerson", "denied", "guardianReviews", "autoBlocked"] as const) {
      const value = approvals[key];
      if (typeof value === "number" && Number.isFinite(value)) out[key] = (out[key] ?? 0) + value;
    }
  }
  return out.sessions > 0 ? out : undefined;
}

/** How fast the person answers, from sessions they drove; gaps over 12 h are a session reopened later. */
export function buildReplies(sessions: Session[]): RecapReplies | undefined {
  const gaps: number[] = [];
  for (const session of sessions) {
    if (isAgentDriven(session)) continue;
    for (const seconds of session.userResponseTimesSec) if (Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_REPLY_SEC) gaps.push(seconds);
  }
  const medianSec = median(gaps);
  if (medianSec === null) return undefined;
  let fast = 0;
  let longestSec = 0;
  for (const gap of gaps) {
    if (gap < 60) fast += 1;
    if (gap > longestSec) longestSec = gap;
  }
  return { count: gaps.length, medianSec, fastShare: fast / gaps.length, longestSec };
}

/** Most prompts in the session were filled in by a script: a Codex heartbeat, an automation's template. */
function isScriptDriven(session: Session): boolean {
  const prompts = session.prompts.length;
  return prompts >= 5 && session.prompts.filter(isWrapped).length / prompts >= 0.5;
}

/**
 * The longest session the person drove. A heartbeat automation can keep one Codex thread busy for weeks, which
 * says nothing about the person's stamina, so sessions a script or another agent drove are skipped and counted.
 */
export function buildLongestSession(sessions: Session[]): RecapLongestSession | undefined {
  const ranked = [...sessions].sort((a, b) => b.activeMinutes - a.activeMinutes || a.harness.localeCompare(b.harness) || a.id.localeCompare(b.id));
  let skipped = 0;
  for (const session of ranked) {
    if (isAgentDriven(session) || isScriptDriven(session)) {
      skipped += 1;
      continue;
    }
    const longest = buildLongest([session])!;
    return skipped ? { ...longest, skippedAutomated: skipped } : longest;
  }
  return undefined;
}
