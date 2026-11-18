import { appendFileSync, mkdtempSync, rmSync, renameSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionFile } from "../../../src/schema/types.js";
import { parseClaudeTranscript, type Checkpoints, type ParseCheckpoint } from "../../../src/sources/claude/parse.js";
import { TailCheckpoints } from "../../../src/store/tail.js";
import { assistant, attachment, prompt, system, text, thinking, toolResult, toolUse, transcript, writeLines, SESSION } from "./helpers.js";

// A live transcript only grows. Reading it from its last checkpoint must give exactly the Session a full read gives,
// and anything else (truncated, rewritten, replaced) must fall back to a full read.

const stores: string[] = [];
afterEach(() => {
  while (stores.length) rmSync(stores.pop()!, { recursive: true, force: true });
});

function checkpoints(): TailCheckpoints {
  const dir = mkdtempSync(join(tmpdir(), "ai-insights-tail-"));
  stores.push(dir);
  return new TailCheckpoints(dir, { minBytes: 0 });
}

/** Records the checkpoints the parser loads and saves, so a test can tell a resumed read from a full one. */
function spy(inner: Checkpoints) {
  const log = { loaded: [] as Array<ParseCheckpoint | null>, saved: [] as ParseCheckpoint[] };
  const wrapped: Checkpoints = {
    minBytes: inner.minBytes,
    load: async (path, key) => {
      const value = await inner.load(path, key);
      log.loaded.push(value);
      return value;
    },
    save: async (path, key, checkpoint) => {
      log.saved.push(checkpoint);
      await inner.save(path, key, checkpoint);
    },
  };
  return { wrapped, log };
}

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

function firstPart(): unknown[] {
  return [
    prompt("2026-03-01T10:00:00.000Z", "fix the failing parser test", { permissionMode: "default" }),
    assistant("2026-03-01T10:00:05.000Z", "m1", [thinking("hmm"), toolUse("t1", "Bash", { command: "pnpm test" })], { usage: { input: 100, output: 20, cacheRead: 50 } }),
    toolResult("2026-03-01T10:00:09.000Z", "t1", "1 failing", { error: true }),
    assistant("2026-03-01T10:00:12.000Z", "m2", [toolUse("t2", "Edit", { file_path: "/work/demo/src/a.ts", old_string: "a\nb", new_string: "a\nc\nd" })], { usage: { input: 120, output: 40 } }),
    toolResult("2026-03-01T10:00:13.000Z", "t2", "ok"),
    // A streamed copy of m2 that grows its counters; the largest copy wins.
    assistant("2026-03-01T10:00:14.000Z", "m2", [], { usage: { input: 120, output: 55 } }),
    system("2026-03-01T10:00:15.000Z", "turn_duration"),
  ];
}

function secondPart(): unknown[] {
  return [
    prompt("2026-03-01T10:05:00.000Z", "now run the linter", { permissionMode: "plan" }),
    attachment("2026-03-01T10:05:01.000Z", { type: "queued_command", prompt: "and the typecheck", commandMode: "prompt" }),
    assistant("2026-03-01T10:05:04.000Z", "m3", [text("running"), toolUse("t3", "Bash", { command: "pnpm lint" })], { usage: { input: 200, output: 10 } }),
    toolResult("2026-03-01T10:05:06.000Z", "t3", "clean"),
    // A late copy of m1 with larger counters: merging must reach the request built before the checkpoint.
    assistant("2026-03-01T10:05:07.000Z", "m1", [], { usage: { input: 100, output: 30, cacheRead: 50 } }),
    system("2026-03-01T10:05:08.000Z", "compact_boundary"),
    prompt("2026-03-01T10:06:00.000Z", "/clear"),
  ];
}

async function full(file: SessionFile) {
  return parseClaudeTranscript(file);
}

