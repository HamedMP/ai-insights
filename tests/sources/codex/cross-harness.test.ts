import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeSource } from "../../../src/sources/claude/index.js";
import { codexSource } from "../../../src/sources/codex/index.js";
import { event, meta, resetClock, rolloutName, Tree, userMessage, uuid } from "./fixtures.js";

let tree: Tree;
beforeEach(() => {
  tree = new Tree();
  resetClock();
});
afterEach(() => tree.cleanup());

/** A minimal hand-written Claude Code transcript that started in `cwd`. */
async function claudeProject(cwd: string): Promise<string | null> {
  const session = "22222222-3333-4444-8555-666666666666";
  const path = join(tree.root, "claude", "projects", "-repo", `${session}.jsonl`);
  mkdirSync(join(tree.root, "claude", "projects", "-repo"), { recursive: true });
  const base = { sessionId: session, cwd, gitBranch: "main", isSidechain: false, version: "2.0.0", parentUuid: null };
  const lines = [
    { ...base, uuid: "a", type: "user", timestamp: "2026-03-02T09:00:00.000Z", message: { role: "user", content: "fix the bug" } },
    {
      ...base,
      uuid: "b",
      type: "assistant",
      timestamp: "2026-03-02T09:00:05.000Z",
      requestId: "req-1",
      message: { id: "m1", type: "message", role: "assistant", model: "claude-test", content: [{ type: "text", text: "fixed" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } },
    },
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  const parsed = await claudeSource.parse({ harness: "claude-code", path, mtimeMs: 1, sizeBytes: 1 });
  return parsed?.projectPath ?? null;
}

async function codexProject(records: Record<string, unknown>[]): Promise<string | null> {
  tree.write(rolloutName(1), records);
  const [file] = await codexSource.discover({ roots: [tree.sessions] });
  return (await codexSource.parse(file!))?.projectPath ?? null;
}

describe("one repository, one project, whichever harness was used", () => {
  it("gives a Codex session started in a parent folder the same projectPath as a Claude session in the repository", async () => {
    const parent = join(tree.root, "projects");
    const repo = join(parent, "widgets");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const edit = (path: string) =>
      event({ type: "item_completed", thread_id: uuid(1), turn_id: "t1", item: { type: "FileChange", id: path, status: "completed", changes: { [path]: { type: "update", unified_diff: "@@\n-a\n+b\n" } } } });
    const codex = await codexProject([meta(uuid(1), { cwd: parent }), ...userMessage("fix the bug"), edit(join(repo, "src", "a.ts")), edit(join(repo, "src", "b.ts"))]);
    expect(codex).toBe(repo);
    expect(codex).toBe(await claudeProject(repo));
  });

  it("keeps a repository under the home directory as the same absolute path in both", async () => {
    const repo = join(homedir(), "ai-insights-cross-harness-fixture");
    const codex = await codexProject([meta(uuid(1), { cwd: repo }), ...userMessage("fix the bug")]);
    expect(codex).toBe(repo);
    expect(codex).toBe(await claudeProject(repo));
  });
});
