/**
 * The shared contract. Every module codes against these types.
 * Changing this file needs the orchestrator's agreement, because five other
 * modules depend on it.
 */

export const HARNESSES = ["claude-code", "codex", "cursor", "pi", "opencode", "gemini"] as const;
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
  /**
   * USD the harness itself recorded for this response (OpenCode, Pi), at its own price list. It can be 0 for
   * subscription or free models and is not an API bill. Absent when the harness records no cost.
   */
  costUsd?: number;
  /**
   * The provider's service tier, when the transcript records one that changes the price (Codex `priority`
   * for Fast mode, `ultrafast`). Absent for the standard tier and when unknown.
   */
  serviceTier?: string;
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
  /**
   * Invocations per slash command, keyed as in `slashCommands`. `slashCommands` is a set and loses repeats;
   * this keeps them, including commands that leave no prompt (Claude `system` `local_command` lines). Absent in
   * sessions cached before it existed and in sources that cannot count.
   */
  slashCommandCounts?: Record<string, number>;
}

/** How much the model thought before answering, as the harness records it. */
export interface ThinkingStats {
  /** Claude: assistant records holding a `thinking` block. Codex: reasoning items. */
  blocks: number;
  /** Summed thinking time in ms, or null when the harness records no durations. */
  totalMs: number | null;
  /** The longest single think in ms, or null when the harness records no durations. */
  longestMs: number | null;
}

/**
 * Who let the agent's actions through. Each counter is absent when the harness does not record it, so a
 * missing number is never read as zero.
 */
