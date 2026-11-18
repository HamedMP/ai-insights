import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseClaudeTranscript, type Checkpoints, type ParseCheckpoint } from "../../../src/sources/claude/parse.js";
import { readSubagentLog } from "../../../src/sources/claude/subagent-log.js";
import { TailCheckpoints } from "../../../src/store/tail.js";
import { assistant, prompt, text, thinking, toolResult, toolUse, transcript, writeLines } from "./helpers.js";

// With checkpoints, subagent lines are replayed from a saved, reduced log instead of being read again. The Session
// must be exactly the one a plain full read gives, for any line the reduction sees.

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function store(): TailCheckpoints {
  const dir = mkdtempSync(join(tmpdir(), "ai-insights-sublog-"));
  dirs.push(dir);
  return new TailCheckpoints(dir, { minBytes: 0 });
}
/** Saves every log, however small, and counts the loads that found one. */
function eager(inner: TailCheckpoints) {
  const hits = { loaded: 0 };
  const wrapped: Checkpoints = {
    minBytes: 0,
    load: async (path, key) => {
      const value = await inner.load(path, key);
      if (value && key.startsWith("claude-subagent")) hits.loaded += 1;
      return value;
    },
    save: (path, key, checkpoint: ParseCheckpoint) => inner.save(path, key, checkpoint, 0),
  };
  return { wrapped, hits };
}

const line = (value: unknown) => `${typeof value === "string" ? value : JSON.stringify(value)}\n`;
const sub = (extra: Record<string, unknown> = {}) => ({ isSidechain: true, ...extra });

function mainFile() {
  return transcript([
    prompt("2026-03-01T10:00:00.000Z", "split the work", { permissionMode: "default" }),
    assistant("2026-03-01T10:00:02.000Z", "m1", [toolUse("t1", "Task", { name: "helper", prompt: "x" })], { usage: { input: 10, output: 2 } }),
  ]);
}

