import type { Coverage, Finding, HarnessRetention, RecapLanes, RenderExtras, Report, Retention, RunSnapshot, SuggestionStep, UsageSummary } from "../schema/types.js";
import { bytesFor, clip, count, formatBytes, formatDate, formatDateTime, formatInt, formatUsd, num, plural, shortenPath } from "./format.js";
import { harnessLabel, keyLabel, severityRank, suggestionLabel } from "./labels.js";
import { safeLink, shortUrl } from "./links.js";
import { historyDaysOf, NOT_A_PROBLEM, pricingGap, problemFindings, rankActions, type RankedAction, unpricedModelsText, wallClockMinutes } from "./story.js";
import { busiestDays, MAX_LANES, openVersusWorking, timelineSummary, type Timeline } from "./timeline.js";

/**
 * The one adapter between the product's data and the page. Everything the client code reads comes from
 * `PageView`, serialised into the report as JSON. When the data contract moves, fix it here.
 *
 * Two kinds of data leave this module:
 *  - `recap`: share-safe aggregates, the only input the cards, captions and exports may use. Built by
 *    allowlisting fields of `Report.recap`, so a field the data layer adds later never reaches a card
 *    until it is copied here on purpose.
 *  - everything else: the private analysis, shown on the page only (project names, finding evidence).
 */

export const MATRIX_URL = "https://matrix-os.com";
export const MAX_FINDINGS = 40;
const MAX_EVIDENCE = 5;
const MAX_TEXT = 1200;
const MAX_TITLE = 200;
const MAX_COPY = 6000;
const MAX_DAYS = 400;

// ---------------------------------------------------------------------------
// Input: Report plus the recap and run snapshots the data layer adds
// ---------------------------------------------------------------------------

/** One saved run (`RunSnapshot`), read defensively: snapshots on disk can come from older versions. */
export type RunSnapshotInput = Partial<RunSnapshot>;

/** `renderReport` input: the Report, whose optional `recap` is the share-safe recap (`Recap`). */
export type RenderInput = Report;

// ---------------------------------------------------------------------------
// Output: the page's view model
// ---------------------------------------------------------------------------

export interface KeyCount {
  key: string;
  count: number;
}

export interface RecapView {
  generatedAt: string;
  timeZone: string;
  range: { from: string; to: string; days: number };
  totals: {
    sessions: number;
    prompts: number;
    activeDays: number;
    wallHours: number;
    agentHours: number;
    harnesses: Array<{ key: string; sessions: number }>;
    commits: number;
    commitShare: number;
    compactions: number;
    toolCalls: number;
    toolsPerPrompt: number;
    toolCallsCapped: boolean;
  };
  rhythm: {
    hours: number[];
    peakHour: number;
    nightShare: number;
    earlyShare: number;
    verdict: { key: string; label: string };
    quiet: { len: number; start: number };
    latestNight: number | null;
    harnessPeaks: Array<{ key: string; peak: number; prompts: number; hours: number[] }>;
    weekdays: KeyCount[];
  };
  daily: Array<{ day: string; sessions: number; prompts: number; minutes: number }>;
  streak: { days: number; start: string | null; end: string | null };
  bigDay: { day: string; prompts: number; weekday: string } | null;
  voice: {
    prompts: number;
    excludedAgentSessions: number;
    /** Prompts left out of the voice stats because a script filled them (an XML-style wrapper). */
    excludedWrapped: number;
    words: KeyCount[];
    openers: KeyCount[];
    polite: { please: number; thanks: number; sorry: number };
    questionShare: number;
    wordsTyped: number;
    oneWord: number;
    leverage: { words: number; toolCalls: number } | null;
  };
  interrupted: number;
  slash: KeyCount[];
  slashTotal: number;
  shell: { calls: number; programs: KeyCount[]; tests: number; testPass: number | null; rmrf: number; forcePush: number; sleeps: number };
  /** False when no prompt had a timestamp: the rhythm numbers are zeros, and cards built on them are off. */
  hasRhythm: boolean;
  /**
   * `lanes`: the sessions open around the busiest moment, share-safe (harness names, no ids or clock times).
   * Null when the recap has none or they do not add up to `max`: cards then draw a plain schematic, never data.
   */
  parallel: { max: number; overlapEvents: number; subagents: number; lanes: LanesView | null };
  /** `skippedAutomated`: longer sessions a script or another agent drove, left out (0 when none). */
  longestSession: { activeMinutes: number; wallMinutes: number; prompts: number; toolCalls: number; toolCallsCapped: boolean; harness: string; compactions: number; skippedAutomated: number } | null;
  topProjectShare: number | null;
  failures: { total: number; calls: number; rate: number; categories: Array<{ key: string; label: string; count: number }>; nemesis: Array<{ key: string; count: number; runs: number }> };
  models: Array<{ key: string; harness: string; requests: number; share: number }>;
  usage: {
    tokens: number;
    output: number;
    requests: number;
    usd: number | null;
    unpriced: number;
    cacheHitRate: number | null;
    novels: number;
    usdPerCommit: number | null;
    /** False: no cost claim anywhere on a card. */
    priced: boolean;
    /** Harnesses whose usage the cost covers; a card names them when some sources have no token counts. */
    pricedHarnesses: string[];
  };
  winRate: number | null;
  facetSessions: number;
  /** How much history AI Insights still has: share-safe (counts and a day). Null without retention data. */
  history: { days: number; firstDay: string | null; cachedOnly: number } | null;
  /** Thinking blocks the harnesses recorded; durations null when no session recorded them. */
  thinking: { blocks: number; sessions: number; totalMs: number | null; longestMs: number | null } | null;
  /** Who let actions through. A counter is null when no harness here records it: never read it as zero. */
  approvals: { auto: number | null; byPerson: number | null; denied: number | null; autoBlocked: number | null; guardianReviews: number | null; sessions: number } | null;
  /** The person's reply time to finished turns. */
  replies: { count: number; medianSec: number; fastShare: number; longestSec: number } | null;
  /** MCP servers by sessions and skills by invocations, public names only. */
  connectors: KeyCount[];
  skills: KeyCount[];
  /** `earned`: titles from the work ratios, fixed wording and the rule that earned each. */
  persona: { title: string; time: string; role: string; reason: string; earned: Array<{ key: string; title: string; rule: string }> } | null;
  tips: Array<{ title: string; kind: string; metric: { value: number; unit: string; label: string } | null }>;
  /** false: the page does not build that card (its data is missing). */
  avail: Record<string, boolean>;
}

/** `RecapLanes` as shares (0..1) of the window, so a card scales them to any width. */
export interface LanesView {
  windowMinutes: number;
  /** The peak instant as a share of the window. */
  peak: number;
  /** Lanes open at the peak: equals `parallel.max`. */
  atPeak: number;
  rows: Array<{ harness: string; start: number; end: number; active: Array<[number, number]>; atPeak: boolean }>;
}

export interface FindingView {
  id: string;
  anchor: string;
  kind: string;
  severity: string;
  title: string;
  detail: string;
  harnesses: string[];
  metric: { value: string; label: string } | null;
  metricValue: number | null;
  evidence: Array<{ when: string | null; harness: string; note: string; session: string }>;
  moreEvidence: number;
  /** Anchor of the ranked action that fixes it, when there is one. */
  action: string | null;
}

export interface ActionView {
  anchor: string;
  type: string;
  typeLabel: string;
  title: string;
  why: string;
  metric: { value: string; label: string } | null;
  action: string;
  instructionText: string | null;
  snippet: { text: string; file: string | null } | null;
  url: string | null;
  urlLabel: string | null;
  agreed: boolean;
  also: string[];
  finding: string | null;
  findingId: string | null;
  /** Separate actions a suggestion offers (`suggestion.steps`), each with its own text to copy. */
  steps: StepView[];
}

export interface StepView {
  title: string;
  body: string;
  copy: string | null;
  copyLabel: string | null;
  undo: string | null;
  url: string | null;
  urlLabel: string | null;
}

export interface RunView {
  /** The snapshot id (a file-safe timestamp), unique per run. */
  id: string;
  /** Local day of the run, for display. */
  day: string;
  generatedAt: string;
  days: number | null;
  metrics: Record<string, number | null>;
  findings: Array<{ id: string; kind: string; title: string; severity: string; value: number | null; unit: string }>;
}

