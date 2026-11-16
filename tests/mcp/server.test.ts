import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DRIVERS, GOAL_CATEGORIES, OUTCOMES, type BuildReportInput, type Report, type Session, type TranscriptTurn } from "../../src/schema/types.js";
import { createServer } from "../../src/mcp/server.js";
import { MAX_OUTPUT_CHARS } from "../../src/mcp/bound.js";
import { Store } from "../../src/store/store.js";
import { fakeBuildReport, fakeRenderReport, fakeSource, makeSession, tempHome, validFacet, validNarrative, type FakeSource } from "../store/fixtures.js";

let home: string;
let cleanup: () => Promise<void>;
let client: Client;
let claude: FakeSource;
let codex: FakeSource;
let buildCalls: BuildReportInput[];

async function connect(overrides: { buildReport?: (input: BuildReportInput) => Report } = {}) {
  const server = createServer({
    sources: [claude, codex],
    store: new Store(home),
    buildReport: overrides.buildReport ?? fakeBuildReport(buildCalls),
    renderReport: fakeRenderReport,
    now: () => new Date("2026-11-15T12:00:00Z"),
    timeZone: "UTC",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const next = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), next.connect(clientTransport)]);
  return next;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { isError: result.isError === true, text, json };
}

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  buildCalls = [];
  claude = fakeSource("claude-code", [
    makeSession({ id: "c1", sourceMtimeMs: 3, startTime: "2026-10-03T09:00:00.000Z", endTime: "2026-10-03T10:00:00.000Z" }),
    makeSession({ id: "c2", sourceMtimeMs: 2, startTime: "2026-10-02T09:00:00.000Z", projectPath: "/home/someone/code/secret-app" }),
  ]);
  codex = fakeSource("codex", [makeSession({ id: "x1", harness: "codex", sourceMtimeMs: 1, startTime: "2026-10-01T09:00:00.000Z" })]);
  client = await connect();
});
afterEach(async () => {
  await client.close();
  await cleanup();
});

describe("tool listing", () => {
  it("offers the seven tools, each with an input schema and a description an agent can act on", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "hindsight_excerpt",
      "hindsight_render",
      "hindsight_report",
      "hindsight_save_facets",
      "hindsight_save_narrative",
      "hindsight_scan",
      "hindsight_sessions",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description!.length).toBeGreaterThan(80);
    }
    const save = tools.find((tool) => tool.name === "hindsight_save_facets")!;
    for (const value of [...GOAL_CATEGORIES, ...OUTCOMES, ...DRIVERS]) expect(save.description).toContain(value);
    expect(save.description).toContain("drivenBy");
  });
});

describe("hindsight_scan", () => {
  it("returns coverage for every harness and headline numbers", async () => {
    const { json, isError } = await call("hindsight_scan");
    expect(isError).toBe(false);
    expect(json.coverage).toHaveLength(5);
    expect(json.coverage.find((entry: any) => entry.harness === "codex")).toMatchObject({ found: true, sessions: 1, bytes: 100 });
    expect(json.coverage.find((entry: any) => entry.harness === "claude-code")).toMatchObject({ bytes: 200 });
    expect(json.coverage.find((entry: any) => entry.harness === "pi")).toMatchObject({ found: false });
    expect(json.headline).toMatchObject({ sessions: 3, toolErrors: 3 });
    expect(json.facets).toMatchObject({ saved: 0, missing: 3, toJudge: 3 });
    expect(json.analysis).toMatchObject({ findings: 1, estimatedUsd: 0.42 });
  });

  it("still answers when the analysis module fails", async () => {
    await client.close();
    client = await connect({ buildReport: () => { throw new Error("not implemented at /home/someone/x.ts"); } });
    const { json, isError } = await call("hindsight_scan");
    expect(isError).toBe(false);
    expect(json.analysis).toBeNull();
    expect(json.headline.sessions).toBe(3);
  });

  it("rejects an unreadable since with a message saying what is accepted", async () => {
    const { isError, text } = await call("hindsight_scan", { since: "last tuesday" });
    expect(isError).toBe(true);
    expect(text).toContain("30d");
  });

  it("filters by harness", async () => {
    const { json } = await call("hindsight_scan", { harness: "codex" });
    expect(json.headline.sessions).toBe(1);
  });
});

