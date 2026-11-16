import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BuildReportInput,
  Harness,
  Report,
  Session,
  SessionFacet,
  SessionFile,
  Source,
  TranscriptTurn,
} from "../../src/schema/types.js";

/** Synthetic, hand-written data only. Nothing here comes from a real transcript. */
export function makeSession(overrides: Partial<Session> & { id: string; harness?: Harness }): Session {
  const harness = overrides.harness ?? "claude-code";
  return {
    harness,
    sourcePath: `/fake/${harness}/${overrides.id}.jsonl`,
    sourceMtimeMs: 1_000,
    projectPath: "/work/demo-app",
    gitBranch: "main",
    startTime: "2026-10-01T09:00:00.000Z",
    endTime: "2026-10-01T09:30:00.000Z",
    durationMinutes: 30,
    activeMinutes: 25,
    models: ["model-a"],
    permissionMode: "default",
    userMessageCount: 3,
    assistantMessageCount: 5,
    prompts: [{ timestamp: "2026-10-01T09:00:00.000Z", text: "add a settings page" }],
    userResponseTimesSec: [12, 40],
    requests: [
      { id: `${overrides.id}-r1`, timestamp: "2026-10-01T09:01:00.000Z", model: "model-a", usage: { input: 100, cachedInput: 900, cacheWrite: 50, output: 200 } },
    ],
    toolCalls: [
      { name: "Bash", category: "shell", timestamp: "2026-10-01T09:02:00.000Z", command: "pnpm test", error: "command_failed" },
      { name: "Edit", category: "edit", timestamp: "2026-10-01T09:03:00.000Z", filePath: "/work/demo-app/src/a.ts" },
    ],
    features: { mcpServers: [], skills: [], slashCommands: [], subagents: 0, planMode: false, webSearch: false, webFetch: false, compactions: 0 },
    linesAdded: 10,
    linesRemoved: 2,
    filesModified: ["/work/demo-app/src/a.ts"],
    languages: { TypeScript: 1 },
    gitCommits: 1,
    gitPushes: 0,
    issues: 0,
    ...overrides,
  };
}

export function fileFor(session: Session, mtimeMs = session.sourceMtimeMs): SessionFile {
  return { harness: session.harness, path: session.sourcePath, mtimeMs, sizeBytes: 100 };
}

export interface FakeSource extends Source {
  parseCalls: string[];
  excerptCalls: Array<{ path: string; options: unknown }>;
  /** Replace what the source reports, e.g. to simulate a changed file. */
  sessions: Session[];
}

/** A source backed by an in-memory list, counting parses so tests can see cache hits. */
export function fakeSource(harness: Harness, sessions: Session[], extra: Partial<Source> = {}): FakeSource {
  const source: FakeSource = {
    harness,
    label: harness === "claude-code" ? "Claude Code" : harness === "codex" ? "Codex" : harness,
    sessions,
    parseCalls: [],
    excerptCalls: [],
    defaultRoots: () => [`/fake/${harness}`],
    discover: async (options) => {
      const since = options?.since?.getTime() ?? -Infinity;
      return source.sessions
        .filter((session) => session.sourceMtimeMs >= since)
        .map((session) => fileFor(session))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, options?.maxFiles ?? Infinity);
    },
    parse: async (file) => {
      source.parseCalls.push(file.path);
      const session = source.sessions.find((candidate) => candidate.sourcePath === file.path);
      return session ? { ...session, sourceMtimeMs: file.mtimeMs } : null;
    },
    excerpt: async (file, options) => {
      source.excerptCalls.push({ path: file.path, options });
      const turns: TranscriptTurn[] = [
        { timestamp: "2026-10-01T09:00:00.000Z", role: "user", text: "please fix the login bug, token is sk-abcdefghijklmnopqrstuvwxyz123456" },
        { timestamp: "2026-10-01T09:01:00.000Z", role: "assistant", text: "Looking at the auth module." },
        { timestamp: "2026-10-01T09:02:00.000Z", role: "tool", text: "x".repeat(10_000), toolName: "Bash", isError: true },
      ];
      return turns;
    },
    ...extra,
  };
  return source;
}

export function validFacet(sessionId: string, harness: Harness = "claude-code"): SessionFacet {
  return {
    sessionId,
    harness,
    underlyingGoal: "Add a settings page",
    goalCategories: ["feature"],
    sessionType: "single_task",
    outcome: "mostly_achieved",
    helpfulness: "very_helpful",
    satisfaction: "likely_satisfied",
    primarySuccess: "correct_code_edits",
    frictions: { buggy_code: 1 },
    frictionDetail: "First attempt broke a test.",
    summary: "Built the page, fixed one failing test.",
  };
}

export function validNarrative() {
  return {
    headline: "You mostly build features in one app, with short focused sessions.",
    workAreas: [{ name: "Demo app", sessions: 3, description: "Settings and auth work." }],
    interactionStyle: "Short prompts, quick corrections.",
    wins: [{ title: "Fast fixes", description: "Bugs got fixed in one pass." }],
    frictions: [{ title: "Flaky tests", description: "Tests failed repeatedly.", examples: ["pnpm test failed 4 times"] }],
    suggestions: [{ type: "instructions", title: "Run tests first", action: "Ask the agent to run tests before saying done.", instructionText: "Always run pnpm test before finishing." }],
    horizon: [{ title: "Parallel agents", description: "Try running two agents on separate branches.", starterPrompt: "Split this task into two." }],
  };
}

