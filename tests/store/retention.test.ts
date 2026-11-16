import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness, Session, SessionFile } from "../../src/schema/types.js";
import { claudePolicy, geminiPolicy, isDesktopTranscript, measureRetention, readRetentionPolicies, type RetentionPolicy } from "../../src/store/retention.js";
import { makeSession } from "./fixtures.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ai-insights-retention-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const DAY = 86_400_000;
const NOW = new Date("2026-11-16T12:00:00Z");
const platform = "linux" as NodeJS.Platform;

function settings(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
}

describe("Claude Code retention policy", () => {
  it("uses the documented default of 30 days when cleanupPeriodDays is not set", async () => {
    const policy = await claudePolicy({ env: {}, home, platform });
    expect(policy).toMatchObject({ policy: "deletes", days: 30, source: "default", clock: "modified", setting: { name: "cleanupPeriodDays", file: "~/.claude/settings.json", value: null } });
    expect(policy.desktopDays).toBeNull();
  });

  it("reads cleanupPeriodDays from the user settings, and from CLAUDE_CONFIG_DIR when set", async () => {
    settings(join(home, ".claude", "settings.json"), { cleanupPeriodDays: 90 });
    expect(await claudePolicy({ env: {}, home, platform })).toMatchObject({ days: 90, source: "settings", setting: { value: 90 } });
    const other = join(home, "conf");
    settings(join(other, "settings.json"), { cleanupPeriodDays: 400, desktopSessionCleanupPeriodDays: 60 });
    expect(await claudePolicy({ env: { CLAUDE_CONFIG_DIR: other }, home, platform })).toMatchObject({ days: 400, desktopDays: 60, setting: { file: "~/conf/settings.json" } });
  });

  it("does not claim a deletion age when the settings file does not parse, because Claude Code pauses its sweep", async () => {
    settings(join(home, ".claude", "settings.json"), "{ not json");
    const policy = await claudePolicy({ env: {}, home, platform });
    expect(policy.policy).toBe("unknown");
    expect(policy.days).toBeUndefined();
  });
});

describe("Gemini CLI retention policy", () => {
  it("uses the documented 30-day default, a configured maxAge, or nothing when cleanup is off", async () => {
    expect(await geminiPolicy({ env: {}, home })).toMatchObject({ policy: "deletes", days: 30, source: "default", clock: "last-updated" });
    const path = join(home, ".gemini", "settings.json");
    settings(path, { general: { sessionRetention: { maxAge: "2w" } } });
    expect(await geminiPolicy({ env: {}, home })).toMatchObject({ days: 14, source: "settings" });
    settings(path, { general: { sessionRetention: { enabled: false } } });
    expect((await geminiPolicy({ env: {}, home })).policy).toBe("kept");
  });
});

describe("the other harnesses", () => {
  it("say Codex, OpenCode and Pi keep transcripts and Cursor is unknown, never a guessed age", async () => {
    const policies = await readRetentionPolicies({ env: {}, home, platform });
    expect(policies.get("codex")!.policy).toBe("kept");
    expect(policies.get("opencode")!.policy).toBe("kept");
    expect(policies.get("pi")!.policy).toBe("kept");
    expect(policies.get("cursor")!.policy).toBe("unknown");
    for (const harness of ["codex", "opencode", "pi", "cursor"] as Harness[]) expect(policies.get(harness)!.days).toBeUndefined();
  });
});

describe("Desktop and Cowork transcripts", () => {
  it("are recognised by their entry point at either end of the file", async () => {
    const path = join(home, "a.jsonl");
    writeFileSync(path, `${JSON.stringify({ type: "user", entrypoint: "claude-desktop" })}\n`);
    expect(await isDesktopTranscript(path)).toBe(true);
    writeFileSync(path, `${JSON.stringify({ type: "user", entrypoint: "cli" })}\n${"x".repeat(200_000)}\n${JSON.stringify({ entrypoint: "local-agent" })}\n`);
    expect(await isDesktopTranscript(path)).toBe(true);
    writeFileSync(path, `${JSON.stringify({ type: "user", entrypoint: "sdk-cli" })}\n`);
    expect(await isDesktopTranscript(path)).toBe(false);
  });
});

