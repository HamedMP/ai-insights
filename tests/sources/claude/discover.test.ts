import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeDefaultRoots, claudeSource } from "../../../src/sources/claude/index.js";
import { assistant, prompt, tempRoot, text, writeLines } from "./helpers.js";

const lines = [prompt("2026-01-01T10:00:00Z", "hi"), assistant("2026-01-01T10:01:00Z", "m1", [text("hello")])];

describe("claude source: finding history", () => {
  it("looks in ~/.claude/projects, or under CLAUDE_CONFIG_DIR when set", () => {
    expect(claudeDefaultRoots({}, "/home/me")).toEqual(["/home/me/.claude/projects", "/home/me/.config/claude/projects"]);
    expect(claudeDefaultRoots({ CLAUDE_CONFIG_DIR: "/opt/claude" }, "/home/me")).toEqual(["/opt/claude/projects"]);
    expect(claudeDefaultRoots({ CLAUDE_CONFIG_DIR: "/a, /b" }, "/home/me")).toEqual(["/a/projects", "/b/projects"]);
  });

  it("lists one file per session, newest first, without listing subagent transcripts as sessions", async () => {
    const root = tempRoot();
    const old = writeLines(join(root, "-proj-a", "aaaaaaaa-0000-4000-8000-000000000001.jsonl"), lines, new Date("2026-01-01T00:00:00Z"));
    const recent = writeLines(join(root, "-proj-b", "bbbbbbbb-0000-4000-8000-000000000002.jsonl"), lines, new Date("2026-02-01T00:00:00Z"));
    const sub = writeLines(
      join(root, "-proj-a", "aaaaaaaa-0000-4000-8000-000000000001", "subagents", "agent-x.jsonl"),
      lines,
      new Date("2026-01-02T00:00:00Z"),
    );
    writeLines(join(root, "-proj-a", "notes.txt"), ["not a transcript"]);

    const files = await claudeSource.discover({ roots: [root] });
    expect(files.map((f) => f.path)).toEqual([recent, old]);
    expect(files.every((f) => f.harness === "claude-code")).toBe(true);
    expect(files.map((f) => f.path)).not.toContain(sub);
    // A subagent writing later makes the parent session stale too.
    expect(files[1]!.mtimeMs).toBe(new Date("2026-01-02T00:00:00Z").getTime());
    expect(files[1]!.sizeBytes).toBeGreaterThan(files[0]!.sizeBytes);
  });

  it("honours since and maxFiles", async () => {
    const root = tempRoot();
    for (let day = 1; day <= 5; day += 1) {
      writeLines(join(root, "-p", `s${day}.jsonl`), lines, new Date(`2026-03-0${day}T00:00:00Z`));
    }
    const since = await claudeSource.discover({ roots: [root], since: new Date("2026-03-03T00:00:00Z") });
    expect(since.map((f) => f.path.slice(-8))).toEqual(["s5.jsonl", "s4.jsonl", "s3.jsonl"]);
    const capped = await claudeSource.discover({ roots: [root], maxFiles: 2 });
    expect(capped).toHaveLength(2);
  });

  it("finds nothing, without failing, when there is no history", async () => {
    expect(await claudeSource.discover({ roots: ["/nonexistent/claude/projects"] })).toEqual([]);
  });

  it("does not list the same history twice when two roots point at it", async () => {
    const root = tempRoot();
    writeLines(join(root, "-p", "s.jsonl"), lines);
    expect(await claudeSource.discover({ roots: [root, `${root}/`] })).toHaveLength(1);
  });
});
