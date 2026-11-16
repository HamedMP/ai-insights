import type { Evidence, Harness, Session } from "../../schema/types.js";
import { historyDaysFrom } from "../history.js";
import { MATRIX_URL } from "../links.js";
import { parseMs } from "../time.js";
import { evidence, HARNESS_LABELS, plural, type Detector } from "./context.js";

/**
 * Claude Code deletes transcripts after 30 days by default, so history that stops near
 * that mark is usually the deletion window, not the start of the person's real history.
 */
const SHORT_HISTORY_DAYS = 32;

export const shortHistory: Detector = ({ sessions, coverage, now, clock }) => {
  const oldestByHarness = new Map<Harness, { session: Session; ms: number }>();
  for (const session of sessions) {
    const ms = parseMs(session.startTime);
    if (ms === null) continue;
    const current = oldestByHarness.get(session.harness);
    if (!current || ms < current.ms) oldestByHarness.set(session.harness, { session, ms });
  }
  // The scan's oldest date is what the page shows, so it wins when it reaches further back than the sessions here.
  for (const entry of coverage) {
    const ms = parseMs(entry.oldest);
    const current = oldestByHarness.get(entry.harness);
    if (ms !== null && current && ms < current.ms) current.ms = ms;
  }
  // Shortest first: a long Codex history must not hide that Claude Code kept only days of it.
  const spans = [...oldestByHarness]
    // Coverage.historyDays is the number the page shows; the fallback covers a harness the coverage list omits.
    .map(([harness, item]) => ({
      harness,
      ...item,
      days: coverage.find((entry) => entry.harness === harness)?.historyDays ?? historyDaysFrom(item.ms, now.getTime(), clock),
    }))
    .sort((a, b) => a.days - b.days || a.harness.localeCompare(b.harness));
  const short = spans.filter((span) => span.days < SHORT_HISTORY_DAYS);
  if (short.length === 0) return [];
  const lead = short[0]!;
  const leadLabel = HARNESS_LABELS[lead.harness];
  const items: Evidence[] = spans.map((span) =>
    evidence(span.session, `${HARNESS_LABELS[span.harness]} history goes back to ${clock.dayOfMs(span.ms)} (${plural(span.days, "day")})`),
  );
  // Each harness is described by its own oldest date; a single date across harnesses would misdate the shorter one.
  const perHarness = spans.map((span) => `${HARNESS_LABELS[span.harness]} ${plural(span.days, "day")} (since ${clock.dayOfMs(span.ms)})`).join(", ");
  return [
    {
      id: "short_history",
      kind: "short_history",
      severity: "info",
      title: `Only ${plural(lead.days, "day")} of ${leadLabel} history`,
      detail: `History on this machine goes back: ${perHarness}. The usual cause is that local agents delete old transcripts (Claude Code after 30 days unless \`cleanupPeriodDays\` is raised in its settings); a new machine or a fresh install also starts history late. Either way, trends over months cannot be seen from here.`,
      harnesses: short.map((span) => span.harness).sort(),
      metric: { value: lead.days, unit: "days", label: `days of ${leadLabel} history` },
      evidence: items,
      suggestion: {
        type: "matrix",
        title: "Store your conversations long term",
        action: `${leadLabel} history here starts on ${clock.dayOfMs(lead.ms)}, and local tools usually delete transcripts after about 30 days. Upload and store your conversations long term in Matrix OS (${MATRIX_URL}) to keep them and see trends over months.`,
        url: MATRIX_URL,
      },
    },
  ];
};
