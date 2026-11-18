import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeTranscript } from "../../../src/sources/claude/parse.js";
import { parseClaudeTranscript as referenceParse } from "../../reference/claude-parse.js";
import { assistant, prompt, text, thinking, toolResult, toolUse, transcript, writeLines } from "./helpers.js";

// The parser now folds subagent lines through one reduced form (`subagentEvent`) and tool calls and results through
// pure "facts", so a saved log can replay them. These tests hold it to the parser before that change, kept verbatim
// in tests/reference, on transcripts with subagents and on every odd shape the reduction handles.

const sub = (extra: Record<string, unknown> = {}) => ({ isSidechain: true, ...extra });
const lines = (): unknown[] => [
  assistant("2026-03-01T10:00:05.000Z", "s1", [thinking("p"), text("ok"), toolUse("a1", "Bash", { command: "git commit -m x && git push" })], { usage: { input: 30, output: 4, cacheRead: 5, cache5m: 1, cache1h: 2, speed: "fast" }, extra: sub({ thinkingDurationMs: 1200, permissionMode: "acceptEdits", cwd: "/work/other" }) }),
  toolResult("2026-03-01T10:00:06.000Z", "a1", [{ type: "text", text: "Exit code 1" }], { error: true }),
  { ...toolResult("2026-03-01T10:00:07.000Z", "a1", "ok", { result: { gitOperation: { commit: true, push: true } } }), uuid: "p1", permissionDecision: { decision: "accept", source: "user" } },
  { ...toolResult("2026-03-01T10:00:07.500Z", "a1", "ok"), uuid: "p1", permissionDecision: { decision: "accept", source: "user" } },
  assistant("2026-03-01T10:00:08.000Z", "s2", [toolUse("a2", "Write", { file_path: "/work/a.ts", content: "a\nb" }), toolUse("a3", "MultiEdit", { file_path: "/work/b.ts", edits: [{ old_string: "x", new_string: "y\nz" }, 3] }), toolUse("a4", "Edit", { file_path: "/work/c.ts", old_string: "q", new_string: "r" })], { usage: { input: 1, output: 1 }, extra: sub() }),
  toolResult("2026-03-01T10:00:09.000Z", "a2", "ok", { result: { type: "update", originalFile: "a\nq", content: "a\nb" } }),
  toolResult("2026-03-01T10:00:09.500Z", "a4", "File has been modified since read", { error: true }),
  assistant("2026-03-01T10:00:10.000Z", "s3", [toolUse("a5", "Skill", { skill: "review" }), toolUse("a6", "SlashCommand", { command: "deploy now" }), toolUse("a7", "mcp__linear__search", {}), toolUse("a8", "NotebookEdit", { notebook_path: "/n.ipynb", new_source: "1\n2" }), toolUse("a9", "WebSearch", {}), toolUse("a1", "Bash", { command: "dup id" })], { usage: { input: 2, output: 2 }, extra: sub() }),
  assistant("2026-03-01T10:00:11.000Z", "s4", [], { usage: { input: 900, output: 0 }, stop: null, extra: sub() }),
  assistant("2026-03-01T10:00:12.000Z", "s4", [], { usage: { input: 9, output: 3 }, extra: sub() }),
  assistant("2026-03-01T10:00:13.000Z", "s5", [thinking("x"), toolUse("b1", "Read", { file_path: "/r" })], { model: "<synthetic>", extra: sub() }),
  { ...assistant("2026-03-01T10:00:15.000Z", "s6", [toolUse("b2", "Read", { file_path: "/x" })], { usage: { input: 4, output: 4 } }), timestamp: "later" },
  { type: "assistant", timestamp: "2026-03-01T10:00:16.000Z", message: "text" },
  { type: "assistant", timestamp: "2026-03-01T10:00:17.000Z", message: [1, 2] },
  { type: "assistant", timestamp: "2026-03-01T10:00:17.500Z", message: { id: "s9", model: "m", usage: [1], content: "no" } },
  { type: "assistant", timestamp: "2026-03-01T10:00:17.700Z", message: { id: "s10", model: "m", usage: { input_tokens: 1, output_tokens: 1, cache_creation: "x" }, content: [] } },
  { type: "user", timestamp: "2026-03-01T10:00:18.000Z" },
  { type: "user", timestamp: "2026-03-01T10:00:19.000Z", message: { content: "plain" }, permissionDecision: "yes" },
  { type: "system", subtype: "compact_boundary", timestamp: "2026-03-01T10:00:21.000Z", permissionMode: "plan" },
  { type: "attachment", attachment: { type: "queued_command", prompt: "p" } },
  "not json",
];

describe("the Claude Code parser gives what it gave before subagent lines were reduced", () => {
  it("on a session whose subagents use every kind of line", async () => {
    const file = transcript([prompt("2026-03-01T10:00:00.000Z", "go"), assistant("2026-03-01T10:00:02.000Z", "m1", [toolUse("t1", "Task", { name: "helper" })], { usage: { input: 1, output: 1 } })]);
    writeLines(join(file.path.slice(0, -".jsonl".length), "subagents", "agent-a.jsonl"), lines());
    writeLines(join(file.path.slice(0, -".jsonl".length), "subagents", "agent-b.jsonl"), lines().slice(4, 12));
    expect(await parseClaudeTranscript(file)).toEqual(await referenceParse(file));
  });

  it("on sidechain lines written into the main file, as older versions did", async () => {
    const file = transcript([prompt("2026-03-01T10:00:00.000Z", "go"), assistant("2026-03-01T10:00:01.000Z", "m0", [], { usage: { input: 1, output: 1 } }), ...lines()]);
    expect(await parseClaudeTranscript(file)).toEqual(await referenceParse(file));
  });

});
