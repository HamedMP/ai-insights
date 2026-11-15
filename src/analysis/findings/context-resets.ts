import type { Session } from "../../schema/types.js";
import { evidence, harnessesOf, MAX_EVIDENCE, plural, type Detector } from "./context.js";

/** A handful of compacted sessions is a pattern; one or two is a long day. */
const MIN_SESSIONS = 3;
/** Total resets needed before the pattern is worth a finding. */
const MIN_COMPACTIONS = 5;
/** A session compacted this often has lost its early context several times over. */
const HEAVY_SESSION = 3;
const MEDIUM_COMPACTIONS = 10;

export const contextResets: Detector = ({ sessions }) => {
  const compacted = sessions.filter((session) => session.features.compactions > 0);
  const total = compacted.reduce((sum, session) => sum + session.features.compactions, 0);
  if (compacted.length < MIN_SESSIONS || total < MIN_COMPACTIONS) return [];
  const heaviest = Math.max(...compacted.map((session) => session.features.compactions));
  const items = [...compacted]
    .sort((a, b) => b.features.compactions - a.features.compactions || a.startTime.localeCompare(b.startTime))
    .slice(0, MAX_EVIDENCE)
    .map((session: Session) => evidence(session, `Context was compacted ${plural(session.features.compactions, "time")}`));
  return [
    {
      id: "context_resets",
      kind: "context_resets",
      severity: heaviest >= HEAVY_SESSION || total >= MEDIUM_COMPACTIONS ? "medium" : "low",
      title: "Sessions often run out of context",
      detail: `${plural(compacted.length, "session")} hit the context limit and were compacted, ${plural(total, "time")} in all. Each compaction replaces the conversation with a summary, so details from earlier in the session can be lost.`,
      harnesses: harnessesOf(compacted),
      metric: { value: total, unit: "compactions", label: "context compactions" },
      evidence: items,
      suggestion: {
        type: "habit",
        title: "Hand off instead of compacting",
        action:
          "When a task outgrows one context, have the agent write progress and next steps to a file, then start a fresh session from that file instead of letting it compact.",
      },
    },
  ];
};