describe("hindsight_report", () => {
  it("serves every section the skills ask for, including the facet aggregate and narrative", async () => {
    await call("hindsight_save_facets", { facets: [validFacet("c1")] });
    await call("hindsight_save_narrative", { narrative: validNarrative() });
    const { json } = await call("hindsight_report", { sections: ["findings", "activity", "usage", "facets", "narrative"] });
    expect(Object.keys(json).sort()).toEqual(["activity", "facets", "findings", "narrative", "usage"]);
    expect(json.facets.sessionsWithFacets).toBe(1);
    expect(json.narrative.headline).toBe(validNarrative().headline);
  });

  it("returns only the requested sections", async () => {
    const { json } = await call("hindsight_report", { sections: ["usage"] });
    expect(Object.keys(json)).toEqual(["usage"]);
    expect(json.usage.estimatedUsd).toBe(0.42);
  });

  it("defaults to summary and findings, and scans on first use", async () => {
    const { json } = await call("hindsight_report");
    expect(Object.keys(json).sort()).toEqual(["findings", "summary"]);
    expect(json.summary.sessions).toBe(3);
    expect(json.findings[0].id).toBe("repeated_failed_command:pnpm test");
  });

  it("keeps today's full shape with detail: full, daily series cut to the requested recent days", async () => {
    const { json, text } = await call("hindsight_report", { sections: ["activity", "usage"], detail: "full", days: 7 });
    expect(json.activity.daily).toHaveLength(7);
    expect(json.activity.daily.at(-1).day).toBe("2026-11-04");
    expect(json.activity.tools.length).toBeGreaterThan(50);
    expect(json.usage.daily).toHaveLength(7);
    expect(text.length).toBeLessThan(MAX_OUTPUT_CHARS);
  });

  it("returns a digest by default so facets, activity and usage together fit the narrative step", async () => {
    await call("hindsight_save_facets", { facets: [validFacet("c1"), validFacet("c2")] });
    const { json, text } = await call("hindsight_report", { sections: ["facets", "activity", "usage"] });
    expect(text.length).toBeLessThanOrEqual(3_000);
    expect(json.activity.daily).toBeUndefined();
    expect(json.activity.weekly.length).toBeGreaterThan(0);
    expect(json.activity.weekly.length).toBeLessThanOrEqual(12);
    expect(json.activity.weekly.at(-1).week).toBe("2026-11-02");
    expect(json.usage.weekly.at(-1).week).toBe("2026-11-02");
    expect(Object.keys(json.activity.tools)).toHaveLength(8);
    expect(json.activity.tools["mcp__server__a_rather_long_tool_name-0"]).toBe(1_000);
    expect(json.facets.sessionsWithFacets).toBe(2);
    expect(Object.keys(json.facets.goalCategories).length).toBeLessThanOrEqual(6);
    expect(Object.keys(json.usage.models)).toHaveLength(5);
    expect(json.usage.models["model-0"]).toEqual({ tokens: 1_000_000, usd: 1 });
  });

  it("puts honest headline numbers in the summary: wall-clock hours, agent-hours, and the unpriced share", async () => {
    await client.close();
    client = await connect({ buildReport: fakeBuildReport(buildCalls, { wallClockActiveMinutes: 30, estimatedUsd: 1_633, requests: 100, unpriced: 13 }) });
    const { json } = await call("hindsight_report", { sections: ["summary"] });
    expect(json.summary).toMatchObject({ activeHours: 0.5, agentHours: 1.3, cost: "about $1,633 for the requests we can price; 13% unpriced" });
    expect(json.summary.unpricedShare).toBeCloseTo(0.13);
  });

  it("returns a short, safe error when the analysis fails", async () => {
    await client.close();
    client = await connect({ buildReport: () => { throw new Error("boom at /home/someone/private/file.ts:12"); } });
    const { isError, text } = await call("hindsight_report");
    expect(isError).toBe(true);
    expect(text).not.toContain("/home/someone");
    expect(text).not.toMatch(/at .*:\d+/);
  });
});

