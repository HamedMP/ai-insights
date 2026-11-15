import type {
  Coverage,
  Harness,
  ModelRequest,
  Session,
  SessionFacet,
  ToolCall,
  ToolCategory,
  ToolErrorCategory,
  UserPrompt,
} from "../../src/schema/types.js";

/** Fixed reference instant so every test is deterministic. */
export const NOW = new Date("2026-06-30T12:00:00Z");
const BASE = Date.parse("2026-06-01T09:00:00Z");

export function at(minutesFromBase: number): string {
  return new Date(BASE + minutesFromBase * 60_000).toISOString();
}

export function day(dayOffset: number, minute = 0): string {
  return at(dayOffset * 24 * 60 + minute);
}

let counter = 0;

const VERBS = ["add", "fix", "rename", "remove", "document", "speed", "refactor"];
const NOUNS = ["toggle", "parser", "cache", "router", "login", "exporter", "scheduler", "uploader", "theme", "search", "billing"];
const PLACES = ["settings", "dashboard", "cli", "api", "worker", "sidebar", "onboarding", "reports", "admin"];

/** A distinct, ordinary task prompt per call, so healthy sessions never look like repeated instructions. */
export function task(): string {
  counter += 1;
  const n = counter;
  return `${VERBS[n % VERBS.length]} ${NOUNS[Math.floor(n / VERBS.length) % NOUNS.length]} ${PLACES[Math.floor(n / (VERBS.length * NOUNS.length)) % PLACES.length]} module`;
}

export function request(overrides: Partial<ModelRequest> & { usage?: Partial<ModelRequest["usage"]> } = {}): ModelRequest {
  counter += 1;
  const { usage, ...rest } = overrides;
  return {
    id: `req-${counter}`,
    timestamp: at(0),
    model: "claude-sonnet-4-6",
    ...rest,
    usage: { input: 100, cachedInput: 900, cacheWrite: 0, output: 50, ...usage },
  };
}

export function tool(
  category: ToolCategory,
  overrides: Partial<ToolCall> & { error?: ToolErrorCategory } = {},
): ToolCall {
  const names: Record<ToolCategory, string> = {
    shell: "Bash",
    read: "Read",
    edit: "Edit",
    search: "Grep",
    web: "WebFetch",
    subagent: "Task",
    mcp: "mcp__github__get_issue",
    skill: "Skill",
    plan: "ExitPlanMode",
    ask_user: "AskUserQuestion",
    other: "TodoWrite",
  };
  return { name: names[category], category, timestamp: at(0), ...overrides };
}

export function shell(command: string, error?: ToolErrorCategory, timestamp = at(0)): ToolCall {
  return tool("shell", { command, timestamp, ...(error ? { error } : {}) });
}

export function prompt(text: string, timestamp = at(0), interrupted = false): UserPrompt {
  return { text, timestamp, ...(interrupted ? { interrupted } : {}) };
}

/** A healthy, ordinary session: a handful of prompts, some reads and edits, a test run, a commit. */
export function session(overrides: Partial<Session> = {}): Session {
  counter += 1;
  const id = overrides.id ?? `session-${counter}`;
  const startTime = overrides.startTime ?? at(0);
  const start = Date.parse(startTime);
  const plus = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
  const harness: Harness = overrides.harness ?? "claude-code";
  return {
    id,
    harness,
    sourcePath: `/synthetic/${harness}/${id}.jsonl`,
    sourceMtimeMs: start,
    projectPath: "/synthetic/project",
    gitBranch: "main",
    startTime,
    endTime: plus(30),
    durationMinutes: 30,
    activeMinutes: 25,
    models: ["claude-sonnet-4-6"],
    permissionMode: "default",
    userMessageCount: 3,
    assistantMessageCount: 6,
    prompts: [
      prompt(task(), plus(0)),
      prompt(task(), plus(10)),
      prompt("commit it", plus(25)),
    ],
    userResponseTimesSec: [20, 45],
    requests: [request({ timestamp: plus(1) }), request({ timestamp: plus(11) }), request({ timestamp: plus(26) })],
    toolCalls: [
      tool("read", { timestamp: plus(1), filePath: "/synthetic/project/src/settings.ts" }),
      tool("edit", { timestamp: plus(2), filePath: "/synthetic/project/src/settings.ts" }),
      tool("edit", { timestamp: plus(12), filePath: "/synthetic/project/tests/settings.test.ts" }),
      shell("pnpm test", undefined, plus(13)),
      shell("git commit -m 'feat: dark mode'", undefined, plus(26)),
    ],
    features: {
      mcpServers: [],
      skills: [],
      slashCommands: [],
      subagents: 0,
      planMode: false,
      webSearch: false,
      webFetch: false,
      compactions: 0,
    },
    linesAdded: 40,
    linesRemoved: 5,
    filesModified: ["/synthetic/project/src/settings.ts", "/synthetic/project/tests/settings.test.ts"],
    languages: { TypeScript: 3 },
    gitCommits: 1,
    gitPushes: 0,
    issues: 0,
    ...overrides,
  };
}

/** Sessions spread one per day, so cross-day detectors see a real spread. */
export function sessionsOverDays(count: number, make: (index: number) => Partial<Session> = () => ({})): Session[] {
  return Array.from({ length: count }, (_, index) => session({ startTime: day(index), ...make(index) }));
}

export function coverage(harness: Harness, sessions: number, found = sessions > 0): Coverage {
  return {
    harness,
    label: harness === "claude-code" ? "Claude Code" : harness,
    found,
    files: sessions,
    sessions,
    issues: 0,
    oldest: null,
    newest: null,
  };
}

export function facet(sessionId: string, overrides: Partial<SessionFacet> = {}): SessionFacet {
  return {
    sessionId,
    harness: "claude-code",
    underlyingGoal: "Add a settings toggle",
    goalCategories: ["feature"],
    sessionType: "single_task",
    outcome: "fully_achieved",
    helpfulness: "very_helpful",
    satisfaction: "satisfied",
    primarySuccess: "correct_code_edits",
    frictions: {},
    frictionDetail: "",
    summary: "Added the toggle and a test.",
    ...overrides,
  };
}
