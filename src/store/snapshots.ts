import { createHash } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  FINDING_KINDS,
  RECAP_VERSION,
  REPORT_VERSION,
  SNAPSHOT_VERSION,
  type Finding,
  type MetricDelta,
  type Report,
  type RunComparison,
  type RunFinding,
  type RunMetrics,
  type RunSnapshot,
} from "../schema/types.js";
import { readJsonFile, writeFileAtomic } from "./fs.js";

/** Up to this many snapshots are all kept; past it, old ones are thinned. */
export const KEEP_ALL_SNAPSHOTS = 500;
/** Snapshots newer than this are never thinned. */
export const THIN_AFTER_DAYS = 90;
/** Bounds the folder even if every snapshot is recent. */
export const MAX_SNAPSHOTS = 2_000;
/** Two runs this close together are one run: the later replaces the earlier. */
export const MERGE_WINDOW_MS = 10 * 60_000;
const MAX_FINDINGS = 60;
const MAX_DAILY = 30;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const DAY_MS = 86_400_000;

/** `2026-11-16T17:30:12.530Z` as `2026-11-16T17-30-12-530Z`: sorts the same and is a valid file name everywhere. */
export function snapshotId(generatedAt: string): string {
  return new Date(Date.parse(generatedAt)).toISOString().replace(/[:.]/g, "-");
}

const SNAPSHOT_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** A repeated instruction's id and title are built from prompt words; a snapshot keeps a hash and a fixed title. */
function runFinding(finding: Finding): RunFinding {
  const quoted = finding.kind === "repeated_instruction";
  const id = quoted ? `repeated_instruction:#${createHash("sha256").update(finding.id).digest("hex").slice(0, 16)}` : finding.id.slice(0, 300);
  return {
    id,
    kind: finding.kind,
    severity: finding.severity,
    title: quoted ? "You keep repeating an instruction" : finding.title.slice(0, 200),
    metric: finding.metric ? { value: finding.metric.value, unit: finding.metric.unit.slice(0, 40), label: finding.metric.label.slice(0, 120) } : null,
    hasSuggestion: !!finding.suggestion,
  };
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2, info: 3 } as const;

export function snapshotMetrics(report: Report): RunMetrics {
  const activity = report.activity;
  const recap = report.recap;
  let toolCalls = 0;
  let toolErrors = 0;
  if (recap) {
    toolCalls = recap.failures.calls;
    toolErrors = recap.failures.total;
  } else {
    for (const tool of activity.tools) toolCalls += tool.count;
    for (const error of activity.toolErrors) toolErrors += error.count;
  }
  return {
    sessions: activity.sessions,
    prompts: recap?.totals.prompts ?? activity.userMessages,
    activeDays: activity.activeDays,
    wallHours: round((activity.wallClockActiveMinutes ?? activity.totalActiveMinutes) / 60, 1),
    agentHours: round(activity.totalActiveMinutes / 60, 1),
    toolCalls,
    toolErrors,
    failureRate: toolCalls ? toolErrors / toolCalls : 0,
    tests: recap?.shell.tests ?? 0,
    testPass: recap?.shell.testPass ?? null,
    tokens: report.usage.tokens,
    usd: report.usage.estimatedUsd,
    cacheHitRate: report.usage.cacheHitRate,
    maxParallel: activity.parallelSessions.maxConcurrent,
    compactions: activity.features.compactions,
    compactionsPerSession: activity.sessions ? activity.features.compactions / activity.sessions : 0,
    commits: activity.gitCommits,
    medianResponseSec: recap?.replies?.medianSec ?? null,
    winRate: recap?.winRate ?? null,
    interrupted: recap?.interrupted ?? 0,
    streak: activity.longestStreakDays,
  };
}

