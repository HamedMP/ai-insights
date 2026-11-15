import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexSource } from "../../../src/sources/codex/index.js";
import { assistant, event, item, meta, resetClock, rolloutName, shell, Tree, userMessage, uuid, type Rec } from "./fixtures.js";

let tree: Tree;
beforeEach(() => {
  tree = new Tree();
  resetClock();
});
afterEach(() => tree.cleanup());

async function excerptOf(records: Rec[], options = {}) {
  tree.write(rolloutName(1), records);
  const [file] = await codexSource.discover({ roots: [tree.sessions] });
  return codexSource.excerpt(file!, options);
}

const done = (payload: Rec): Rec => event({ type: "item_completed", thread_id: uuid(1), turn_id: "t1", item: payload });

describe("codex excerpts for the model pass", () => {
  it("summarises each tool call in one readable line instead of raw connector JSON", async () => {
    const turns = await excerptOf([
      meta(uuid(1)),
      done({ type: "UserMessage", id: "u", content: [{ type: "text", text: "check the PR" }] }),
      done({
        type: "McpToolCall",
        id: "m1",
        server: "codex_apps",
        tool: "github.get_pr_info",
        arguments: { repo: "acme/widgets", pr_number: 12, include_diff: true, body: { nested: "x".repeat(500) } },
        result: { content: [{ type: "text", text: JSON.stringify({ title: "x", body: "y".repeat(2000) }) }] },
        status: "completed",
      }),
      done({ type: "McpToolCall", id: "m2", server: "figma", tool: "get_design", arguments: {}, error: { message: "rate limited\nretry later" }, status: "failed" }),
      done({
        type: "CommandExecution",
        id: "c1",
        command: ["/bin/bash", "-lc", "pnpm test\n  --run"],
        parsed_cmd: [{ type: "unknown", cmd: "pnpm test" }],
        status: "failed",
        exit_code: 1,
        aggregated_output: "\n\nFAIL tests/a.test.ts\n" + "noise\n".repeat(200),
      }),
      done({ type: "CommandExecution", id: "c2", command: ["/bin/bash", "-lc", "sed -n 1,5p src/a.ts"], parsed_cmd: [{ type: "read", cmd: "sed", name: "a.ts", path: "src/a.ts" }], status: "completed", exit_code: 0, aggregated_output: "secret file content" }),
      done({ type: "FileChange", id: "f1", status: "completed", changes: { "/w/src/a.ts": { type: "update", unified_diff: "@@\n-a\n+b\n+c\n" }, "/w/b.md": { type: "add", content: "x\n" } } }),
      done({ type: "Extension", id: "e1", kind: "web.search", action: { type: "search", query: "vitest retry", queries: null } }),
      done({ type: "SubAgentActivity", id: "s1", kind: "started", agent_path: "/root/reviewer" }),
      item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "PR looks good" }] }),
    ]);
    const tools = turns.filter((turn) => turn.role === "tool");
    expect(tools.map((turn) => turn.text)).toEqual([
      "codex_apps github.get_pr_info (repo: acme/widgets, pr_number: 12, include_diff: true)",
      "figma get_design → failed: rate limited",
      "$ pnpm test --run → exit 1: FAIL tests/a.test.ts",
      "read src/a.ts",
      "edit 2 files: /w/src/a.ts (+2 −1), /w/b.md (+1)",
      'web search "vitest retry"',
      "spawn agent reviewer",
    ]);
    expect(tools.map((turn) => turn.isError ?? false)).toEqual([false, true, true, false, false, false, false]);
    expect(JSON.stringify(turns)).not.toContain("secret file content");
  });

  it("keeps the person's prompts, failures and the final answer when it has to drop turns", async () => {
    const records: Rec[] = [meta(uuid(1)), ...userMessage("start the migration")];
    for (let index = 0; index < 60; index += 1) {
      records.push(...shell(`c${index}`, `step ${index}`, index === 17 ? 2 : 0, "ok"));
      if (index % 10 === 0) records.push(...assistant(`progress ${index}`));
    }
    records.push(event({ type: "task_started" }));
    records.push(event({ type: "turn_aborted", reason: "interrupted" }));
    records.push(...userMessage("stop, use the other table"));
    for (let index = 60; index < 90; index += 1) records.push(...shell(`c${index}`, `step ${index}`, 0, "ok"));
    records.push(...assistant("migration finished"));
    const turns = await excerptOf(records, { maxTurns: 8 });
    expect(turns).toHaveLength(8);
    const texts = turns.map((turn) => turn.text);
    expect(texts).toContain("start the migration");
    expect(texts).toContain("stop, use the other table");
    expect(texts).toContain("[interrupted]");
    expect(texts).toContain("migration finished");
    expect(turns.some((turn) => turn.isError && turn.text.startsWith("$ step 17"))).toBe(true);
    expect(turns.map((turn) => Date.parse(turn.timestamp))).toEqual([...turns.map((turn) => Date.parse(turn.timestamp))].sort((a, b) => a - b));
  });
});
