import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HARNESSES } from "../../src/schema/types.js";
import { scan } from "../../src/store/scan.js";
import { headline, renderFromScan } from "../../src/store/pipeline.js";
import { Store } from "../../src/store/store.js";
import { fakeBuildReport, fakeRenderReport, fakeSource, makeSession, tempHome, validFacet } from "./fixtures.js";
import type { BuildReportInput } from "../../src/schema/types.js";

let home: string;
let cleanup: () => Promise<void>;
let store: Store;

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  store = new Store(home);
});
afterEach(async () => cleanup());

describe("scan", () => {
  it("lists coverage for every harness, marking those with no history as not found", async () => {
    const claude = fakeSource("claude-code", [makeSession({ id: "a" }), makeSession({ id: "b", sourceMtimeMs: 2_000 })]);
    const codex = fakeSource("codex", []);
    const result = await scan({ sources: [claude, codex], store });

    expect(result.coverage.map((entry) => entry.harness)).toEqual([...HARNESSES]);
    const byHarness = Object.fromEntries(result.coverage.map((entry) => [entry.harness, entry]));
    expect(byHarness["claude-code"]).toMatchObject({ found: true, files: 2, sessions: 2, label: "Claude Code" });
    expect(byHarness.codex).toMatchObject({ found: false, files: 0, sessions: 0, oldest: null });
    expect(byHarness.cursor).toMatchObject({ found: false, label: "Cursor" });
  });

  it("reuses the cache on the second run and re-parses only changed transcripts", async () => {
    const sessions = [makeSession({ id: "a" }), makeSession({ id: "b", sourceMtimeMs: 2_000 })];
    const source = fakeSource("claude-code", sessions);
    await scan({ sources: [source], store });
    expect(source.parseCalls).toHaveLength(2);

    source.parseCalls.length = 0;
    source.sessions = [sessions[0]!, { ...sessions[1]!, sourceMtimeMs: 3_000, userMessageCount: 9 }];
    const second = await scan({ sources: [source], store: new Store(home) });
    expect(source.parseCalls).toEqual([sessions[1]!.sourcePath]);
    expect(second.stats.cached).toBe(1);
    expect(second.sessions.find((session) => session.id === "b")?.userMessageCount).toBe(9);
  });

  it("parses again when asked to refresh", async () => {
    const source = fakeSource("claude-code", [makeSession({ id: "a" })]);
    await scan({ sources: [source], store });
    await scan({ sources: [source], store }, { refresh: true });
    expect(source.parseCalls).toHaveLength(2);
  });

  it("keeps going when one source's discovery throws, counting it as an issue", async () => {
    const broken = fakeSource("codex", [], { discover: async () => { throw new Error("boom /home/someone/secret"); } });
    const fine = fakeSource("claude-code", [makeSession({ id: "a" })]);
    const result = await scan({ sources: [broken, fine], store });
    expect(result.sessions).toHaveLength(1);
    expect(result.coverage.find((entry) => entry.harness === "codex")).toMatchObject({ found: false, issues: 1 });
  });

  it("counts a transcript whose parse throws as an issue and skips it", async () => {
    const source = fakeSource("claude-code", [makeSession({ id: "a" }), makeSession({ id: "b", sourceMtimeMs: 5 })]);
    const original = source.parse;
    source.parse = async (file) => (file.path.includes("/b.") ? Promise.reject(new Error("bad")) : original(file));
    const result = await scan({ sources: [source], store });
    expect(result.sessions.map((session) => session.id)).toEqual(["a"]);
    expect(result.stats.failed).toBe(1);
    expect(result.coverage[0]!.issues).toBe(1);
  });

  it("filters by harness while still reporting that other history exists", async () => {
    const claude = fakeSource("claude-code", [makeSession({ id: "a" })]);
    const codex = fakeSource("codex", [makeSession({ id: "c", harness: "codex" })]);
    const result = await scan({ sources: [claude, codex], store }, { harness: "codex" });
    expect(result.sessions.map((session) => session.id)).toEqual(["c"]);
    expect(claude.parseCalls).toEqual([]);
    expect(result.coverage.find((entry) => entry.harness === "claude-code")).toMatchObject({ found: true, sessions: 0 });
  });

  it("applies since and reports found:true when older history exists outside the window", async () => {
    const source = fakeSource("claude-code", [makeSession({ id: "old", sourceMtimeMs: 10 })]);
    const result = await scan({ sources: [source], store }, { since: new Date(1_000) });
    expect(result.sessions).toHaveLength(0);
    expect(result.coverage[0]).toMatchObject({ found: true, files: 0 });
  });

  it("caps the number of transcripts read, newest first", async () => {
    const sessions = Array.from({ length: 10 }, (_, index) => makeSession({ id: `s${index}`, sourceMtimeMs: index }));
    const source = fakeSource("claude-code", sessions);
    const result = await scan({ sources: [source], store }, { maxSessions: 3 });
    expect(result.sessions.map((session) => session.id).sort()).toEqual(["s7", "s8", "s9"]);
  });

  it("de-duplicates sessions that appear in two transcripts, keeping the latest", async () => {
    const early = makeSession({ id: "dup", sourcePath: "/fake/one.jsonl", endTime: "2026-10-01T09:10:00.000Z" });
    const late = makeSession({ id: "dup", sourcePath: "/fake/two.jsonl", sourceMtimeMs: 2, endTime: "2026-10-01T10:00:00.000Z" });
    const result = await scan({ sources: [fakeSource("claude-code", [early, late])], store });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.endTime).toBe(late.endTime);
    expect(result.files.get("claude-code:dup")?.path).toBe("/fake/two.jsonl");
    expect(result.stats.duplicates).toBe(1);
  });

  it("parses with bounded concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const sessions = Array.from({ length: 20 }, (_, index) => makeSession({ id: `s${index}`, sourceMtimeMs: index }));
    const source = fakeSource("claude-code", sessions);
    const original = source.parse;
    source.parse = async (file) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return original(file);
    };
    await scan({ sources: [source], store }, { concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("pipeline", () => {
  it("builds the report with only the facets that belong to scanned sessions, plus the narrative", async () => {
    const source = fakeSource("claude-code", [makeSession({ id: "a" })]);
    await store.saveFacet(validFacet("a"));
    await store.saveFacet(validFacet("gone"));
    const calls: BuildReportInput[] = [];
    const result = await scan({ sources: [source], store });
    const outcome = await renderFromScan({ store, buildReport: fakeBuildReport(calls), renderReport: fakeRenderReport, timeZone: "UTC" }, result);
    expect(calls[0]!.facets!.map((facet) => facet.sessionId)).toEqual(["a"]);
    expect(calls[0]!.narrative).toBeNull();
    expect(outcome.url).toMatch(/^file:\/\/.*report\.html$/);
    expect(outcome.facetCount).toBe(1);
  });

  it("summarises headline numbers straight from sessions", () => {
    const numbers = headline([makeSession({ id: "a" }), makeSession({ id: "b", startTime: "2026-09-01T00:00:00.000Z" })]);
    expect(numbers).toMatchObject({ sessions: 2, userPrompts: 6, toolCalls: 4, toolErrors: 2, tokens: 2500, firstSession: "2026-09-01T00:00:00.000Z" });
  });
});
