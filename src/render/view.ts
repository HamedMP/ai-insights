import type { Coverage, Finding, RenderExtras, Report, RunSnapshot } from "../schema/types.js";
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
  parallel: { max: number; overlapEvents: number; subagents: number };
  longestSession: { activeMinutes: number; wallMinutes: number; prompts: number; toolCalls: number; toolCallsCapped: boolean; harness: string; compactions: number } | null;
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
  /** How much history the tools keep: share-safe (a count and a day). Absent until the data layer sends it. */
  history: { days: number; firstDay: string | null } | null;
  persona: { title: string; time: string; role: string; reason: string } | null;
  tips: Array<{ title: string; kind: string; metric: { value: number; unit: string; label: string } | null }>;
  /** false: the page does not build that card (its data is missing). */
  avail: Record<string, boolean>;
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
  coverage: Array<{ harness: string; label: string; found: boolean; sessions: number; days: number | null; since: string | null; disk: string | null; skipped: number; note: string | null; tokens: boolean }>;
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
    perCommit: number | null;
    /** What the tools themselves logged (OpenCode, Pi), beside the list-price estimate; null when none did. */
    recorded: { usd: number; text: string; harnesses: string[] } | null;
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
    disk: { metric: { value: string; label: string } | null; title: string; action: string; url: string | null; urlLabel: string | null } | null;
    matrix: { metric: { value: string; label: string } | null; since: string | null; url: string };
  };
  runs: RunView[];
  retention: RetentionView | null;
}

export interface RetentionView {
  /** Deletion within 7 days for at least one tool: the block leads "What to change". */
  urgent: boolean;
  sentence: string;
  rows: Array<{ label: string; kept: string | null; oldest: string | null; atRisk: string | null; next: string | null; cacheOnly: number }>;
  cache: string | null;
  steps: StepView[];
  /** One line for "Over time" when retention limits how far back runs and days go; null when it does not. */
  limit: string | null;
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

const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Every card id, in the default order. Matches `CARD_IDS` in the client engine. */
/** Cards a style may leave out; they are never in the default selection. */
export const OPTIONAL_CARD_IDS = ["history"] as const;
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
    parallel: { max: count(parallel.max), overlapEvents: count(parallel.overlapEvents), subagents: count(parallel.subagents) },
    longestSession: longest && count(longest.activeMinutes) > 0
      ? { activeMinutes: count(longest.activeMinutes), wallMinutes: count(longest.wallMinutes), prompts: count(longest.prompts), toolCalls: count(longest.toolCalls), toolCallsCapped: longest.toolCallsCapped === true, harness: str(longest.harness, 20), compactions: count(longest.compactions) }
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
    history: raw.history && count(obj(raw.history).days) > 0 ? { days: Math.round(count(obj(raw.history).days)), firstDay: day(obj(raw.history).firstDay ?? obj(raw.history).from) } : null,
    persona: persona && str(persona.title, 60) ? { title: str(persona.title, 60), time: str(persona.time, 30), role: str(persona.role, 30), reason: str(persona.reason, 160) } : null,
    tips: [],
    avail: {},
  };
  view.tips = tipsFor(raw.tips, input.findings ?? []);
  view.avail = availability(view);
  return view;
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
    .filter((f) => f.suggestion && TIP_TITLES[f.kind] && f.kind !== "history_disk_usage" && f.kind !== "short_history")
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
    history: d.history !== null,
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

