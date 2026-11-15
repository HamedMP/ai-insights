import type { Session } from "../../schema/types.js";
import { evidence, harnessesOf, isAgentDriven, MAX_EVIDENCE, percent, plural, round, type Detector } from "./context.js";

/** Below this many interruptions the rate is too noisy to mean anything. */
const MIN_INTERRUPTIONS = 10;
/** One prompt in seven arriving mid-turn means the agent often heads the wrong way before being stopped. */
const MIN_INTERRUPTION_RATE = 0.15;
/** Seen in several sessions, so it is how the person works, not one frustrating task. */
const MIN_INTERRUPTED_SESSIONS = 3;
/** Nearly one prompt in three mid-turn means a large share of agent work is being redirected. */
const MEDIUM_INTERRUPTION_RATE = 0.3;

export const frequentInterruptions: Detector = ({ sessions }) => {
  let prompts = 0;
  let interrupted = 0;
  const perSession: Array<{ session: Session; count: number; first: string }> = [];
  for (const session of sessions) {
    if (isAgentDriven(session)) continue;
    let count = 0;
    let first = "";
    for (const prompt of session.prompts) {
      prompts += 1;
      if (!prompt.interrupted) continue;
      interrupted += 1;
      count += 1;
      if (!first) first = prompt.timestamp;
    }
    if (count > 0) perSession.push({ session, count, first });
  }
  if (prompts === 0) return [];
  const rate = interrupted / prompts;
  if (interrupted < MIN_INTERRUPTIONS || rate < MIN_INTERRUPTION_RATE || perSession.length < MIN_INTERRUPTED_SESSIONS) return [];
  const items = perSession
    .sort((a, b) => b.count - a.count || a.first.localeCompare(b.first))
    .slice(0, MAX_EVIDENCE)
    .map((item) => evidence(item.session, `${plural(item.count, "prompt")} sent while the agent was still working`, item.first));
  return [
    {
      id: "frequent_interruptions",
      kind: "frequent_interruptions",
      severity: rate >= MEDIUM_INTERRUPTION_RATE ? "medium" : "low",
      title: "You interrupt the agent a lot",
      detail: `${percent(rate)} of your prompts (${interrupted} of ${prompts}) arrived while the agent was still working, across ${plural(perSession.length, "session")}. Frequent course corrections usually mean the first request left out something the agent needed.`,
      harnesses: harnessesOf(perSession.map((item) => item.session)),
      metric: { value: round(rate * 100, 1), unit: "%", label: "prompts that interrupted the agent" },
      evidence: items,
      suggestion: {
        type: "habit",
        title: "Front-load the request",
        action:
          "State the goal, constraints and what \"done\" looks like in the first prompt, and ask the agent to confirm its approach before it starts on anything large.",
      },
    },
  ];
};