export interface ApprovalStats {
  /** Claude: `permissionDecision` accepted by configuration (classifier, mode, rule). */
  auto?: number;
  /** Claude: accepted by the person (`user_temporary`, `user_permanent` and other user sources). */
  byPerson?: number;
  /** Claude: rejected decisions. Codex: actions the person declined. */
  denied?: number;
  /** Codex: automatic guardian review threads this session started. */
  guardianReviews?: number;
  /**
   * Codex: actions the automatic reviewer (auto-review) blocked or let time out, from the tool result's
   * `codex/telemetry` error code (`guardian_denied`, `execution_rejected`, `guardian_timed_out`). Not the person.
   */
  autoBlocked?: number;
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
  /**
   * Usage counters the parser read but could not count (Codex: a cumulative counter that went backwards with
   * nothing to explain it, or a duplicate that shrank). Not unreadable lines, so not in `issues`. Absent when none.
   */
  skippedUsageRecords?: number;
  /** Tool calls seen beyond the source's cap and so missing from `toolCalls`. Absent or 0 when none were dropped. */
  toolCallsDropped?: number;
  /** Absent when the harness records no thinking, and in sessions cached before it existed. */
  thinking?: ThinkingStats;
  /** Absent when the harness records no approval decisions, and in sessions cached before it existed. */
  approvals?: ApprovalStats;
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
  /**
   * Why history this source can see on this machine cannot be read (an unsupported Node version, an unreadable
   * database), or null when nothing is wrong. Shown in coverage and `doctor`. Never throws.
   */
  diagnose?(): Promise<string | null>;
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
  /** Folded into `history_retention`; no detector emits it any more. Kept so older saved reports still type-check. */
  "short_history",
  "history_disk_usage",
  "history_retention",
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

/** One action of a multi-step suggestion, shown as its own step. */
export interface SuggestionStep {
  title: string;
  /** What to do and why, in one or two sentences. */
  action: string;
  /** Text to copy exactly as given: a command to run or a settings line to paste. */
  command?: string;
  /** How to take the step back. */
  undo?: string;
  url?: string;
  instructionText?: string;
}

export interface Suggestion {
  type: SuggestionType;
  title: string;
  /** What to do, in one or two sentences. */
  action: string;
  /** For `instructions`: text to add to CLAUDE.md / AGENTS.md. */
  instructionText?: string;
  /** For `feature` and `plugin`: a link to learn more or install. */
  url?: string;
  /**
   * On a narrative suggestion: the `Finding.id` it builds on. A renderer shows one card for the pair, so the
   * same idea is not listed twice. Absent when the suggestion stands on its own.
   */
  findingId?: string;
  /**
   * Separate actions to show as numbered steps, in order. `action` then sums them up in one line. Absent on
   * single-action suggestions.
   */
  steps?: SuggestionStep[];
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

/**
 * Spend a harness recorded itself (OpenCode, Pi), at its own price list. Not an API bill and not the estimate:
 * subscriptions and coding plans record 0, so `zeroRequests` says how many requests recorded $0.
 */
export interface RecordedCost {
  usd: number;
  /** Requests that carried a recorded cost (zero included). */
  requests: number;
  /** Of those, the ones that recorded exactly $0. */
  zeroRequests: number;
}

export interface UsageSummary extends UsageTotals {
  daily: Array<UsageTotals & { day: string }>;
  /** Total of `ModelRequest.costUsd`; absent when no request carried one (never a $0 stand-in). */
  recorded?: RecordedCost;
  /** The same per harness, highest spend first; absent with `recorded`. */
  recordedByHarness?: Array<RecordedCost & { harness: Harness }>;
  models: Array<UsageTotals & { harness: Harness; model: string }>;
  /** cachedInput / (input + cachedInput + cacheWrite), 0..1, null when there was no input. */
  cacheHitRate: number | null;
  pricingVersion: string;
}

export interface Coverage {
  /** Local calendar days from the oldest session's day to the report day, at least 1. The one number to show. */
  historyDays?: number;
  harness: Harness;
  label: string;
  /** False when no history for this harness was found on the machine. */
  found: boolean;
  files: number;
  /** Bytes the harness's history takes on disk, when the scan measured it. */
  bytes?: number;
  sessions: number;
  /** Unreadable lines and records. */
  issues: number;
  /** Usage counters read but not counted (`Session.skippedUsageRecords` summed); absent when none. */
  skippedUsageRecords?: number;
  oldest: string | null;
  newest: string | null;
  /** Why history that exists could not be read, e.g. "needs Node 22.5 or later to read opencode.db". */
  note?: string;
}

export interface Count {
  key: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Retention: how long each harness keeps transcripts, and what AI Insights keeps after they are gone
// ---------------------------------------------------------------------------

/** Days ahead `atRisk` looks for transcripts about to be deleted. */
export const RETENTION_WINDOW_DAYS = 7;

export interface RetentionAtRisk {
  /** Transcripts past, or reaching within the window, the age at which the harness deletes them. */
  sessions: number;
  bytes: number;
  /**
   * When the first of them becomes eligible for deletion (ISO). The harness deletes at its next start after
   * that, so a date in the past means "the next time it starts".
   */
  nextDeletion: string | null;
}

export interface HarnessRetention {
  harness: Harness;
  /** `deletes`: the harness removes transcripts by itself; `kept`: kept until you delete them; `unknown`: not documented or unreadable here. */
  policy: "deletes" | "kept" | "unknown";
  /** Age in days at which transcripts are deleted. Only with `deletes`. */
  days?: number;
  /** Where `days` came from: the documented default, the person's settings file, or managed (organization) settings. */
  source?: "default" | "settings" | "managed";
  /** The setting that controls it: its name, the file it lives in (home shortened to `~`), and the value found there. */
  setting?: { name: string; file: string; value: number | string | null };
  /** What the age is measured from: the file's last change (Claude Code) or the chat's recorded last update (Gemini CLI). */
  clock?: "modified" | "last-updated";
  /** One or two sentences on how the harness decides, from its docs or source. */
  basis: string;
  /** The doc or source `basis` comes from. */
  url?: string;
  /** Transcripts on disk now. */
  transcripts: number;
  bytes: number;
  /** Start of the oldest session whose transcript is still on disk (ISO), or null. */
  oldestOnDisk: string | null;
  /** Only with `deletes`. */
  atRisk?: RetentionAtRisk;
  /**
   * Up to five sessions in `atRisk`, soonest first, so a finding can cite them. Session ids only: no paths.
   */
  due?: Array<{ sessionId: string; eligibleAt: string }>;
  /**
   * Transcripts that would be due but the harness keeps anyway, left out of `atRisk`: Claude Code keeps sessions
   * started or last continued in Claude Desktop or Cowork (v2.1.248+), and Claude Desktop's own session stores are
   * not part of its sweep, so they may be kept.
   */
  exempt?: { sessions: number; reason: string };
  /** Sessions whose transcript is gone and that now exist only in AI Insights' cache. */
  cachedOnly: number;
  /** Start of the oldest session AI Insights still has for this harness, on disk or in its cache (ISO), or null. */
  coversFrom: string | null;
}

export interface Retention {
  windowDays: number;
  /** Harnesses with transcripts on disk or sessions in the cache. */
  harnesses: HarnessRetention[];
  /** Sums over `harnesses`. */
  atRisk: RetentionAtRisk;
  cachedOnly: number;
  /** The earliest session start any recap can still cover (ISO), or null. */
  coversFrom: string | null;
  /**
   * What a session cached by AI Insights keeps once its transcript is deleted, and what it does not. Fixed text,
   * so a page can say "your stats survive; the full transcripts do not unless you archive them".
   */
  cache: { keeps: string[]; drops: string[] };
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
  /**
   * When the session was really working: [startMs, endMs] epoch-millisecond pairs, split where it sat idle for
   * more than 10 minutes, oldest first, at most 50. A session resumed days later is two stretches, not one bar.
   */
  active?: Array<[number, number]>;
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
  /** `sessions` counts sessions started that day, so the series sums to `sessions` above. */
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

// ---------------------------------------------------------------------------
// Friction causes: sessions grouped by the kind of trouble they showed. A count of sessions showing a sign,
// never a diagnosis of why.
// ---------------------------------------------------------------------------

export const FRICTION_CAUSES = ["missing_context", "unclear_request", "context_ran_out", "tool_environment", "permissions", "off_course"] as const;
export type FrictionCauseKey = (typeof FRICTION_CAUSES)[number];

export interface FrictionCauseSign {
  /** A deterministic signal (`stepped_in`, `compacted`) or `judged:<FrictionType>` for the agent review's call. */
  key: string;
  /** Fixed wording, e.g. "Context was compacted". */
  label: string;
  sessions: number;
}

export interface FrictionCause {
  key: FrictionCauseKey;
  /** Fixed wording, e.g. "Context ran out". */
  label: string;
  /** Sessions showing at least one of `signs`. */
  sessions: number;
  /** Sessions the signs could be seen in: every session, or only judged ones when every sign comes from the review. */
  of: number;
  /** sessions / of, 0..1. */
  share: number;
  /** One fixed sentence on what is counted. */
  basis: string;
  signs: FrictionCauseSign[];
  /** At most two sessions that show it most, notes from fixed templates only. */
  evidence: Evidence[];
  /** The finding whose suggestion is used, when one fired. */
  findingId?: string;
  suggestion: { title: string; action: string };
}

export interface FrictionCauses {
  /** Sessions looked at. */
  sessions: number;
  /** Sessions with a facet; their judged friction is used only when there are at least `minJudged`. */
  judged: number;
  /** True when judged friction was used. */
  usedReview: boolean;
  minSessions: number;
  minJudged: number;
  /** Sessions showing a sign of any cause. A session can show several, so the causes' shares do not add up to this. */
  withAny: number;
  /** Causes with at least one session, highest share first. */
  causes: FrictionCause[];
}

// ---------------------------------------------------------------------------
// Work ratios: how the person works, as ratios of counts. None of them grows with tokens or spend.
// ---------------------------------------------------------------------------

export const WORK_RATIO_KEYS = ["correctionsPerSession", "contextResetShare", "toolErrorRate", "planFirstShare", "parallelism"] as const;
export type WorkRatioKey = (typeof WORK_RATIO_KEYS)[number];

export interface WorkRatio {
  key: WorkRatioKey;
  /** Fixed wording, e.g. "Mid-run corrections". */
  label: string;
  /** One fixed sentence: what is counted, over what. */
  definition: string;
  /** numerator / denominator; null when the denominator is 0. */
  value: number | null;
  numerator: number;
  denominator: number;
  /** How `value` reads: a per-item rate, a 0..1 share, or a multiple ("1.8×"). */
  unit: "per_session" | "share" | "times";
  /** What the numerator and denominator count, e.g. "corrections", "sessions". */
  counts: { numerator: string; denominator: string };
}

export type WorkRatios = Record<WorkRatioKey, WorkRatio>;

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
  /** The shareable stats for the recap cards. Absent when there are no sessions, and in reports from before it existed. */
  recap?: Recap;
  /** How long each harness keeps transcripts. Absent when the scan did not measure it (tests, older reports). */
  retention?: Retention;
  /** Sessions grouped by the kind of trouble they showed. Absent with too few sessions, and in older reports. */
  frictionCauses?: FrictionCauses;
  /** How the person works, as ratios of counts. Absent when there are no sessions, and in older reports. */
  ratios?: WorkRatios;
}

// ---------------------------------------------------------------------------
// Recap: the shareable stats. Cards built from it get posted publicly, so it holds counts, times, shares and
// names from fixed public allowlists only: never prompt text, paths, project, branch, file or person names.
// Field names follow the approved prototype's bundle.json; docs/recap-contract.md lists every difference.
// A stat that cannot be computed is absent, never zero or a guess.
// ---------------------------------------------------------------------------

export const RECAP_VERSION = 1 as const;

/** A label from a fixed list (an allowlisted word, program or command, or a neutral fallback) and its count. */
export interface RecapCount {
  key: string;
  count: number;
}

export type RecapWeekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export type RecapVerdictKey = "night_owl" | "early_bird" | "evening" | "afternoon" | "morning";

export interface RecapRhythm {
  /** 24 entries: the person's prompts by local hour (every prompt, templates and agent-driven sessions included). */
  hours: number[];
  /** Local hour with the most prompts; the earliest on a tie. */
  peakHour: number;
  /** Share of prompts from 22:00 to 04:59, 0..1. */
  nightShare: number;
  /** Share of prompts from 05:00 to 09:59, 0..1. */
  earlyShare: number;
  verdict: { key: RecapVerdictKey; label: string };
  /** Longest run of hours with no prompt, wrapping midnight. `start` is null when every hour has prompts. */
  quiet: { len: number; start: number | null };
  /** Latest prompt between 00:00 and 04:59 as minutes after midnight; absent when there was none. */
  latestNight?: number;
  /** Peak hour per harness, for harnesses with at least one prompt. */
  harnessPeaks: Array<{ key: Harness; peak: number; prompts: number; hours: number[] }>;
  /** Monday first, always seven entries. */
  weekdays: Array<{ key: RecapWeekday; count: number }>;
}

export interface RecapVoice {
  /** Prompts the stats below were computed from: typed by the person, not slash commands or script-filled templates. */
  prompts: number;
  /** Sessions another agent drove, left out of every voice stat. */
  excludedAgentSessions: number;
  /** Prompts that open with an XML-style wrapper tag: templates a script filled, counted in totals only. */
  excludedWrapped: number;
  /** Top five words from the fixed vocabulary, counted once per prompt. */
  words: RecapCount[];
  /** Top three openers from the fixed list ("can you", "let's", "yes"). */
  openers: RecapCount[];
  polite: { please: number; thanks: number; sorry: number };
  /** Share of voice prompts that are questions, 0..1. */
  questionShare: number;
  /** Whitespace-separated words across voice prompts. */
  wordsTyped: number;
  /** Voice prompts of exactly one word. */
  oneWord: number;
  /** The prompt of at most five words that set off the most tool calls before the next prompt. Never the words themselves. */
  leverage?: { words: number; toolCalls: number };
}

export interface RecapShell {
  /** Shell tool calls with a command. */
  calls: number;
  /** Top five programs, public names only; anything else is "your own CLI". */
  programs: RecapCount[];
  /** Test-runner invocations. */
  tests: number;
  /** Share of test runs that did not fail, 0..1; absent when no tests ran. */
  testPass?: number;
  rmrf: number;
  forcePush: number;
  /** Times the agent slept or waited (`sleep`, Codex `clock.sleep`). */
  sleeps: number;
}

export interface RecapLongestSession {
  activeMinutes: number;
  wallMinutes: number;
  prompts: number;
  toolCalls: number;
  harness: Harness;
  compactions: number;
  /** The source kept only part of the session's tool calls: show `toolCalls` as "10,000+". */
  toolCallsCapped: boolean;
  /**
   * Longer sessions left out because a script or another agent drove them: most prompts were script-filled
   * templates (an XML-style wrapper such as a Codex `<heartbeat>`), or other agents sent more messages than the
   * person. Absent when the longest session overall was the person's.
   */
  skippedAutomated?: number;
}

/**
 * The sessions open around the moment the most ran at once, for drawing lanes. Share-safe: relative minutes
 * and harness names only, no ids, projects or clock times. Lanes active at `peakAt` number exactly `atPeak`,
 * which equals `parallel.max`.
 */
export interface RecapLanes {
  /** Length of the window drawn, in minutes, centred on the peak where the history allows. */
  windowMinutes: number;
  /** Minutes from the window start to the peak instant. */
  peakAt: number;
  atPeak: number;
  /** Oldest start first. Every lane active at the peak is kept; others fill up to 20 lanes. */
  lanes: Array<{
    harness: Harness;
    /** Minutes from the window start, clipped to the window. */
    start: number;
    end: number;
    /** When the session was working inside the window, [from, to) in minutes, at most 20. */
    active: Array<[number, number]>;
  }>;
}

export interface RecapFailures {
  total: number;
  calls: number;
  /** total / calls, 0..1 (0 when there were no calls). */
  rate: number;
  categories: Array<{ key: ToolErrorCategory; label: string; count: number }>;
  /** The programs the agent's commands failed with most: public names only, anything else is "your own CLI". */
  nemesis: Array<{ key: string; count: number; runs: number }>;
}

export interface RecapModel {
  /** A display name from a known public model family ("Claude Opus 4.6", "GPT-5"), else "Another model". */
  key: string;
  harness: Harness;
  requests: number;
  /** Share of the requests of models the person chose (the automatic `codex-auto-review` excluded), 0..1. */
  share: number;
}

export interface RecapUsage {
  tokens: number;
  output: number;
  /** Requests to models the person chose: `codex-auto-review` is left out. */
  requests: number;
  /** API list-price estimate; absent when nothing could be priced. */
  usd?: number;
  unpriced: number;
  cacheHitRate?: number;
  /** Output tokens as novels (about 0.75 words per token, 90k words per novel). */
  novels: number;
  /** Absent without a price or without commits. */
  usdPerCommit?: number;
}

export interface RecapPersona {
  /** "The Night Orchestrator". */
  title: string;
  time: "Night" | "Dawn" | "Golden-Hour" | "Afternoon" | "Morning";
  role: "Orchestrator" | "Shipper" | "Delegator";
  /** One sentence built from a fixed template and numbers; the win-rate clause only when facets exist. */
  reason: string;
  /** Extra titles earned from `Report.ratios`, at most three. Absent when none was earned, and in older recaps. */
  earned?: RecapTitle[];
}

/** A title earned from one work ratio: fixed wording, and the rule with the number that earned it. */
export interface RecapTitle {
  key: string;
  /** "The Clear Briefer". */
  title: string;
  ratio: WorkRatioKey;
  value: number;
  /** Fixed template and numbers, e.g. "0.05 mid-run corrections per session (under 0.1 earns it)". */
  rule: string;
}

export interface RecapTip {
  /** One of the fixed suggestion titles the detectors write; nothing interpolated from the history. */
  title: string;
  kind: FindingKind;
  metric: { value: number; unit: string } | null;
}

export interface RecapThinking {
  blocks: number;
  /** Absent when no session recorded durations. */
  totalMs?: number;
  longestMs?: number;
  /** Sessions that reported thinking; older cached sessions report none. */
  sessions: number;
}

export interface RecapApprovals {
  auto?: number;
  byPerson?: number;
  denied?: number;
  guardianReviews?: number;
  autoBlocked?: number;
  /** Sessions that reported approvals. */
  sessions: number;
}

export interface RecapReplies {
  /** Gaps between the agent finishing and the person's next prompt, over 12 h dropped (a session reopened days later). */
  count: number;
  medianSec: number;
  /** Share answered within a minute, 0..1. */
  fastShare: number;
  /** The slowest reply kept, at most 12 h. */
  longestSec: number;
}

export interface Recap {
  version: typeof RECAP_VERSION;
  generatedAt: string;
  timeZone: string;
  /** The true span: first to last local day with a session, `days` counted inclusively and never capped. */
  range: { from: string; to: string; days: number };
  totals: {
    sessions: number;
    /** The person's prompts (`prompts` kept per session), templates included. */
    prompts: number;
    activeDays: number;
    /** Wall-clock hours with at least one session active. */
    wallHours: number;
    /** Summed session hours: parallel sessions add up. */
    agentHours: number;
    harnesses: Array<{ key: Harness; sessions: number }>;
    commits: number;
    /** Share of sessions with at least one commit, 0..1. */
    commitShare: number;
    compactions: number;
    toolCalls: number;
    toolsPerPrompt: number;
    /** Some session kept only part of its tool calls, so `toolCalls` is a lower bound. */
    toolCallsCapped: boolean;
  };
  /** Absent when no prompt has a usable time. */
  rhythm?: RecapRhythm;
  /** Per local day, oldest first, the newest `MAX_RECAP_DAYS` at most. */
  daily: Array<{ day: string; sessions: number; prompts: number; minutes: number }>;
  /** True when `daily` lost older days to the cap; `range` still covers them. */
  dailyTruncated: boolean;
  /** Longest run of consecutive active days; `start` and `end` are null when there was none. */
  streak: { days: number; start: string | null; end: string | null };
  bigDay?: { day: string; prompts: number; weekday: RecapWeekday };
  voice: RecapVoice;
  /** Prompts sent while the agent was working: interruptions and Codex steering. */
  interrupted: number;
  slash: RecapCount[];
  slashTotal: number;
  /** MCP servers by sessions using them, public names only; anything else is "a custom one". */
  connectors: RecapCount[];
  /** Skills by invocations, public names only; anything else is "a custom one". */
  skills: RecapCount[];
  shell: RecapShell;
  parallel: { max: number; overlapEvents: number; subagents: number; lanes?: RecapLanes };
  longestSession?: RecapLongestSession;
  /** The top project's share of agent time, 0..1, never its name. Absent without projects. */
  topProjectShare?: number;
  failures: RecapFailures;
  models: RecapModel[];
  usage: RecapUsage;
  /** Fully or mostly achieved share of judged sessions; absent without facets. */
  winRate?: number;
  facetSessions: number;
  /** Absent when no prompt has a usable time. */
  persona?: RecapPersona;
  tips: RecapTip[];
  thinking?: RecapThinking;
  approvals?: RecapApprovals;
  replies?: RecapReplies;
  /** How much history AI Insights keeps. Absent without `Report.retention`. */
  history?: RecapHistory;
}

/** Share-safe: a day and counts only. */
export interface RecapHistory {
  /** Local calendar days from `firstDay` through the report day, both included, so it agrees with `range.days`. */
  days: number;
  /** Local day of the oldest session AI Insights still has. */
  firstDay: string;
  /** Sessions whose transcript the harness deleted and that only AI Insights' cache still holds. */
  cachedOnly: number;
}

// ---------------------------------------------------------------------------
// Run snapshots: a few KB saved per report run, so later reports can show change over time. Never prompt text.
// ---------------------------------------------------------------------------

export const SNAPSHOT_VERSION = 1 as const;

export interface RunMetrics {
  sessions: number;
  prompts: number;
  activeDays: number;
  wallHours: number;
  agentHours: number;
  toolCalls: number;
  toolErrors: number;
  failureRate: number;
  tests: number;
  testPass: number | null;
  tokens: number;
  usd: number | null;
  cacheHitRate: number | null;
  maxParallel: number;
  compactions: number;
  compactionsPerSession: number;
  commits: number;
  /** Median reply time with gaps over 12 h dropped, as in the recap. */
  medianResponseSec: number | null;
  winRate: number | null;
  interrupted: number;
  streak: number;
}

export interface RunFinding {
  /** `Finding.id`, except `repeated_instruction`, whose id is built from prompt words and is hashed here. */
  id: string;
  kind: FindingKind;
  severity: Severity;
  /** `Finding.title`, except `repeated_instruction`, whose title quotes a prompt and is replaced by a fixed one. */
  title: string;
  metric: { value: number; unit: string; label: string } | null;
  hasSuggestion: boolean;
}

export interface RunSnapshot {
  snapshotVersion: typeof SNAPSHOT_VERSION;
  /** `generatedAt` as a file-name-safe stamp; also the file name. */
  id: string;
  generatedAt: string;
  timeZone: string;
  versions: { report: number; recap: number; pricing: string };
  window: { from: string | null; to: string | null; days: number };
  metrics: RunMetrics;
  findings: RunFinding[];
  /** Finding ids whose suggestion the report showed. */
  suggestionsShown: string[];
  narrative: boolean;
  /** The newest days of the window, at most 30. */
  daily?: Array<{ day: string; sessions: number; prompts: number; minutes: number }>;
}

export interface MetricDelta {
  key: keyof RunMetrics;
  previous: number | null;
  current: number | null;
  /** current - previous; null when either side is missing. */
  delta: number | null;
}

export interface RunComparison {
  previousId: string;
  currentId: string;
  deltas: MetricDelta[];
  /** Flagged before, not detected now. Not proof of a fix. */
  resolved: RunFinding[];
  stillOpen: RunFinding[];
  new: RunFinding[];
}

/** What a renderer receives besides the report. Every field is optional, so a renderer can ignore it. */
export interface RenderExtras {
  /** Saved snapshots, oldest first, the current run last. */
  runs?: RunSnapshot[];
  /** The current run against the one before it; absent on a first run. */
  comparison?: RunComparison;
  /**
   * This installation's random device id (src/store/device.ts). The share link carries it so the site keeps one
   * entry per machine; absent when the store could not make one, and the link then publishes as before.
   */
  deviceId?: string;
}

export interface BuildReportInput {
  sessions: Session[];
  facets?: SessionFacet[];
  narrative?: Narrative | null;
  coverage: Coverage[];
  timeZone?: string;
  now?: Date;
  /** Measured by the scan; passed through to `Report.retention`. */
  retention?: Retention;
  /** Told as each part of the analysis starts, for a progress display. Never changes the report; a throw is ignored. */
  onStep?: (step: AnalysisStep) => void;
}

export type AnalysisStep = "usage" | "activity" | "findings" | "recap";
