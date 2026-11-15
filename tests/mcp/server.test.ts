import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GOAL_CATEGORIES, OUTCOMES, type BuildReportInput, type Report } from "../../src/schema/types.js";
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
    for (const value of [...GOAL_CATEGORIES, ...OUTCOMES]) expect(save.description).toContain(value);
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
    expect(json.facets).toEqual({ saved: 0, missing: 3 });
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

  it("keeps daily series to the requested number of recent days", async () => {
    const { json, text } = await call("hindsight_report", { sections: ["activity"], days: 7 });
    expect(json.activity.daily).toHaveLength(7);
    expect(json.activity.daily.at(-1).day).toBe("day-399");
    expect(text.length).toBeLessThan(MAX_OUTPUT_CHARS);
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

  it("filters to sessions still missing facets", async () => {
    await call("hindsight_save_facets", { facets: [validFacet("c1")] });
    const { json } = await call("hindsight_sessions", { missingFacets: true });
    expect(json.sessions.map((session: any) => session.sessionId)).toEqual(["c2", "x1"]);
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
