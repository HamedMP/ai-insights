import type { Finding, Session, UserPrompt } from "../../schema/types.js";
import { IDLE_GAP_MS } from "../../sources/shared.js";
import { median } from "../activity.js";
import { parseMs } from "../time.js";
import { evidence, harnessesOf, isAgentDriven, MAX_EVIDENCE, minutes, plural, round, type Detector } from "./context.js";

/** The agent worked this long on its own before the person cut in: long enough to have gone far down a wrong path. */
export const SLOW_GAP_MIN = 10;
/** Fewer late corrections than this is ordinary steering. */
const MIN_SLOW_CORRECTIONS = 3;
/** Spread over sessions, so one bad session does not define a habit. */
const MIN_SLOW_SESSIONS = 2;
/** This many late corrections is a regular cost, not an occasional one. */
const MEDIUM_SLOW_CORRECTIONS = 6;

export interface Correction {
  session: Session;
  prompt: UserPrompt;
  minutesBefore: number;
}

/**
 * When the agent had done nothing for this long before the person typed, its turn had ended and it was
 * waiting (often on a question); the same idle gap that ends an active span in the sources.
 */
const AGENT_WAITING_MS = IDLE_GAP_MS;

function agentActivity(session: Session): number[] {
  const times: number[] = [];
  for (const call of session.toolCalls) {
    const ms = parseMs(call.timestamp);
    if (ms !== null) times.push(ms);
  }
  for (const request of session.requests) {
    const ms = parseMs(request.timestamp);
    if (ms !== null) times.push(ms);
  }
  return times.sort((a, b) => a - b);
}

/** The latest value in sorted `times` that is at most `limit`, or null. */
function lastAtOrBefore(times: number[], limit: number): number | null {
  let low = 0;
  let high = times.length - 1;
  let found: number | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (times[middle]! <= limit) {
      found = times[middle]!;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** Prompts the person sent while the agent was still working on its turn, with how long it had worked alone. */
export function corrections(session: Session): Correction[] {
  const out: Correction[] = [];
  const activity = agentActivity(session);
  let previous: number | null = parseMs(session.startTime);
  for (const prompt of session.prompts) {
    const at = parseMs(prompt.timestamp);
    if (at === null) continue;
    if (prompt.interrupted && previous !== null && at > previous) {
      // Only a step-in while the agent was still working is a correction; after its turn ended, the person was simply away.
      const last = lastAtOrBefore(activity, at);
      if (last !== null && last > previous && at - last <= AGENT_WAITING_MS) {
        out.push({ session, prompt, minutesBefore: (at - previous) / 60_000 });
      }
    }
    previous = at;
  }
  return out;
}

export const slowCorrection: Detector = ({ sessions }) => {
  // When an orchestrator drives the session, its timing is not the person's habit.
  const slow = sessions.filter((session) => !isAgentDriven(session)).flatMap(corrections).filter((item) => item.minutesBefore >= SLOW_GAP_MIN);
  const involved = new Set(slow.map((item) => item.session));
  if (slow.length < MIN_SLOW_CORRECTIONS || involved.size < MIN_SLOW_SESSIONS) return [];
  const typical = median(slow.map((item) => item.minutesBefore)) ?? 0;
  const ranked = [...slow].sort((a, b) => b.minutesBefore - a.minutesBefore || a.prompt.timestamp.localeCompare(b.prompt.timestamp));
  const seen = new Set<Session>();
  const items = [];
  for (const item of ranked) {
    if (seen.has(item.session)) continue;
    seen.add(item.session);
    items.push(evidence(item.session, `Stepped in after the agent had worked alone for ${minutes(item.minutesBefore)}`, item.prompt.timestamp));
    if (items.length >= MAX_EVIDENCE) break;
  }
  const finding: Finding = {
    id: "slow_correction",
    kind: "slow_correction",
    severity: slow.length >= MEDIUM_SLOW_CORRECTIONS ? "medium" : "low",
    title: "Corrections often come late",
    detail: `${plural(slow.length, "time")} across ${plural(involved.size, "session")} you interrupted the agent after it had been working for ${SLOW_GAP_MIN}+ minutes (typically ${minutes(typical)}). Work done before a late correction is often thrown away.`,
    harnesses: harnessesOf(involved),
    metric: { value: round(typical, 1), unit: "minutes", label: "typical time before stepping in" },
    evidence: items,
    suggestion: {
      type: "habit",
      title: "Agree on the plan before long runs",
      action:
        "For larger tasks, ask for a short plan first (plan mode in Claude Code, or \"propose a plan and wait\") and approve it before the agent starts editing.",
    },
  };
  return [finding];
};
