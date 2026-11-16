import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HARNESSES } from "../../src/schema/types.js";
import { scan } from "../../src/store/scan.js";
import { headline, renderFromScan } from "../../src/store/pipeline.js";
import { Store } from "../../src/store/store.js";
import { fakeBuildReport, fakeRenderReport, fakeSource, fileFor, makeSession, tempHome, validFacet } from "./fixtures.js";
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

  it("measures history size per harness from every discovered transcript, not only the parsed ones", async () => {
    const claude = fakeSource("claude-code", [makeSession({ id: "c1", sourceMtimeMs: 10 }), makeSession({ id: "c2", sourceMtimeMs: 9 })]);
    const codex = fakeSource("codex", [makeSession({ id: "x1", harness: "codex", sourceMtimeMs: 2 }), makeSession({ id: "x2", harness: "codex", sourceMtimeMs: 1 })]);
    const claudeDiscover = claude.discover;
    // A transcript the source discovers but that parses to no session still takes space on disk.
    claude.discover = async (options) => [
      ...(await claudeDiscover(options)).map((file) => ({ ...file, sizeBytes: 1_000 })),
      { harness: "claude-code" as const, path: "/fake/claude-code/empty.jsonl", mtimeMs: 8, sizeBytes: 500 },
    ];
    const codexDiscover = codex.discover;
    codex.discover = async (options) => (await codexDiscover(options)).map((file) => ({ ...file, sizeBytes: 4_000 }));

    // The overall cap leaves both codex transcripts unparsed.
    const result = await scan({ sources: [claude, codex], store }, { maxSessions: 3 });
    const byHarness = Object.fromEntries(result.coverage.map((entry) => [entry.harness, entry]));
    expect(result.sessions.map((session) => session.id).sort()).toEqual(["c1", "c2"]);
    expect(codex.parseCalls).toEqual([]);
    expect(byHarness["claude-code"]!.bytes).toBe(2_500);
    expect(byHarness.codex!.bytes).toBe(8_000);
    expect(byHarness.cursor!.bytes).toBe(0);
  });

  it("ignores nonsense file sizes from a source when measuring history", async () => {
    const claude = fakeSource("claude-code", [makeSession({ id: "a" }), makeSession({ id: "b", sourceMtimeMs: 2 })]);
    const original = claude.discover;
    claude.discover = async (options) => (await original(options)).map((file, index) => ({ ...file, sizeBytes: index === 0 ? Number.NaN : -5 }));
    const result = await scan({ sources: [claude], store });
    expect(result.coverage[0]!.bytes).toBe(0);
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

describe("scan project roots", () => {
  /** Lays out a main checkout and a linked worktree inside the temp home, the way git does it. */
  async function repo() {
    const main = join(home, "work", "app");
    const worktree = join(home, "work", "app-wt", "feature");
    const admin = join(main, ".git", "worktrees", "feature");
    await mkdir(join(main, "packages", "web"), { recursive: true });
    await mkdir(admin, { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, ".git"), `gitdir: ${admin}\n`);
    await writeFile(join(admin, "gitdir"), `${join(worktree, ".git")}\n`);
    await writeFile(join(admin, "commondir"), "../..\n");
    return { main, worktree };
  }

  it("counts worktrees and subfolders of one repository as one project root", async () => {
    const { main, worktree } = await repo();
    const outside = join(home, "scratch");
    await mkdir(outside);
    const source = fakeSource("claude-code", [
      makeSession({ id: "main", projectPath: main }),
      makeSession({ id: "sub", projectPath: join(main, "packages", "web"), sourceMtimeMs: 2 }),
      makeSession({ id: "wt", projectPath: worktree, sourceMtimeMs: 3 }),
      makeSession({ id: "plain", projectPath: outside, sourceMtimeMs: 4 }),
      makeSession({ id: "none", projectPath: null, sourceMtimeMs: 5 }),
    ]);
    const result = await scan({ sources: [source], store });
    const byId = Object.fromEntries(result.sessions.map((session) => [session.id, session]));
    expect(byId.main!.projectRoot).toBe(main);
    expect(byId.sub!.projectRoot).toBe(main);
    expect(byId.wt!.projectRoot).toBe(main);
    expect(byId.wt!.projectPath).toBe(worktree);
    expect("projectRoot" in byId.plain!).toBe(false);
    expect("projectRoot" in byId.none!).toBe(false);
  });

  it("fills the root into sessions cached before roots existed, without parsing their transcripts again", async () => {
    const { main, worktree } = await repo();
    const old = makeSession({ id: "old", projectPath: worktree, agentMessageCount: 4 });
    await store.cacheSession(fileFor(old), old);
    await store.flush();
    const source = fakeSource("claude-code", [old]);

    const result = await scan({ sources: [source], store: new Store(home) });
    expect(source.parseCalls).toEqual([]);
    expect(result.sessions[0]!.projectRoot).toBe(main);
    // Fields the cache schema does not list by name survive the round trip.
    expect(result.sessions[0]!.agentMessageCount).toBe(4);
    const cached = await new Store(home).cachedSession(fileFor(old));
    expect(cached && cached.projectRoot).toBe(main);
  });

  it("keeps a cached root after the worktree folder is deleted and git has forgotten it", async () => {
    const { main, worktree } = await repo();
    const source = fakeSource("claude-code", [makeSession({ id: "wt", projectPath: worktree })]);
    await scan({ sources: [source], store });
    await rm(worktree, { recursive: true, force: true });
    await rm(join(main, ".git", "worktrees"), { recursive: true, force: true });

    const again = await scan({ sources: [source], store: new Store(home) });
    expect(source.parseCalls).toHaveLength(1);
    expect(again.sessions[0]!.projectRoot).toBe(main);
  });

  it("places a deleted worktree under the root another session reached, when git still lists it", async () => {
    const { main, worktree } = await repo();
    await rm(worktree, { recursive: true, force: true });
    const source = fakeSource("claude-code", [
      makeSession({ id: "main", projectPath: main }),
      makeSession({ id: "gone", projectPath: worktree, sourceMtimeMs: 2 }),
      makeSession({ id: "lost", projectPath: join(home, "never-existed"), sourceMtimeMs: 3 }),
    ]);
    const result = await scan({ sources: [source], store });
    const byId = Object.fromEntries(result.sessions.map((session) => [session.id, session]));
    expect(byId.gone!.projectRoot).toBe(main);
    expect("projectRoot" in byId.lost!).toBe(false);
  });

  it("writes each newly parsed session to the cache once", async () => {
    const { main } = await repo();
    const source = fakeSource("claude-code", [makeSession({ id: "a", projectPath: main })]);
    const counting = new Store(home);
    let writes = 0;
    const original = counting.cacheSession.bind(counting);
    counting.cacheSession = async (file, session) => {
      writes += 1;
      return original(file, session);
    };
    await scan({ sources: [source], store: counting });
    expect(writes).toBe(1);
    const second = new Store(home);
    let rewrites = 0;
    const secondOriginal = second.cacheSession.bind(second);
    second.cacheSession = async (file, session) => {
      rewrites += 1;
      return secondOriginal(file, session);
    };
    await scan({ sources: [source], store: second });
    expect(rewrites).toBe(0);
  });
});