export interface PageView {
  v: 1;
  generatedAt: string;
  generatedLabel: string | null;
  timeZone: string;
  recap: RecapView | null;
  /** Why parts are missing, in plain words; null when nothing is. */
  notes: { recap: string | null; review: string | null; runs: string };
  review: { facets: number; narrative: boolean; prompt: string };
  hero: {
    wallHours: number | null;
    agentHours: number;
    sessions: number;
    prompts: number;
    usd: number | null;
    maxParallel: number;
    activeDays: number;
    rangeDays: number | null;
    from: string | null;
    to: string | null;
    lede: string;
    harnesses: string[];
  };
  coverage: Array<{ harness: string; label: string; found: boolean; sessions: number; days: number | null; since: string | null; disk: string | null; skipped: number; skippedUsage: number; note: string | null; tokens: boolean }>;
  activity: {
    sessions: number;
    activeDays: number;
    streak: number;
    hours: number[];
    harnessHours: Array<{ key: string; hours: number[] }>;
    weekdays: KeyCount[];
    daily: Array<{ day: string; sessions: number; prompts: number; minutes: number; usd: number | null }>;
    responseBuckets: KeyCount[];
    medianResponseSec: number | null;
    toolCategories: KeyCount[];
    toolCalls: number;
    toolsPerPrompt: number | null;
    subagentSessions: number;
    planModeSessions: number;
    compactions: number;
    agentDriven: number;
    linesAdded: number;
    linesRemoved: number;
    commits: number;
    projects: Array<{ label: string; title: string; note: string | null; sessions: number; minutes: number }>;
    languages: KeyCount[];
    maxParallel: number;
    overlapEvents: number;
    /** Chat-export sessions, shown on their own: no tokens, no shell, files, commits or parallel agents. */
    chat: { sessions: number; only: boolean; prompts: number; replies: number; toolCalls: number; toolErrors: number; attachments: number; files: number; voiceNotes: number; branches: number } | null;
  };
  timeline: { days: Array<TimelineDayView>; busiest: number; total: number; sessions: number } | null;
  usage: {
    tokens: number;
    input: number;
    cachedInput: number;
    cacheWrite: number;
    output: number;
    requests: number;
    usd: number | null;
    usdText: string;
    unpriced: number;
    cacheHitRate: number | null;
    pricingVersion: string;
    gap: string | null;
    /** Codex spend with no recorded speed tier, priced at Standard; null when there is none. */
    untiered: string | null;
    perCommit: number | null;
    /** What the tools themselves logged (OpenCode, Pi), beside the list-price estimate; null when none did. */
    recorded: { usd: number; requests: number; zeroRequests: number; text: string; harnesses: Array<{ label: string; usd: number; requests: number; zeroRequests: number; text: string }> } | null;
    noTokens: string[];
    daily: Array<{ day: string; usd: number | null; tokens: number }>;
    models: Array<{ model: string; harness: string; requests: number; tokens: number; output: number; usd: number | null; unpriced: number }>;
  };
  failures: { total: number; calls: number; categories: KeyCount[] };
  findings: FindingView[];
  otherFindings: number;
  actions: { top: ActionView[]; rest: ActionView[] };
  narrative: {
    headline: string;
    interactionStyle: string;
    workAreas: Array<{ name: string; sessions: number; description: string }>;
    wins: Array<{ title: string; description: string }>;
    frictions: Array<{ title: string; description: string; examples: string[] }>;
    horizon: Array<{ title: string; description: string; starterPrompt: string | null }>;
  } | null;
  facets: { sessions: number; outcomes: KeyCount[]; frictions: KeyCount[]; successes: KeyCount[]; goals: KeyCount[] } | null;
  closing: {
    show: boolean;
    disk: { metric: { value: string; label: string } | null; title: string; action: string; url: string | null; urlLabel: string | null } | null;
    matrix: { metric: { value: string; label: string } | null; since: string | null; url: string };
  };
  runs: RunView[];
  retention: RetentionView | null;
  /** Sessions grouped by the kind of trouble they showed; null with too few sessions or in older reports. */
  causes: CausesView | null;
  /** The work ratios in their fixed order; null in older reports. */
  ratios: RatioView[] | null;
  /** The random device id the share link carries (RenderExtras.deviceId); null without one. */
  deviceId: string | null;
}

export interface CausesView {
  sessions: number;
  judged: number;
  usedReview: boolean;
  minJudged: number;
  withAny: number;
  causes: Array<{
    key: string;
    label: string;
    sessions: number;
    of: number;
    share: number;
    basis: string;
    signs: Array<{ label: string; sessions: number }>;
    evidence: Array<{ when: string | null; harness: string; note: string; session: string }>;
    suggestion: { title: string; action: string };
    /** Anchors of the finding behind the suggestion and of its ranked action, when they are on the page. */
    finding: string | null;
    action: string | null;
  }>;
}

export interface RatioView {
  key: string;
  label: string;
  definition: string;
  value: number | null;
  /** The value as it should read: "0.42", "18%", "1.7×", or "n/a". */
  text: string;
  numerator: number;
  denominator: number;
  counts: { numerator: string; denominator: string };
  unit: string;
}

export interface RetentionView {
  /** Transcripts can be deleted within the window for at least one tool: the block leads "What to change". */
  urgent: boolean;
  /** Which situation the wording describes, most pressing first. */
  level: "urgent" | "managed" | "default" | "settings" | "short" | "kept";
  title: string;
  sentence: string;
  /** One row per tool: what it keeps, from where, and what can go. */
  rows: RetentionRow[];
  /** What AI Insights' cache keeps once a transcript is gone, and what it does not. */
  cache: { keeps: string[]; drops: string[] } | null;
  steps: StepView[];
  /** The history-on-disk number, shown in the block when it replaces the closing cards. */
  disk: { value: string; label: string } | null;
  /** One line for "Over time" when retention limits how far back runs and days go; null when it does not. */
  limit: string | null;
}

export interface RetentionRow {
  harness: string;
  label: string;
  policy: HarnessRetention["policy"];
  /** "deletes after 30 days", "keeps until you delete them", "not documented". */
  keeps: string;
  /** Where the number comes from: "default", "your settings", "managed by your organization". */
  source: string | null;
  /** The setting, its file and the value found. */
  setting: string | null;
  transcripts: number;
  disk: string | null;
  oldest: string | null;
  atRisk: string | null;
  exempt: string | null;
  cacheOnly: number;
  basis: string;
  url: string | null;
  urlLabel: string | null;
}

export interface TimelineDayView {
  label: string;
  kind: "all" | "busiest";
  start: number;
  end: number;
  lanes: number;
  hidden: number;
  inWindow: number;
  peak: { count: number; x: number; label: string };
  harnesses: string[];
  agentDriven: number;
  ticks: Array<{ x: number; label: string; major: boolean }>;
  bars: Array<{ lane: number; x: number; w: number; harness: string; project: string; agent: boolean; start: number; end: number; active: Array<[number, number]> }>;
  summary: string;
  idle: string | null;
}

// ---------------------------------------------------------------------------
// Small readers: the recap arrives untyped, so every field is checked
// ---------------------------------------------------------------------------

type Loose = Record<string, unknown>;
const obj = (value: unknown): Loose => (value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : {});
const arr = (value: unknown, max = 50): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
const str = (value: unknown, max = 80): string => (typeof value === "string" ? clip(value, max) : "");
const ratio = (value: unknown): number => Math.min(1, Math.max(0, num(value)));
const maybe = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const day = (value: unknown): string | null => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

function keyCounts(value: unknown, max = 10, keyMax = 40): KeyCount[] {
  return arr(value, max)
    .map((entry) => obj(entry))
    .map((entry) => ({ key: str(entry.key, keyMax), count: count(entry.count) }))
    .filter((entry) => entry.key !== "");
}

function hours24(value: unknown): number[] {
  const list = arr(value, 24).map(count);
  while (list.length < 24) list.push(0);
  return list;
}

/** Kinds shown in "Keep your history" or the closing cards, never as a tip or a ranked action. */
const CLOSING_KINDS: ReadonlySet<string> = new Set(["history_retention", "history_disk_usage", "short_history"]);

const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Every card id, in the default order. Matches `CARD_IDS` in the client engine. */
/** Cards a style may leave out; they are never in the default selection. */
export const OPTIONAL_CARD_IDS = ["thinking", "approvals", "history", "titles"] as const;
export const CARD_IDS = ["intro", "hours", "clock", "weekday", "streak", "words", "manners", "slash", "shell", "tests", "danger", "parallel", "marathon", "failures", "nemesis", "model", "tokens", "persona", "tips", "summary", "outro"] as const;

/** Generic card wording per finding kind: a card never repeats a finding's own title, which can name a command. */
const TIP_TITLES: Record<string, string> = {
  repeated_failed_command: "Fix the command that keeps failing",
  repeated_instruction: "Write down what you keep repeating",
  slow_correction: "Step in sooner when it drifts",
  frequent_interruptions: "Agree on the plan before long runs",
  context_resets: "Hand off instead of compacting",
  long_sessions: "Split marathon sessions",
  cache_miss_cost: "Keep the cache warm",
  expensive_model_for_simple_work: "Use a lighter model for quick jobs",
  no_tests_before_done: "Run the tests before calling it done",
  permission_prompt_load: "Pre-approve the safe commands",
  tool_error_hotspot: "Fix the tool that fails most",
  unused_feature: "Try a feature that fits your work",
  single_harness_only: "Try a second coding agent",
  history_retention: "Keep your history",
  short_history: "Keep your history longer",
  history_disk_usage: "Compress your history",
};

/**
 * The share-safe recap, or null when the report has none (a report saved before recaps existed, or a
 * history with no prompts). Only fields listed here reach the cards.
 */
