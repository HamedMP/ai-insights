import type { Harness, Severity, SuggestionType } from "../schema/types.js";
import { humanize } from "./format.js";

const HARNESS_LABELS: Record<Harness, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  "claude-chat": "Claude chat",
};

export function harnessLabel(harness: string): string {
  return (HARNESS_LABELS as Record<string, string>)[harness] ?? humanize(harness);
}

const KEY_LABELS: Record<string, string> = {
  git_and_prs: "Git and PRs",
  devops: "DevOps",
  mcp: "MCP",
  ask_user: "Asking you",
  user_rejected: "Rejected by you",
  edit_mismatch: "Edit did not match",
  file_changed: "File changed underneath",
  too_large: "Too large",
  external_blocker: "External blocker",
  slow_or_stuck: "Slow or stuck",
  over_engineering: "Over-engineering",
  data_analysis: "Data analysis",
  quick_question: "Quick question",
  single_task: "Single task",
  multi_task: "Multiple tasks",
  iterative_refinement: "Iterative refinement",
};

/** Human label for a taxonomy key; unknown keys still read sensibly. */
export function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? humanize(key);
}

export const SEVERITY_LABELS: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low", info: "Info" };
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };

export function severityRank(severity: string): number {
  return SEVERITY_ORDER[severity] ?? 4;
}

export function severityLabel(severity: string): string {
  return (SEVERITY_LABELS as Record<string, string>)[severity] ?? humanize(severity);
}

const SUGGESTION_LABELS: Record<SuggestionType, string> = {
  instructions: "Instructions",
  feature: "Feature",
  plugin: "Plugin",
  habit: "Habit",
  model_choice: "Model choice",
  matrix: "Matrix OS",
};

export function suggestionLabel(type: string): string {
  return (SUGGESTION_LABELS as Record<string, string>)[type] ?? humanize(type);
}
