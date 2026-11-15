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

/** A stand-in for the analysis module: records what it was given and returns a minimal report. */
export function fakeBuildReport(calls: BuildReportInput[] = []) {
  return (input: BuildReportInput): Report => {
    calls.push(input);
    const daily = Array.from({ length: 400 }, (_, index) => ({ day: `day-${index}`, sessions: 1, userMessages: 2, activeMinutes: 3 }));
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
        userMessages: 3,
        assistantMessages: 5,
        linesAdded: 10,
        linesRemoved: 2,
        filesModified: 1,
        gitCommits: 1,
        hourHistogram: new Array(24).fill(0),
        daily,
        byHarness: [],
        projects: [],
        languages: [],
        tools: [],
        toolCategories: [],
        toolErrors: [],
        responseTimeBuckets: [],
        medianResponseTimeSec: null,
        parallelSessions: { overlapEvents: 0, maxConcurrent: 1, sessionsInvolved: 0 },
        features: { mcpServers: [], skills: [], slashCommands: [], sessionsWithSubagents: 0, sessionsWithPlanMode: 0, sessionsWithWeb: 0, compactions: 0 },
      },
      usage: {
        tokens: 1250,
        input: 100,
        cachedInput: 900,
        cacheWrite: 50,
        output: 200,
        requests: 1,
        estimatedUsd: 0.42,
        unpriced: 0,
        daily: [],
        models: [],
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
      facets: input.facets && input.facets.length > 0 ? { sessionsWithFacets: input.facets.length, goalCategories: [], sessionTypes: [], outcomes: [], helpfulness: [], satisfaction: [], frictions: [], successes: [] } : null,
      narrative: input.narrative ?? null,
    };
  };
}

export function fakeRenderReport(report: Report): string {
  return `<!doctype html><html><body><h1>Hindsight</h1><p>${report.activity.sessions} sessions</p></body></html>`;
}

export async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "hindsight-test-"));
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}