export function recapView(input: RenderInput): RecapView | null {
  const raw = obj(input.recap);
  const range = obj(raw.range);
  const totals = obj(raw.totals);
  const from = day(range.from);
  const to = day(range.to);
  if (!from || !to || count(totals.sessions) === 0) return null;
  const hasRhythm = !!raw.rhythm && typeof raw.rhythm === "object";
  const rhythm = obj(raw.rhythm);
  const voice = obj(raw.voice);
  const shell = obj(raw.shell);
  const usage = obj(raw.usage);
  const failures = obj(raw.failures);
  const parallel = obj(raw.parallel);
  const longest = raw.longestSession ? obj(raw.longestSession) : null;
  const persona = raw.persona ? obj(raw.persona) : null;
  const weekdays = keyCounts(rhythm.weekdays, 7, 3);
  const verdict = obj(rhythm.verdict);
  const quiet = obj(rhythm.quiet);
  const polite = obj(voice.polite);
  const leverage = voice.leverage ? obj(voice.leverage) : null;
  const streak = obj(raw.streak);
  const bigDay = raw.bigDay ? obj(raw.bigDay) : null;
  const usd = maybe(usage.usd);
  const tokens = count(usage.tokens);
  const models = arr(raw.models, 6).map((entry) => obj(entry)).map((m) => ({ key: str(m.key, 40), harness: str(m.harness, 20), requests: count(m.requests), share: ratio(m.share) })).filter((m) => m.key);
  const reportModels = input.usage?.models ?? [];
  const pricedHarnesses = [...new Set(reportModels.filter((m) => typeof m.estimatedUsd === "number" && m.estimatedUsd > 0).map((m) => String(m.harness)))];

  const view: RecapView = {
    generatedAt: str(raw.generatedAt, 40) || input.generatedAt,
    timeZone: str(raw.timeZone, 64) || input.timeZone,
    range: { from, to, days: Math.max(1, Math.round(count(range.days)) || 1) },
    totals: {
      sessions: count(totals.sessions),
      prompts: count(totals.prompts),
      activeDays: count(totals.activeDays),
      wallHours: count(totals.wallHours),
      agentHours: count(totals.agentHours),
      harnesses: arr(totals.harnesses, 6).map((entry) => obj(entry)).map((h) => ({ key: str(h.key, 20), sessions: count(h.sessions ?? h.count) })).filter((h) => h.key),
      commits: count(totals.commits),
      commitShare: ratio(totals.commitShare),
      compactions: count(totals.compactions),
      toolCalls: count(totals.toolCalls),
      toolsPerPrompt: count(totals.toolsPerPrompt),
      toolCallsCapped: totals.toolCallsCapped === true,
    },
    rhythm: {
      hours: hours24(rhythm.hours),
      peakHour: Math.min(23, Math.round(count(rhythm.peakHour))),
      nightShare: ratio(rhythm.nightShare),
      earlyShare: ratio(rhythm.earlyShare),
      verdict: { key: str(verdict.key, 30), label: str(verdict.label, 30) || "Steady" },
      quiet: { len: Math.min(24, Math.round(count(quiet.len))), start: Math.min(23, Math.round(count(quiet.start))) },
      latestNight: maybe(rhythm.latestNight),
      harnessPeaks: arr(rhythm.harnessPeaks, 6).map((entry) => obj(entry)).map((p) => ({ key: str(p.key, 20), peak: Math.min(23, Math.round(count(p.peak))), prompts: count(p.prompts), hours: hours24(p.hours) })).filter((p) => p.key),
      weekdays: WEEKDAY_KEYS.map((key) => ({ key, count: weekdays.find((w) => w.key === key)?.count ?? 0 })),
    },
    daily: arr(raw.daily, MAX_DAYS).map((entry) => obj(entry)).map((d) => ({ day: day(d.day) ?? "", sessions: count(d.sessions), prompts: count(d.prompts), minutes: count(d.minutes) })).filter((d) => d.day),
    streak: { days: count(streak.days), start: day(streak.start), end: day(streak.end) },
    bigDay: bigDay && day(bigDay.day) ? { day: day(bigDay.day)!, prompts: count(bigDay.prompts), weekday: WEEKDAY_KEYS.includes(String(bigDay.weekday)) ? String(bigDay.weekday) : "Mon" } : null,
    voice: {
      prompts: count(voice.prompts),
      excludedAgentSessions: count(voice.excludedAgentSessions),
      excludedWrapped: count(voice.excludedWrapped),
      words: keyCounts(voice.words, 5, 24),
      openers: keyCounts(voice.openers, 3, 24),
      polite: { please: count(polite.please), thanks: count(polite.thanks), sorry: count(polite.sorry) },
      questionShare: ratio(voice.questionShare),
      wordsTyped: count(voice.wordsTyped),
      oneWord: count(voice.oneWord),
      leverage: leverage && count(leverage.toolCalls) > 0 ? { words: Math.max(1, count(leverage.words)), toolCalls: count(leverage.toolCalls) } : null,
    },
    interrupted: count(raw.interrupted),
    slash: keyCounts(raw.slash, 5, 32),
    slashTotal: count(raw.slashTotal),
    shell: { calls: count(shell.calls), programs: keyCounts(shell.programs, 5, 24), tests: count(shell.tests), testPass: maybe(shell.testPass), rmrf: count(shell.rmrf), forcePush: count(shell.forcePush), sleeps: count(shell.sleeps) },
    hasRhythm,
    parallel: { max: count(parallel.max), overlapEvents: count(parallel.overlapEvents), subagents: count(parallel.subagents), lanes: lanesOf(parallel.lanes, count(parallel.max)) },
    longestSession: longest && count(longest.activeMinutes) > 0
      ? { activeMinutes: count(longest.activeMinutes), wallMinutes: count(longest.wallMinutes), prompts: count(longest.prompts), toolCalls: count(longest.toolCalls), toolCallsCapped: longest.toolCallsCapped === true, harness: str(longest.harness, 20), compactions: count(longest.compactions), skippedAutomated: count(longest.skippedAutomated) }
      : null,
    topProjectShare: maybe(raw.topProjectShare),
    failures: {
      total: count(failures.total),
      calls: count(failures.calls),
      rate: ratio(failures.rate),
      categories: arr(failures.categories, 9).map((entry) => obj(entry)).map((c) => ({ key: str(c.key, 30), label: str(c.label, 40) || keyLabel(str(c.key, 30)), count: count(c.count) })).filter((c) => c.key),
      nemesis: arr(failures.nemesis, 4).map((entry) => obj(entry)).map((n) => ({ key: str(n.key, 24), count: count(n.count), runs: Math.max(count(n.runs), count(n.count)) })).filter((n) => n.key),
    },
    models,
    usage: {
      tokens,
      output: count(usage.output),
      requests: count(usage.requests),
      usd: usd !== null && usd > 0 ? usd : null,
      unpriced: count(usage.unpriced),
      cacheHitRate: maybe(usage.cacheHitRate),
      novels: count(usage.novels),
      usdPerCommit: maybe(usage.usdPerCommit),
      priced: usd !== null && usd > 0 && tokens > 0,
      pricedHarnesses,
    },
    winRate: maybe(raw.winRate),
    facetSessions: count(raw.facetSessions),
    history: historyOf(raw.history),
    thinking: thinkingOf(raw.thinking),
    approvals: approvalsOf(raw.approvals),
    replies: repliesOf(raw.replies),
    connectors: keyCounts(raw.connectors, 5, 40),
    skills: keyCounts(raw.skills, 5, 40),
    persona: persona && str(persona.title, 60) ? { title: str(persona.title, 60), time: str(persona.time, 30), role: str(persona.role, 30), reason: str(persona.reason, 160), earned: earnedOf(persona.earned) } : null,
    tips: [],
    avail: {},
  };
  view.tips = tipsFor(raw.tips, input.findings ?? []);
  view.avail = availability(view);
  return view;
}

const MAX_LANE_ROWS = 40;
const MAX_LANE_STRETCHES = 20;

/**
 * `RecapLanes` (relative minutes) as shares of the window. Kept only when it is self-consistent: the lanes open
 * at the peak must number `atPeak`, and `atPeak` must equal the card's headline count, or the picture would
 * contradict the number beside it.
 */
export function lanesOf(raw: RecapLanes | undefined | unknown, max: number): LanesView | null {
  const lanes = obj(raw);
  const span = num(lanes.windowMinutes);
  const peakAt = maybe(lanes.peakAt);
  const atPeak = count(lanes.atPeak);
  if (!(span > 0) || peakAt === null || atPeak < 2 || atPeak !== max) return null;
  const share = (minutes: unknown) => ratio(num(minutes) / span);
  const rows = arr(lanes.lanes, MAX_LANE_ROWS).map((entry) => obj(entry)).map((lane) => {
    const stretches = arr(lane.active, MAX_LANE_STRETCHES).filter(Array.isArray).map((pair) => [num((pair as unknown[])[0]), num((pair as unknown[])[1])] as [number, number]).filter(([a, b]) => b > a);
    return {
      harness: str(lane.harness, 20),
      start: share(lane.start),
      end: share(lane.end),
      active: stretches.map(([a, b]) => [share(a), share(b)] as [number, number]),
      atPeak: stretches.some(([a, b]) => a <= peakAt && peakAt < b),
    };
  }).filter((lane) => lane.end > lane.start);
  if (rows.filter((lane) => lane.atPeak).length !== atPeak) return null;
  return { windowMinutes: span, peak: ratio(peakAt / span), atPeak, rows };
}