/** Lines in every shape the parse treats specially, from a subagent. */
function subLines(): unknown[] {
  return [
    assistant("2026-03-01T10:00:05.000Z", "s1", [thinking("plan"), text("ok"), toolUse("st1", "Bash", { command: "git commit -m x && git push", description: "ignored" })], {
      usage: { input: 30, output: 4, cacheRead: 5, cache5m: 1, cache1h: 2, speed: "fast" },
      model: "claude-opus-4-8",
      extra: sub({ thinkingDurationMs: 1200, permissionMode: "acceptEdits", cwd: "/work/elsewhere", gitBranch: "feature" }),
    }),
    toolResult("2026-03-01T10:00:06.000Z", "st1", [{ type: "text", text: "Exit code 1\nfatal: nope" }], { error: true, result: { stdout: "big output".repeat(50) } }),
    { ...toolResult("2026-03-01T10:00:07.000Z", "st1", "fine", { result: { gitOperation: { commit: true, push: true } } }), ...sub({ permissionDecision: { decision: "accept", source: "user-click", extra: 1 } }) },
    assistant("2026-03-01T10:00:08.000Z", "s2", [toolUse("st2", "Write", { file_path: "/work/demo/a.ts", content: "a\nb\nc" }), toolUse("st3", "MultiEdit", { file_path: "/work/demo/b.ts", edits: [{ old_string: "x", new_string: "y\nz" }, "junk", null] })], { usage: { input: 1, output: 1 }, extra: sub() }),
    toolResult("2026-03-01T10:00:09.000Z", "st2", "ok", { result: { type: "update", originalFile: "a\nq", content: "a\nb\nc", structuredPatch: [] } }),
    assistant("2026-03-01T10:00:10.000Z", "s3", [toolUse("st4", "NotebookEdit", { notebook_path: "/work/n.ipynb", new_source: "1\n2", edit_mode: "insert" }), toolUse("st5", "Skill", { skill: "review" }), toolUse("st6", "mcp__linear__search", { q: 1 })], { usage: { input: 2, output: 2 }, extra: sub() }),
    // A failed edit whose error text names the cause; a command with no git in it whose result reports a commit;
    // the same permission line twice (counted once, by uuid).
    assistant("2026-03-01T10:00:10.500Z", "s3b", [toolUse("st9", "Edit", { file_path: "/work/demo/c.ts", old_string: "a", new_string: "b" }), toolUse("st10", "Bash", { command: "./ship" })], { usage: { input: 2, output: 2 }, extra: sub() }),
    toolResult("2026-03-01T10:00:10.600Z", "st9", "File has been modified since read, read it again", { error: true }),
    toolResult("2026-03-01T10:00:10.700Z", "st10", "shipped", { result: { gitOperation: { commit: true } } }),
    { ...toolResult("2026-03-01T10:00:10.800Z", "st10", "again"), uuid: "dup-perm", permissionDecision: { decision: "accept", source: "user" } },
    { ...toolResult("2026-03-01T10:00:10.900Z", "st10", "again"), uuid: "dup-perm", permissionDecision: { decision: "accept", source: "user" } },
    // A proxy placeholder, then its completed copy; a synthetic reply; a reply with usage but no ids.
    assistant("2026-03-01T10:00:11.000Z", "s4", [], { usage: { input: 900, output: 0 }, stop: null, extra: sub() }),
    assistant("2026-03-01T10:00:12.000Z", "s4", [], { usage: { input: 9, output: 3 }, extra: sub() }),
    assistant("2026-03-01T10:00:13.000Z", "s5", [text("x")], { model: "<synthetic>", extra: sub() }),
    { ...assistant("2026-03-01T10:00:14.000Z", "", [], { usage: { input: 3, output: 3 } }), requestId: "", message: { model: "m", usage: { input_tokens: 3, output_tokens: 3 } } },
    // Untimed: its tool call borrows the session's end time.
    { ...assistant("2026-03-01T10:00:15.000Z", "s6", [toolUse("st7", "Read", { file_path: "/work/demo/README.md" })], { usage: { input: 4, output: 4 } }), timestamp: "later" },
    // Odd shapes: a message that is a string, an array or missing; content that is not an array; a non-object block.
    { type: "assistant", timestamp: "2026-03-01T10:00:16.000Z", message: "text" },
    { type: "assistant", timestamp: "2026-03-01T10:00:17.000Z", message: [1, 2] },
    { type: "user", timestamp: "2026-03-01T10:00:18.000Z" },
    { type: "user", timestamp: "2026-03-01T10:00:19.000Z", message: { content: "plain text" }, permissionDecision: "yes" },
    { type: "assistant", timestamp: "2026-03-01T10:00:20.000Z", message: { id: "s7", model: "claude-opus-4-8", usage: { input_tokens: 1, output_tokens: 1 }, content: ["x", null, { type: "tool_use", id: "st8", name: "Edit", input: "nope" }] } },
    { type: "system", subtype: "compact_boundary", timestamp: "2026-03-01T10:00:21.000Z", permissionMode: "plan" },
    { type: "attachment", attachment: { type: "queued_command", prompt: "ignored in subagents" } },
    { type: "permission-mode", permissionMode: "bypassPermissions" },
    "not json",
    "[1,2]",
  ];
}

