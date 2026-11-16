import type { Evidence, Harness, Session, Suggestion } from "../../schema/types.js";
import { PACKMEM_ACTION, PACKMEM_URL } from "../links.js";
import { historyRetention } from "./history-retention.js";
import { parseMs } from "../time.js";
import { evidence, HARNESS_LABELS, round, type Detector } from "./context.js";

/** Half a gigabyte of transcripts is enough that compressing it frees space a person would notice. */
const MIN_TOTAL_BYTES = 500_000_000;
const BYTES_PER_MB = 1_000_000;
/** A session written to this recently may still be running (the MCP server uses the same window), so it is not cited. */
const RUNNING_WINDOW_MS = 10 * 60_000;

function isRunning(session: Session, nowMs: number): boolean {
  const last = Math.max(parseMs(session.endTime) ?? 0, session.sourceMtimeMs || 0);
  return nowMs - last < RUNNING_WINDOW_MS;
}


function megabytes(bytes: number): number {
  return round(bytes / BYTES_PER_MB, 0);
}

export const historyDiskUsage: Detector = (context) => {
  const { sessions, coverage, now } = context;
  const sized = coverage
    .filter((entry) => typeof entry.bytes === "number" && Number.isFinite(entry.bytes) && entry.bytes > 0)
    .sort((a, b) => b.bytes! - a.bytes! || a.harness.localeCompare(b.harness));
  const total = sized.reduce((sum, entry) => sum + entry.bytes!, 0);
  if (total < MIN_TOTAL_BYTES) return [];

  // Sessions arrive sorted by start time, so the last finished one seen per harness is the newest.
  const newest = new Map<Harness, Session>();
  for (const session of sessions) if (!isRunning(session, now.getTime())) newest.set(session.harness, session);
  const items: Evidence[] = [];
  for (const entry of sized) {
    const session = newest.get(entry.harness);
    if (!session) continue;
    items.push(evidence(session, `${HARNESS_LABELS[entry.harness]} history takes ${megabytes(entry.bytes!)} MB on disk`, session.endTime || session.startTime));
  }

  const suggestion: Suggestion = {
    type: "plugin",
    title: "Compress and save disk space",
    action: PACKMEM_ACTION,
    ...(PACKMEM_URL ? { url: PACKMEM_URL } : {}),
  };
  return [
    {
      id: "history_disk_usage",
      kind: "history_disk_usage",
      severity: "info",
      title: `Agent history takes ${megabytes(total)} MB on disk`,
      detail: `Your agent transcripts take ${megabytes(total)} MB across ${sized.map((entry) => HARNESS_LABELS[entry.harness]).join(", ")}.`,
      harnesses: sized.map((entry) => entry.harness).sort(),
      metric: { value: megabytes(total), unit: "MB", label: "agent history on disk" },
      evidence: items,
      // The keep-your-history finding already carries the packmem step; the pitch is not shown twice.
      ...(historyRetention(context).length ? {} : { suggestion }),
    },
  ];
};