function earnedOf(raw: unknown): Array<{ key: string; title: string; rule: string }> {
  return arr(raw, 3)
    .map((entry) => obj(entry))
    .map((entry) => ({ key: str(entry.key, 40), title: str(entry.title, 40), rule: str(entry.rule, 160) }))
    .filter((entry) => entry.title && entry.rule);
}

function historyOf(raw: unknown): RecapView["history"] {
  const history = obj(raw);
  const days = Math.round(count(history.days));
  return days > 0 ? { days, firstDay: day(history.firstDay), cachedOnly: count(history.cachedOnly) } : null;
}

function thinkingOf(raw: unknown): RecapView["thinking"] {
  const thinking = obj(raw);
  const blocks = count(thinking.blocks);
  if (blocks === 0) return null;
  const total = maybe(thinking.totalMs), longest = maybe(thinking.longestMs);
  return { blocks, sessions: count(thinking.sessions), totalMs: total !== null && total > 0 ? total : null, longestMs: longest !== null && longest > 0 ? longest : null };
}

function approvalsOf(raw: unknown): RecapView["approvals"] {
  if (!raw || typeof raw !== "object") return null;
  const approvals = obj(raw);
  const counter = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
  const view = { auto: counter(approvals.auto), byPerson: counter(approvals.byPerson), denied: counter(approvals.denied), autoBlocked: counter(approvals.autoBlocked), guardianReviews: counter(approvals.guardianReviews), sessions: count(approvals.sessions) };
  return [view.auto, view.byPerson, view.denied, view.autoBlocked, view.guardianReviews].some((value) => value !== null) ? view : null;
}

function repliesOf(raw: unknown): RecapView["replies"] {
  const replies = obj(raw);
  const replyCount = count(replies.count);
  return replyCount > 0 ? { count: replyCount, medianSec: count(replies.medianSec), fastShare: ratio(replies.fastShare), longestSec: count(replies.longestSec) } : null;
}

/** The recap's own tips, else up to three from the findings, worded per kind so no command text reaches a card. */
function tipsFor(raw: unknown, findings: Finding[]): RecapView["tips"] {
  const metricOf = (m: unknown) => {
    const metric = obj(m);
    return typeof metric.value === "number" && Number.isFinite(metric.value) ? { value: metric.value, unit: str(metric.unit, 30), label: str(metric.label, 60) } : null;
  };
  const own = arr(raw, 3).map((entry) => obj(entry)).map((t) => ({ title: str(t.title, 60) || TIP_TITLES[str(t.kind, 40)] || "", kind: str(t.kind, 40), metric: metricOf(t.metric) })).filter((t) => t.title);
  if (own.length > 0) return own;
  return [...findings]
    .filter((f) => f.suggestion && TIP_TITLES[f.kind] && !CLOSING_KINDS.has(f.kind))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .filter((f, i, all) => all.findIndex((g) => g.kind === f.kind) === i)
    .slice(0, 3)
    .map((f) => ({ title: TIP_TITLES[f.kind]!, kind: f.kind, metric: metricOf(f.metric) }));
}

/** Which cards have the data they need. A card without it is not offered, rather than drawn with zeros. */
export function availability(d: RecapView): Record<string, boolean> {
  const promptsOk = d.totals.prompts >= 10;
  return {
    intro: true,
    hours: d.totals.wallHours > 0,
    clock: promptsOk && d.hasRhythm,
    weekday: promptsOk && d.hasRhythm,
    streak: d.streak.days >= 1 && d.streak.start !== null,
    words: d.voice.words.length > 0,
    manners: d.voice.prompts >= 10,
    slash: d.slash.length > 0,
    shell: d.shell.calls > 0 && d.shell.programs.length > 0,
    tests: d.shell.tests > 0 && d.shell.testPass !== null,
    danger: d.shell.rmrf + d.shell.forcePush > 0,
    parallel: d.parallel.max >= 2,
    marathon: d.longestSession !== null,
    failures: d.failures.total > 0 && d.failures.categories.length > 0,
    nemesis: d.failures.nemesis.length > 0,
    model: d.models.length > 0,
    tokens: d.usage.tokens > 0,
    persona: d.persona !== null && d.hasRhythm,
    tips: d.tips.length > 0,
    summary: d.voice.words.length > 0 && d.shell.programs.length > 0 && d.models.length > 0 && d.persona !== null && d.hasRhythm,
    outro: true,
    // Optional cards, never in the default selection.
    thinking: d.thinking !== null && d.thinking.blocks >= 10,
    // The card compares who let actions through: it needs the automatic and the person's counts both recorded.
    approvals: d.approvals !== null && d.approvals.auto !== null && d.approvals.byPerson !== null && d.approvals.auto + d.approvals.byPerson > 0,
    history: d.history !== null,
    titles: d.persona !== null && d.persona.earned.length > 0,
  };
}

// ---------------------------------------------------------------------------
// The private analysis
// ---------------------------------------------------------------------------

const TIME_UNITS: Record<string, string> = { minutes: "min", minute: "min", min: "min", hours: "h", hour: "h", h: "h", seconds: "s", second: "s", s: "s" };

/** A finding's number as it should read: bytes in decimal units, USD as money, rates keep their unit. */
export function metricOf(finding: Pick<Finding, "metric">): { value: string; label: string } | null {
  const metric = finding.metric;
  if (!metric || !Number.isFinite(metric.value)) return null;
  const unit = String(metric.unit ?? "");
  const rate = /^per\s/i.test(unit.trim()) && !String(metric.label ?? "").toLowerCase().includes(unit.trim().toLowerCase()) ? ` ${unit.trim()}` : "";
  const bytes = bytesFor(metric.value, unit);
  const plain = Number.isInteger(metric.value) ? formatInt(metric.value) : num(metric.value).toFixed(1);
  const time = TIME_UNITS[unit.trim().toLowerCase()];
  const value = bytes !== null ? formatBytes(bytes) : /^usd$/i.test(unit) ? formatUsd(metric.value) : time ? `${plain} ${time}` : plain;
  return { value, label: clip(`${String(metric.label || metric.unit || "")}${rate}`, 100) };
}

/**
 * A suggestion without `instructionText` may still carry a settings fragment inline, such as
 * `"permissions": {"allow": [...]}` to add to `.claude/settings.json`. Offer the first fragment
 * that parses as a JSON object as a copyable, formatted block, named after the file it mentions.
 */