/** `suggestion.steps`, read loosely: any finding may carry them, and the field is newer than this renderer. */
export function stepsOf(suggestion: unknown): StepView[] {
  return arr(obj(suggestion).steps, 6).map((entry) => obj(entry)).map((step) => {
    const link = safeLink(step.url);
    const copyText = str(step.instructionText ?? step.copy ?? step.text ?? step.snippet, MAX_COPY) || null;
    const file = str(step.file ?? step.path, 200);
    return {
      title: str(step.title, MAX_TITLE),
      body: str(step.action ?? step.description ?? step.detail, MAX_TEXT),
      copy: copyText,
      copyLabel: copyText ? (file ? `Add to ${file}` : str(step.copyLabel, 80) || "Copy") : null,
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
    findings: arr(run.findings, 80).map((entry) => obj(entry)).map((f) => ({ id: str(f.id, 200), kind: str(f.kind, 40), title: str(f.title, MAX_TITLE), severity: str(f.severity, 10), value: maybe(obj(f.metric).value), unit: str(obj(f.metric).unit, 30) })).filter((f) => f.id),
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

function ledeFor(report: Report, recap: RecapView | null, names: string[]): string {
  const narrative = report.narrative?.headline;
  if (typeof narrative === "string" && narrative.trim()) return clip(narrative.trim(), 900);
  const a = report.activity;
  const sessions = count(a.sessions);
  if (sessions === 0) return "No coding-agent sessions were found in this window. Once your agents have some history, run the report again.";
  const where = names.length > 0 ? ` in ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`}` : "";
  const days = recap ? recap.range.days : null;
  const parts = [`${plural(sessions, "session")}${where}${days ? ` over ${plural(days, "day")}` : ""}, on ${plural(count(a.activeDays), "active day")}.`];
  const calls = (a.toolCategories ?? []).reduce((sum, entry) => sum + count(entry.count), 0);
  const typed = count(a.userMessages);
  if (calls > 0 && typed > 0) parts.push(`Your agents made ${formatInt(calls)} tool calls, ${formatInt(calls / typed)} for every message you typed.`);
  return parts.join(" ");
}

/**
 * How long each tool keeps transcripts and what is about to go, from `report.retention` and the
 * `history_retention` finding. Read loosely and defensively: null when the report carries neither.
 */
export function retentionView(report: Report, zone: string): RetentionView | null {
  const raw = (report as unknown as { retention?: unknown }).retention;
  const finding = (report.findings ?? []).find((f) => f.kind === ("history_retention" as never)) ?? null;
  const entries = (Array.isArray(raw) ? raw : arr(obj(raw).harnesses ?? obj(raw).tools, 8)).map((entry) => obj(entry)).slice(0, 8);
  if (entries.length === 0 && !finding) return null;
  const now = Date.parse(report.generatedAt);
  let urgent = false, soonest: { label: string; sessions: number; mb: number; date: string | null } | null = null;
  const rows = entries.map((e) => {
    const label = str(e.label, 40) || harnessLabel(str(e.harness, 30));
    const keepDays = maybe(e.keepDays ?? e.retentionDays ?? e.cleanupPeriodDays);
    const forever = e.keepsForever === true || e.forever === true;
    const risk = obj(e.atRisk ?? e.deletingSoon);
    const riskSessions = count(risk.sessions ?? e.sessionsAtRisk);
    const riskMb = count(risk.mb ?? risk.megabytes ?? e.mbAtRisk);
    const nextIso = str(e.nextDeletion ?? risk.by ?? risk.date, 40);
    const next = nextIso ? formatDate(nextIso, zone) : null;
    if (riskSessions > 0 && (!Number.isFinite(Date.parse(nextIso)) || Date.parse(nextIso) - now <= 7 * 86_400_000)) {
      urgent = true;
      if (!soonest) soonest = { label, sessions: riskSessions, mb: riskMb, date: next };
    }
    return {
      label,
      kept: forever ? "kept until you delete it" : keepDays !== null ? `kept ${plural(keepDays, "day")}` : null,
      oldest: formatDate(str(e.oldest ?? e.oldestTranscript, 40), zone),
      atRisk: riskSessions > 0 ? `${plural(riskSessions, "session")}${riskMb > 0 ? ` (${formatBytes(riskMb * 1e6)})` : ""} deleted${next ? ` by ${next}` : " this week"}` : null,
      next,
      cacheOnly: count(e.cacheOnly ?? e.onlyInCache ?? e.sessionsOnlyInCache),
    };
  });
  const cacheRaw = obj(obj(raw).cache);
  const cache = str(cacheRaw.note ?? obj(raw).cacheNote, 400) || "AI Insights' cache keeps each session's numbers and your own prompts, so these stats survive. It does not keep the agents' replies or tool output: the full transcripts are gone once a tool deletes them, unless you archive them.";
  const limited = rows.filter((row) => row.kept && !row.kept.startsWith("kept until"));
  const s0 = soonest as { label: string; sessions: number; mb: number; date: string | null } | null;
  return {
    urgent,
    sentence: s0
      ? `${s0.label} will delete ${plural(s0.sessions, "session")}${s0.mb > 0 ? ` (${formatBytes(s0.mb * 1e6)})` : ""}${s0.date ? ` by ${s0.date}` : " this week"}. The numbers stay in AI Insights; the full transcripts do not, unless you keep them.`
      : limited.length ? `${listText(limited.map((row) => `${row.label} keeps transcripts for ${row.kept!.replace("kept ", "")}`))}. A yearly look back needs them kept longer.` : finding ? clip(finding.detail, MAX_TEXT) : "Your transcripts are kept.",
    rows,
    cache,
    steps: finding ? stepsOf(finding.suggestion) : [],
    limit: limited.length ? `How far back this goes is limited by retention: ${listText(limited.map((row) => `${row.label} ${row.kept}`))}.` : null,
  };
}

function recordedSpend(report: Report): PageView["usage"]["recorded"] {
  const usage = obj(report.usage);
  const total = maybe(usage.recordedUsd ?? usage.recordedSpendUsd ?? obj(usage.recorded).usd);
  if (total === null) return null;
  const harnesses = arr(obj(usage.recorded).harnesses ?? usage.recordedHarnesses, 6).map((h) => harnessLabel(str(h, 30))).filter(Boolean);
  // A recorded $0 is a subscription or a free model, not "free work": say so instead of printing $0.
  const text = total > 0 ? formatUsd(total) : "nothing billed";
  return { usd: total, text, harnesses };
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
      title: clip(finding.title, MAX_TITLE),
      detail: clip(finding.detail, MAX_TEXT),
      harnesses: [...new Set((finding.harnesses ?? []).map(harnessLabel))],
      metric: metricOf(finding),
      metricValue: maybe(finding.metric?.value),
      evidence: evidence.slice(0, MAX_EVIDENCE).map((item) => ({ when: formatDateTime(item.timestamp, zone), harness: harnessLabel(String(item.harness)), note: clip(item.note, 300), session: clip(String(item.sessionId ?? ""), 40) })),
      moreEvidence: Math.max(0, evidence.length - MAX_EVIDENCE),
      action: actionFor.get(finding) ?? null,
    };
  });

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
    runs.push({ id: report.generatedAt, day: localDay(report.generatedAt, zone) ?? "", generatedAt: report.generatedAt, days: recap?.range.days ?? null, metrics: currentMetrics(report, recap), findings: (report.findings ?? []).map((f) => ({ id: String(f.id), kind: String(f.kind), title: clip(f.title, MAX_TITLE), severity: String(f.severity), value: maybe(f.metric?.value), unit: String(f.metric?.unit ?? "") })) });
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
      toolCalls: (a.toolCategories ?? []).reduce((sum, entry) => sum + count(entry.count), 0),
      toolsPerPrompt: count(a.userMessages) > 0 ? (a.toolCategories ?? []).reduce((sum, entry) => sum + count(entry.count), 0) / count(a.userMessages) : null,
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
      gap: gap ? `${Math.round(gap.unpricedShare * 100)}% of requests (${formatInt(count(report.usage.unpriced))}) have no known price${gap.models.length > 0 ? `: ${unpricedModelsText(gap.models, 6)}` : ""}. They are left out of the estimate, not counted as free, so the real figure is higher.` : null,
      perCommit: usd !== null && usd > 0 && count(a.gitCommits) > 0 ? usd / count(a.gitCommits) : null,
      recorded: recordedSpend(report),
      noTokens,
      daily: (report.usage?.daily ?? []).slice(-MAX_DAYS).map((d) => ({ day: d.day, usd: maybe(d.estimatedUsd), tokens: count(d.tokens) })),
      models: usageModels.slice(0, 40).map((m) => ({ model: clip(String(m.model), 60), harness: String(m.harness), requests: count(m.requests), tokens: count(m.tokens), output: count(m.output), usd: maybe(m.estimatedUsd), unpriced: count(m.unpriced) })),
    },
    failures: {
      total: (a.toolErrors ?? []).reduce((sum, entry) => sum + count(entry.count), 0),
      calls: (a.toolCategories ?? []).reduce((sum, entry) => sum + count(entry.count), 0),
      categories: keyCounts(a.toolErrors, 9, 30),
    },
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
      disk: disk
        ? { metric: metricOf(disk), title: clip(disk.suggestion?.title ?? "Compress and save disk space", MAX_TITLE), action: clip(disk.suggestion?.action ?? disk.detail, MAX_TEXT), url: diskLink ? diskLink.href : null, urlLabel: diskLink ? shortUrl(diskLink) : null }
        : null,
      matrix: { metric: shortMetric, since: shortMetric ? formatDate(shortHistoryCoverage(coverage, short)?.oldest, zone) : null, url: MATRIX_URL },
    },
    runs,
    retention: retentionView(report, zone),
  };
}

