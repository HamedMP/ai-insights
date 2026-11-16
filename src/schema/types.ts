/**
 * The shared contract. Every module codes against these types.
 * Changing this file needs the orchestrator's agreement, because five other
 * modules depend on it.
 */

export const HARNESSES = ["claude-code", "codex", "cursor", "pi", "opencode"] as const;
export type Harness = (typeof HARNESSES)[number];

// ---------------------------------------------------------------------------
// Sessions: what a source produces from one transcript
// ---------------------------------------------------------------------------

/** Token counters for one model response. `input` excludes both cache counters. */
export interface TokenUsage {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  output: number;
}

export interface ModelRequest {
  /** Stable per-response id, unique within the harness. Used to de-duplicate copies. */
  id: string;
  timestamp: string;
  model: string;
  usage: TokenUsage;
}

export const TOOL_CATEGORIES = [
  "shell",
  "read",
  "edit",
  "search",
  "web",
  "subagent",
  "mcp",
  "skill",
  "plan",
  "ask_user",
  "other",
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const TOOL_ERROR_CATEGORIES = [
  "command_failed",
  "file_not_found",
  "file_changed",
  "edit_mismatch",
  "permission_denied",
  "user_rejected",
  "timeout",
  "too_large",
  "other",
] as const;
export type ToolErrorCategory = (typeof TOOL_ERROR_CATEGORIES)[number];

export interface ToolCall {
  /** Tool name as the harness reports it, e.g. "Bash", "apply_patch", "mcp__linear__get_issue". */
  name: string;
  category: ToolCategory;
  timestamp: string;
  /** Set when the tool result was an error. */
  error?: ToolErrorCategory;
  /** Shell tools only: the command, secrets redacted, at most 300 characters. */
  command?: string;
  /** File tools only: the path the call read or changed. */
  filePath?: string;
  /** MCP tools only: the server name. */
  mcpServer?: string;
  /** Skill and slash-command invocations: the skill or command name. */
  skill?: string;
}

export interface UserPrompt {
  timestamp: string;
  /** What the person typed, secrets redacted, at most 2000 characters. Never tool results or injected context. */
  text: string;
  /** True when the prompt arrived while the agent was still working (an interruption or steer). */
  interrupted?: boolean;
}

export interface SessionFeatures {
  mcpServers: string[];
  skills: string[];
  slashCommands: string[];
  subagents: number;
  planMode: boolean;
  webSearch: boolean;
  webFetch: boolean;
  /** Number of context compactions or resets inside the session. */
  compactions: number;
}

/**
 * One normalised session. Holds numbers, tool metadata and the person's own
 * prompts. It never holds assistant text or tool output; those are read on
 * demand through `Source.excerpt`.
 */
export interface Session {
  id: string;
  harness: Harness;
  /** Absolute path (or `path#key` for database-backed harnesses) the session was read from. */
  sourcePath: string;
  /** mtime of the source in ms, used to decide whether a cached session is stale. */
  sourceMtimeMs: number;
  projectPath: string | null;
  /**
   * The main repository root when `projectPath` is a git worktree or a folder inside a repository; absent when
   * it could not be resolved (the folder is gone, or it is not in a repository). Set while scanning, from the
   * file system only, never by running git. Group by `projectRoot ?? projectPath`.
   */
  projectRoot?: string | null;
  gitBranch: string | null;
  startTime: string;
  endTime: string;
  /** Wall-clock minutes from first to last entry. */
  durationMinutes: number;
  /** Minutes with activity, counting gaps over 10 minutes as idle. */
  activeMinutes: number;
  models: string[];
  permissionMode: string | null;
  userMessageCount: number;
  assistantMessageCount: number;
  prompts: UserPrompt[];
  /** Messages injected by other agents or automations (orchestrator notes, task notifications). Never counted as the person's. */
  agentMessageCount?: number;
  /** Seconds between the agent finishing a turn and the person's next prompt. */
  userResponseTimesSec: number[];
  requests: ModelRequest[];
  toolCalls: ToolCall[];
  features: SessionFeatures;
  linesAdded: number;
  linesRemoved: number;
  filesModified: string[];
  /** File-extension language name to number of file-tool calls, e.g. { TypeScript: 12 }. */
  languages: Record<string, number>;
  gitCommits: number;
  gitPushes: number;
  /** Records the parser could not understand. Never throw on unknown records; count them. */
  issues: number;
}

export interface SessionFile {
  harness: Harness;
  /** Same form as `Session.sourcePath`. */
  path: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface DiscoverOptions {
  /** Only files modified at or after this instant. */
  since?: Date;
  /** Newest first; stop after this many files. */
  maxFiles?: number;
  /** Override the harness's default roots (tests, recovered backups). */
  roots?: string[];
}

export interface ExcerptOptions {
  /** At most this many turns, default 40. */
  maxTurns?: number;
  /** At most this many characters per turn, default 1200. */
  maxCharsPerTurn?: number;
  /** Keep turns closest to this instant. Default: spread evenly across the session. */
  around?: string;
}

/** A redacted, truncated slice of a transcript, for the model-run analysis pass. */
export interface TranscriptTurn {
  timestamp: string;
  /** "agent" is a message another agent or automation injected; it is not the person speaking. */
  role: "user" | "assistant" | "tool" | "agent";
  text: string;
  toolName?: string;
  isError?: boolean;
}

/** One per harness. Sources never throw on bad input; they skip and count. */
export interface Source {
  /**
   * Bump whenever this source's parser would produce a different `Session` from the same transcript. The store
   * keeps it with each cached session and re-parses when it differs, so a parser fix reaches history that has
   * not changed on disk. A missing version counts as "0".
   */
  parserVersion?: string;
  harness: Harness;
  /** Human name, e.g. "Claude Code". */
  label: string;
  /** Default roots on this machine, honouring the harness's own env overrides. */
  defaultRoots(): string[];
  discover(options?: DiscoverOptions): Promise<SessionFile[]>;
  /** Null when the file holds no real session (empty, too short, not a transcript). */
  parse(file: SessionFile): Promise<Session | null>;
  excerpt(file: SessionFile, options?: ExcerptOptions): Promise<TranscriptTurn[]>;
}

// ---------------------------------------------------------------------------
// Facets: the model-written judgement per session, with a fixed taxonomy
// ---------------------------------------------------------------------------

export const GOAL_CATEGORIES = [
  "feature",
  "bug_fix",
  "refactor",
  "tests",
  "review",
  "debugging",
  "research",
  "planning",
  "docs",
  "devops",
  "git_and_prs",
  "data_analysis",
  "configuration",
  "writing",
  "orchestration",
  "tooling",
  "other",
] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];

export const SESSION_TYPES = ["single_task", "multi_task", "iterative_refinement", "exploration", "quick_question"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const OUTCOMES = ["fully_achieved", "mostly_achieved", "partially_achieved", "not_achieved", "in_progress", "unclear"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const HELPFULNESS = ["essential", "very_helpful", "moderately_helpful", "slightly_helpful", "unhelpful"] as const;
export type Helpfulness = (typeof HELPFULNESS)[number];

export const SATISFACTION = ["satisfied", "likely_satisfied", "neutral", "dissatisfied", "unclear"] as const;
export type Satisfaction = (typeof SATISFACTION)[number];

export const FRICTION_TYPES = [
  "misunderstood_request",
  "wrong_approach",
  "buggy_code",
  "incomplete_work",
  "ignored_instructions",
  "over_engineering",
  "permission_block",
  "tool_failure",
  "environment_issue",
  "external_blocker",
  "context_loss",
  "slow_or_stuck",
] as const;
export type FrictionType = (typeof FRICTION_TYPES)[number];

export const SUCCESS_TYPES = [
  "correct_code_edits",
  "multi_file_changes",
  "good_debugging",
  "fast_accurate_search",
  "good_explanations",
  "proactive_help",
  "good_planning",
  "autonomous_execution",
] as const;
export type SuccessType = (typeof SUCCESS_TYPES)[number];

/** Who steered the session: the person typing, another agent (an orchestrator or automation), or both. */
export const DRIVERS = ["person", "agent", "mixed"] as const;
export type Driver = (typeof DRIVERS)[number];

export interface SessionFacet {
  sessionId: string;
  harness: Harness;
  underlyingGoal: string;
  goalCategories: GoalCategory[];
  sessionType: SessionType;
  outcome: Outcome;
  helpfulness: Helpfulness;
  satisfaction: Satisfaction;
  primarySuccess: SuccessType | null;
  frictions: Partial<Record<FrictionType, number>>;
  frictionDetail: string;
  summary: string;
  /** Optional so facets saved before this field existed stay valid. */
  drivenBy?: Driver;
}

// ---------------------------------------------------------------------------
// Findings: deterministic, evidence-backed observations
// ---------------------------------------------------------------------------

export const FINDING_KINDS = [
  "repeated_failed_command",
  "repeated_instruction",
  "slow_correction",
  "frequent_interruptions",
  "context_resets",
  "long_sessions",
  "cache_miss_cost",
  "expensive_model_for_simple_work",
  "no_tests_before_done",
  "permission_prompt_load",
  "tool_error_hotspot",
  "unused_feature",
  "single_harness_only",
  "short_history",
  "history_disk_usage",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export type Severity = "info" | "low" | "medium" | "high";

export interface Evidence {
  sessionId: string;
  harness: Harness;
  timestamp?: string;
  /** One short line a person can check, e.g. "`pnpm test` failed 4 times in a row". */
  note: string;
}

export const SUGGESTION_TYPES = ["instructions", "feature", "plugin", "habit", "model_choice", "matrix"] as const;
export type SuggestionType = (typeof SUGGESTION_TYPES)[number];

export interface Suggestion {
  type: SuggestionType;
  title: string;
  /** What to do, in one or two sentences. */
  action: string;
  /** For `instructions`: text to add to CLAUDE.md / AGENTS.md. */
  instructionText?: string;
  /** For `feature` and `plugin`: a link to learn more or install. */
  url?: string;
}

export interface Finding {
  /** Stable across runs for the same underlying pattern, e.g. `repeated_failed_command:pnpm test`. */
  id: string;
  kind: FindingKind;
  severity: Severity;
  title: string;
  detail: string;
  harnesses: Harness[];
  metric?: { value: number; unit: string; label: string };
  evidence: Evidence[];
  suggestion?: Suggestion;
}

// ---------------------------------------------------------------------------
// Report: what the renderer, the CLI and the MCP server all consume
// ---------------------------------------------------------------------------

export interface UsageTotals {
  /** Sum of every counter. */
  tokens: number;
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  requests: number;
  /** API list-price estimate. Null when nothing could be priced; never 0 for "unknown". */
  estimatedUsd: number | null;
  /** Requests whose model has no known price. */
  unpriced: number;
}

export interface UsageSummary extends UsageTotals {
  daily: Array<UsageTotals & { day: string }>;
  models: Array<UsageTotals & { harness: Harness; model: string }>;
  /** cachedInput / (input + cachedInput + cacheWrite), 0..1, null when there was no input. */
  cacheHitRate: number | null;
  pricingVersion: string;
}

export interface Coverage {
  harness: Harness;
  label: string;
  /** False when no history for this harness was found on the machine. */
  found: boolean;
  files: number;
  /** Bytes the harness's history takes on disk, when the scan measured it. */
  bytes?: number;
  sessions: number;
  issues: number;
  oldest: string | null;
  newest: string | null;
}

export interface Count {
  key: string;
  count: number;
}

export interface SessionSpan {
  sessionId: string;
  harness: Harness;
  /** `projectRoot ?? projectPath`, or null when the session has neither. */
  project: string | null;
  start: string;
  end: string;
  activeMinutes: number;
  /** True when the session was driven by another agent, not typed by the person. */
  agentDriven?: boolean;
}

export interface Activity {
  sessions: number;
  activeDays: number;
  /** Longest run of consecutive active days. */
  longestStreakDays: number;
  /** Sum over sessions, so parallel sessions add up: agent time, not the person's time. */
  totalActiveMinutes: number;
  /** Wall-clock minutes during which at least one session was active. Never more than 24 h per day. */
  wallClockActiveMinutes?: number;
  userMessages: number;
  assistantMessages: number;
  linesAdded: number;
  linesRemoved: number;
  filesModified: number;
  gitCommits: number;
  /** 24 entries, sessions' user messages by local hour. */
  hourHistogram: number[];
  /** Per local day, newest last. */
  daily: Array<{ day: string; sessions: number; userMessages: number; activeMinutes: number }>;
  byHarness: Array<{ harness: Harness; sessions: number; activeMinutes: number }>;
  /** Grouped by `projectRoot ?? projectPath`; `worktrees` counts the distinct working folders folded into the row. */
  projects: Array<{ projectPath: string; sessions: number; activeMinutes: number; worktrees?: number }>;
  /**
   * One entry per session with a known start and end, oldest first, capped at the newest 400. Lets a renderer
   * draw which sessions ran side by side. `activeMinutes` is the session's own active time inside the span.
   */
  sessionSpans?: SessionSpan[];
  languages: Count[];
  tools: Count[];
  toolCategories: Count[];
  toolErrors: Count[];
  /** Buckets: "<10s", "10-30s", "30s-1m", "1-5m", "5-15m", ">15m". */
  responseTimeBuckets: Count[];
  medianResponseTimeSec: number | null;
  /** Times when two or more sessions overlapped. */
  parallelSessions: { overlapEvents: number; maxConcurrent: number; sessionsInvolved: number };
  features: {
    mcpServers: Count[];
    skills: Count[];
    slashCommands: Count[];
    sessionsWithSubagents: number;
    sessionsWithPlanMode: number;
    sessionsWithWeb: number;
    compactions: number;
  };
}

export interface FacetAggregate {
  sessionsWithFacets: number;
  goalCategories: Count[];
  sessionTypes: Count[];
  outcomes: Count[];
  helpfulness: Count[];
  satisfaction: Count[];
  frictions: Count[];
  successes: Count[];
}

/** Written by the person's own agent during the insights skill, then saved through the MCP server. */
export interface Narrative {
  /** Two or three sentences shown at the top of the report. */
  headline: string;
  workAreas: Array<{ name: string; sessions: number; description: string }>;
  interactionStyle: string;
  wins: Array<{ title: string; description: string }>;
  frictions: Array<{ title: string; description: string; examples: string[] }>;
  suggestions: Suggestion[];
  /** Larger workflows worth trying next. */
  horizon: Array<{ title: string; description: string; starterPrompt?: string }>;
}

export const REPORT_VERSION = 1 as const;

export interface Report {
  version: typeof REPORT_VERSION;
  generatedAt: string;
  /** IANA zone used for day and hour bucketing. */
  timeZone: string;
  range: { from: string | null; to: string | null };
  coverage: Coverage[];
  activity: Activity;
  usage: UsageSummary;
  findings: Finding[];
  /** Null until the model-run pass has saved facets. */
  facets: FacetAggregate | null;
  /** Null until the model-run pass has saved a narrative. */
  narrative: Narrative | null;
}

export interface BuildReportInput {
  sessions: Session[];
  facets?: SessionFacet[];
  narrative?: Narrative | null;
  coverage: Coverage[];
  timeZone?: string;
  now?: Date;
}