export function settingsSnippet(action: string): { text: string; file: string | null } | null {
  const spans = [...String(action ?? "").matchAll(/`([^`\n]{2,600})`/g)].map((match) => match[1]!.trim());
  for (const span of spans) {
    for (const candidate of [span, `{${span}}`]) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
          const file = spans.find((other) => /^[\w.~/-]+\.(json|jsonc|toml|ya?ml)$/i.test(other)) ?? null;
          return { text: JSON.stringify(parsed, null, 2), file };
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  }
  return null;
}

/**
 * The harness a short-history finding counts. Its number is one harness's days, so the date
 * beside it must be that harness's own oldest session, never the oldest across all of them.
 */
export function shortHistoryCoverage(coverage: Coverage[], finding: Finding | null): Coverage | null {
  if (!finding) return null;
  const found = coverage.filter((entry) => entry.found && (finding.harnesses ?? []).includes(entry.harness));
  const days = finding.metric && /day/i.test(String(finding.metric.unit)) ? Math.round(finding.metric.value) : null;
  const byDays = days !== null ? found.filter((entry) => historyDaysOf(entry) === days) : [];
  if (byDays.length === 1) return byDays[0]!;
  if (found.length === 1) return found[0]!;
  const evidence = finding.evidence?.[0]?.harness;
  return found.find((entry) => entry.harness === evidence) ?? null;
}

const anchorOf = (prefix: string, id: string) => `${prefix}-${id.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "x"}`;

function folderName(path: string): string {
  return clip(path.split(/[\\/]/).filter(Boolean).pop() ?? path, 60);
}

/** Folder name for a project row, never the full path (it can hold a username); the shortened path goes in the tooltip. */
function projectLabel(path: string | null | undefined): { label: string; title: string } {
  if (!path) return { label: "No project", title: "No project" };
  const short = clip(shortenPath(String(path)), 120);
  return { label: folderName(short), title: short };
}

function actionView(action: RankedAction, index: number, findingAnchors: Map<Finding, string>): ActionView {
  const suggestion = action.suggestion;
  const instructions = action.instructionText ?? suggestion.instructionText ?? null;
  const link = safeLink(action.url ?? suggestion.url);
  const snippet = instructions ? null : (settingsSnippet(action.action) ?? settingsSnippet(suggestion.action));
  return {
    anchor: `action-${index + 1}`,
    type: String(suggestion.type),
    typeLabel: suggestionLabel(String(suggestion.type)),
    title: clip(suggestion.title, MAX_TITLE),
    why: clip(action.why, MAX_TITLE),
    metric: action.finding ? metricOf(action.finding) : null,
    action: clip(action.action, MAX_TEXT),
    instructionText: instructions ? clip(instructions, MAX_COPY) : null,
    snippet,
    url: link ? link.href : null,
    urlLabel: link ? shortUrl(link) : null,
    agreed: action.agreed === true,
    also: (action.alsoCovers ?? []).map((folded) => clip(folded.note, 240)),
    finding: action.finding ? (findingAnchors.get(action.finding) ?? null) : null,
    findingId: action.finding && typeof action.finding.id === "string" ? action.finding.id : null,
    steps: stepsOf(suggestion),
  };
}

/**
 * `suggestion.steps` (`SuggestionStep`): each step its own action, with the text to copy exactly as given. A
 * `command` is a line to run or paste; `instructionText` goes in CLAUDE.md or AGENTS.md.
 */
export function stepsOf(suggestion: { steps?: SuggestionStep[] } | null | undefined): StepView[] {
  return arr(suggestion?.steps, 6).map((entry) => obj(entry)).map((step) => {
    const link = safeLink(step.url);
    const command = str(step.command, MAX_COPY) || null;
    const instructions = str(step.instructionText, MAX_COPY) || null;
    const copyText = command ?? instructions;
    return {
      title: str(step.title, MAX_TITLE),
      body: str(step.action, MAX_TEXT),
      copy: copyText,
      copyLabel: !copyText ? null : command ? (/^\s*["{]/.test(command) ? "Line to paste" : "Command to run") : "Add to CLAUDE.md or AGENTS.md",
      undo: str(step.undo, 400) || null,
      url: link ? link.href : null,
      urlLabel: link ? shortUrl(link) : null,
    };
  }).filter((step) => step.title || step.body);
}

function localDay(iso: string, zone: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  return day(parts);
}

/**
 * A transcript past its age is only eligible: the harness deletes it at its next start, which may never come.
 * Saved retention titles say "will be deleted"; the page says "can be".
 */
export function findingTitle(kind: string, title: string): string {
  return kind === "history_retention" ? title.replace(/\bwill be deleted\b/g, "can be deleted") : title;
}

function runView(run: RunSnapshotInput, zone: string): RunView | null {
  const generated = str(run.generatedAt, 40);
  const shown = localDay(generated, zone);
  if (!shown) return null;
  const id = str(run.id, 60) || generated;
  const metrics: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(obj(run.metrics)).slice(0, 60)) if (/^[a-zA-Z]{1,40}$/.test(key)) metrics[key] = maybe(value);
  return {
    id,
    day: shown,
    generatedAt: generated,
    days: maybe(obj(run.window).days),
    metrics,
    findings: arr(run.findings, 80).map((entry) => obj(entry)).map((f) => ({ id: str(f.id, 200), kind: str(f.kind, 40), title: findingTitle(str(f.kind, 40), str(f.title, MAX_TITLE)), severity: str(f.severity, 10), value: maybe(obj(f.metric).value), unit: str(obj(f.metric).unit, 30) })).filter((f) => f.id),
  };
}

/** Today's numbers in the run-snapshot shape, for comparison when the data layer did not send the current run. */
function currentMetrics(report: Report, recap: RecapView | null): Record<string, number | null> {
  const a = report.activity;
  const calls = (a.toolCategories ?? []).reduce((sum, entry) => sum + count(entry.count), 0);
  const errors = (a.toolErrors ?? []).reduce((sum, entry) => sum + count(entry.count), 0);
  const wall = wallClockMinutes(report);
  return {
    sessions: count(a.sessions),
    prompts: recap ? recap.totals.prompts : count(a.userMessages),
    activeDays: count(a.activeDays),
    wallHours: wall !== null ? wall / 60 : null,
    agentHours: count(a.totalActiveMinutes) / 60,
    toolCalls: calls,
    toolErrors: errors,
    failureRate: calls > 0 ? errors / calls : null,
    testPass: recap ? recap.shell.testPass : null,
    tokens: count(report.usage.tokens),
    usd: maybe(report.usage.estimatedUsd),
    cacheHitRate: maybe(report.usage.cacheHitRate),
    maxParallel: count(a.parallelSessions?.maxConcurrent),
    compactions: count(a.features?.compactions),
    compactionsPerSession: count(a.sessions) > 0 ? count(a.features?.compactions) / count(a.sessions) : null,
    commits: count(a.gitCommits),
    medianResponseSec: maybe(a.medianResponseTimeSec),
    winRate: recap ? recap.winRate : null,
    streak: count(a.longestStreakDays),
  };
}

function timelineDay(timeline: Timeline, zone: string, working: number): TimelineDayView {
  return {
    label: timeline.window.label || "All sessions",
    kind: timeline.window.kind,
    start: timeline.window.start,
    end: timeline.window.end,
    lanes: timeline.lanes,
    hidden: timeline.hidden,
    inWindow: timeline.inWindow,
    peak: { count: timeline.peak.count, x: timeline.peak.x, label: timeline.peak.label },
    harnesses: timeline.harnesses,
    agentDriven: timeline.agentDriven,
    ticks: timeline.ticks.map((tick) => ({ x: tick.x, label: tick.label, major: tick.major })),
    bars: timeline.bars.map((bar) => ({
      lane: bar.lane, x: bar.x, w: bar.width, harness: bar.harness, project: projectLabel(bar.project).title, agent: bar.agentDriven, start: bar.start, end: bar.end,
      // Active stretches as shares of the window; empty when the report has none (older caches): the bar is then solid.
      active: bar.active.filter(([a, b]) => b > timeline.window.start && a < timeline.window.end).slice(0, 50).map(([a, b]) => {
        const len = timeline.window.end - timeline.window.start, from = Math.max(a, timeline.window.start), to = Math.min(b, timeline.window.end);
        return [(from - timeline.window.start) / len, Math.max(0.002, (to - from) / len)] as [number, number];
      }),
    })),
    summary: timelineSummary(timeline, zone, working),
    idle: openVersusWorking(timeline, working),
  };
}

/**
 * Tool calls and typed messages of the coding agents only: chat exports have their own tools and many prompts, so
 * counting them in would turn "tool calls for every message" into a number about neither.
 */
export function codingToolCalls(a: Report["activity"]): { calls: number; typed: number } {
  const calls = (a.toolCategories ?? []).reduce((sum, entry) => sum + count(entry.count), 0) - count(a.chat?.toolCalls);
  const typed = count(a.userMessages) - count(a.chat?.userMessages);
  return { calls: Math.max(0, calls), typed: Math.max(0, typed) };
}

/** Failed tool calls of the coding agents; a chat export's failed connector calls (all "other") are left out. */
function codingFailures(a: Report["activity"]): { total: number; calls: number; categories: KeyCount[] } {
  const chatErrors = count(a.chat?.toolErrors);
  const errors = (a.toolErrors ?? []).map((entry) => (entry.key === "other" ? { ...entry, count: Math.max(0, count(entry.count) - chatErrors) } : entry)).filter((entry) => count(entry.count) > 0);
  return {
    total: errors.reduce((sum, entry) => sum + count(entry.count), 0),
    calls: codingToolCalls(a).calls,
    categories: keyCounts(errors, 9, 30),
  };
}

function ledeFor(report: Report, recap: RecapView | null, names: string[]): string {
  const narrative = report.narrative?.headline;
  if (typeof narrative === "string" && narrative.trim()) return clip(narrative.trim(), 900);
  const a = report.activity;
  const sessions = count(a.sessions);
  if (sessions === 0) return "No coding-agent sessions were found in this window. Once your agents have some history, run the report again.";
  const where = names.length > 0 ? ` in ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`}` : "";
  const days = recap ? recap.range.days : null;
  const parts = [`${plural(sessions, "session")}${where}${days ? ` over ${plural(days, "day")}` : ""}, on ${plural(count(a.activeDays), "active day")}.`];
  const { calls, typed } = codingToolCalls(a);
  if (calls > 0 && typed > 0) parts.push(`Your agents made ${formatInt(calls)} tool calls, ${formatInt(calls / typed)} for every message you typed.`);
  const chats = count(a.chat?.sessions);
  if (chats > 0) parts.push(chats >= sessions ? "They come from a chat export, so tokens and cost are not measured." : `${formatInt(chats)} of them are chats from an export: tokens and cost are not measured for those.`);
  return parts.join(" ");
}

const SOURCE_LABELS: Record<string, string> = { default: "its default", settings: "your settings", managed: "managed by your organization" };

/** Days as a person reads them: Gemini CLI accepts hours, so 48h is "2 days" and 36h "1.5 days". */
function daysText(days: number): string {
  if (Number.isInteger(days)) return plural(days, "day");
  return `${(Math.round(days * 10) / 10).toFixed(1).replace(/\.0$/, "")} days`;
}

