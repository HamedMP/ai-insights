import { buildReport } from "../../../src/analysis/index.js";
import type { Coverage, Finding, FindingKind, Session } from "../../../src/schema/types.js";
import { coverage, NOW } from "../factory.js";

/** Runs the full report, so detectors are tested with the same context production gives them. */
export function findings(kind: FindingKind, sessions: Session[], options: { coverage?: Coverage[]; now?: Date } = {}): Finding[] {
  const report = buildReport({
    sessions,
    coverage: options.coverage ?? [coverage("claude-code", sessions.length), coverage("codex", 0)],
    now: options.now ?? NOW,
    timeZone: "UTC",
  });
  return report.findings.filter((finding) => finding.kind === kind);
}
