import type { Evidence, Harness, Session, Suggestion } from "../../schema/types.js";
import { PACKMEM_URL } from "../links.js";
import { evidence, HARNESS_LABELS, round, type Detector } from "./context.js";

/** Half a gigabyte of transcripts is enough that compressing it frees space a person would notice. */
const MIN_TOTAL_BYTES = 500_000_000;
const BYTES_PER_MB = 1_000_000;

/** packmem is a library, not a ready-made archiver, so this must not promise a one-step fix or a ratio. */
const ACTION =
  "Agent transcripts repeat a lot of text (the same files, tool output and context resent turn after turn), so they compress well. packmem is an Apache-2.0 library for npm, PyPI and crates.io that stores records as packed columns in a fraction of the space; you can build an archive of old transcripts on it before deleting the originals.";

function megabytes(bytes: number): number {
  return round(bytes / BYTES_PER_MB, 0);
}

export const historyDiskUsage: Detector = ({ sessions, coverage }) => {
  const sized = coverage
    .filter((entry) => typeof entry.bytes === "number" && Number.isFinite(entry.bytes) && entry.bytes > 0)
    .sort((a, b) => b.bytes! - a.bytes! || a.harness.localeCompare(b.harness));
  const total = sized.reduce((sum, entry) => sum + entry.bytes!, 0);
  if (total < MIN_TOTAL_BYTES) return [];

  // Sessions arrive sorted by start time, so the last one seen per harness is the newest.
  const newest = new Map<Harness, Session>();
  for (const session of sessions) newest.set(session.harness, session);
  const items: Evidence[] = [];
  for (const entry of sized) {
    const session = newest.get(entry.harness);
    if (!session) continue;
    items.push(evidence(session, `${HARNESS_LABELS[entry.harness]} history takes ${megabytes(entry.bytes!)} MB on disk`, session.endTime || session.startTime));
  }

  const suggestion: Suggestion = {
    type: "plugin",
    title: "Compress and save disk space",
    action: ACTION,
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
      suggestion,
    },
  ];
};