const ageClock = (entry: HarnessRetention) => (entry.clock === "last-updated" ? "their last update" : "they last changed");

/** "can be deleted from Nov 18, 2026": the harness deletes at its next start after that, so a past date is "the next time it starts". */
function eligibleText(iso: string | null, nowMs: number, zone: string, label: string): string {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms) || ms <= nowMs) return `can be deleted the next time ${label} starts`;
  return `can be deleted from ${formatDate(iso, zone)}`;
}

function retentionRow(entry: HarnessRetention, nowMs: number, zone: string): RetentionRow {
  const label = harnessLabel(String(entry.harness));
  const days = maybe(entry.days);
  const keeps = entry.policy === "deletes" && days !== null ? `deletes after ${daysText(days)}` : entry.policy === "kept" ? "keeps until you delete them" : "not documented";
  const setting = entry.setting && str(entry.setting.name, 80)
    ? `${str(entry.setting.name, 80)} in ${str(entry.setting.file, 200)}${entry.setting.value === null || entry.setting.value === undefined ? " (not set)" : `: ${clip(String(entry.setting.value), 40)}`}`
    : null;
  const risk = entry.atRisk && count(entry.atRisk.sessions) > 0 ? entry.atRisk : null;
  const link = safeLink(entry.url);
  return {
    harness: String(entry.harness),
    label,
    policy: entry.policy === "deletes" || entry.policy === "kept" ? entry.policy : "unknown",
    keeps,
    source: entry.source ? (SOURCE_LABELS[entry.source] ?? null) : null,
    setting,
    transcripts: count(entry.transcripts),
    disk: count(entry.bytes) > 0 ? formatBytes(count(entry.bytes)) : null,
    oldest: formatDate(entry.oldestOnDisk, zone),
    atRisk: risk ? `${plural(count(risk.sessions), "transcript")}${count(risk.bytes) > 0 ? ` (${formatBytes(count(risk.bytes))})` : ""} ${eligibleText(risk.nextDeletion, nowMs, zone, label)}` : null,
    exempt: entry.exempt && count(entry.exempt.sessions) > 0 ? `${plural(count(entry.exempt.sessions), "older session")} kept anyway: ${clip(entry.exempt.reason, 240)}.` : null,
    cacheOnly: count(entry.cachedOnly),
    basis: clip(entry.basis, 400),
    url: link ? link.href : null,
    urlLabel: link ? shortUrl(link) : null,
  };
}

/** One sentence per deleting tool: how long, measured from when, and who set it. */
function deletesSentence(entry: HarnessRetention): string {
  const label = harnessLabel(String(entry.harness));
  const days = daysText(num(entry.days));
  if (entry.source === "managed") return `Your organization's managed settings make ${label} delete transcripts ${days} after ${ageClock(entry)}`;
  if (entry.source === "settings") return `${label} deletes transcripts ${days} after ${ageClock(entry)}, as set in ${str(entry.setting?.file, 200) || "your settings"}`;
  return `${label} deletes transcripts ${days} after ${ageClock(entry)}, its default`;
}

const KEEP_NOTE = "AI Insights keeps the stats it already read; the full transcripts go unless you keep or archive them.";

/**
 * "Keep your history": how long each tool keeps transcripts and what can go soon, from `report.retention` and the
 * `history_retention` finding (its three steps). Null when the report carries neither (older reports, which show
 * the closing cards instead).
 */
export function retentionView(report: Report, zone: string): RetentionView | null {
  const retention: Retention | null = report.retention && Array.isArray(report.retention.harnesses) ? report.retention : null;
  const finding = (report.findings ?? []).find((f) => f.kind === "history_retention") ?? null;
  if (!retention && !finding) return null;
  const nowMs = Date.parse(report.generatedAt);
  const entries = (retention?.harnesses ?? []).slice(0, 8);
  const rows = entries.map((entry) => retentionRow(entry, nowMs, zone));
  const deleting = entries.filter((entry) => entry.policy === "deletes" && maybe(entry.days) !== null && count(entry.transcripts) > 0);
  const atRisk = deleting.filter((entry) => count(entry.atRisk?.sessions) > 0);
  const managed = deleting.filter((entry) => entry.source === "managed");
  const atDefault = deleting.filter((entry) => entry.source === "default");

  let level: RetentionView["level"];
  let title: string;
  let sentence: string;
  if (atRisk.length) {
    level = "urgent";
    const total = atRisk.reduce((sum, entry) => sum + count(entry.atRisk!.sessions), 0);
    title = `${plural(total, "transcript")} can be deleted in the next ${daysText(count(retention!.windowDays) || 7)}.`;
    const parts = atRisk.map((entry) => {
      const label = harnessLabel(String(entry.harness));
      const bytes = count(entry.atRisk!.bytes);
      const next = entry.atRisk!.nextDeletion ? Date.parse(entry.atRisk!.nextDeletion) : Number.NaN;
      const when = Number.isFinite(next) && next > nowMs ? `from ${formatDate(entry.atRisk!.nextDeletion, zone)}, at its next start after that` : "the next time it starts";
      return `${label} can delete ${plural(count(entry.atRisk!.sessions), "transcript")}${bytes > 0 ? ` (${formatBytes(bytes)})` : ""} ${when}`;
    });
    sentence = `${listText(parts)}. ${KEEP_NOTE}`;
  } else if (managed.length || atDefault.length || deleting.length) {
    level = managed.length ? "managed" : atDefault.length ? "default" : "settings";
    title = level === "managed" ? "Your organization sets how long transcripts are kept." : "Keep the history a yearly look back needs.";
    sentence = `${deleting.map(deletesSentence).join(". ")}. ${KEEP_NOTE}`;
  } else if (finding) {
    level = "short";
    title = "Keep the history a yearly look back needs.";
    sentence = clip(finding.detail, MAX_TEXT);
  } else {
    level = "kept";
    const unknown = rows.filter((row) => row.policy === "unknown").map((row) => row.label);
    title = "Your tools keep their transcripts.";
    sentence = `${rows.filter((row) => row.policy === "kept").length ? `${listText(rows.filter((row) => row.policy === "kept").map((row) => row.label))} ${rows.filter((row) => row.policy === "kept").length === 1 ? "keeps" : "keep"} transcripts until you delete them.` : ""}${unknown.length ? ` ${listText(unknown)}: not documented whether old chats are deleted.` : ""}`.trim();
  }
  const disk = (report.findings ?? []).find((f) => f.kind === "history_disk_usage") ?? null;
  const coversFrom = formatDate(retention?.coversFrom, zone);
  return {
    urgent: level === "urgent",
    level,
    title,
    sentence,
    rows,
    cache: retention?.cache ? { keeps: arr(retention.cache.keeps, 10).map((line) => str(line, 200)).filter(Boolean), drops: arr(retention.cache.drops, 10).map((line) => str(line, 200)).filter(Boolean) } : null,
    steps: finding ? stepsOf(finding.suggestion) : [],
    disk: disk ? metricOf(disk) : null,
    limit: deleting.length ? `How far back this goes is limited by retention: ${listText(deleting.map((entry) => `${harnessLabel(String(entry.harness))} deletes transcripts after ${daysText(num(entry.days))}`))}${coversFrom ? `; AI Insights still has sessions back to ${coversFrom}` : ""}.` : null,
  };
}

/**
 * Codex spend whose sessions recorded no speed tier (older Codex versions), priced at Standard. OpenAI's Fast tier
 * costs 2x Standard on most models and 2.5x on gpt-5.5 (https://developers.openai.com/api/docs/pricing).
 */
function untieredNote(usage: UsageSummary | undefined): string | null {
  const row = usage?.untiered?.find((entry) => entry.harness === "codex");
  if (!row || !(count(row.estimatedUsd) > 0)) return null;
  return `${formatUsd(row.estimatedUsd)} of the Codex estimate (${plural(count(row.requests), "request")}) comes from sessions that recorded no speed tier, so it is priced at Standard rates. OpenAI's Fast tier costs 2x Standard on most models; if those requests ran on Fast, they came to about ${formatUsd(row.atFastUsd)}.`;
}

/** What OpenCode and Pi logged themselves, beside the estimate. A recorded $0 is a subscription or plan, never "free". */
export function recordedSpend(usage: Pick<UsageSummary, "recorded" | "recordedByHarness"> | undefined): PageView["usage"]["recorded"] {
  const total = usage?.recorded;
  if (!total || count(total.requests) === 0) return null;
  const line = (usd: number, requests: number, zero: number) => {
    if (usd <= 0) return `nothing billed by the harness (${plural(requests, "request")} recorded $0, typical of subscriptions)`;
    return `recorded ${formatUsd(usd)}${zero > 0 ? ` (${plural(zero, "request")} recorded $0, typical of subscriptions)` : ""}`;
  };
  const harnesses = arr(usage?.recordedByHarness, 6).map((entry) => obj(entry)).map((entry) => {
    const usd = Math.max(0, num(entry.usd)), requests = count(entry.requests), zero = count(entry.zeroRequests);
    return { label: harnessLabel(str(entry.harness, 30)), usd, requests, zeroRequests: zero, text: line(usd, requests, zero) };
  }).filter((entry) => entry.requests > 0);
  const usd = Math.max(0, num(total.usd));
  return { usd, requests: count(total.requests), zeroRequests: count(total.zeroRequests), text: line(usd, count(total.requests), count(total.zeroRequests)), harnesses };
}

