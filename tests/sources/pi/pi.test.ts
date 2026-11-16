import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { piDefaultRoots, piSource } from "../../../src/sources/pi/index.js";

type Rec = Record<string, unknown>;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hindsight-pi-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const T0 = Date.parse("2026-07-18T19:28:30.000Z");
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
let entry = 0;
const eid = () => (entry += 1).toString(16).padStart(8, "0");

function write(root: string, name: string, records: Rec[]): string {
  const folder = join(root, "--work-app--");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, name);
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return path;
}

const header = (id: string): Rec => ({ type: "session", version: 3, id, timestamp: iso(0), cwd: "/work/app" });
const msg = (seconds: number, message: Rec): Rec => ({ type: "message", id: eid(), parentId: null, timestamp: iso(seconds), message: { timestamp: T0 + seconds * 1000, ...message } });
const user = (seconds: number, text: string) => msg(seconds, { role: "user", content: [{ type: "text", text }] });
const usage = (input: number, output: number, cacheRead = 0, cost = 0.01): Rec => ({
  input, output, cacheRead, cacheWrite: 0, reasoning: 2, totalTokens: input + output + cacheRead, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});
const assistant = (seconds: number, stopReason: string, content: Rec[], extra: Rec = {}) =>
  msg(seconds, { role: "assistant", api: "openai-codex-responses", provider: "openai-codex", model: "gpt-5.5", stopReason, usage: usage(100, 10, 500), responseId: `resp_${seconds}`, content, ...extra });
const call = (id: string, name: string, args: Rec): Rec => ({ type: "toolCall", id, name, arguments: args });
const result = (seconds: number, id: string, name: string, isError: boolean, text: string, details?: Rec) =>
  msg(seconds, { role: "toolResult", toolCallId: id, toolName: name, isError, content: [{ type: "text", text }], ...(details ? { details } : {}) });

describe("pi sessions", () => {
  it("reads prompts, tool calls, edits and token usage with Pi's recorded cost", async () => {
    const root = join(dir, "sessions");
    write(root, "2026-07-18T19-28-30-912Z_11111111-2222-4333-8444-555555555555.jsonl", [
      header("11111111-2222-4333-8444-555555555555"),
      { type: "model_change", id: eid(), parentId: null, timestamp: iso(0), provider: "openai-codex", modelId: "gpt-5.5" },
      user(1, "make the tests pass, my key is sk-abcdefghijklmnopqrstuv"),
      assistant(5, "toolUse", [call("c1", "bash", { command: "npm test" }), call("c2", "edit", { path: "/work/app/a.ts", edits: [{ oldText: "x", newText: "y\nz" }] })]),
      result(6, "c1", "bash", true, "Command exited with code 1"),
      result(7, "c2", "edit", false, "ok", { diff: "-x\n+y\n+z" }),
      assistant(10, "stop", [{ type: "text", text: "All green." }]),
      user(70, "great"),
    ]);
    const [file] = await piSource.discover({ roots: [root] });
    const session = (await piSource.parse(file!))!;
    expect(session.harness).toBe("pi");
    expect(session.id).toBe("11111111-2222-4333-8444-555555555555");
    expect(session.projectPath).toBe("/work/app");
    expect(session.prompts.map((prompt) => prompt.text)).toEqual(["make the tests pass, my key is [redacted]", "great"]);
    expect(session.userResponseTimesSec).toEqual([60]);
    expect(session.requests).toHaveLength(2);
    expect(session.requests[0]).toMatchObject({ id: "resp_5", model: "openai-codex/gpt-5.5", usage: { input: 100, cachedInput: 500, output: 10 }, costUsd: 0.01 });
    expect(session.toolCalls.map((tool) => [tool.name, tool.category, tool.error ?? null])).toEqual([
      ["bash", "shell", "command_failed"],
      ["edit", "edit", null],
    ]);
    expect(session.toolCalls[0]!.command).toBe("npm test");
    expect(session.linesAdded).toBe(2);
    expect(session.linesRemoved).toBe(1);
    expect(session.filesModified).toEqual(["/work/app/a.ts"]);
  });

  it("counts a compaction and its model call, and marks the prompt after an abort as an interruption", async () => {
    const root = join(dir, "sessions");
    write(root, "s.jsonl", [
      header("aaaaaaaa-2222-4333-8444-555555555555"),
      user(1, "start"),
      assistant(5, "aborted", []),
      user(8, "no, do it differently"),
      { type: "compaction", id: eid(), parentId: null, timestamp: iso(20), summary: "SUMMARY TEXT", tokensBefore: 9000, usage: usage(9000, 300, 0, 0.05) },
      assistant(30, "stop", [{ type: "text", text: "done" }]),
    ]);
    const [file] = await piSource.discover({ roots: [root] });
    const session = (await piSource.parse(file!))!;
    expect(session.features.compactions).toBe(1);
    expect(session.requests.map((request) => request.costUsd)).toEqual([0.01, 0.05, 0.01]);
    expect(session.prompts[1]).toMatchObject({ text: "no, do it differently", interrupted: true });
    expect(JSON.stringify(session)).not.toContain("SUMMARY TEXT");
  });

  it("skips torn lines and counts them, and returns an excerpt of the conversation", async () => {
    const root = join(dir, "sessions");
    const path = write(root, "s.jsonl", [header("bbbbbbbb-2222-4333-8444-555555555555"), user(1, "hi"), assistant(2, "stop", [{ type: "text", text: "hello" }])]);
    writeFileSync(path, '{"type":"message","id":', { flag: "a" });
    const [file] = await piSource.discover({ roots: [root] });
    const session = (await piSource.parse(file!))!;
    expect(session.issues).toBe(1);
    expect((await piSource.excerpt(file!)).map((turn) => [turn.role, turn.text])).toEqual([
      ["user", "hi"],
      ["assistant", "hello"],
    ]);
  });

  it("looks in Pi's and OMP's session folders, honouring the Pi environment overrides", () => {
    const home = "/home/someone";
    expect(piDefaultRoots({}, home)).toEqual(
      expect.arrayContaining([join(home, ".pi", "agent", "sessions"), join(home, ".omp", "agent", "sessions"), join(home, ".omp", "profiles")]),
    );
    expect(piDefaultRoots({ PI_CODING_AGENT_DIR: "/custom/agent" }, home)[0]).toBe("/custom/agent/sessions");
    expect(piDefaultRoots({ PI_CODING_AGENT_SESSION_DIR: "/direct", PI_CODING_AGENT_DIR: "/custom/agent" }, home)[0]).toBe("/direct");
  });
});

describe("pi thinking", () => {
  it("counts assistant messages that hold a thinking block, without durations", async () => {
    const root = join(dir, "sessions");
    write(root, "2026-07-18T19-28-30-912Z_11111111-2222-4333-8444-555555555556.jsonl", [
      header("11111111-2222-4333-8444-555555555556"),
      user(1, "fix it"),
      assistant(5, "toolUse", [{ type: "thinking", thinking: "look first", thinkingSignature: "sig" }, { type: "thinking", thinking: "more" }, call("c1", "bash", { command: "ls" })]),
      result(6, "c1", "bash", false, "ok"),
      assistant(8, "stop", [{ type: "text", text: "Done." }]),
    ]);
    const [file] = await piSource.discover({ roots: [root] });
    const session = (await piSource.parse(file!))!;
    expect(session.thinking).toEqual({ blocks: 1, totalMs: null, longestMs: null });
  });
});