describe("hindsight_sessions", () => {
  it("lists sessions newest first with paging", async () => {
    const first = await call("hindsight_sessions", { limit: 2 });
    expect(first.json.total).toBe(3);
    expect(first.json.sessions.map((session: any) => session.sessionId)).toEqual(["c1", "c2"]);
    expect(first.json.sessions[0]).toMatchObject({ sessionId: "c1", harness: "claude-code" });
    expect(first.json.nextOffset).toBe(2);
    const second = await call("hindsight_sessions", { limit: 2, offset: 2 });
    expect(second.json.sessions.map((session: any) => session.sessionId)).toEqual(["x1"]);
    expect(second.json.nextOffset).toBeNull();
  });

  it("shows a short project name rather than a full home path", async () => {
    const { json } = await call("hindsight_sessions");
    const c2 = json.sessions.find((session: any) => session.sessionId === "c2");
    expect(c2.project).toBe("code/secret-app");
  });

  it("names a worktree session by its repository root, in listings and excerpts alike", async () => {
    const main = join(home, "code", "big-repo");
    const admin = join(main, ".git", "worktrees", "feat");
    const worktree = join(home, "code", "big-repo-wt", "feat");
    await mkdir(admin, { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, ".git"), `gitdir: ${admin}\n`);
    await writeFile(join(admin, "commondir"), "../..\n");
    claude.sessions = [...claude.sessions, makeSession({ id: "w1", sourceMtimeMs: 4, projectPath: worktree })];

    const { json } = await call("hindsight_sessions");
    expect(json.sessions.find((session: any) => session.sessionId === "w1").project).toBe("code/big-repo");
    const excerpt = await call("hindsight_excerpt", { sessionId: "w1", harness: "claude-code" });
    expect(excerpt.json.session.project).toBe("code/big-repo");
  });

  it("filters to sessions still missing facets", async () => {
    await call("hindsight_save_facets", { facets: [validFacet("c1")] });
    const { json } = await call("hindsight_sessions", { missingFacets: true });
    expect(json.sessions.map((session: any) => session.sessionId).sort()).toEqual(["c2", "x1"]);
    const all = await call("hindsight_sessions");
    expect(all.json.sessions.find((session: any) => session.sessionId === "c1").hasFacet).toBe(true);
  });
});

