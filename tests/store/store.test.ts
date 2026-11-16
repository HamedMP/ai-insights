import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { DRIVERS, FRICTION_TYPES, GOAL_CATEGORIES, OUTCOMES } from "../../src/schema/types.js";
import { SessionSchema, describeIssues } from "../../src/store/schemas.js";
import { KEEP_REPORT_COPIES, Store, resolveHome } from "../../src/store/store.js";
import { parseSince } from "../../src/store/since.js";
import { fakeBuildReport, fileFor, makeSession, tempHome, validFacet, validNarrative } from "./fixtures.js";

let home: string;
let cleanup: () => Promise<void>;
let store: Store;

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  store = new Store(home);
});
afterEach(async () => cleanup());

function mode(path: string) {
  return stat(path).then((info) => info.mode & 0o777);
}

describe("store home", () => {
  it("honours HINDSIGHT_HOME so people and tests can move the cache", () => {
    expect(resolveHome({ HINDSIGHT_HOME: "/tmp/elsewhere" })).toBe("/tmp/elsewhere");
    expect(resolveHome({})).toMatch(/\.hindsight$/);
  });
});

describe("session cache", () => {
  it("reuses a cached session only while the transcript's mtime is unchanged", async () => {
    const session = makeSession({ id: "s1" });
    await store.cacheSession(fileFor(session), session);
    await store.flush();

    const fresh = new Store(home);
    expect(await fresh.cachedSession(fileFor(session))).toEqual(session);
    expect(await fresh.cachedSession(fileFor(session, 2_000))).toBeUndefined();
  });

  it("remembers transcripts that held no session so they are not re-parsed", async () => {
    const session = makeSession({ id: "empty" });
    await store.cacheSession(fileFor(session), null);
    await store.flush();
    expect(await new Store(home).cachedSession(fileFor(session))).toBeNull();
  });

  it("re-parses when the cached file on disk is corrupt", async () => {
    const session = makeSession({ id: "s2" });
    await store.cacheSession(fileFor(session), session);
    await store.flush();
    await writeFile(join(home, "sessions", "claude-code", "s2.json"), "{not json");
    expect(await new Store(home).cachedSession(fileFor(session))).toBeUndefined();
  });

  it("keeps private files private: directories 0700, files 0600", async () => {
    const session = makeSession({ id: "s3" });
    await store.cacheSession(fileFor(session), session);
    await store.flush();
    expect(await mode(home)).toBe(0o700);
    expect(await mode(join(home, "sessions", "claude-code"))).toBe(0o700);
    expect(await mode(join(home, "sessions", "claude-code", "s3.json"))).toBe(0o600);
    expect(await mode(join(home, "sessions", "claude-code", ".index.json"))).toBe(0o600);
  });

  it("does not leave temp files behind after writes", async () => {
    for (let index = 0; index < 5; index += 1) {
      const session = makeSession({ id: `t${index}` });
      await store.cacheSession(fileFor(session), session);
    }
    await store.flush();
    const names = await readdir(join(home, "sessions", "claude-code"));
    expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses to cache a session whose id would escape the store directory", async () => {
    const hostile = makeSession({ id: "../../etc/passwd" });
    expect(await store.cacheSession(fileFor(hostile), hostile)).toBe(false);
    expect(() => store.sessionPath("claude-code", "../x")).toThrow();
    expect(() => store.facetPath("codex", "a/b")).toThrow();
    expect(() => store.facetPath("codex", ".hidden")).toThrow();
  });
});

describe("facets", () => {
  it("saves a valid facet and reads it back", async () => {
    await store.saveFacet(validFacet("s1"));
    expect(await store.readFacet("claude-code", "s1")).toEqual(validFacet("s1"));
    expect(await mode(join(home, "facets", "claude-code", "s1.json"))).toBe(0o600);
  });

  it("rejects unknown taxonomy values with a message that lists the allowed ones", async () => {
    const bad = { ...validFacet("s1"), goalCategories: ["feature", "vibes"] };
    const error = await store.saveFacet(bad).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ZodError);
    const message = describeIssues(error as ZodError);
    expect(message).toContain("goalCategories.1");
    for (const value of GOAL_CATEGORIES) expect(message).toContain(value);
  });

  it("accepts every goal category and outcome in the contract, including orchestration, tooling and in_progress", async () => {
    expect(GOAL_CATEGORIES).toContain("orchestration");
    expect(GOAL_CATEGORIES).toContain("tooling");
    expect(OUTCOMES).toContain("in_progress");
    for (const goal of GOAL_CATEGORIES) await expect(store.saveFacet({ ...validFacet("g"), goalCategories: [goal] })).resolves.toBeTruthy();
    for (const outcome of OUTCOMES) await expect(store.saveFacet({ ...validFacet("o"), outcome })).resolves.toBeTruthy();
  });

  it("records who drove the session when the agent says so, and stays valid without it", async () => {
    for (const drivenBy of DRIVERS) {
      expect((await store.saveFacet({ ...validFacet("d"), drivenBy })).drivenBy).toBe(drivenBy);
    }
    expect(await store.readFacet("claude-code", "d")).toMatchObject({ drivenBy: DRIVERS.at(-1) });
    const legacy = await store.saveFacet(validFacet("legacy"));
    expect("drivenBy" in legacy).toBe(false);
  });

  it("rejects an unknown driver and lists the allowed ones", async () => {
    const message = describeIssues((await store.saveFacet({ ...validFacet("d"), drivenBy: "robot" }).catch((caught: unknown) => caught)) as ZodError);
    expect(message).toContain("drivenBy");
    for (const value of DRIVERS) expect(message).toContain(value);
  });

  it("rejects unknown friction types and names the allowed ones", async () => {
    const bad = { ...validFacet("s1"), frictions: { rage_quit: 2 } };
    const message = describeIssues((await store.saveFacet(bad).catch((caught: unknown) => caught)) as ZodError);
    expect(message).toContain("rage_quit");
    for (const value of FRICTION_TYPES) expect(message).toContain(value);
  });

  it("rejects facets with hostile session ids or extra fields", async () => {
    await expect(store.saveFacet({ ...validFacet("s1"), sessionId: "../../evil" })).rejects.toBeInstanceOf(ZodError);
    await expect(store.saveFacet({ ...validFacet("s1"), extra: true })).rejects.toBeInstanceOf(ZodError);
  });

  it("redacts secrets the model may have quoted into a facet", async () => {
    const saved = await store.saveFacet({ ...validFacet("s1"), summary: "Used key sk-ant-abcdefghijklmnopqrstuvwx to call the API" });
    expect(saved.summary).not.toContain("sk-ant-abcdefghijklmnopqrstuvwx");
    const raw = await readFile(join(home, "facets", "claude-code", "s1.json"), "utf8");
    expect(raw).not.toContain("sk-ant-abcdefghijklmnopqrstuvwx");
  });

  it("skips invalid facet files on disk instead of failing the report", async () => {
    await store.saveFacet(validFacet("good"));
    await mkdir(join(home, "facets", "codex"), { recursive: true });
    await writeFile(join(home, "facets", "codex", "bad.json"), JSON.stringify({ sessionId: "bad", outcome: "great" }));
    const facets = await store.listFacets();
    expect(facets.map((facet) => facet.sessionId)).toEqual(["good"]);
  });

  it("lists only facets for the sessions asked about", async () => {
    await store.saveFacet(validFacet("a"));
    await store.saveFacet(validFacet("b", "codex"));
    const facets = await store.listFacets(new Set(["codex:b"]));
    expect(facets.map((facet) => facet.sessionId)).toEqual(["b"]);
  });
});