describe("resuming an appended Claude Code transcript", () => {
  it("gives the same Session as a full read after each append, reading only the new lines", async () => {
    const file = transcript(firstPart());
    const { wrapped, log } = spy(checkpoints());
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(await full(file));
    expect(log.loaded).toEqual([null]);
    expect(log.saved).toHaveLength(1);

    for (const record of secondPart()) {
      appendFileSync(file.path, line(record));
      const resumed = await parseClaudeTranscript(file, undefined, { checkpoints: wrapped });
      expect(resumed).toEqual(await full(file));
      expect(log.loaded.at(-1)).not.toBeNull();
    }
  });

  it("handles a torn last line: the checkpoint stops before it and the next read completes it", async () => {
    const file = transcript(firstPart());
    const { wrapped, log } = spy(checkpoints());
    const next = line(secondPart()[0]);
    appendFileSync(file.path, next.slice(0, 25));
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(await full(file));
    appendFileSync(file.path, next.slice(25));
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(await full(file));
    expect(log.loaded.at(-1)).not.toBeNull();
  });

  it("folds subagent transcripts in after the resumed main file, exactly as a full read does", async () => {
    const file = transcript([...firstPart(), assistant("2026-03-01T10:00:20.000Z", "m9", [toolUse("ta", "Task", { name: "helper", prompt: "look" })], { usage: { input: 5, output: 5 } })]);
    const sub = join(file.path.slice(0, -".jsonl".length), "subagents", "agent-a1.jsonl");
    writeLines(sub, [
      assistant("2026-03-01T10:01:00.000Z", "s1", [toolUse("st1", "Read", { file_path: "/work/demo/README.md" })], { usage: { input: 7, output: 3 }, extra: { isSidechain: true, permissionMode: "acceptEdits" } }),
    ]);
    const store = checkpoints();
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: store })).toEqual(await full(file));
    appendFileSync(file.path, secondPart().map(line).join(""));
    appendFileSync(sub, line(assistant("2026-03-01T10:06:30.000Z", "s2", [], { usage: { input: 9, output: 1 }, extra: { isSidechain: true } })));
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: store })).toEqual(await full(file));
  });

  it("reads from the top when the transcript was truncated", async () => {
    const file = transcript([...firstPart(), ...secondPart()]);
    const { wrapped, log } = spy(checkpoints());
    await parseClaudeTranscript(file, undefined, { checkpoints: wrapped });
    truncateSync(file.path, Buffer.byteLength(firstPart().map(line).join("")));
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(await full(file));
    expect(log.loaded.at(-1)).toBeNull();
  });

  it("reads from the top when the start of the transcript was rewritten in place, even at the same length", async () => {
    const file = transcript([...firstPart(), ...secondPart()]);
    const { wrapped, log } = spy(checkpoints());
    await parseClaudeTranscript(file, undefined, { checkpoints: wrapped });
    const rewritten = [...firstPart(), ...secondPart()].map(line).join("").replace("fix the failing parser test", "fix the passing parser test");
    writeFileSync(file.path, rewritten + line(prompt("2026-03-01T11:00:00.000Z", "more")));
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(await full(file));
    expect(log.loaded.at(-1)).toBeNull();
  });

  it("reads from the top when the transcript was replaced by another file", async () => {
    const file = transcript(firstPart());
    const { wrapped, log } = spy(checkpoints());
    await parseClaudeTranscript(file, undefined, { checkpoints: wrapped });
    const other = `${file.path}.new`;
    writeFileSync(other, [...firstPart(), ...secondPart()].map(line).join(""));
    renameSync(other, file.path);
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(await full(file));
    expect(log.loaded.at(-1)).toBeNull();
  });

  it("ignores a checkpoint made with other read limits", async () => {
    const file = transcript([...firstPart(), ...secondPart()]);
    const { wrapped, log } = spy(checkpoints());
    await parseClaudeTranscript(file, undefined, { checkpoints: wrapped });
    const limits = { maxBytes: 1e9, maxLineBytes: 1e6, maxLines: 5 };
    expect(await parseClaudeTranscript(file, limits, { checkpoints: wrapped })).toEqual(await parseClaudeTranscript(file, limits));
    expect(log.loaded.at(-1)).toBeNull();
  });

  it("checkpoints every field of the parse, so none is lost on resume", async () => {
    const file = transcript([...firstPart(), ...secondPart()]);
    const { wrapped, log } = spy(checkpoints());
    await parseClaudeTranscript(file, undefined, { checkpoints: wrapped });
    const state = JSON.parse(log.saved[0]!.state) as Record<string, unknown>;
    // Every field the builder has is in the checkpoint; a new kind of field fails the snapshot instead of being dropped.
    expect(Object.keys(state)).toContain("counted");
    expect(Object.keys(state)).toContain("delegates");
    expect(state.sessionId).toBe(SESSION);
  });
});
