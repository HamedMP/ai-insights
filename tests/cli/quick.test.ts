import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { run, type CliDeps } from "../../src/cli/main.js";
import { SUMMARY_SCHEMA_VERSION } from "../../src/cli/summary-json.js";
import type { Session } from "../../src/schema/types.js";
import { fakeBuildReport, fakeRenderReport, fakeSource, makeSession, tempHome } from "../store/fixtures.js";

// `today`, `week`, `month` and `summary`, and the JSON other tools read (docs/summary-json.md).

let home: string;
let cleanup: () => Promise<void>;
let out: string;
let err: string;
beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  out = "";
  err = "";
});
afterEach(async () => cleanup());

const NOW = new Date("2026-11-18T15:42:00.000Z");
const compactions = (count: number) => ({ mcpServers: [], skills: [], slashCommands: [], subagents: 0, planMode: false, webSearch: false, webFetch: false, compactions: count });

function today(id: string, extra: Partial<Session> = {}): Session {
  return makeSession({
    id,
    sourceMtimeMs: Date.parse("2026-11-18T10:00:00.000Z"),
    projectPath: "/home/someone/code/secret-project",
    startTime: "2026-11-18T09:00:00.000Z",
    endTime: "2026-11-18T09:20:00.000Z",
    prompts: [
      { timestamp: "2026-11-18T09:00:00.000Z", text: "a private prompt about the launch" },
      { timestamp: "2026-11-18T09:08:00.000Z", text: "another private prompt" },
    ],
    toolCalls: [{ name: "Bash", category: "shell", timestamp: "2026-11-18T09:05:00.000Z", command: "pnpm deploy --token-file ~/keys" }],
    requests: [{ id: `${id}-r`, timestamp: "2026-11-18T09:10:00.000Z", model: "claude-opus-4-5", usage: { input: 1000, cachedInput: 5000, cacheWrite: 200, output: 300 } }],
    features: compactions(2),
    ...extra,
  });
}

function deps(sessions: Session[], overrides: Partial<CliDeps> = {}): Partial<CliDeps> {
  return {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { AI_INSIGHTS_HOME: home },
    sources: [
      fakeSource("claude-code", sessions.filter((session) => session.harness === "claude-code")),
      fakeSource("claude-chat", sessions.filter((session) => session.harness === "claude-chat")),
    ],
    buildReport: fakeBuildReport(),
    renderReport: fakeRenderReport,
    now: () => NOW,
    timeZone: "Europe/Helsinki",
    retentionPolicies: async () => new Map(),
    ...overrides,
  };
}

const history = () => [
  today("a"),
  today("b"),
  today("c"),
  makeSession({ id: "chat1", harness: "claude-chat", sourceMtimeMs: Date.parse("2026-11-17T10:00:00.000Z"), startTime: "2026-11-17T08:00:00.000Z", endTime: "2026-11-17T08:30:00.000Z", requests: [], toolCalls: [] }),
  makeSession({ id: "older", sourceMtimeMs: Date.parse("2026-11-03T10:00:00.000Z"), startTime: "2026-11-03T09:00:00.000Z", endTime: "2026-11-03T09:30:00.000Z" }),
];

const Tokens = z.strictObject({ input: z.number().int(), output: z.number().int(), cacheRead: z.number().int(), cacheWrite: z.number().int(), total: z.number().int() });
const Period = z.strictObject({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/),
  sessions: z.number().int().min(0),
  activeMinutes: z.number().int().min(0),
  prompts: z.number().int().min(0),
  tokens: Tokens.nullable(),
  costUsd: z.number().min(0).nullable(),
  unpricedRequestShare: z.number().min(0).max(1),
  byAgent: z.array(z.strictObject({ agent: z.string(), label: z.string(), sessions: z.number().int(), costUsd: z.number().nullable(), measured: z.boolean() })),
  byModel: z.array(z.strictObject({ model: z.string(), costUsd: z.number().nullable(), tokens: z.number().int() })),
  tip: z.strictObject({ id: z.string(), text: z.string() }).nullable(),
  byProject: z.array(z.strictObject({ project: z.string(), sessions: z.number().int(), activeMinutes: z.number().int(), costUsd: z.number().nullable() })).optional(),
  series: z.array(z.strictObject({ from: z.string(), to: z.string(), sessions: z.number(), activeMinutes: z.number(), prompts: z.number(), tokens: z.number().nullable(), costUsd: z.number().nullable() })).optional(),
});
const Summary = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  timezone: z.string(),
  periods: z.strictObject({ today: Period.optional(), week: Period.optional(), month: Period.optional(), range: Period.optional() }),
  reportPath: z.string().nullable(),
});