/** The few KB a report run leaves behind: numbers and finding ids, never prompt text. */
export function makeSnapshot(report: Report): RunSnapshot {
  const findings = [...report.findings]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_FINDINGS)
    .map(runFinding);
  const recap = report.recap;
  const window = recap
    ? { from: recap.range.from, to: recap.range.to, days: recap.range.days }
    : { from: report.range.from?.slice(0, 10) ?? null, to: report.range.to?.slice(0, 10) ?? null, days: 0 };
  const snapshot: RunSnapshot = {
    snapshotVersion: SNAPSHOT_VERSION,
    id: snapshotId(report.generatedAt),
    generatedAt: new Date(Date.parse(report.generatedAt)).toISOString(),
    timeZone: report.timeZone,
    versions: { report: REPORT_VERSION, recap: RECAP_VERSION, pricing: report.usage.pricingVersion },
    window,
    metrics: snapshotMetrics(report),
    findings,
    suggestionsShown: findings.filter((finding) => finding.hasSuggestion).map((finding) => finding.id),
    narrative: report.narrative !== null,
  };
  if (recap && recap.daily.length) snapshot.daily = recap.daily.slice(-MAX_DAILY);
  return snapshot;
}

const nullableNumber = z.number().nullable();

const RunFindingSchema = z.object({
  id: z.string().min(1).max(300),
  kind: z.enum(FINDING_KINDS),
  severity: z.enum(["info", "low", "medium", "high"]),
  title: z.string().max(300),
  metric: z.object({ value: z.number(), unit: z.string().max(60), label: z.string().max(200) }).nullable(),
  hasSuggestion: z.boolean(),
});

const RunSnapshotSchema = z.object({
  snapshotVersion: z.literal(SNAPSHOT_VERSION),
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/),
  generatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  timeZone: z.string().max(100),
  versions: z.object({ report: z.number(), recap: z.number(), pricing: z.string().max(100) }),
  window: z.object({ from: z.string().max(40).nullable(), to: z.string().max(40).nullable(), days: z.number().int().min(0) }),
  metrics: z.object({
    sessions: z.number(),
    prompts: z.number(),
    activeDays: z.number(),
    wallHours: z.number(),
    agentHours: z.number(),
    toolCalls: z.number(),
    toolErrors: z.number(),
    failureRate: z.number(),
    tests: z.number(),
    testPass: nullableNumber,
    tokens: z.number(),
    usd: nullableNumber,
    cacheHitRate: nullableNumber,
    maxParallel: z.number(),
    compactions: z.number(),
    compactionsPerSession: z.number(),
    commits: z.number(),
    medianResponseSec: nullableNumber,
    winRate: nullableNumber,
    interrupted: z.number(),
    streak: z.number(),
  }),
  findings: z.array(RunFindingSchema).max(200),
  suggestionsShown: z.array(z.string().max(300)).max(200),
  narrative: z.boolean(),
  daily: z.array(z.object({ day: z.string().max(10), sessions: z.number(), prompts: z.number(), minutes: z.number() })).max(400).optional(),
}) satisfies z.ZodType<RunSnapshot, unknown>;

export function snapshotsDir(home: string): string {
  return join(home, "snapshots");
}

/** Monday (UTC) of the week an instant falls in, as a day string. */
function weekOf(ms: number): string {
  const day = new Date(ms);
  const back = (day.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - back)).toISOString().slice(0, 10);
}

/**
 * Which snapshots to keep. Up to 500 all stay; past that, those older than 90 days thin to the newest per week,
 * and a hard cap keeps the newest 2,000. Pure, so the policy is testable without a file system.
 */
export function retainedIds(runs: Array<{ id: string; generatedAt: string }>, now: Date): Set<string> {
  const sorted = [...runs].sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  if (sorted.length <= KEEP_ALL_SNAPSHOTS) return new Set(sorted.map((run) => run.id));
  const cutoff = now.getTime() - THIN_AFTER_DAYS * DAY_MS;
  const newestPerWeek = new Map<string, string>();
  const keep: string[] = [];
  for (const run of sorted) {
    const ms = Date.parse(run.generatedAt);
    if (ms >= cutoff) keep.push(run.id);
    else newestPerWeek.set(weekOf(ms), run.id);
  }
  const weekly = new Set(newestPerWeek.values());
  const old = sorted.filter((run) => weekly.has(run.id)).map((run) => run.id);
  return new Set([...old, ...keep].slice(-MAX_SNAPSHOTS));
}