describe("hindsight_excerpt", () => {
  it("returns redacted, truncated turns from the right transcript", async () => {
    const { json, isError } = await call("hindsight_excerpt", { sessionId: "c2", maxCharsPerTurn: 200 });
    expect(isError).toBe(false);
    expect(claude.excerptCalls[0]!.path).toBe("/fake/claude-code/c2.jsonl");
    expect(json.session).toMatchObject({ sessionId: "c2", harness: "claude-code" });
    expect(json.turns[0].text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(json.turns[2].text.length).toBeLessThanOrEqual(200);
    expect(json.turns[2]).toMatchObject({ role: "tool", toolName: "Bash", isError: true });
  });

  it("explains how to find ids when the session is unknown", async () => {
    const { isError, text } = await call("hindsight_excerpt", { sessionId: "nope" });
    expect(isError).toBe(true);
    expect(text).toContain("hindsight_sessions");
  });

  it("rejects ids that could be used to reach other files", async () => {
    const { isError, text } = await call("hindsight_excerpt", { sessionId: "../../etc/passwd" });
    expect(isError).toBe(true);
    expect(text).not.toContain("/etc/passwd");
  });

  it("hides the source's error details when reading the transcript fails", async () => {
    claude.excerpt = async () => { throw new Error("ENOENT: /home/someone/.claude/projects/x.jsonl"); };
    const { isError, text } = await call("hindsight_excerpt", { sessionId: "c1" });
    expect(isError).toBe(true);
    expect(text).not.toContain("/home/someone");
  });
});

describe("hindsight_save_facets", () => {
  it("saves valid facets and rejects bad ones in the same batch with fixable messages", async () => {
    const bad = { ...validFacet("c2"), outcome: "nailed_it" };
    const unknown = validFacet("ghost");
    const { json, isError } = await call("hindsight_save_facets", { facets: [validFacet("c1"), bad, unknown] });
    expect(isError).toBe(false);
    expect(json.saved).toEqual(["c1"]);
    expect(json.rejected).toHaveLength(2);
    expect(json.rejected[0].error).toContain("outcome");
    for (const value of OUTCOMES) expect(json.rejected[0].error).toContain(value);
    expect(json.rejected[1].error).toContain("hindsight_sessions");
    expect(json.sessionsStillMissingFacets).toBe(2);
    expect(await new Store(home).readFacet("claude-code", "c1")).toEqual(validFacet("c1"));
  });

  it("marks the call as an error when nothing could be saved", async () => {
    const { isError, json } = await call("hindsight_save_facets", { facets: [{ sessionId: "c1" }] });
    expect(isError).toBe(true);
    expect(json.rejected[0].error).toContain("harness");
  });

  it("caps the batch size", async () => {
    const facets = Array.from({ length: 51 }, () => validFacet("c1"));
    const { isError } = await call("hindsight_save_facets", { facets });
    expect(isError).toBe(true);
  });

  it("feeds saved facets into the report", async () => {
    await call("hindsight_save_facets", { facets: [validFacet("c1"), validFacet("x1", "codex")] });
    const { json } = await call("hindsight_report", { sections: ["summary"] });
    expect(json.summary.sessionsWithFacets).toBe(2);
    expect(buildCalls.at(-1)!.facets).toHaveLength(2);
  });
});

describe("hindsight_save_narrative and hindsight_render", () => {
  it("rejects an invalid narrative with the field at fault", async () => {
    const { isError, text } = await call("hindsight_save_narrative", { narrative: { ...validNarrative(), headline: "" } });
    expect(isError).toBe(true);
    expect(text).toContain("headline");
  });

  it("renders with the saved narrative and returns a path and file URL", async () => {
    await call("hindsight_save_narrative", { narrative: validNarrative() });
    const { json, isError } = await call("hindsight_render");
    expect(isError).toBe(false);
    expect(json.path).toMatch(/reports\/report\.html$/);
    expect(json.url).toMatch(/^file:\/\//);
    expect(json.hasNarrative).toBe(true);
    expect(json.topFindings[0].title).toContain("pnpm test");
    expect(await readFile(json.path, "utf8")).toContain("3 sessions");
    expect(buildCalls.at(-1)!.narrative?.headline).toBe(validNarrative().headline);
  });

  it("returns a safe error when rendering fails", async () => {
    await client.close();
    client = await connect({ buildReport: () => { throw new Error("secret /home/someone/path"); } });
    const { isError, text } = await call("hindsight_render");
    expect(isError).toBe(true);
    expect(text).not.toContain("/home/someone");
  });
});

const NOW = Date.parse("2026-11-15T12:00:00Z");

/** `count` sessions for one harness, one per day going back from `newestDay` days before now. */
function history(harness: "claude-code" | "codex", prefix: string, count: number, newestDay = 1, overrides: Partial<Session> = {}): Session[] {
  return Array.from({ length: count }, (_, index) => {
    const start = NOW - (newestDay + index) * 86_400_000;
    return makeSession({
      id: `${prefix}${index}`,
      harness,
      sourceMtimeMs: start + 3_600_000,
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + 3_600_000).toISOString(),
      ...overrides,
    });
  });
}

const ids = (json: any) => json.sessions.map((session: any) => session.sessionId);

describe("hindsight_sessions: choosing which sessions get facets", () => {
  it("spreads the missing-facet listing across harnesses and the whole time range by default", async () => {
    claude.sessions = history("claude-code", "c", 20, 1);
    codex.sessions = history("codex", "x", 4, 40);
    const { json } = await call("hindsight_sessions", { missingFacets: true, limit: 6 });
    expect(json.strategy).toBe("spread");
    const picked: string[] = ids(json);
    expect(picked).toHaveLength(6);
    expect(picked.filter((id) => id.startsWith("x")).length).toBeGreaterThanOrEqual(1);
    expect(picked.filter((id) => id.startsWith("c")).length).toBeGreaterThanOrEqual(4);
    expect(picked).toContain("c0");
    expect(picked).toContain("c19");
  });

  it("gives every harness with sessions at least one slot, even a small one", async () => {
    claude.sessions = history("claude-code", "c", 50, 1);
    codex.sessions = history("codex", "x", 1, 3);
    const { json } = await call("hindsight_sessions", { missingFacets: true, limit: 3 });
    expect(ids(json)).toContain("x0");
  });

  it("pages through the spread order without repeats", async () => {
    claude.sessions = history("claude-code", "c", 10, 1);
    codex.sessions = history("codex", "x", 5, 2);
    const first = await call("hindsight_sessions", { missingFacets: true, limit: 4 });
    const second = await call("hindsight_sessions", { missingFacets: true, limit: 4, offset: 4 });
    const whole = await call("hindsight_sessions", { missingFacets: true, limit: 8 });
    expect([...ids(first.json), ...ids(second.json)]).toEqual(ids(whole.json));
    expect(new Set(ids(whole.json)).size).toBe(8);
  });

  it("still offers newest first on request, and lists newest first when not choosing facets", async () => {
    claude.sessions = history("claude-code", "c", 10, 1);
    codex.sessions = history("codex", "x", 5, 40);
    const newest = await call("hindsight_sessions", { missingFacets: true, strategy: "newest", limit: 3 });
    expect(newest.json.strategy).toBe("newest");
    expect(ids(newest.json)).toEqual(["c0", "c1", "c2"]);
    const plain = await call("hindsight_sessions", { limit: 3 });
    expect(plain.json.strategy).toBe("newest");
    expect(ids(plain.json)).toEqual(["c0", "c1", "c2"]);
  });

  it("skips sessions with fewer than two prompts by default when choosing facets, and says so", async () => {
    claude.sessions = [...history("claude-code", "c", 2, 1), ...history("claude-code", "one", 1, 5, { userMessageCount: 1 })];
    codex.sessions = [];
    const { json } = await call("hindsight_sessions", { missingFacets: true });
    expect(ids(json).sort()).toEqual(["c0", "c1"]);
    expect(json.skipped.fewPrompts).toBe(1);
    expect(json.skippedReasons.join(" ")).toContain("fewer than 2");
    const all = await call("hindsight_sessions", { missingFacets: true, minUserMessages: 0 });
    expect(ids(all.json)).toContain("one0");
  });

  it("marks sessions whose transcript changed in the last ten minutes as live and leaves them out of facet work", async () => {
    const live = makeSession({ id: "running", sourceMtimeMs: NOW - 5 * 60_000, startTime: new Date(NOW - 3_600_000).toISOString() });
    claude.sessions = [live, ...history("claude-code", "c", 2, 1)];
    codex.sessions = [];
    const listing = await call("hindsight_sessions", { missingFacets: true });
    expect(ids(listing.json)).not.toContain("running");
    expect(listing.json.skipped.live).toBe(1);
    expect(listing.json.skippedReasons.join(" ")).toContain("still running");
    const included = await call("hindsight_sessions", { missingFacets: true, includeLive: true });
    expect(included.json.sessions.find((row: any) => row.sessionId === "running").live).toBe(true);
    const plain = await call("hindsight_sessions");
    expect(plain.json.sessions.find((row: any) => row.sessionId === "running").live).toBe(true);
    expect(plain.json.sessions.find((row: any) => row.sessionId === "c0").live).toBe(false);
  });

  it("leaves out sessions that were only slash commands", async () => {
    const slashOnly = makeSession({
      id: "slash",
      prompts: [
        { timestamp: "2026-11-10T09:00:00.000Z", text: "/mcp" },
        { timestamp: "2026-11-10T09:01:00.000Z", text: "  /insights" },
      ],
    });
    claude.sessions = [slashOnly, ...history("claude-code", "c", 2, 1)];
    codex.sessions = [];
    const { json } = await call("hindsight_sessions", { missingFacets: true });
    expect(ids(json)).not.toContain("slash");
    expect(json.skipped.slashCommandOnly).toBe(1);
    expect(json.skippedReasons.join(" ")).toContain("slash command");
    const included = await call("hindsight_sessions", { missingFacets: true, includeSlashCommandOnly: true });
    expect(ids(included.json)).toContain("slash");
  });

  it("flags sessions driven more by other agents than by the person", async () => {
    claude.sessions = [
      makeSession({ id: "driven", userMessageCount: 2, agentMessageCount: 7 }),
      makeSession({ id: "human", sourcePath: "/fake/h.jsonl", userMessageCount: 5, agentMessageCount: 1 }),
      makeSession({ id: "legacy", sourcePath: "/fake/l.jsonl" }),
    ];
    codex.sessions = [];
    const { json } = await call("hindsight_sessions");
    const row = (id: string) => json.sessions.find((session: any) => session.sessionId === id);
    expect(row("driven").agentDriven).toBe(true);
    expect(row("human").agentDriven).toBe(false);
    expect(row("legacy").agentDriven).toBe(false);
  });
});

function turns(count: number, make: (index: number) => TranscriptTurn): TranscriptTurn[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

describe("hindsight_excerpt: size", () => {
  it("defaults to about 4,000 characters in total", async () => {
    claude.excerpt = async () =>
      turns(60, (index) => ({
        timestamp: new Date(NOW + index * 1000).toISOString(),
        role: index % 3 === 0 ? "user" : index % 3 === 1 ? "assistant" : "tool",
        text: `${index} `.padEnd(2_000, "word "),
        ...(index % 3 === 2 ? { toolName: "Bash" } : {}),
      }));
    const { json, text } = await call("hindsight_excerpt", { sessionId: "c1" });
    const total = json.turns.reduce((sum: number, turn: any) => sum + turn.text.length, 0);
    expect(text.length).toBeLessThanOrEqual(4_000);
    expect(text.length).toBeGreaterThan(3_200);
    expect(total).toBeGreaterThan(1_500);
  });

  it("spends the budget on what the person said, errors and the last reply before routine tool output", async () => {
    claude.excerpt = async () => [
      { timestamp: "2026-11-15T10:00:00Z", role: "user", text: "please make the build green" },
      ...turns(30, (index) => ({ timestamp: `2026-11-15T10:0${index % 10}:00Z`, role: "tool" as const, toolName: "Bash", text: "x".repeat(1_500) })),
      { timestamp: "2026-11-15T10:20:00Z", role: "tool", toolName: "Bash", isError: true, text: "Error: tests failed in auth.spec" },
      { timestamp: "2026-11-15T10:21:00Z", role: "agent", text: "Orchestrator note: rebase on main" },
      { timestamp: "2026-11-15T10:30:00Z", role: "assistant", text: "All green now." },
    ];
    const { json } = await call("hindsight_excerpt", { sessionId: "c1", maxTurns: 80 });
    const texts = json.turns.map((turn: any) => turn.text);
    expect(texts).toContain("please make the build green");
    expect(texts).toContain("Error: tests failed in auth.spec");
    expect(texts).toContain("All green now.");
    expect(json.turns.find((turn: any) => turn.role === "agent").text).toBe("Orchestrator note: rebase on main");
    const total = texts.reduce((sum: number, value: string) => sum + value.length, 0);
    expect(total).toBeLessThanOrEqual(4_000);
  });

  it("lets the caller ask for more", async () => {
    claude.excerpt = async () => turns(10, (index) => ({ timestamp: `2026-11-15T10:0${index}:00Z`, role: "user", text: "y".repeat(3_000) }));
    const { json } = await call("hindsight_excerpt", { sessionId: "c1", maxTurns: 10, maxCharsPerTurn: 3_000 });
    const total = json.turns.reduce((sum: number, turn: any) => sum + turn.text.length, 0);
    expect(total).toBeGreaterThan(20_000);
    const capped = await call("hindsight_excerpt", { sessionId: "c1", maxChars: 1_500 });
    expect(capped.text.length).toBeLessThanOrEqual(1_500);
  });
});

describe("headline numbers", () => {
  it("scan reports wall-clock hours, agent-hours and the unpriced share", async () => {
    await client.close();
    client = await connect({ buildReport: fakeBuildReport(buildCalls, { wallClockActiveMinutes: 30, estimatedUsd: 10, requests: 10, unpriced: 5 }) });
    const { json } = await call("hindsight_scan");
    expect(json.headline.agentHours).toBe(1.3);
    expect(json.headline.activeHours).toBeUndefined();
    expect(json.analysis).toMatchObject({ activeHours: 0.5, agentHours: 1.3, cost: "about $10.00 for the requests we can price; 50% unpriced" });
  });

  it("render returns the same honest headline", async () => {
    await client.close();
    client = await connect({ buildReport: fakeBuildReport(buildCalls, { estimatedUsd: 10, requests: 10, unpriced: 1 }) });
    const { json } = await call("hindsight_render");
    expect(json.headline).toMatchObject({ activeHours: null, agentHours: 1.3, time: "1.3 agent-hours", cost: "about $10.00 for the requests we can price; 10% unpriced" });
  });
});

describe("returning users and what is left to judge", () => {
  function mixedHistory() {
    const running = makeSession({ id: "running", sourceMtimeMs: NOW - 5 * 60_000 });
    const brief = makeSession({ id: "brief", sourceMtimeMs: 7, userMessageCount: 1 });
    claude.sessions = [running, brief, ...history("claude-code", "c", 3, 1)];
    codex.sessions = history("codex", "x", 2, 5);
  }

  it("counts only the sessions the listing can still offer as missing, and the skipped ones apart", async () => {
    mixedHistory();
    const listing = await call("hindsight_sessions", { missingFacets: true });
    expect(listing.json.total).toBe(5);

    const { json } = await call("hindsight_save_facets", { facets: [validFacet("c0"), validFacet("x0", "codex")] });
    expect(json.sessionsStillMissingFacets).toBe(3);
    expect(json.skippedWithoutFacets).toEqual({ live: 1, slashCommandOnly: 0, fewPrompts: 1 });
    const after = await call("hindsight_sessions", { missingFacets: true });
    expect(after.json.total).toBe(json.sessionsStillMissingFacets);
  });

  it("tells a returning user how many sessions are already judged and that a new narrative replaces the old one", async () => {
    mixedHistory();
    const fresh = await call("hindsight_scan");
    expect(fresh.json.facets).toMatchObject({ saved: 0, toJudge: 5 });
    expect(fresh.json.narrative).toEqual({ saved: false });

    await call("hindsight_save_facets", { facets: [validFacet("c0"), validFacet("c1")] });
    await call("hindsight_save_narrative", { narrative: validNarrative() });
    const again = await call("hindsight_scan");
    expect(again.json.facets).toMatchObject({ saved: 2, toJudge: 3, skipped: { live: 1, slashCommandOnly: 0, fewPrompts: 1 } });
    expect(again.json.narrative).toEqual({ saved: true });
    expect(again.json.next).toContain("2 sessions already");
    expect(again.json.next).toContain("replaces");
  });
});

describe("hindsight_save_narrative placeholders", () => {
  const withInstruction = (instructionText: string) => ({
    ...validNarrative(),
    suggestions: [{ type: "instructions", title: "Stack view", action: "Add a rule.", instructionText }],
  });

  it("rejects instruction text holding an angle-bracket or ellipsis placeholder, saying what to fix", async () => {
    for (const text of ["Run `gh stack view <n> --json`.", "Run `gh stack view … --json`.", "Run gh stack view ... --json"]) {
      const { isError, text: message } = await call("hindsight_save_narrative", { narrative: withInstruction(text) });
      expect(isError).toBe(true);
      expect(message).toContain("suggestions.0.instructionText");
      expect(message).toContain("placeholder");
    }
  });

  it("accepts real text that only looks similar: generics, comparisons and git ranges", async () => {
    const text = "Compare with `git diff main...HEAD`; keep `Array<string>` types; a < b > c is fine; spread `...args`.";
    const { isError } = await call("hindsight_save_narrative", { narrative: withInstruction(text) });
    expect(isError).toBe(false);
  });
});

describe("returning users with nothing new", () => {
  it("skips straight to the narrative when every listable session already has a facet", async () => {
    claude.sessions = history("claude-code", "c", 2, 1);
    codex.sessions = [];
    await call("hindsight_scan");
    await call("hindsight_save_facets", { facets: [validFacet("c0"), validFacet("c1")] });
    const { json } = await call("hindsight_scan");
    expect(json.facets.toJudge).toBe(0);
    expect(json.next).toContain("no new sessions need facets");
    expect(json.next).not.toContain("up to 0");
  });
});
