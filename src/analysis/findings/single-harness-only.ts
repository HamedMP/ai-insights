import { evidence, HARNESS_LABELS, plural, type Detector } from "./context.js";

/** With only a handful of sessions, which agent someone uses is not yet a pattern. */
const MIN_SESSIONS = 5;

export const singleHarnessOnly: Detector = ({ sessions, coverage }) => {
  const used = [...new Set(sessions.map((session) => session.harness))];
  if (used.length !== 1 || sessions.length < MIN_SESSIONS) return [];
  const harness = used[0]!;
  // Only say "only one" when other agents were actually looked for, not when the report was filtered to one.
  const checked = coverage.filter((entry) => entry.harness !== harness).map((entry) => HARNESS_LABELS[entry.harness]);
  if (checked.length === 0) return [];
  const first = sessions[0]!;
  const last = sessions[sessions.length - 1]!;
  const label = HARNESS_LABELS[harness];
  return [
    {
      id: `single_harness_only:${harness}`,
      kind: "single_harness_only",
      severity: "info",
      title: `All of this history is from ${label}`,
      detail: `Hindsight found ${plural(sessions.length, "session")} from ${label} and none from ${checked.join(", ")} on this machine, so there is nothing to compare against.`,
      harnesses: [harness],
      evidence: [
        evidence(first, `Oldest ${label} session found`),
        ...(last === first ? [] : [evidence(last, `Newest ${label} session found`)]),
      ],
      suggestion: {
        type: "habit",
        title: "Compare with a second agent",
        action: `If you use another agent on a different machine, run Hindsight there too. If not, trying a second agent on a few tasks shows which one suits which kind of work.`,
      },
    },
  ];
};