interface Listed {
  id: string;
  generatedAt: string;
  path: string;
}

/** Snapshot files by name, oldest first; names carry the time, so nothing needs reading. */
async function listSnapshots(home: string): Promise<Listed[]> {
  let names: string[];
  try {
    names = await readdir(snapshotsDir(home));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => SNAPSHOT_FILE.test(name))
    .sort()
    .map((name) => {
      const id = name.slice(0, -".json".length);
      const iso = id.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/, "$1:$2:$3.$4");
      return { id, generatedAt: iso, path: join(snapshotsDir(home), name) };
    });
}

/**
 * Saves a run. A run within ten minutes of the newest saved one replaces it, so re-running a report does not
 * fill the history with near-identical points. Then applies the retention policy.
 */
export async function saveSnapshot(home: string, snapshot: RunSnapshot, now: Date = new Date()): Promise<string> {
  const existing = await listSnapshots(home);
  const at = Date.parse(snapshot.generatedAt);
  const path = join(snapshotsDir(home), `${snapshot.id}.json`);
  await writeFileAtomic(path, `${JSON.stringify(snapshot)}\n`);
  for (const run of existing) {
    if (run.id !== snapshot.id && Math.abs(Date.parse(run.generatedAt) - at) < MERGE_WINDOW_MS) await rm(run.path, { force: true });
  }
  const after = await listSnapshots(home);
  const keep = retainedIds(after, now);
  for (const run of after) if (!keep.has(run.id)) await rm(run.path, { force: true });
  return path;
}

/** Every readable snapshot, oldest first. Files that are oversized, unparseable or of another version are skipped. */
export async function loadRuns(home: string): Promise<RunSnapshot[]> {
  const runs: RunSnapshot[] = [];
  for (const run of (await listSnapshots(home)).slice(-MAX_SNAPSHOTS)) {
    const info = await stat(run.path).catch(() => null);
    if (!info || !info.isFile() || info.size > MAX_SNAPSHOT_BYTES) continue;
    const parsed = RunSnapshotSchema.safeParse(await readJsonFile(run.path));
    if (parsed.success && parsed.data.id === run.id) runs.push(parsed.data as RunSnapshot);
  }
  return runs;
}

const METRIC_KEYS: Array<keyof RunMetrics> = [
  "sessions", "prompts", "activeDays", "wallHours", "agentHours", "toolCalls", "toolErrors", "failureRate", "tests", "testPass", "tokens", "usd",
  "cacheHitRate", "maxParallel", "compactions", "compactionsPerSession", "commits", "medianResponseSec", "winRate", "interrupted", "streak",
];

/** What changed between two runs: every metric's delta, and which findings went away, stayed or appeared. */
export function compareRuns(previous: RunSnapshot, current: RunSnapshot): RunComparison {
  const deltas: MetricDelta[] = METRIC_KEYS.map((key) => {
    const before = previous.metrics[key] ?? null;
    const now = current.metrics[key] ?? null;
    return { key, previous: before, current: now, delta: before === null || now === null ? null : now - before };
  });
  const before = new Set(previous.findings.map((finding) => finding.id));
  const now = new Set(current.findings.map((finding) => finding.id));
  return {
    previousId: previous.id,
    currentId: current.id,
    deltas,
    resolved: previous.findings.filter((finding) => !now.has(finding.id)),
    stillOpen: current.findings.filter((finding) => before.has(finding.id)),
    new: current.findings.filter((finding) => !before.has(finding.id)),
  };
}
