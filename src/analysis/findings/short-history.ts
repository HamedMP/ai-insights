import type { Evidence, Harness, Session } from "../../schema/types.js";
import { DAY_MS, parseMs } from "../time.js";
import { MATRIX_URL } from "../links.js";
import { evidence, HARNESS_LABELS, round, type Detector } from "./context.js";

/**
 * Claude Code deletes transcripts after 30 days by default, so history that stops near
 * that mark is the deletion window, not the start of the person's real history.
 */
const SHORT_HISTORY_DAYS = 32;

export const shortHistory: Detector = ({ sessions, now }) => {
  const oldestByHarness = new Map<Harness, { session: Session; ms: number }>();
  for (const session of sessions) {
    const ms = parseMs(session.startTime);
    if (ms === null) continue;
    const current = oldestByHarness.get(session.harness);
    if (!current || ms < current.ms) oldestByHarness.set(session.harness, { session, ms });
  }
  // Shortest first: a long Codex history must not hide that Claude Code kept only days of it.
  const spans = [...oldestByHarness]
    .map(([harness, item]) => ({ harness, ...item, days: Math.max(0, (now.getTime() - item.ms) / DAY_MS) }))
    .sort((a, b) => a.days - b.days || a.harness.localeCompare(b.harness));
  const short = spans.filter((span) => span.days < SHORT_HISTORY_DAYS);
  if (short.length === 0) return [];
  const lead = short[0]!;
  const shownDays = (days: number) => {
    const value = Math.max(1, Math.round(days));
    return `${value} ${value === 1 ? "day" : "days"}`;
  };
  const leadLabel = HARNESS_LABELS[lead.harness];
  const items: Evidence[] = spans.map((span) =>
    evidence(span.session, `Oldest ${HARNESS_LABELS[span.harness]} session found is from ${new Date(span.ms).toISOString().slice(0, 10)} (${shownDays(span.days)} ago)`),
  );
  const perHarness = spans.map((span) => `${HARNESS_LABELS[span.harness]} ${shownDays(span.days)}`).join(", ");
  return [
    {
      id: "short_history",
      kind: "short_history",
      severity: "info",
      title: `Only ${shownDays(lead.days)} of ${leadLabel} history`,
      detail: `History on this machine goes back: ${perHarness}. Local agents delete old transcripts (Claude Code after 30 days unless \`cleanupPeriodDays\` is raised in its settings), so trends over months are already gone.`,
      harnesses: short.map((span) => span.harness).sort(),
      metric: { value: round(lead.days, 1), unit: "days", label: `days of ${leadLabel} history` },
      evidence: items,
      suggestion: {
        type: "matrix",
        title: "Store your conversations long term",
        action: `Local tools delete transcripts after about 30 days. Upload and store your conversations long term in Matrix OS (${MATRIX_URL}) to keep them and see trends over months.`,
        url: MATRIX_URL,
      },
    },
  ];
};