export interface FakeReportOptions {
  /** Set to model a report from an analysis that measures wall-clock time. */
  wallClockActiveMinutes?: number;
  /** Requests whose model had no price, out of `requests`. */
  unpriced?: number;
  requests?: number;
  estimatedUsd?: number | null;
}

const DAY_MS = 86_400_000;

function isoDay(index: number): string {
  return new Date(Date.UTC(2025, 9, 1) + index * DAY_MS).toISOString().slice(0, 10);
}

function counts(prefix: string, length: number): Array<{ key: string; count: number }> {
  return Array.from({ length }, (_, index) => ({ key: `${prefix}-${index}`, count: 1_000 - index }));
}

/**
 * A stand-in for the analysis module: records what it was given and returns a
 * report as heavy as a busy year, so size limits are tested against realistic bulk.
 */
export function fakeBuildReport(calls: BuildReportInput[] = [], options: FakeReportOptions = {}) {
  return (input: BuildReportInput): Report => {
    calls.push(input);
    const days = 400;
    const daily = Array.from({ length: days }, (_, index) => ({ day: isoDay(index), sessions: 1, userMessages: 2, activeMinutes: 3 }));
    const totals = { tokens: 1250, input: 100, cachedInput: 900, cacheWrite: 50, output: 200, requests: 1, estimatedUsd: 0.01, unpriced: 0 };
    const requests = options.requests ?? 1;
    const unpriced = options.unpriced ?? 0;
    const facetCount = input.facets?.length ?? 0;
    return {
      version: 1,
      generatedAt: (input.now ?? new Date()).toISOString(),
      timeZone: input.timeZone ?? "UTC",
      range: { from: input.sessions.at(-1)?.startTime ?? null, to: input.sessions[0]?.endTime ?? null },
      coverage: input.coverage,
      activity: {
        sessions: input.sessions.length,
        activeDays: 1,
        longestStreakDays: 1,
        totalActiveMinutes: input.sessions.reduce((sum, session) => sum + session.activeMinutes, 0),
        ...(options.wallClockActiveMinutes !== undefined ? { wallClockActiveMinutes: options.wallClockActiveMinutes } : {}),
        userMessages: 3,
        assistantMessages: 5,
        linesAdded: 10,
        linesRemoved: 2,
        filesModified: 1,
        gitCommits: 1,
        hourHistogram: Array.from({ length: 24 }, (_, hour) => (hour === 10 ? 50 : hour === 15 ? 40 : hour)),
        daily,
        byHarness: [
          { harness: "claude-code", sessions: 30, activeMinutes: 900 },
          { harness: "codex", sessions: 20, activeMinutes: 600 },
        ],
        projects: Array.from({ length: 40 }, (_, index) => ({ projectPath: `/home/someone/code/project-${index}`, sessions: 40 - index, activeMinutes: 100 })),
        languages: counts("lang", 30),
        tools: counts("mcp__server__a_rather_long_tool_name", 120),
        toolCategories: counts("category", 11),
        toolErrors: counts("error", 9),
        responseTimeBuckets: ["<10s", "10-30s", "30s-1m", "1-5m", "5-15m", ">15m"].map((key, index) => ({ key, count: index * 3 })),
        medianResponseTimeSec: 42,
        parallelSessions: { overlapEvents: 12, maxConcurrent: 11, sessionsInvolved: 20 },
        features: {
          mcpServers: counts("server", 25),
          skills: counts("skill", 25),
          slashCommands: counts("command", 25),
          sessionsWithSubagents: 4,
          sessionsWithPlanMode: 0,
          sessionsWithWeb: 3,
          compactions: 68,
        },
      },
      usage: {
        tokens: 1250,
        input: 100,
        cachedInput: 900,
        cacheWrite: 50,
        output: 200,
        requests,
        estimatedUsd: options.estimatedUsd === undefined ? 0.42 : options.estimatedUsd,
        unpriced,
        daily: daily.map((entry) => ({ ...totals, day: entry.day })),
        models: Array.from({ length: 14 }, (_, index) => ({
          ...totals,
          tokens: 1_000_000 - index,
          harness: index % 2 === 0 ? ("claude-code" as const) : ("codex" as const),
          model: `model-${index}`,
          estimatedUsd: index < 2 && unpriced > 0 ? null : 1,
          unpriced: index < 2 ? unpriced : 0,
        })),
        cacheHitRate: 0.86,
        pricingVersion: "test",
      },
      findings: [
        {
          id: "repeated_failed_command:pnpm test",
          kind: "repeated_failed_command",
          severity: "medium",
          title: "`pnpm test` keeps failing",
          detail: "It failed in a row several times.",
          harnesses: ["claude-code"],
          evidence: [{ sessionId: input.sessions[0]?.id ?? "none", harness: "claude-code", note: "failed 4 times" }],
        },
      ],
      facets:
        facetCount > 0
          ? {
              sessionsWithFacets: facetCount,
              goalCategories: counts("goal", 17),
              sessionTypes: counts("type", 5),
              outcomes: counts("outcome", 6),
              helpfulness: counts("help", 5),
              satisfaction: counts("sat", 5),
              frictions: counts("friction", 12),
              successes: counts("success", 8),
            }
          : null,
      narrative: input.narrative ?? null,
    };
  };
}

export function fakeRenderReport(report: Report): string {
  return `<!doctype html><html><body><h1>AI Insights</h1><p>${report.activity.sessions} sessions</p></body></html>`;
}

export async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "ai-insights-test-"));
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}