describe("measureRetention", () => {
  const claude: RetentionPolicy = { harness: "claude-code", policy: "deletes", days: 30, source: "default", clock: "modified", basis: "b", desktopDays: null };
  const codex: RetentionPolicy = { harness: "codex", policy: "kept", basis: "kept" };
  const file = (path: string, ageDays: number, harness: Harness = "claude-code"): SessionFile => ({ harness, path, mtimeMs: NOW.getTime() - ageDays * DAY, sizeBytes: 1_000 });
  const sessionFor = (f: SessionFile, id: string, startAgo: number): Session =>
    makeSession({ id, harness: f.harness, sourcePath: f.path, startTime: new Date(NOW.getTime() - startAgo * DAY).toISOString(), endTime: new Date(f.mtimeMs).toISOString() });

  it("counts transcripts that reach the deletion age within 7 days, soonest first, and leaves Desktop sessions out", async () => {
    const files = [
      file("/h/.claude/projects/p/young.jsonl", 2),
      file("/h/.claude/projects/p/due-soon.jsonl", 25),
      file("/h/.claude/projects/p/overdue.jsonl", 31),
      file("/h/.claude/projects/p/desktop.jsonl", 28),
      file("/h/Claude/claude-code-sessions/x/.claude/projects/p/store.jsonl", 29),
    ];
    const sessions = new Map(files.map((f, n) => [f.path, sessionFor(f, `s${n}`, 40)]));
    const orphan = makeSession({ id: "gone", startTime: new Date(NOW.getTime() - 90 * DAY).toISOString() });
    const retention = await measureRetention({
      now: NOW,
      policies: new Map([["claude-code", claude], ["codex", codex]]),
      files: new Map([["claude-code", files]]),
      sessionsByPath: sessions,
      cachedOnly: new Map([["claude-code", [orphan]]]),
      isDesktop: async (path) => path.endsWith("desktop.jsonl"),
      mtimeOf: async (f) => f.mtimeMs,
    });
    const entry = retention.harnesses[0]!;
    expect(retention.harnesses).toHaveLength(1);
    expect(entry.atRisk).toEqual({ sessions: 2, bytes: 2_000, nextDeletion: new Date(NOW.getTime() - DAY).toISOString() });
    expect(entry.due!.map((item) => item.sessionId)).toEqual(["s2", "s1"]);
    expect(entry.exempt!.sessions).toBe(2);
    expect(entry.cachedOnly).toBe(1);
    expect(entry.coversFrom).toBe(orphan.startTime);
    expect(retention.coversFrom).toBe(orphan.startTime);
    expect(retention.atRisk.sessions).toBe(2);
    expect(retention.cache.keeps.join(" ")).toMatch(/prompts/);
    expect(retention.cache.drops.join(" ")).toMatch(/replies/);
  });

  it("deletes Desktop sessions too once desktopSessionCleanupPeriodDays gives them an age", async () => {
    const files = [file("/h/.claude/projects/p/desktop.jsonl", 26)];
    const retention = await measureRetention({
      now: NOW,
      policies: new Map([["claude-code", { ...claude, desktopDays: 30 }]]),
      files: new Map([["claude-code", files]]),
      sessionsByPath: new Map(),
      cachedOnly: new Map(),
      isDesktop: async () => true,
      mtimeOf: async (f) => f.mtimeMs,
    });
    expect(retention.harnesses[0]!.atRisk!.sessions).toBe(1);
    expect(retention.harnesses[0]!.exempt).toBeUndefined();
  });

  it("measures the transcript's own mtime, not a subagent's later write", async () => {
    const dir = join(home, "projects", "p");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "s.jsonl");
    writeFileSync(path, "{}\n");
    const own = (NOW.getTime() - 26 * DAY) / 1000;
    utimesSync(path, own, own);
    const retention = await measureRetention({
      now: NOW,
      policies: new Map([["claude-code", claude]]),
      files: new Map([["claude-code", [{ ...file(path, 3), path }]]]),
      sessionsByPath: new Map(),
      cachedOnly: new Map(),
      isDesktop: async () => false,
    });
    // Discovery reported a fresh mtime because a subagent wrote 3 days ago; the transcript itself is 26 days old.
    expect(retention.harnesses[0]!.atRisk!.sessions).toBe(1);
  });
});
