import type { Harness, Session } from "../../schema/types.js";
import type { OwnedRequest } from "../usage.js";
import { evidence, harnessesOf, MAX_EVIDENCE, plural, usd, type Detector } from "./context.js";

/** Model names that mark the most expensive tier of each vendor. */
const TOP_TIER = /opus|fable|-pro\b|gpt-5\.5|gpt-5\.6/i;
/** A quick question: a few prompts, a few tool calls, a few minutes, almost no code written. */
const SIMPLE_MAX_PROMPTS = 3;
const SIMPLE_MAX_TOOL_CALLS = 5;
const SIMPLE_MAX_ACTIVE_MIN = 10;
const SIMPLE_MAX_LINES = 20;
/** One or two quick questions on a big model is nothing; this many is a default worth revisiting. */
const MIN_SESSIONS = 8;
/** When most of the top-tier sessions are this simple, the default model is oversized for the work. */
const MEDIUM_SHARE = 0.5;

const CHEAPER: Partial<Record<Harness, string>> = {
  "claude-code": "Switch to Sonnet or Haiku for quick questions (`/model sonnet`), and keep Opus for long, hard tasks.",
  codex: "Use a smaller model or a lower reasoning effort for quick questions (`/model` in Codex), and keep the top model for long tasks.",
};

function dominantModel(session: Session, requests: OwnedRequest[]): string | null {
  const counts = new Map<string, number>();
  for (const { request } of requests) counts.set(request.model, (counts.get(request.model) ?? 0) + 1);
  if (counts.size === 0) return session.models[0] ?? null;
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}

function isSimple(session: Session): boolean {
  return (
    session.userMessageCount >= 1 &&
    session.userMessageCount <= SIMPLE_MAX_PROMPTS &&
    session.toolCalls.length <= SIMPLE_MAX_TOOL_CALLS &&
    session.activeMinutes <= SIMPLE_MAX_ACTIVE_MIN &&
    session.linesAdded + session.linesRemoved <= SIMPLE_MAX_LINES
  );
}

export const expensiveModelForSimpleWork: Detector = ({ sessions, requests }) => {
  const bySession = new Map<Session, OwnedRequest[]>();
  for (const owned of requests) {
    const list = bySession.get(owned.session);
    if (list) list.push(owned);
    else bySession.set(owned.session, [owned]);
  }
  let topTierSessions = 0;
  const simple: Array<{ session: Session; model: string; cost: number | null }> = [];
  for (const session of sessions) {
    const owned = bySession.get(session) ?? [];
    const model = dominantModel(session, owned);
    if (!model || !TOP_TIER.test(model)) continue;
    topTierSessions += 1;
    if (!isSimple(session)) continue;
    const priced = owned.filter((item) => item.usd !== null);
    const cost = priced.length ? priced.reduce((sum, item) => sum + item.usd!, 0) : null;
    simple.push({ session, model, cost });
  }
  if (simple.length < MIN_SESSIONS) return [];
  const share = simple.length / topTierSessions;
  const spend = simple.some((item) => item.cost !== null) ? simple.reduce((sum, item) => sum + (item.cost ?? 0), 0) : null;
  const harnesses = harnessesOf(simple.map((item) => item.session));
  const items = [...simple]
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || a.session.startTime.localeCompare(b.session.startTime))
    .slice(0, MAX_EVIDENCE)
    .map((item) =>
      evidence(
        item.session,
        `${item.model} for ${plural(item.session.userMessageCount, "prompt")} and ${plural(item.session.toolCalls.length, "tool call")}${item.cost !== null ? `, about ${usd(item.cost)}` : ""}`,
      ),
    );
  const models = [...new Set(simple.map((item) => item.model))].sort();
  return [
    {
      id: "expensive_model_for_simple_work",
      kind: "expensive_model_for_simple_work",
      severity: share >= MEDIUM_SHARE ? "medium" : "low",
      title: "Top-tier models answer quick questions",
      detail: `${plural(simple.length, "session")} on ${models.join(", ")} were quick and tool-light (at most ${SIMPLE_MAX_PROMPTS} prompts and ${SIMPLE_MAX_TOOL_CALLS} tool calls), ${Math.round(share * 100)}% of your top-tier sessions${spend !== null ? `, costing about ${usd(spend)} at API list prices` : ""}. A smaller model answers these as well, faster and cheaper.`,
      harnesses,
      metric: { value: simple.length, unit: "sessions", label: "quick sessions on a top-tier model" },
      evidence: items,
      suggestion: {
        type: "model_choice",
        title: "Match the model to the task",
        action: harnesses.map((harness) => CHEAPER[harness]).filter(Boolean).join(" ") || "Use a smaller model for quick questions and keep the top tier for long, hard tasks.",
      },
    },
  ];
};
