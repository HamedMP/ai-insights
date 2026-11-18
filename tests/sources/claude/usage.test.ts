import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeTranscript } from "../../../src/sources/claude/parse.js";
import { readClaudeUsage } from "../../../src/sources/claude/usage.js";
import { assistant, prompt, tempRoot, text, toolResult, toolUse, transcript, writeLines, SESSION } from "./helpers.js";

// The usage-only reading feeds the first numbers on screen. It must find exactly the requests the full parse finds,
// or say it cannot (null), never a near miss.

describe("reading a Claude Code transcript for its usage only", () => {
  it("finds the same requests as the full parse: streamed copies, placeholders, fast mode, subagents", async () => {
    const file = transcript([
      prompt("2026-03-01T10:00:00.000Z", "count the tokens"),
      // A proxy placeholder, then the completed response replacing it.
      assistant("2026-03-01T10:00:01.000Z", "m1", [], { usage: { input: 900, output: 0 }, stop: null }),
      assistant("2026-03-01T10:00:02.000Z", "m1", [text("partial")], { usage: { input: 10, output: 4, cacheRead: 800 } }),
      assistant("2026-03-01T10:00:03.000Z", "m1", [text("done")], { usage: { input: 10, output: 9, cacheRead: 800, cache5m: 0, cache1h: 0 } }),
      assistant("2026-03-01T10:00:04.000Z", "m2", [toolUse("t1", "Bash", { command: "ls" })], { usage: { input: 20, output: 5, speed: "fast" }, model: "claude-opus-4-8" }),
      toolResult("2026-03-01T10:00:05.000Z", "t1", "a b"),
      // Synthetic replies and replies without usage are not requests.
      assistant("2026-03-01T10:00:06.000Z", "m3", [text("x")], { model: "<synthetic>" }),
      assistant("2026-03-01T10:00:07.000Z", "m4", [text("y")], { usage: null }),
      // A line copied from another session on resume is counted where it came from.
      { ...assistant("2026-03-01T10:00:08.000Z", "m5", [], { usage: { input: 1, output: 1 } }), sessionId: "99999999-2222-4333-8444-555555555555" },
      // An untimed response is an issue, not a request.
      { ...assistant("2026-03-01T10:00:09.000Z", "m6", [], { usage: { input: 2, output: 2 } }), timestamp: "yesterday" },
      "not json at all",
    ]);
    writeLines(join(file.path.slice(0, -".jsonl".length), "subagents", "agent-1.jsonl"), [
      assistant("2026-03-01T10:00:10.000Z", "s1", [], { usage: { input: 30, output: 3 }, extra: { isSidechain: true } }),
      assistant("2026-03-01T10:00:11.000Z", "m2", [], { usage: { input: 20, output: 8, speed: "fast" }, model: "claude-opus-4-8" }),
    ]);
    const usage = await readClaudeUsage(file);
    const session = await parseClaudeTranscript(file);
    expect(usage).not.toBeNull();
    expect(usage!.id).toBe(session!.id);
    expect(usage!.requests).toEqual(session!.requests);
    expect(usage!.requests.length).toBeGreaterThan(2);
  });

  it("declines a transcript whose session the full parse might drop: no timed reply on the main thread", async () => {
    const file = transcript([
      prompt("2026-03-01T10:00:00.000Z", "hello"),
      { ...assistant("2026-03-01T10:00:02.000Z", "m1", [], { usage: { input: 5, output: 5 } }), isSidechain: true },
    ]);
    expect(await readClaudeUsage(file)).toBeNull();
  });

  it("declines a file not named after its session, whose id would come from another line", async () => {
    const root = tempRoot();
    const file = transcript([assistant("2026-03-01T10:00:02.000Z", "m1", [], { usage: { input: 5, output: 5 } })], { root, session: "notes" });
    expect(await readClaudeUsage(file)).toBeNull();
    expect((await parseClaudeTranscript(file))?.requests).toHaveLength(1);
  });

  it("declines a transcript past the line limit instead of guessing where the full parse stopped", async () => {
    const lines = Array.from({ length: 12 }, (_, n) => assistant(`2026-03-01T10:00:${String(10 + n).padStart(2, "0")}.000Z`, `m${n}`, [], { usage: { input: 5, output: 5 } }));
    const file = transcript(lines);
    const limits = { maxBytes: 1e9, maxLineBytes: 1e6, maxLines: 6 };
    expect(await readClaudeUsage(file, limits)).toBeNull();
    expect(SESSION).toBe(file.path.split("/").pop()!.replace(".jsonl", ""));
  });
});