describe("replaying subagent transcripts from their saved logs", () => {
  it("gives exactly the Session of a full read, first from the file and then from the log", async () => {
    const file = mainFile();
    writeLines(join(file.path.slice(0, -".jsonl".length), "subagents", "agent-a.jsonl"), subLines());
    const { wrapped, hits } = eager(store());
    const expected = await parseClaudeTranscript(file);
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(expected);
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(expected);
    expect(hits.loaded).toBe(1);
  });

  it("follows a live team session: the main file and its subagents grow, and new subagents appear", async () => {
    const file = mainFile();
    const dir = join(file.path.slice(0, -".jsonl".length), "subagents");
    const lines = subLines();
    writeLines(join(dir, "agent-a.jsonl"), lines.slice(0, 5));
    const { wrapped, hits } = eager(store());
    await parseClaudeTranscript(file, undefined, { checkpoints: wrapped });
    const steps: Array<() => void> = [
      () => appendFileSync(join(dir, "agent-a.jsonl"), lines.slice(5, 9).map(line).join("")),
      () => appendFileSync(file.path, line(prompt("2026-03-01T10:05:00.000Z", "and now", { permissionMode: "plan" }))),
      () => writeLines(join(dir, "agent-0.jsonl"), lines.slice(9, 14)),
      () => appendFileSync(join(dir, "agent-a.jsonl"), line(lines[14]).slice(0, 20)),
      () => appendFileSync(join(dir, "agent-a.jsonl"), line(lines[14]).slice(20) + lines.slice(15).map(line).join("")),
    ];
    for (const step of steps) {
      step();
      expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(await parseClaudeTranscript(file));
    }
    expect(hits.loaded).toBeGreaterThan(3);
  });

  it("takes the folder and branch from a subagent when the main file has none, as a full read does", async () => {
    const file = transcript([prompt("2026-03-01T10:00:00.000Z", "go", { cwd: undefined, gitBranch: undefined }), { ...assistant("2026-03-01T10:00:02.000Z", "m1", [], { usage: { input: 1, output: 1 } }), cwd: undefined, gitBranch: undefined }]);
    writeLines(join(file.path.slice(0, -".jsonl".length), "subagents", "agent-a.jsonl"), subLines());
    const { wrapped } = eager(store());
    const expected = await parseClaudeTranscript(file);
    expect(expected?.projectPath).toBe("/work/elsewhere");
    await parseClaudeTranscript(file, undefined, { checkpoints: wrapped });
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(expected);
  });

  it("reads a subagent file again in full when it was rewritten or truncated", async () => {
    const file = mainFile();
    const path = join(file.path.slice(0, -".jsonl".length), "subagents", "agent-a.jsonl");
    writeLines(path, subLines());
    const { wrapped } = eager(store());
    await parseClaudeTranscript(file, undefined, { checkpoints: wrapped });
    writeFileSync(path, subLines().slice(0, 3).map(line).join(""));
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(await parseClaudeTranscript(file));
    writeFileSync(path, subLines().slice(0, 3).map(line).join("").replace("Exit code 1", "Exit code 2") + subLines().slice(3).map(line).join(""));
    expect(await parseClaudeTranscript(file, undefined, { checkpoints: wrapped })).toEqual(await parseClaudeTranscript(file));
  });

  it("saves no prompt, tool output, file content or assistant text, and commands only scrubbed", async () => {
    const file = mainFile();
    const path = join(file.path.slice(0, -".jsonl".length), "subagents", "agent-a.jsonl");
    writeLines(path, [
      { ...prompt("2026-03-01T10:00:04.000Z", "SUBAGENT-BRIEF-MARKER"), isSidechain: true },
      assistant("2026-03-01T10:00:05.000Z", "s1", [text("ASSISTANT-TEXT-MARKER"), toolUse("w1", "Write", { file_path: "/work/a.ts", content: "FILE-CONTENT-MARKER\nline" }), toolUse("b1", "Bash", { command: "export API_KEY=sk-abcdefghijklmnopqrstuvwx && deploy" })], { usage: { input: 1, output: 1 }, extra: sub() }),
      toolResult("2026-03-01T10:00:06.000Z", "b1", "TOOL-OUTPUT-MARKER exit code 1", { error: true }),
      toolResult("2026-03-01T10:00:07.000Z", "w1", "ok", { result: { type: "update", originalFile: "OLD-FILE-MARKER", content: "FILE-CONTENT-MARKER\nline" } }),
    ]);
    const saved: string[] = [];
    const checkpoints: Checkpoints = { minBytes: 0, load: async () => null, save: async (_path, _key, checkpoint) => void saved.push(checkpoint.state) };
    const log = await readSubagentLog(path, { maxBytes: 1e9, maxLineBytes: 1e8, maxLines: 1e6 }, checkpoints);
    expect(log.events.length).toBe(4);
    const text_ = saved.join("") + JSON.stringify(log);
    for (const marker of ["SUBAGENT-BRIEF-MARKER", "ASSISTANT-TEXT-MARKER", "FILE-CONTENT-MARKER", "TOOL-OUTPUT-MARKER", "OLD-FILE-MARKER", "sk-abcdefghijklmnopqrstuvwx"]) expect(text_).not.toContain(marker);
    expect(text_).toContain("API_KEY=[redacted]");
  });
});