describe("summary --json, the contract other tools read", () => {
  it("has schema version 1 and exactly the documented fields for today, this week and this month", async () => {
    expect(await run(["summary", "--json"], deps(history()))).toBe(0);
    const json = Summary.parse(JSON.parse(out));
    expect(SUMMARY_SCHEMA_VERSION).toBe(1);
    expect(Object.keys(json.periods)).toEqual(["today", "week", "month"]);
    expect(json.timezone).toBe("Europe/Helsinki");
    expect(json.periods.today).toMatchObject({ from: "2026-11-18T00:00:00+02:00", to: "2026-11-18T17:42:00+02:00", sessions: 3, prompts: 6 });
    expect(json.periods.week!.from).toBe("2026-11-16T00:00:00+02:00");
    expect(json.periods.month!.from).toBe("2026-11-01T00:00:00+02:00");
    expect(json.periods.month!.sessions).toBe(5);
    expect(json.periods.today!.tip?.id).toBe("context_resets");
  });

  it("carries aggregates only: no prompts, commands, project names or paths, and no report path until one exists", async () => {
    await run(["summary", "--json"], deps(history()));
    expect(out).not.toMatch(/private prompt|secret-project|pnpm deploy|\/home\//);
    expect(JSON.parse(out).reportPath).toBeNull();
    out = "";
    await mkdir(join(home, "reports"), { recursive: true });
    await writeFile(join(home, "reports", "report.html"), "<html></html>");
    await run(["summary", "--json"], deps(history()));
    expect(JSON.parse(out).reportPath).toBe(join(home, "reports", "report.html"));
  });

  it("shows chat exports as not measured, never as 0 or an estimate", async () => {
    await run(["week", "--json"], deps(history()));
    const week = Summary.parse(JSON.parse(out)).periods.week!;
    expect(week.byAgent.find((row) => row.agent === "claude-chat")).toEqual({ agent: "claude-chat", label: "claude-chat", sessions: 1, costUsd: null, measured: false });
    out = "";
    await run(["week", "--json", "--harness", "claude-chat"], deps(history()));
    const chatOnly = Summary.parse(JSON.parse(out)).periods.week!;
    expect(chatOnly.tokens).toBeNull();
    expect(chatOnly.costUsd).toBeNull();
  });

  it("names projects only when --by project is given", async () => {
    await run(["today", "--json", "--by", "project"], deps(history()));
    expect(Summary.parse(JSON.parse(out)).periods.today!.byProject).toEqual([{ project: "secret-project", sessions: 3, activeMinutes: 20, costUsd: expect.any(Number) }]);
  });

  it("adds one row per period for --last and --since, under the same version", async () => {
    await run(["today", "--json", "--last", "3"], deps(history()));
    const last = Summary.parse(JSON.parse(out)).periods.today!;
    expect(last.from).toBe("2026-11-16T00:00:00+02:00");
    expect(last.series!.map((row) => row.from.slice(0, 10))).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    out = "";
    await run(["week", "--json", "--since", "2026-11-01", "--until", "2026-11-10"], deps(history()));
    const range = Summary.parse(JSON.parse(out)).periods.range!;
    expect(range).toMatchObject({ from: "2026-11-01T00:00:00+02:00", to: "2026-11-11T00:00:00+02:00", sessions: 1 });
  });
});

describe("the quick views in a terminal", () => {
  it("lead with the tip, then the numbers and an honest cost", async () => {
    expect(await run(["today"], deps(history()))).toBe(0);
    const tip = out.indexOf("Tip");
    expect(tip).toBeGreaterThan(-1);
    expect(tip).toBeLessThan(out.indexOf("3 sessions"));
    expect(out).toContain("Sessions ran out of context today.");
    expect(out).toMatch(/at API list prices/);
    expect(out).not.toMatch(/\u001b\[/);
    expect(out.split("\n").every((line) => line.length < 100)).toBe(true);
  });

  it("leave the cost out with --no-cost", async () => {
    await run(["week", "--no-cost"], deps(history()));
    expect(out).not.toMatch(/\$|list prices|Cost/);
    out = "";
    await run(["summary", "--no-cost"], deps(history()));
    expect(out).not.toMatch(/\$|list prices|Cost/);
  });

  it("say an agent that records no usage recorded none, rather than unpriced or $0", async () => {
    const quiet = makeSession({ id: "cur", harness: "cursor", sourceMtimeMs: Date.parse("2026-11-17T10:00:00.000Z"), startTime: "2026-11-17T08:00:00.000Z", endTime: "2026-11-17T08:30:00.000Z", requests: [] });
    await run(["week"], deps([...history()], { sources: [fakeSource("cursor", [quiet], { label: "Cursor" }), fakeSource("claude-code", history().filter((s) => s.harness === "claude-code"))] }));
    expect(out).toMatch(/Cursor\s+1\s+no usage recorded/);
  });

  it("show chat exports as not measured", async () => {
    await run(["week"], deps(history()));
    expect(out).toMatch(/claude-chat\s+1\s+not measured/);
  });

  it("show today, this week and this month side by side for summary", async () => {
    await run(["summary"], deps(history()));
    expect(out).toMatch(/Today\s+This week\s+This month/);
    expect(out).toMatch(/Sessions\s+3\s+4\s+5/);
  });

  it("write no report", async () => {
    await run(["month"], deps(history()));
    await expect(import("node:fs/promises").then((fs) => fs.stat(join(home, "reports", "report.html")))).rejects.toThrow();
  });
});

describe("quick view options", () => {
  it.each([
    [["today", "--last", "0"], /--last must be a whole number/],
    [["today", "--by", "repo"], /--by must be project, model or agent/],
    [["today", "--since", "30d"], /--since must be a day/],
    [["today", "--until", "nope"], /--until must be a day/],
    [["summary", "--last", "2"], /does not work with `ai-insights summary`/],
    [["report", "--by", "model"], /only works with `ai-insights today`/],
    [["today", "--last", "2", "--since", "2026-11-01"], /not both/],
    [["today", "--since", "2026-11-10", "--until", "2026-11-01"], /before --since/],
  ])("rejects %j", async (argv, message) => {
    expect(await run(argv, deps(history()))).toBe(2);
    expect(err).toMatch(message);
  });
});