describe("narrative", () => {
  it("round-trips a valid narrative", async () => {
    await store.saveNarrative(validNarrative());
    expect(await store.readNarrative()).toEqual(validNarrative());
  });

  it("rejects suggestion links that are not http(s), so the report never carries javascript: links", async () => {
    const narrative = validNarrative();
    const bad = { ...narrative, suggestions: [{ type: "plugin", title: "x", action: "y", url: "javascript:alert(1)" }] };
    await expect(store.saveNarrative(bad)).rejects.toBeInstanceOf(ZodError);
  });

  it("returns null when no narrative was saved or the file is invalid", async () => {
    expect(await store.readNarrative()).toBeNull();
    await writeFile(join(home, "narrative.json"), JSON.stringify({ headline: 3 }));
    expect(await store.readNarrative()).toBeNull();
  });
});

describe("reports", () => {
  it("writes report.html, a timestamped copy and report.json", async () => {
    const report = fakeBuildReport()({ sessions: [makeSession({ id: "s1" })], coverage: [] });
    const saved = await store.saveReport("<html></html>", report, new Date("2026-11-01T10:00:00Z"));
    expect(await readFile(saved.htmlPath, "utf8")).toBe("<html></html>");
    expect(saved.copyPath).toMatch(/report-2026-11-01T10-00-00-000Z\.html$/);
    expect(JSON.parse(await readFile(saved.jsonPath, "utf8")).version).toBe(1);
    expect(await mode(saved.htmlPath)).toBe(0o600);
  });

  it("keeps a bounded number of timestamped copies", async () => {
    const report = fakeBuildReport()({ sessions: [], coverage: [] });
    for (let index = 0; index < KEEP_REPORT_COPIES + 3; index += 1) {
      await store.saveReport("<html></html>", report, new Date(Date.UTC(2026, 0, 1, 0, index)));
    }
    const copies = (await readdir(join(home, "reports"))).filter((name) => name.startsWith("report-"));
    expect(copies).toHaveLength(KEEP_REPORT_COPIES);
    expect(copies.sort()[0]).toContain("T00-03-");
  });
});

describe("parseSince", () => {
  const now = new Date("2026-11-15T00:00:00Z");
  it("understands relative windows and ISO dates", () => {
    expect(parseSince("90d", now)?.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(parseSince("2w", now)?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(parseSince("2026-01-31", now)?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
  it("rejects nonsense instead of guessing", () => {
    expect(parseSince("soon", now)).toBeNull();
    expect(parseSince("0d", now)).toBeNull();
    expect(parseSince("", now)).toBeNull();
  });
});

describe("SessionSchema", () => {
  it("accepts a project root, a null one, and fields newer than the schema", () => {
    const withRoot = SessionSchema.parse({ ...makeSession({ id: "a" }), projectRoot: "/work/app", someNewField: 1 });
    expect(withRoot.projectRoot).toBe("/work/app");
    expect((withRoot as Record<string, unknown>).someNewField).toBe(1);
    expect(SessionSchema.safeParse({ ...makeSession({ id: "b" }), projectRoot: null }).success).toBe(true);
    expect(SessionSchema.safeParse({ ...makeSession({ id: "c" }), projectRoot: 7 }).success).toBe(false);
  });
});

describe("narrative placeholders", () => {
  it("still reads back a narrative saved before placeholders were refused", async () => {
    const store = new Store(home);
    const old = { ...validNarrative(), suggestions: [{ type: "instructions", title: "t", action: "a", instructionText: "Run `x <n>`." }] };
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "narrative.json"), JSON.stringify(old));
    expect((await store.readNarrative())?.suggestions[0]?.instructionText).toBe("Run `x <n>`.");
    await expect(store.saveNarrative(old)).rejects.toThrow(/placeholder/);
  });
});