const RATIO_ORDER = ["correctionsPerSession", "contextResetShare", "toolErrorRate", "planFirstShare", "parallelism"];

export function ratioText(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  if (unit === "share") return `${value > 0 && value < 0.01 ? "<1" : Math.round(value * 100)}%`;
  if (unit === "times") return `${value.toFixed(1)}×`;
  return value.toFixed(2);
}

export function ratiosView(report: Report): RatioView[] | null {
  const raw = obj(report.ratios);
  if (!report.ratios) return null;
  return RATIO_ORDER.map((key) => obj(raw[key]))
    .filter((r) => str(r.key, 40) && str(r.label, 80))
    .map((r) => {
      const value = maybe(r.value);
      const unit = str(r.unit, 20);
      const counts = obj(r.counts);
      return { key: str(r.key, 40), label: str(r.label, 80), definition: str(r.definition, 300), value, text: ratioText(value, unit), numerator: num(r.numerator), denominator: num(r.denominator), counts: { numerator: str(counts.numerator, 40), denominator: str(counts.denominator, 40) }, unit };
    });
}

export function causesView(report: Report, zone: string, findings: FindingView[]): CausesView | null {
  const raw = report.frictionCauses;
  if (!raw || !Array.isArray(raw.causes)) return null;
  const byId = new Map(findings.map((f) => [f.id, f]));
  return {
    sessions: count(raw.sessions),
    judged: count(raw.judged),
    usedReview: raw.usedReview === true,
    minJudged: count(raw.minJudged),
    withAny: count(raw.withAny),
    causes: raw.causes.slice(0, 8).map((c) => {
      const finding = c.findingId ? byId.get(clip(String(c.findingId), 200)) : undefined;
      return {
        key: str(c.key, 40),
        label: str(c.label, 80),
        sessions: count(c.sessions),
        of: count(c.of),
        share: ratio(c.share),
        basis: str(c.basis, 400),
        signs: arr(c.signs, 10).map((x) => obj(x)).map((x) => ({ label: str(x.label, 120), sessions: count(x.sessions) })).filter((x) => x.label),
        evidence: arr(c.evidence, 2).map((x) => obj(x)).map((x) => ({ when: formatDateTime(typeof x.timestamp === "string" ? x.timestamp : undefined, zone), harness: harnessLabel(String(x.harness ?? "")), note: str(x.note, 300), session: str(x.sessionId, 40) })),
        suggestion: { title: str(c.suggestion?.title, MAX_TITLE), action: str(c.suggestion?.action, MAX_TEXT) },
        finding: finding ? finding.anchor : null,
        action: finding ? finding.action : null,
      };
    }),
  };
}

