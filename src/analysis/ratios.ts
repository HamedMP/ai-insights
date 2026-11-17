import type { Activity, Session, WorkRatio, WorkRatioKey, WorkRatios } from "../schema/types.js";
import { activeSpans, unionSpans } from "./activity.js";
import { corrections } from "./findings/slow-correction.js";
import { isAgentDriven, isBriefDriven } from "./sessions.js";
import { parseMs } from "./time.js";

function ratio(
  key: WorkRatioKey,
  label: string,
  definition: string,
  unit: WorkRatio["unit"],
  numerator: number,
  denominator: number,
  counts: WorkRatio["counts"],
): WorkRatio {
  return { key, label, definition, value: denominator > 0 ? numerator / denominator : null, numerator, denominator, unit, counts };
}

/** The person typed in it and no other agent drove it: only then do their steering habits show. */
function personDriven(session: Session): boolean {
  return session.prompts.length > 0 && !isAgentDriven(session);
}

/** Plan mode, a plan step before the first edit, or an opening brief: the work was laid out before files changed. */
function startedWithPlan(session: Session): boolean {
  if (session.features.planMode || isBriefDriven(session)) return true;
  let firstEdit = Number.POSITIVE_INFINITY;
  let firstPlan = Number.POSITIVE_INFINITY;
  session.toolCalls.forEach((call, index) => {
    // Tool calls are in transcript order; fall back to it when a timestamp is missing.
    const when = parseMs(call.timestamp) ?? index;
    if (call.category === "edit") firstEdit = Math.min(firstEdit, when);
    if (call.category === "plan") firstPlan = Math.min(firstPlan, when);
  });
  return firstPlan < firstEdit;
}

/**
 * Ratios of counts that say how someone works with agents. Each is a habit, not a volume: none grows by spending
 * more tokens, and each keeps the counts behind it so a reader can check it.
 */
export function buildWorkRatios(sessions: Session[], activity: Activity): WorkRatios {
  let driven = 0;
  let correctionCount = 0;
  let compacted = 0;
  let editing = 0;
  let planned = 0;
  let agentMs = 0;
  const spans: Array<[number, number]> = [];
  for (const session of sessions) {
    if (session.features.compactions > 0) compacted += 1;
    if (personDriven(session)) {
      driven += 1;
      correctionCount += corrections(session).length;
      if (session.toolCalls.some((call) => call.category === "edit")) {
        editing += 1;
        if (startedWithPlan(session)) planned += 1;
      }
    }
    for (const span of activeSpans(session)) {
      agentMs += span[1] - span[0];
      spans.push(span);
    }
  }
  const wallMs = unionSpans(spans).reduce((sum, [start, end]) => sum + (end - start), 0);
  const toolCalls = activity.toolCategories.reduce((sum, entry) => sum + entry.count, 0);
  const toolErrors = activity.toolErrors.reduce((sum, entry) => sum + entry.count, 0);
  const hours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;
  return {
    correctionsPerSession: ratio(
      "correctionsPerSession",
      "Mid-run corrections",
      "Prompts you sent while the agent was still working on its turn, per session you drove yourself.",
      "per_session",
      correctionCount,
      driven,
      { numerator: "corrections", denominator: "sessions you drove" },
    ),
    contextResetShare: ratio(
      "contextResetShare",
      "Sessions that hit a context reset",
      "Sessions compacted at least once because the conversation outgrew the context window, out of all sessions.",
      "share",
      compacted,
      sessions.length,
      { numerator: "sessions compacted", denominator: "sessions" },
    ),
    toolErrorRate: ratio(
      "toolErrorRate",
      "Tool-call error rate",
      "Tool calls that came back with an error (a failed command, a missing file, a refusal), out of all tool calls.",
      "share",
      toolErrors,
      toolCalls,
      { numerator: "failed calls", denominator: "tool calls" },
    ),
    planFirstShare: ratio(
      "planFirstShare",
      "Started with a plan",
      "Sessions you drove that changed files and began from plan mode, a plan step before the first edit, or a written brief.",
      "share",
      planned,
      editing,
      { numerator: "planned sessions", denominator: "sessions that edited files" },
    ),
    parallelism: {
      ...ratio(
        "parallelism",
        "Sessions running at once",
        "Active time summed over every session, divided by the clock time when at least one was active: 2× means two at once on average.",
        "times",
        hours(agentMs),
        hours(wallMs),
        { numerator: "agent hours", denominator: "clock hours" },
      ),
      // From the exact milliseconds, so rounding the displayed hours never moves the ratio.
      value: wallMs > 0 ? agentMs / wallMs : null,
    },
  };
}
