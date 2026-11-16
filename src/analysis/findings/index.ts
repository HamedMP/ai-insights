import type { Finding, FindingKind } from "../../schema/types.js";
import { cacheMissCost } from "./cache-miss-cost.js";
import { contextResets } from "./context-resets.js";
import { compareFindings, MAX_EVIDENCE, type Detector, type DetectorContext } from "./context.js";
import { expensiveModelForSimpleWork } from "./expensive-model.js";
import { frequentInterruptions } from "./frequent-interruptions.js";
import { historyDiskUsage } from "./history-disk-usage.js";
import { longSessions } from "./long-sessions.js";
import { noTestsBeforeDone } from "./no-tests-before-done.js";
import { permissionPromptLoad } from "./permission-prompt-load.js";
import { repeatedFailedCommand } from "./repeated-failed-command.js";
import { repeatedInstruction } from "./repeated-instruction.js";
import { shortHistory } from "./short-history.js";
import { singleHarnessOnly } from "./single-harness-only.js";
import { slowCorrection } from "./slow-correction.js";
import { toolErrorHotspot } from "./tool-error-hotspot.js";
import { unusedFeature } from "./unused-feature.js";

export type { Detector, DetectorContext } from "./context.js";

/** Text meant to be pasted into an instructions file must be complete: no ellipsis, no `<n>`-style placeholder. */
const PLACEHOLDER = /\u2026|\.\.\.|<[^<>\n]{1,80}>/;

function withoutPlaceholderInstructions(finding: Finding): Finding {
  const text = finding.suggestion?.instructionText;
  if (!text || !PLACEHOLDER.test(text)) return finding;
  const { instructionText: _dropped, ...suggestion } = finding.suggestion!;
  return { ...finding, suggestion };
}

/** Keyed by kind so the compiler insists on a detector for every `FindingKind`. */
export const DETECTORS: Record<FindingKind, Detector> = {
  repeated_failed_command: repeatedFailedCommand,
  repeated_instruction: repeatedInstruction,
  slow_correction: slowCorrection,
  frequent_interruptions: frequentInterruptions,
  context_resets: contextResets,
  long_sessions: longSessions,
  cache_miss_cost: cacheMissCost,
  expensive_model_for_simple_work: expensiveModelForSimpleWork,
  no_tests_before_done: noTestsBeforeDone,
  permission_prompt_load: permissionPromptLoad,
  tool_error_hotspot: toolErrorHotspot,
  unused_feature: unusedFeature,
  single_harness_only: singleHarnessOnly,
  short_history: shortHistory,
  history_disk_usage: historyDiskUsage,
};

/**
 * Runs every detector. One detector tripping over odd data must not cost the person
 * the whole report, so a failure drops that detector's findings and nothing else.
 */
export function detectFindings(context: DetectorContext): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const detector of Object.values(DETECTORS)) {
    let produced: Finding[];
    try {
      produced = detector(context);
    } catch {
      continue;
    }
    for (const finding of produced) {
      if (seen.has(finding.id) || finding.evidence.length === 0) continue;
      seen.add(finding.id);
      findings.push(withoutPlaceholderInstructions({ ...finding, evidence: finding.evidence.slice(0, MAX_EVIDENCE) }));
    }
  }
  return findings.sort(compareFindings);
}
