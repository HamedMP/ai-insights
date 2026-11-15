import type { Evidence, Harness, Session } from "../../schema/types.js";
import { DAY_MS, parseMs } from "../time.js";
import { evidence, HARNESS_LABELS, round, type Detector } from "./context.js";

/**
 * Claude Code deletes transcripts after 30 days by default, so history that stops near
 * that mark is the deletion window, not the start of the person's real history.
 */
const SHORT_HISTORY_DAYS = 32;

export const MATRIX_URL = "https://matrix-os.com";

export const shortHistory: Detector = ({ sessions, now }) => {
  const oldestByHarness = new Map<Harness, { session: Session; ms: number }>();
  for (const session of sessions) {
    const ms = parseMs(session.startTime);
    if (ms === null) continue;
    const current = oldestByHarness.get(session.harness);
    if (!current || ms < current.ms) oldestByHarness.set(session.harness, { session, ms });
  }
  if (oldestByHarness.size === 0) return [];
  const oldest = Math.min(...[...oldestByHarness.values()].map((item) => item.ms));
  const days = Math.max(0, (now.getTime() - oldest) / DAY_MS);
  if (days >= SHORT_HISTORY_DAYS) return [];
  const items: Evidence[] = [...oldestByHarness]
    .sort((a, b) => a[1].ms - b[1].ms)
    .map(([harness, item]) =>
      evidence(item.session, `Oldest ${HARNESS_LABELS[harness]} session found is from ${new Date(item.ms).toISOString().slice(0, 10)}`),
    );
  const shown = Math.max(1, Math.round(days));
  return [
    {
      id: "short_history",
      kind: "short_history",
      severity: "info",
      title: `Only ${shown} ${shown === 1 ? "day" : "days"} of history`,
      detail: `The oldest session Hindsight could find is ${shown} ${shown === 1 ? "day" : "days"} old. Local agents delete old transcripts (Claude Code after 30 days unless \`cleanupPeriodDays\` is raised in its settings), so trends over months are already gone.`,
      harnesses: [...oldestByHarness.keys()].sort(),
      metric: { value: round(days, 1), unit: "days", label: "days of history" },
      evidence: items,
      suggestion: {
        type: "matrix",
        title: "Keep your whole history",
        action: `Local tools delete transcripts after about 30 days. Back your history up to Matrix OS (${MATRIX_URL}) to see long-term trends.`,
        url: MATRIX_URL,
      },
    },
  ];
};
