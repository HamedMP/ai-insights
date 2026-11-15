import { evidence, harnessesOf, MAX_EVIDENCE, minutes, percent, plural, type Detector } from "./context.js";

/** Past two and a half active hours, a single context has usually been summarised or crowded with stale detail. */
const LONG_ACTIVE_MIN = 150;
/** Or this many prompts, which fills most context windows regardless of time. */
const LONG_PROMPTS = 80;
/** A few long sessions is a pattern; one is an outlier. */
const MIN_LONG_SESSIONS = 3;
/** When this share of sessions run long, it is how the person works, not an exception. */
const MEDIUM_SHARE = 0.25;

export const longSessions: Detector = ({ sessions }) => {
  const long = sessions.filter((session) => session.activeMinutes >= LONG_ACTIVE_MIN || session.userMessageCount >= LONG_PROMPTS);
  if (long.length < MIN_LONG_SESSIONS) return [];
  const share = long.length / sessions.length;
  const items = [...long]
    .sort((a, b) => b.activeMinutes - a.activeMinutes || b.userMessageCount - a.userMessageCount || a.startTime.localeCompare(b.startTime))
    .slice(0, MAX_EVIDENCE)
    .map((session) => {
      // Active time is what the threshold measures; wall-clock is shown only so a session left open for days reads correctly.
      const open = session.durationMinutes >= 2 * session.activeMinutes && session.durationMinutes >= 24 * 60 ? `, open for ${Math.round(session.durationMinutes / 1440)} days` : "";
      return evidence(session, `${minutes(session.activeMinutes)} of active work, ${plural(session.userMessageCount, "prompt")}${open}`);
    });
  return [
    {
      id: "long_sessions",
      kind: "long_sessions",
      severity: share >= MEDIUM_SHARE ? "medium" : "low",
      title: "Some sessions run very long",
      detail: `${plural(long.length, "session")} (${percent(share)}) ran over ${minutes(LONG_ACTIVE_MIN)} of active time or ${LONG_PROMPTS} prompts. Agents tend to lose track of early decisions in sessions this long, and every request carries the whole history, which costs more.`,
      harnesses: harnessesOf(long),
      metric: { value: long.length, unit: "sessions", label: "very long sessions" },
      evidence: items,
      suggestion: {
        type: "habit",
        title: "Split at natural checkpoints",
        action:
          "End the session when a piece of work is committed, and start the next one with a two-line summary of where things stand.",
      },
    },
  ];
};
