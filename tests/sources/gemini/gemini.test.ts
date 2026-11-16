import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { geminiDefaultRoots, geminiSource } from "../../../src/sources/gemini/index.js";

type Rec = Record<string, unknown>;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hindsight-gemini-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SID = "5f0c2a4e-1111-4222-8333-944455556666";
const iso = (seconds: number) => new Date(Date.parse("2026-08-01T09:00:00.000Z") + seconds * 1000).toISOString();
const chats = () => join(dir, "tmp", "projecthash", "chats");

function write(name: string, lines: Rec[], folder = chats()): string {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, name);
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return path;
}

const meta: Rec = { sessionId: SID, projectHash: "projecthash", startTime: iso(0), lastUpdated: iso(0), directories: ["/work/site"], kind: "main" };
const user = (id: string, seconds: number, text: string): Rec => ({ id, type: "user", timestamp: iso(seconds), content: [{ text }] });
const gemini = (id: string, seconds: number, extra: Rec = {}): Rec => ({
  id,
  type: "gemini",
  timestamp: iso(seconds),
  content: "",
  model: "gemini-3-pro",
  tokens: { input: 1200, output: 80, cached: 1000, thoughts: 20, tool: 5, total: 1305 },
  ...extra,
});
const call = (id: string, name: string, args: Rec, status = "success", seconds = 2): Rec => ({ id, name, args, status, timestamp: iso(seconds) });

async function only() {
  const files = await geminiSource.discover({ roots: [join(dir, "tmp")] });
  expect(files).toHaveLength(1);
  return { file: files[0]!, session: (await geminiSource.parse(files[0]!))! };
}

describe("gemini cli chats", () => {
  it("reads prompts, tool calls and token usage from an append-only chat file", async () => {
    write("session-2026-08-01T09-00-abcd1234.jsonl", [
      meta,
      user("u1", 1, "rename the header, token=secretvalue"),
      gemini("g1", 3, { toolCalls: [call("t1", "run_shell_command", { command: "npm run build" }, "error"), call("t2", "replace", { file_path: "/work/site/a.ts", old_string: "a", new_string: "b" })] }),
      { $patch: { id: "g1", toolCalls: [{ id: "t1", result: [{ functionResponse: { response: { error: "Command exited with code 2" } } }] }] } },
      gemini("g2", 10, { content: "Renamed." , toolCalls: [] }),
      { $set: { summary: "renaming", lastUpdated: iso(10) } },
      user("u2", 40, "thanks"),
    ]);
    const { session } = await only();
    expect(session.harness).toBe("gemini");
    expect(session.id).toBe(SID);
    expect(session.projectPath).toBe("/work/site");
    expect(session.prompts.map((prompt) => prompt.text)).toEqual(["rename the header, token=[redacted]", "thanks"]);
    expect(session.userResponseTimesSec).toEqual([30]);
    expect(session.requests[0]).toMatchObject({ model: "gemini-3-pro", usage: { input: 205, cachedInput: 1000, cacheWrite: 0, output: 100 } });
    expect(session.requests[0]!.costUsd).toBeUndefined();
    expect(session.toolCalls.map((tool) => [tool.name, tool.category, tool.error ?? null])).toEqual([
      ["run_shell_command", "shell", "command_failed"],
      ["replace", "edit", null],
    ]);
    expect(session.filesModified).toEqual(["/work/site/a.ts"]);
  });

  it("reads the older single-document chat files", async () => {
    write("session-2025-09-01T10-00-old.json", []);
    writeFileSync(join(chats(), "session-2025-09-01T10-00-old.json"), JSON.stringify({ ...meta, messages: [user("u1", 0, "hello"), gemini("g1", 2, { content: "hi" })] }));
    const { session, file } = await only();
    expect(session.prompts).toHaveLength(1);
    expect(session.requests).toHaveLength(1);
    expect((await geminiSource.excerpt(file)).map((turn) => turn.role)).toEqual(["user", "assistant"]);
  });

  it("folds subagent chats into their parent without counting the subagent's brief", async () => {
    write("session-2026-08-01T09-00-abcd1234.jsonl", [meta, user("u1", 1, "investigate"), gemini("g1", 2, { toolCalls: [call("t1", "codebase_investigator", { objective: "x" })] })]);
    write("child.jsonl", [{ ...meta, sessionId: "child-1", kind: "subagent" }, user("c1", 3, "objective x"), gemini("c2", 4, { toolCalls: [call("t2", "read_file", { file_path: "/work/site/b.ts" }, "success", 4)] })], join(chats(), SID));
    const { session } = await only();
    expect(session.prompts).toHaveLength(1);
    expect(session.requests).toHaveLength(2);
    expect(session.toolCalls.map((tool) => tool.name)).toEqual(["codebase_investigator", "read_file"]);
    expect(session.features.subagents).toBe(1);
  });

  it("honours GEMINI_CLI_HOME", () => {
    expect(geminiDefaultRoots({ GEMINI_CLI_HOME: "/elsewhere" }, "/home/someone")).toEqual(["/elsewhere/.gemini/tmp"]);
    expect(geminiDefaultRoots({}, "/home/someone")).toEqual(["/home/someone/.gemini/tmp"]);
  });
});