function listText(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const REVIEW_PROMPT = "Run the analyze-ai-usage skill: analyse my recent sessions and update my AI Insights report.";

/** Build the page's view model. Pure and deterministic: the same input gives the same JSON. */
export function buildView(input: RenderInput, zone: string, extras: RenderExtras = {}): PageView {
  const report = input;
  const recap = recapView(input);
  const a = report.activity;
  const coverage = report.coverage ?? [];
  const found = coverage.filter((entry) => entry.found && count(entry.sessions) > 0);
  const order = [...(a.byHarness ?? [])].sort((x, y) => count(y.sessions) - count(x.sessions)).map((entry) => String(entry.harness));
  const names = (order.length > 0 ? order : found.map((entry) => String(entry.harness))).map(harnessLabel);
  const wall = wallClockMinutes(report);
  const usageModels = report.usage?.models ?? [];
  const tokenHarnesses = new Set(usageModels.filter((m) => count(m.tokens) > 0).map((m) => String(m.harness)));
  const noTokens = found.filter((entry) => !tokenHarnesses.has(entry.harness)).map((entry) => entry.label || harnessLabel(entry.harness));

  // Findings and ranked actions, cross-linked both ways.
  const problems = problemFindings(report).sort((x, y) => severityRank(x.severity) - severityRank(y.severity)).slice(0, MAX_FINDINGS);
  const findingAnchors = new Map<Finding, string>(problems.map((finding, index) => [finding, anchorOf("f", `${index}-${String(finding.id ?? finding.kind)}`)]));
  const ranked = rankActions(report);
  const all = [...ranked.top, ...ranked.rest];
  const actionViews = all.map((action, index) => actionView(action, index, findingAnchors));
  const actionFor = new Map<Finding, string>();
  all.forEach((action, index) => {
    if (action.finding && !actionFor.has(action.finding)) actionFor.set(action.finding, actionViews[index]!.anchor);
  });

  const findings: FindingView[] = problems.map((finding) => {
    const evidence = finding.evidence ?? [];
    return {
      id: clip(String(finding.id ?? ""), 200),
      anchor: findingAnchors.get(finding)!,
      kind: String(finding.kind),
      severity: ["high", "medium", "low", "info"].includes(String(finding.severity)) ? String(finding.severity) : "info",
      title: findingTitle(String(finding.kind), clip(finding.title, MAX_TITLE)),
      detail: clip(finding.detail, MAX_TEXT),
      harnesses: [...new Set((finding.harnesses ?? []).map(harnessLabel))],
      metric: metricOf(finding),
      metricValue: maybe(finding.metric?.value),
      evidence: evidence.slice(0, MAX_EVIDENCE).map((item) => ({ when: formatDateTime(item.timestamp, zone), harness: harnessLabel(String(item.harness)), note: clip(item.note, 300), session: clip(String(item.sessionId ?? ""), 40) })),
      moreEvidence: Math.max(0, evidence.length - MAX_EVIDENCE),
      action: actionFor.get(finding) ?? null,
    };
  });

  const retention = retentionView(report, zone);
  const disk = (report.findings ?? []).find((finding) => finding.kind === "history_disk_usage") ?? null;
  const short = (report.findings ?? []).find((finding) => finding.kind === "short_history") ?? null;
  const diskLink = disk?.suggestion ? safeLink(disk.suggestion.url) : null;
  const shortMetric = short?.metric && Number.isFinite(short.metric.value) ? { value: formatInt(short.metric.value), label: clip(String(short.metric.label || short.metric.unit), 80) } : null;

  const usdByDay = new Map((report.usage?.daily ?? []).map((entry) => [entry.day, maybe(entry.estimatedUsd)] as const));
  const narrative = report.narrative;
  const facets = report.facets;
  const gap = pricingGap(report);
  const usd = maybe(report.usage?.estimatedUsd);

  // The store saves this run's snapshot before rendering, so the newest run is normally today. Without saved
  // runs (`report --json`, an old caller) today's numbers stand in, so the page can still say "first run".
  const runs = (Array.isArray(extras.runs) ? extras.runs : []).slice(-24).map((run) => runView(run, zone)).filter((run): run is RunView => run !== null).sort((x, y) => (x.generatedAt < y.generatedAt ? -1 : x.generatedAt > y.generatedAt ? 1 : 0));
  const last = runs[runs.length - 1];
  if (!last || last.generatedAt < report.generatedAt) {
    runs.push({ id: report.generatedAt, day: localDay(report.generatedAt, zone) ?? "", generatedAt: report.generatedAt, days: recap?.range.days ?? null, metrics: currentMetrics(report, recap), findings: (report.findings ?? []).map((f) => ({ id: String(f.id), kind: String(f.kind), title: findingTitle(String(f.kind), clip(f.title, MAX_TITLE)), severity: String(f.severity), value: maybe(f.metric?.value), unit: String(f.metric?.unit ?? "") })) });
  }

  const reviewNote = narrative ? null : facets && count(facets.sessionsWithFacets) > 0
    ? `Your agent has judged ${plural(count(facets.sessionsWithFacets), "session")} so far but has not written its review. Run the review again to finish it.`
    : "No agent review yet: the win rate, the agent's read of your sessions and its own suggestions appear after you run the review in your own agent.";

  const timeline = (() => {
    const result = busiestDays(a.sessionSpans, zone, order);
    if (result.days.length === 0) return null;
    return { days: result.days.map((t) => timelineDay(t, zone, count(a.parallelSessions?.maxConcurrent))), busiest: result.busiest, total: Math.min(400, (a.sessionSpans ?? []).length), sessions: count(a.sessions) };
  })();

  return {
    v: 1,
    generatedAt: String(report.generatedAt ?? ""),
    generatedLabel: formatDate(report.generatedAt, zone),
    timeZone: zone,
    recap,
    notes: {
      recap: recap ? null : count(a.sessions) === 0 ? "No sessions in this window, so there are no recap cards yet." : "This report was saved before recap cards existed, so it shows the analysis only. Run the report again to get the cards.",
      review: reviewNote,
      runs: runs.length < 2 ? "This is your first saved run. From the next one, this section compares the two: what moved, what got fixed and what is new." : "",
    },
    review: { facets: count(facets?.sessionsWithFacets), narrative: !!narrative, prompt: REVIEW_PROMPT },
    hero: {
      wallHours: recap ? recap.totals.wallHours : wall !== null ? wall / 60 : null,
      agentHours: count(a.totalActiveMinutes) / 60,
      sessions: count(a.sessions),
      prompts: recap ? recap.totals.prompts : count(a.userMessages),
      usd: usd !== null && usd > 0 ? usd : null,
      maxParallel: count(a.parallelSessions?.maxConcurrent),
      activeDays: count(a.activeDays),
      rangeDays: recap ? recap.range.days : null,
      from: recap ? recap.range.from : day(report.range?.from?.slice(0, 10)),
      to: recap ? recap.range.to : day(report.range?.to?.slice(0, 10)),
      lede: ledeFor(report, recap, names),
      harnesses: names,
    },
    coverage: coverage.map((entry) => ({
      harness: String(entry.harness),
      label: entry.label || harnessLabel(entry.harness),
      found: entry.found === true,
      sessions: count(entry.sessions),
      days: historyDaysOf(entry),
      since: formatDate(entry.oldest, zone),
      disk: typeof entry.bytes === "number" && Number.isFinite(entry.bytes) && entry.bytes > 0 ? formatBytes(entry.bytes) : null,
      skipped: count(entry.issues),
      skippedUsage: count(entry.skippedUsageRecords),
      note: entry.note ? clip(entry.note, 200) : null,
      tokens: tokenHarnesses.has(entry.harness),
    })),
    activity: {
      sessions: count(a.sessions),
      activeDays: count(a.activeDays),
      streak: count(a.longestStreakDays),
      hours: hours24(a.hourHistogram),
      harnessHours: recap ? recap.rhythm.harnessPeaks.map((p) => ({ key: p.key, hours: p.hours })) : [],
      weekdays: recap ? recap.rhythm.weekdays : [],
      daily: (a.daily ?? []).slice(-MAX_DAYS).map((d) => ({ day: d.day, sessions: count(d.sessions), prompts: count(d.userMessages), minutes: count(d.activeMinutes), usd: usdByDay.get(d.day) ?? null })),
      responseBuckets: keyCounts(a.responseTimeBuckets, 6, 12),
      medianResponseSec: maybe(a.medianResponseTimeSec),
      toolCategories: keyCounts(a.toolCategories, 11, 20),
      toolCalls: codingToolCalls(a).calls,
      toolsPerPrompt: codingToolCalls(a).typed > 0 ? codingToolCalls(a).calls / codingToolCalls(a).typed : null,
      subagentSessions: count(a.features?.sessionsWithSubagents),
      planModeSessions: count(a.features?.sessionsWithPlanMode),
      compactions: count(a.features?.compactions),
      agentDriven: (a.sessionSpans ?? []).filter((span) => span.agentDriven).length,
      linesAdded: count(a.linesAdded),
      linesRemoved: count(a.linesRemoved),
      commits: count(a.gitCommits),
      projects: (a.projects ?? []).slice(0, 8).map((p) => {
        const name = projectLabel(p.projectPath);
        const worktrees = count(p.worktrees);
        return { label: name.label, title: name.title, note: worktrees > 1 ? plural(worktrees, "worktree") : null, sessions: count(p.sessions), minutes: count(p.activeMinutes) };
      }),
      languages: keyCounts(a.languages, 8, 40),
      maxParallel: count(a.parallelSessions?.maxConcurrent),
      overlapEvents: count(a.parallelSessions?.overlapEvents),
      chat: a.chat && count(a.chat.sessions) > 0
        ? {
            sessions: count(a.chat.sessions),
            only: count(a.chat.sessions) >= count(a.sessions),
            prompts: count(a.chat.userMessages),
            replies: count(a.chat.assistantMessages),
            toolCalls: count(a.chat.toolCalls),
            toolErrors: count(a.chat.toolErrors),
            attachments: count(a.chat.attachments),
            files: count(a.chat.files),
            voiceNotes: count(a.chat.voiceNotes),
            branches: count(a.chat.branches),
          }
        : null,
    },
    timeline,
    usage: {
      tokens: count(report.usage?.tokens),
      input: count(report.usage?.input),
      cachedInput: count(report.usage?.cachedInput),
      cacheWrite: count(report.usage?.cacheWrite),
      output: count(report.usage?.output),
      requests: count(report.usage?.requests),
      usd: usd !== null && Number.isFinite(usd) ? usd : null,
      usdText: formatUsd(usd),
      unpriced: count(report.usage?.unpriced),
      cacheHitRate: maybe(report.usage?.cacheHitRate),
      pricingVersion: str(report.usage?.pricingVersion, 60),
      gap: gap ? `${gap.unpricedShare < 0.01 ? "Under 1%" : `${Math.round(gap.unpricedShare * 100)}%`} of requests (${formatInt(count(report.usage.unpriced))}) have no known price${gap.models.length > 0 ? `: ${unpricedModelsText(gap.models, 6)}` : ""}. They are left out of the estimate, not counted as free, so the real figure is higher.` : null,
      untiered: untieredNote(report.usage),
      perCommit: usd !== null && usd > 0 && count(a.gitCommits) > 0 ? usd / count(a.gitCommits) : null,
      recorded: recordedSpend(report.usage),
      noTokens,
      daily: (report.usage?.daily ?? []).slice(-MAX_DAYS).map((d) => ({ day: d.day, usd: maybe(d.estimatedUsd), tokens: count(d.tokens) })),
      models: usageModels.slice(0, 40).map((m) => ({ model: clip(String(m.model), 60), harness: String(m.harness), requests: count(m.requests), tokens: count(m.tokens), output: count(m.output), usd: maybe(m.estimatedUsd), unpriced: count(m.unpriced) })),
    },
    failures: codingFailures(a),
    findings,
    otherFindings: (report.findings ?? []).filter((finding) => NOT_A_PROBLEM.has(finding.kind)).length,
    actions: { top: actionViews.slice(0, ranked.top.length), rest: actionViews.slice(ranked.top.length) },
    narrative: narrative
      ? {
          headline: clip(narrative.headline, 900),
          interactionStyle: clip(narrative.interactionStyle, MAX_TEXT),
          workAreas: (narrative.workAreas ?? []).slice(0, 8).filter(Boolean).map((w) => ({ name: clip(w.name, MAX_TITLE), sessions: count(w.sessions), description: clip(w.description, MAX_TEXT) })),
          wins: (narrative.wins ?? []).slice(0, 8).filter(Boolean).map((w) => ({ title: clip(w.title, MAX_TITLE), description: clip(w.description, MAX_TEXT) })),
          frictions: (narrative.frictions ?? []).slice(0, 8).filter(Boolean).map((f) => ({ title: clip(f.title, MAX_TITLE), description: clip(f.description, MAX_TEXT), examples: (f.examples ?? []).slice(0, 5).map((e) => clip(e, 400)) })),
          horizon: (narrative.horizon ?? []).slice(0, 8).filter(Boolean).map((z) => ({ title: clip(z.title, MAX_TITLE), description: clip(z.description, MAX_TEXT), starterPrompt: z.starterPrompt ? clip(z.starterPrompt, MAX_COPY) : null })),
        }
      : null,
    facets: facets && count(facets.sessionsWithFacets) > 0
      ? { sessions: count(facets.sessionsWithFacets), outcomes: keyCounts(facets.outcomes, 6), frictions: keyCounts(facets.frictions, 12, 40), successes: keyCounts(facets.successes, 8, 40), goals: keyCounts(facets.goalCategories, 17, 40) }
      : null,
    closing: {
      // "Keep your history" carries the packmem and Matrix OS steps when it has them: the closing pair then
      // goes, so each pitch shows once. Without its suggestion the disk card is the number and the detail only.
      show: !(retention && retention.steps.length > 0),
      disk: disk
        ? disk.suggestion
          ? { metric: metricOf(disk), title: clip(disk.suggestion.title, MAX_TITLE), action: clip(disk.suggestion.action, MAX_TEXT), url: diskLink ? diskLink.href : null, urlLabel: diskLink ? shortUrl(diskLink) : null }
          : { metric: metricOf(disk), title: clip(disk.title, MAX_TITLE), action: clip(disk.detail, MAX_TEXT), url: null, urlLabel: null }
        : null,
      matrix: { metric: shortMetric, since: shortMetric ? formatDate(shortHistoryCoverage(coverage, short)?.oldest, zone) : null, url: MATRIX_URL },
    },
    runs,
    retention,
    causes: causesView(report, zone, findings),
    ratios: ratiosView(report),
    deviceId: typeof extras.deviceId === "string" && /^[0-9a-f]{32}$/.test(extras.deviceId) ? extras.deviceId : null,
  };
}

