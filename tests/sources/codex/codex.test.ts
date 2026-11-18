import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { codexSource } from "../../../src/sources/codex/index.js";
import { zstdSupport } from "../../../src/sources/codex/read.js";
import type { SessionFile } from "../../../src/schema/types.js";
import {
  assistant,
  at,
  canZstd,
  event,
  item,
  meta,
  rec,
  resetClock,
  rolloutName,
  shell,
  tokenCount,
  tokenCountWithLast,
  Tree,
  turnContext,
  userMessage,
  uuid,
  type Rec,
} from "./fixtures.js";

let tree: Tree;
beforeEach(() => {
  tree = new Tree();
  resetClock();
});
afterEach(() => tree.cleanup());

async function only(): Promise<SessionFile> {
  const files = await codexSource.discover({ roots: [tree.sessions] });
  expect(files).toHaveLength(1);
  return files[0]!;
}

async function parseOne(records: Rec[], options: Parameters<Tree["write"]>[2] = {}) {
  tree.write(rolloutName(1), records, options);
  const session = await codexSource.parse(await only());
  expect(session).not.toBeNull();
  return session!;
}

describe("codex discovery", () => {
  it("finds the person's history under CODEX_HOME, plain and zstd, newest first", async () => {
    const old = new Date("2026-01-01T00:00:00Z");
    const recent = new Date("2026-03-01T00:00:00Z");
    tree.write(rolloutName(1), [meta(uuid(1)), ...userMessage("hi")], { mtime: old });
    tree.write(rolloutName(2), [meta(uuid(2)), ...userMessage("hello")], { mtime: recent, zst: canZstd, day: "2026-03-01" });
    writeFileSync(join(tree.root, "sessions", "notes.txt"), "not a rollout");
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tree.root;
    try {
      expect(codexSource.defaultRoots()).toEqual([join(tree.root, "sessions"), join(tree.root, "archived_sessions")]);
      const files = await codexSource.discover();
      expect(files.map((file) => file.path.includes(uuid(2)))).toEqual([true, false]);
      expect(files.every((file) => file.harness === "codex")).toBe(true);
      expect(await codexSource.discover({ maxFiles: 1 })).toHaveLength(1);
      expect(await codexSource.discover({ since: new Date("2026-02-01T00:00:00Z") })).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    }
  });

  it("reports nothing, without throwing, when Codex was never installed", async () => {
    expect(await codexSource.discover({ roots: [join(tree.root, "missing")] })).toEqual([]);
  });
});

describe("codex CLI rollouts", () => {
  it("keeps only what the person typed, not injected context or instructions", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n<cwd>/work/demo</cwd>\n</environment_context>" }] }),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /work/demo\n\nbe nice" }] }),
      turnContext(),
      ...userMessage("# Context from my IDE setup:\n\n## Open tabs:\n- a.ts\n\n## My request for Codex:\nfix the failing test"),
      ...assistant("done"),
    ]);
    expect(session.prompts.map((prompt) => prompt.text)).toEqual(["fix the failing test"]);
    expect(session.userMessageCount).toBe(1);
    expect(session.assistantMessageCount).toBe(1);
    expect(session.projectPath).toBe("/work/demo");
    expect(session.gitBranch).toBe("main");
    expect(session.models).toEqual(["gpt-test"]);
    expect(session.permissionMode).toBe("on-request/workspace-write");
  });

  it("redacts secrets a person pasted into a prompt", async () => {
    const session = await parseOne([meta(uuid(1)), ...userMessage("use OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456 please")]);
    expect(session.prompts[0]!.text).not.toContain("sk-abcdefghijklmnop");
  });

  it("records shell calls with failures categorised from exit codes", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      turnContext(),
      ...userMessage("run tests"),
      ...shell("c1", "pnpm test", 1, "1 failed"),
      ...shell("c2", "sleep 100", 124, ""),
      ...shell("c3", "cat missing.txt", 1, "cat: missing.txt: No such file or directory"),
      ...shell("c4", "ls", 0, "a b"),
    ]);
    expect(session.toolCalls.map((call) => [call.name, call.category, call.command, call.error])).toEqual([
      ["shell", "shell", "pnpm test", "command_failed"],
      ["shell", "shell", "sleep 100", "timeout"],
      ["shell", "shell", "cat missing.txt", "file_not_found"],
      ["shell", "shell", "ls", undefined],
    ]);
  });

  it("counts lines, files and languages from apply_patch bodies, skipping patches that failed", async () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+export const a = 1;",
      "+export const b = 2;",
      "*** Update File: /work/demo/README.md",
      "@@",
      "-old line",
      "+new line",
      " context",
      "*** End Patch",
    ].join("\n");
    const session = await parseOne([
      meta(uuid(1)),
      ...userMessage("edit"),
      item({ type: "custom_tool_call", name: "apply_patch", call_id: "p1", input: patch, status: "completed" }),
      event({ type: "patch_apply_end", call_id: "p1", success: true, stdout: "", stderr: "" }),
      item({ type: "custom_tool_call_output", call_id: "p1", output: "Success. Updated the following files" }),
      item({ type: "custom_tool_call", name: "apply_patch", call_id: "p2", input: "*** Begin Patch\n*** Update File: src/other.py\n@@\n-x\n+y\n*** End Patch", status: "completed" }),
      event({ type: "patch_apply_end", call_id: "p2", success: false, stdout: "", stderr: "context mismatch" }),
    ]);
    expect(session.linesAdded).toBe(3);
    expect(session.linesRemoved).toBe(1);
    expect(session.filesModified).toEqual(["/work/demo/src/new.ts", "/work/demo/README.md"]);
    expect(session.toolCalls.map((call) => [call.category, call.error])).toEqual([
      ["edit", undefined],
      ["edit", "edit_mismatch"],
    ]);
    expect(session.languages).toEqual({ TypeScript: 1, Markdown: 1, Python: 1 });
  });

  it("counts git commits and pushes that succeeded", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      ...userMessage("ship it"),
      ...shell("g1", "git add -A && git commit -m 'feat: x'", 0),
      ...shell("g2", "git -C /work/demo push origin main", 0),
      ...shell("g3", "git commit -m retry", 1),
      ...shell("g4", "git log --oneline", 0),
    ]);
    expect(session.gitCommits).toBe(1);
    expect(session.gitPushes).toBe(1);
  });

  it("names MCP servers, web search, plan and compactions", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      turnContext("gpt-test", { collaboration_mode: { mode: "plan" } }),
      ...userMessage("look it up"),
      item({ type: "function_call", name: "linear__get_issue", call_id: "m1", arguments: "{}" }),
      event({ type: "mcp_tool_call_end", call_id: "m1", invocation: { server: "linear", tool: "get_issue", arguments: {} }, duration: { secs: 1, nanos: 0 }, result: { Ok: { content: [] } } }),
      item({ type: "function_call", name: "update_plan", call_id: "u1", arguments: JSON.stringify({ plan: [] }) }),
      item({ type: "web_search_call", status: "completed", action: { type: "search", query: "vitest docs" } }),
      rec("compacted", { message: "summary" }),
      event({ type: "context_compacted" }),
    ]);
    expect(session.toolCalls.map((call) => [call.name, call.category, call.mcpServer])).toEqual([
      ["mcp__linear__get_issue", "mcp", "linear"],
      ["update_plan", "plan", undefined],
      ["web_search", "web", undefined],
    ]);
    expect(session.features).toMatchObject({ mcpServers: ["linear"], webSearch: true, planMode: true, compactions: 1 });
  });

  it("marks prompts sent after an interruption and measures how long the person took to reply", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      event({ type: "task_started", model_context_window: 1000 }),
      ...userMessage("first"),
      ...assistant("working"),
      event({ type: "task_complete", last_agent_message: "done" }),
      rec("event_msg", { type: "user_message", message: "second", images: [] }, { timestamp: new Date(Date.parse(at(0)) + 30_000).toISOString() }),
      event({ type: "task_started" }),
      event({ type: "turn_aborted", reason: "interrupted" }),
      event({ type: "task_started" }),
      ...userMessage("no, do it differently"),
    ]);
    expect(session.prompts.map((prompt) => [prompt.text, prompt.interrupted ?? false])).toEqual([
      ["first", false],
      ["second", false],
      ["no, do it differently", true],
    ]);
    expect(session.userResponseTimesSec).toHaveLength(1);
    expect(session.userResponseTimesSec[0]).toBeGreaterThanOrEqual(30);
  });
});

describe("codex token usage", () => {
  it("turns cumulative counters into per-request deltas and never counts a reset as negative usage", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      turnContext("gpt-test"),
      ...userMessage("go"),
      tokenCount(1000, 200, 50),
      tokenCount(1000, 200, 50),
      tokenCount(3000, 1200, 150),
      event({ type: "token_count", info: null, rate_limits: {} }),
      tokenCount(500, 0, 10),
    ]);
    expect(session.requests.map((request) => request.usage)).toEqual([
      { input: 800, cachedInput: 200, cacheWrite: 0, output: 50 },
      { input: 1000, cachedInput: 1000, cacheWrite: 0, output: 100 },
    ]);
    expect(session.requests.every((request) => request.model === "gpt-test")).toBe(true);
    // A reset the parser could read but not count is a skipped counter, not an unreadable line.
    expect(session.issues).toBe(0);
    expect(session.skippedUsageRecords).toBe(1);
  });

  it("keeps counting when a rewritten thread restarts its counter from zero below the old high-water mark", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      turnContext("gpt-test"),
      ...userMessage("go"),
      tokenCountWithLast([1000, 200, 50], [1000, 200, 50]),
      tokenCountWithLast([3000, 1200, 150], [2000, 1000, 100]),
      // The counter starts again: the snapshot is exactly its own latest response, so it continues from zero.
      tokenCountWithLast([400, 100, 20], [400, 100, 20]),
      tokenCountWithLast([900, 300, 30], [500, 200, 10]),
      // Replays of snapshots already seen are not usage.
      tokenCountWithLast([900, 300, 30], [500, 200, 10]),
      tokenCountWithLast([3000, 1200, 150], [2000, 1000, 100]),
    ]);
    expect(session.requests.map((request) => [request.usage.input, request.usage.cachedInput, request.usage.output])).toEqual([
      [800, 200, 50],
      [1000, 1000, 100],
      [300, 100, 20],
      [300, 200, 10],
    ]);
    expect(session.issues).toBe(0);
    expect(session.skippedUsageRecords).toBeUndefined();
  });

  it("never counts the gap between two interleaved counter lineages", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      turnContext("gpt-test"),
      ...userMessage("go"),
      tokenCountWithLast([10_000, 0, 100], [10_000, 0, 100]),
      tokenCountWithLast([500, 0, 10], [500, 0, 10]),
      // Back on the first lineage: only this response's own 1,000 tokens are new, not the 10,500 gap.
      tokenCountWithLast([11_000, 0, 110], [1000, 0, 10]),
      tokenCountWithLast([800, 0, 20], [300, 0, 10]),
    ]);
    expect(session.requests.map((request) => request.usage.input + request.usage.cachedInput)).toEqual([10_000, 500, 1000, 300]);
  });

  it("still refuses a backwards counter whose own latest usage does not explain it", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      turnContext("gpt-test"),
      ...userMessage("go"),
      tokenCountWithLast([3000, 0, 100], [3000, 0, 100]),
      tokenCountWithLast([2900, 0, 90], [100, 0, 5]),
    ]);
    expect(session.requests).toHaveLength(1);
    expect(session.issues).toBe(0);
    expect(session.skippedUsageRecords).toBe(1);
  });

  it("records the service tier a thread's settings selected for the turns that follow", async () => {
    const settings = (serviceTier: string) => event({ type: "thread_settings_applied", thread_settings: { model: "gpt-test", service_tier: serviceTier } });
    const session = await parseOne([
      meta(uuid(1)),
      settings("priority"),
      event({ type: "task_started", turn_id: "t1" }),
      turnContext("gpt-test", { turn_id: "t1" }),
      ...userMessage("go"),
      tokenCountWithLast([1000, 0, 10], [1000, 0, 10]),
      // A change mid-turn applies from the next turn.
      settings("default"),
      tokenCountWithLast([2000, 0, 20], [1000, 0, 10]),
      event({ type: "task_started", turn_id: "t2" }),
      turnContext("gpt-test", { turn_id: "t2" }),
      tokenCountWithLast([3000, 0, 30], [1000, 0, 10]),
    ]);
    expect(session.requests.map((request) => request.serviceTier ?? "standard")).toEqual(["priority", "priority", "standard"]);
  });

  it("counts a response once when both a native record and a cumulative counter describe it", async () => {
    const native = (id: string, input: number, cached: number, output: number, total: [number, number, number], turn: string) =>
      rec("token_usage_record", {
        response_id: id,
        thread_id: uuid(1),
        turn_id: turn,
        usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
        thread_token_usage: { input_tokens: total[0], cached_input_tokens: total[1], output_tokens: total[2] },
      });
    const session = await parseOne([
      meta(uuid(1)),
      turnContext("model-a", { turn_id: "t1" }),
      ...userMessage("go"),
      native("r1", 1000, 400, 20, [1000, 400, 20], "t1"),
      tokenCount(1000, 400, 20),
      turnContext("model-b", { turn_id: "t2" }),
      native("r2", 500, 100, 10, [1500, 500, 30], "t2"),
      tokenCount(1500, 500, 30),
    ]);
    expect(session.requests.map((request) => [request.id, request.model, request.usage.input, request.usage.cachedInput, request.usage.output])).toEqual([
      ["codex-response:r1", "model-a", 600, 400, 20],
      ["codex-response:r2", "model-b", 400, 100, 10],
    ]);
    expect(session.models).toEqual(["model-a", "model-b"]);
  });

  it("does not recount usage a forked thread inherited, even when its counters drift from native totals", async () => {
    const native = (id: string, own: number, total: number) =>
      rec("token_usage_record", {
        response_id: id,
        thread_id: uuid(1),
        usage: { input_tokens: own, cached_input_tokens: 0, output_tokens: 1 },
        thread_token_usage: { input_tokens: total, cached_input_tokens: 0, output_tokens: 1000 },
      });
    const session = await parseOne([
      meta(uuid(1), { forked_from_id: uuid(7), history_base: { thread_id: uuid(7), end_ordinal_exclusive: 10 }, forked_from_ordinal_exclusive: 10 }),
      turnContext(),
      ...userMessage("continue from the fork"),
      native("r1", 100, 1_000_100),
      tokenCount(900_100, 0, 900),
      native("r2", 200, 1_000_300),
      tokenCount(900_300, 0, 901),
    ]);
    expect(session.requests.map((request) => request.id)).toEqual(["codex-response:r1", "codex-response:r2"]);
    expect(session.requests.reduce((sum, request) => sum + request.usage.input, 0)).toBe(300);
  });

  it("keeps counter-only usage from before a thread started writing native records", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      turnContext(),
      ...userMessage("old turn"),
      tokenCount(1000, 0, 10),
      rec("token_usage_record", {
        response_id: "r1",
        thread_id: uuid(1),
        usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 5 },
        thread_token_usage: { input_tokens: 1500, cached_input_tokens: 0, output_tokens: 15 },
      }),
      tokenCount(1500, 0, 15),
    ]);
    expect(session.requests.map((request) => [request.id.startsWith("codex-response:"), request.usage.input])).toEqual([
      [false, 1000],
      [true, 500],
    ]);
  });
});

describe("codex desktop rollouts", () => {
  const done = (payload: Rec): Rec => event({ type: "item_completed", thread_id: uuid(1), turn_id: "t1", item: payload });

  it("counts actions the automatic reviewer blocked, which is not the person declining", async () => {
    const blocked = (id: string, code: string) =>
      done({ type: "McpToolCall", id, server: "browser", tool: "click", status: "failed", result: { content: [{ type: "text", text: "blocked" }], isError: true, _meta: { "codex/telemetry": { error_code: code } } } });
    const session = await parseOne([
      meta(uuid(1)),
      ...userMessage("open the page"),
      blocked("m1", "guardian_denied"),
      blocked("m2", "execution_rejected"),
      blocked("m3", "guardian_timed_out"),
      blocked("m4", "browser_error"),
    ]);
    expect(session.approvals).toEqual({ autoBlocked: 3 });
    expect(session.toolCalls.filter((call) => call.error === "user_rejected")).toHaveLength(0);
  });

  it("reads prompts, commands, file changes and MCP calls from completed items", async () => {
    const browser = "\n<in-app-browser-context>\n# In app browser:\n- tab: http://localhost\n</in-app-browser-context>\n\n## My request:\nmake the button blue\n";
    const session = await parseOne([
      meta(uuid(1), { originator: "Codex Desktop", thread_source: "user" }),
      turnContext("gpt-test", { turn_id: "t1" }),
      event({ type: "task_started", turn_id: "t1" }),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: browser }] }, { metadata: { user_input_order: 1 } }),
      done({ type: "UserMessage", id: "u1", content: [{ type: "text", text: browser, text_elements: [] }] }),
      done({
        type: "CommandExecution",
        id: "x1",
        command: ["/bin/bash", "-lc", "sed -n 1,20p src/app.css"],
        parsed_cmd: [{ type: "read", cmd: "sed -n 1,20p src/app.css", name: "app.css", path: "src/app.css" }],
        status: "completed",
        exit_code: 0,
        aggregated_output: "body {}",
      }),
      done({ type: "CommandExecution", id: "x2", command: ["/bin/bash", "-lc", "rg blue"], parsed_cmd: [{ type: "search", cmd: "rg blue", query: "blue" }], status: "completed", exit_code: 1 }),
      done({ type: "CommandExecution", id: "x3", command: ["/bin/bash", "-lc", "cat ~/.codex/skills/brand-colors/SKILL.md"], parsed_cmd: [{ type: "unknown", cmd: "cat" }], status: "completed", exit_code: 0 }),
      done({
        type: "FileChange",
        id: "f1",
        status: "completed",
        changes: {
          "/work/demo/src/app.css": { type: "update", unified_diff: "@@ -1,2 +1,2 @@\n-color: red;\n+color: blue;\n+border: 0;\n", move_path: null },
          "/work/demo/src/theme.ts": { type: "add", content: "export const blue = 1;\n" },
        },
      }),
      done({ type: "McpToolCall", id: "m1", server: "figma", tool: "get_design", status: "failed", error: { message: "boom" } }),
      done({ type: "Extension", id: "e1", kind: "web.search", action: { type: "openPage", url: "https://example.test" } }),
      done({ type: "SubAgentActivity", id: "s1", kind: "started", agent_path: "/root/helper" }),
      done({ type: "ContextCompaction", id: "c1" }),
      item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] }),
      // The code-mode wrapper mirrors the items above and must not be counted again.
      item({ type: "custom_tool_call", name: "exec", call_id: "w1", input: "text(await tools.exec_command({cmd: 'ls'}))" }),
      event({ type: "task_complete", turn_id: "t1", completed_at: Date.parse(at(0)) / 1000 }),
    ]);
    expect(session.prompts.map((prompt) => prompt.text)).toEqual(["make the button blue"]);
    expect(session.toolCalls.map((call) => [call.name, call.category, call.error])).toEqual([
      ["exec_command", "read", undefined],
      ["exec_command", "search", "command_failed"],
      ["exec_command", "skill", undefined],
      ["apply_patch", "edit", undefined],
      ["mcp__figma__get_design", "mcp", "other"],
      ["web.search", "web", undefined],
      ["spawn_agent", "subagent", undefined],
    ]);
    expect(session.toolCalls[0]!.filePath).toBe("/work/demo/src/app.css");
    expect(session.linesAdded).toBe(3);
    expect(session.linesRemoved).toBe(1);
    expect(session.filesModified).toEqual(["/work/demo/src/app.css", "/work/demo/src/theme.ts"]);
    expect(session.languages).toEqual({ CSS: 2, TypeScript: 1 });
    expect(session.features).toMatchObject({ mcpServers: ["figma"], skills: ["brand-colors"], subagents: 1, webFetch: true, compactions: 1 });
  });

  it("does not stretch a session to the day the thread was merely reopened", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      done({ type: "UserMessage", id: "u1", content: [{ type: "text", text: "quick fix" }] }),
      ...assistant("fixed"),
      rec("event_msg", { type: "thread_settings_applied", thread_id: uuid(1), thread_settings: {} }, { timestamp: "2026-03-20T09:00:00.000Z" }),
      rec("world_state", { full: false, state: {} }, { timestamp: "2026-03-20T09:00:01.000Z" }),
    ]);
    expect(session.endTime.startsWith("2026-03-02")).toBe(true);
    expect(session.durationMinutes).toBeLessThan(1);
  });

  it("treats a steer mid-turn as an interruption but not an answer to the agent's question", async () => {
    const reply = `<send_user_message_question_reply>${JSON.stringify([{ questionItemId: "q", question: "Which?", answer: "the second one" }])}</send_user_message_question_reply>`;
    const session = await parseOne([
      meta(uuid(1)),
      event({ type: "task_started", turn_id: "t1" }),
      done({ type: "UserMessage", id: "u1", content: [{ type: "text", text: "start" }] }),
      done({ type: "AgentMessage", id: "a1", content: [], questions: [{ title: "Which?", options: ["a", "b"] }] }),
      done({ type: "UserMessage", id: "u2", content: [{ type: "text", text: reply }] }),
      done({ type: "UserMessage", id: "u3", content: [{ type: "text", text: "also handle errors" }] }),
      event({ type: "task_complete", turn_id: "t1" }),
    ]);
    expect(session.prompts.map((prompt) => [prompt.text, prompt.interrupted ?? false])).toEqual([
      ["start", false],
      ["the second one", false],
      ["also handle errors", true],
    ]);
    expect(session.toolCalls.map((call) => call.category)).toEqual(["ask_user"]);
  });
});

describe("codex guardian reviews and subagents", () => {
  it("folds child threads into the session that started them", async () => {
    const parentId = uuid(1);
    tree.write(rolloutName(1), [
      meta(parentId, { thread_source: "user" }),
      turnContext("main-model"),
      ...userMessage("build it"),
      rec("token_usage_record", { response_id: "p1", thread_id: parentId, usage: { input_tokens: 100, output_tokens: 10 } }),
    ]);
    tree.write(rolloutName(2), [
      meta(uuid(2), { thread_source: "guardian_review", source: { subagent: { other: "guardian" } }, parent_thread_id: parentId }),
      turnContext("review-model"),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: ">>> APPROVAL REQUEST START\n{}" }] }, { metadata: { user_input_order: 1 } }),
      rec("token_usage_record", { response_id: "g1", thread_id: uuid(2), usage: { input_tokens: 50, output_tokens: 5 } }),
      ...shell("gc", "cat README.md", 0),
    ]);
    tree.write(rolloutName(3), [
      { ...meta(uuid(3), { thread_source: "subagent", source: { subagent: { thread_spawn: { parent_thread_id: parentId } } }, parent_thread_id: parentId, subagent_history_start_ordinal: 2 }), ordinal: 0 },
      { ...meta(parentId), ordinal: 1 },
      { ...item({ type: "message", role: "user", content: [{ type: "input_text", text: "build it" }] }, { metadata: { inherited_user_message: true } }), ordinal: 1 },
      { ...turnContext("sub-model"), ordinal: 2 },
      { ...rec("token_usage_record", { response_id: "s1", thread_id: uuid(3), usage: { input_tokens: 70, output_tokens: 7 } }), ordinal: 3 },
      { ...shell("sc", "git commit -m sub", 0)[0], ordinal: 4 },
      { ...shell("sc", "git commit -m sub", 0)[1], ordinal: 5 },
    ], { base: "archived_sessions" });

    const files = await codexSource.discover({ roots: [tree.sessions] });
    expect(files).toHaveLength(1);
    const session = await codexSource.parse(files[0]!);
    expect(session!.id).toBe(parentId);
    expect(session!.prompts.map((prompt) => prompt.text)).toEqual(["build it"]);
    expect(session!.requests.map((request) => request.id).sort()).toEqual(["codex-response:g1", "codex-response:p1", "codex-response:s1"]);
    expect(session!.models.sort()).toEqual(["main-model", "review-model", "sub-model"]);
    // The subagent's work counts; the guardian's review reads do not.
    expect(session!.toolCalls.map((call) => call.command)).toEqual(["git commit -m sub"]);
    expect(session!.gitCommits).toBe(1);

    const child = await codexSource.parse({ harness: "codex", path: join(tree.root, "sessions/2026/03/02", rolloutName(2)), mtimeMs: 0, sizeBytes: 0 });
    expect(child).toBeNull();
  });

  it("counts a subagent whose declared history start lies past its last record, so its own work is not dropped", async () => {
    // Paginated subagent rollouts can name a start ordinal one past their last record. Nothing in such a file is
    // copied parent history: its counter starts at zero in this thread and its tool calls are its own.
    const parentId = uuid(1);
    tree.write(rolloutName(1), [
      meta(parentId, { thread_source: "user" }),
      turnContext("main-model"),
      ...userMessage("build it"),
      rec("token_usage_record", { response_id: "p1", thread_id: parentId, usage: { input_tokens: 100, output_tokens: 10 } }),
    ]);
    const sub = uuid(3);
    const own = [turnContext("sub-model"), tokenCountWithLast([100, 0, 10], [100, 0, 10]), ...shell("sc", "git commit -m sub", 0), tokenCountWithLast([250, 50, 30], [150, 50, 20])];
    tree.write(rolloutName(3), [
      meta(sub, { thread_source: "subagent", source: { subagent: { thread_spawn: { parent_thread_id: parentId } } }, parent_thread_id: parentId, history_mode: "paginated", subagent_history_start_ordinal: own.length + 1 }),
      ...own.map((record, index) => ({ ...record, ordinal: index + 1 })),
    ], { base: "archived_sessions" });

    const files = await codexSource.discover({ roots: [tree.sessions] });
    expect(files).toHaveLength(1);
    const session = await codexSource.parse(files[0]!);
    const child = session!.requests.filter((request) => request.model === "sub-model");
    expect(child.map((request) => request.usage)).toEqual([
      { input: 100, cachedInput: 0, cacheWrite: 0, output: 10 },
      { input: 100, cachedInput: 50, cacheWrite: 0, output: 20 },
    ]);
    expect(session!.toolCalls.map((call) => call.command)).toEqual(["git commit -m sub"]);
  });

  it("does not count a review thread's repeat of the counter it copied from earlier history", async () => {
    // The copied prefix (before the start ordinal) ends on another thread's counter; the thread's own part first
    // repeats that counter, then adds one response of its own.
    const guardian = uuid(2);
    tree.write(rolloutName(2), [
      meta(guardian, { thread_source: "guardian_review", source: { subagent: { other: "guardian" } }, parent_thread_id: uuid(9), history_mode: "paginated", subagent_history_start_ordinal: 3 }),
      { ...tokenCountWithLast([5000, 4000, 100], [1000, 800, 20]), ordinal: 1 },
      { ...turnContext("review-model"), ordinal: 3 },
      { ...tokenCountWithLast([5000, 4000, 100], [1000, 800, 20]), ordinal: 4 },
      { ...tokenCountWithLast([6200, 4900, 130], [1200, 900, 30]), ordinal: 5 },
    ]);
    const session = await codexSource.parse(await only());
    expect(session!.requests.map((request) => request.usage)).toEqual([{ input: 300, cachedInput: 900, cacheWrite: 0, output: 30 }]);
  });

  it("keeps an orphaned child as its own session so its usage is not lost", async () => {
    tree.write(rolloutName(2), [
      meta(uuid(2), { thread_source: "guardian_review", parent_thread_id: uuid(9) }),
      rec("token_usage_record", { response_id: "g1", thread_id: uuid(2), usage: { input_tokens: 50, output_tokens: 5 } }),
    ]);
    const session = await codexSource.parse(await only());
    expect(session!.requests).toHaveLength(1);
    expect(session!.prompts).toEqual([]);
  });
});

describe("codex robustness", () => {
  it("skips and counts lines it cannot read instead of throwing", async () => {
    const lines = [
      JSON.stringify(meta(uuid(1))),
      "{not json",
      JSON.stringify({ type: "brand_new_record", payload: { anything: true } }),
      JSON.stringify({ payload: {} }),
      JSON.stringify(userMessage("still works")[1]),
      '{"type":"event_msg","payload":{"type":"user_mes',
    ];
    tree.write(rolloutName(1), [], { raw: lines.join("\n") });
    const session = await codexSource.parse(await only());
    expect(session!.prompts.map((prompt) => prompt.text)).toEqual(["still works"]);
    expect(session!.issues).toBe(3);
  });

  it("returns null for a rollout with no real session in it", async () => {
    tree.write(rolloutName(1), [], { raw: "" });
    expect(await codexSource.parse(await only())).toBeNull();
    expect(await codexSource.parse({ harness: "codex", path: join(tree.root, "nope.jsonl"), mtimeMs: 0, sizeBytes: 0 })).toBeNull();
  });

  it.skipIf(!canZstd)("reads zstd rollouts, falling back to the zstd binary, or skips them when neither exists", async () => {
    tree.write(rolloutName(1), [meta(uuid(1)), ...userMessage("compressed")], { zst: true });
    const file = await only();
    expect((await codexSource.parse(file))!.prompts[0]!.text).toBe("compressed");
    zstdSupport.disableNative = true;
    try {
      const viaBinary = await codexSource.parse(file);
      // Either the binary decoded it or, where none is installed, the file was skipped without throwing.
      expect(viaBinary === null || viaBinary.prompts[0]!.text === "compressed").toBe(true);
      zstdSupport.disableBinary = true;
      expect(await codexSource.parse(file)).toBeNull();
    } finally {
      zstdSupport.disableNative = false;
      zstdSupport.disableBinary = false;
    }
  });

  it("reads legacy single-document .json sessions and envelope-free rollouts", async () => {
    const legacy = {
      session: { id: uuid(4), timestamp: "2025-04-01T10:00:00.000Z", instructions: "" },
      items: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "<user_instructions>\nrules\n</user_instructions>" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "old style prompt" }] },
        { type: "function_call", name: "shell", call_id: "c1", arguments: JSON.stringify({ command: ["bash", "-lc", "npm test"] }) },
        { type: "function_call_output", call_id: "c1", output: JSON.stringify({ output: "fail", metadata: { exit_code: 2 } }) },
      ],
    };
    tree.write("rollout-2025-04-01-legacy.json", [], { raw: JSON.stringify(legacy) });
    const bare = [
      { id: uuid(5), timestamp: "2025-06-01T10:00:00.000Z", instructions: null, git: { branch: "dev" } },
      { record_type: "state" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "bare prompt" }] },
    ];
    tree.write(rolloutName(5), [], { raw: bare.map((line) => JSON.stringify(line)).join("\n"), day: "2025-06-01" });
    const files = await codexSource.discover({ roots: [tree.sessions] });
    const sessions = await Promise.all(files.map((file) => codexSource.parse(file)));
    const byId = new Map(sessions.map((session) => [session!.id, session!]));
    expect(byId.get(uuid(4))!.prompts.map((prompt) => prompt.text)).toEqual(["old style prompt"]);
    expect(byId.get(uuid(4))!.toolCalls[0]!.error).toBe("command_failed");
    expect(byId.get(uuid(5))!.prompts.map((prompt) => prompt.text)).toEqual(["bare prompt"]);
    expect(byId.get(uuid(5))!.gitBranch).toBe("dev");
  });
});

describe("codex excerpts", () => {
  it("gives the model pass redacted, truncated turns in time order", async () => {
    const records = [meta(uuid(1)), ...userMessage("token ghp_abcdefghijklmnopqrstuvwxyz0123 here")];
    for (let index = 0; index < 30; index += 1) {
      records.push(...assistant(`step ${index} ${"x".repeat(500)}`));
      records.push(...shell(`c${index}`, `echo ${index}`, index === 3 ? 1 : 0, "out"));
    }
    tree.write(rolloutName(1), records);
    const file = await only();
    const turns = await codexSource.excerpt(file, { maxTurns: 10, maxCharsPerTurn: 100 });
    expect(turns).toHaveLength(10);
    expect(turns[0]!.role).toBe("user");
    expect(turns[0]!.text).not.toContain("ghp_");
    expect(turns.every((turn) => turn.text.length <= 100)).toBe(true);
    expect(turns.map((turn) => Date.parse(turn.timestamp))).toEqual([...turns.map((turn) => Date.parse(turn.timestamp))].sort((a, b) => a - b));

    const all = await codexSource.excerpt(file, { maxTurns: 500 });
    const failed = all.find((turn) => turn.role === "tool" && turn.text.startsWith("$ echo 3"));
    expect(failed?.isError).toBe(true);
    expect(failed?.toolName).toBe("shell");
    expect(all.filter((turn) => turn.role === "assistant")).toHaveLength(30);

    const near = await codexSource.excerpt(file, { maxTurns: 2, around: all.at(-1)!.timestamp });
    expect(near.at(-1)!.timestamp).toBe(all.at(-1)!.timestamp);
  });
});

describe("codex parser version", () => {
  it("declares a parser version so the store re-parses cached history after a parser fix", () => {
    expect(codexSource.parserVersion).toBe("7");
  });
});

describe("codex recap fields", () => {
  const reasoning = (started: number, completed: number) =>
    event({ type: "item_completed", item: { type: "Reasoning", id: `r${started}`, summary_text: [], raw_content: [] }, started_at_ms: started, completed_at_ms: completed });

  it("counts reasoning with its timing from item events, not twice from the mirrored response items", async () => {
    const session = await parseOne([
      meta(uuid(1)),
      ...userMessage("plan it"),
      item({ type: "reasoning", id: "r1", summary: [], encrypted_content: "x" }),
      reasoning(1_770_000_000_000, 1_770_000_004_000),
      item({ type: "reasoning", id: "r2", summary: [], encrypted_content: "x" }),
      reasoning(1_770_000_010_000, 1_770_000_011_500),
    ]);
    expect(session.thinking).toEqual({ blocks: 2, totalMs: 5500, longestMs: 4000 });
  });

  it("counts reasoning items without durations when only the CLI stream exists", async () => {
    const session = await parseOne([meta(uuid(1)), ...userMessage("plan it"), item({ type: "reasoning", id: "r1", summary: [], encrypted_content: "x" })]);
    expect(session.thinking).toEqual({ blocks: 1, totalMs: null, longestMs: null });
  });

  it("counts slash commands per invocation", async () => {
    const session = await parseOne([meta(uuid(1)), ...userMessage("/model"), ...userMessage("/model"), ...userMessage("/review")]);
    expect(session.features.slashCommandCounts).toEqual({ model: 2, review: 1 });
  });

  it("counts tool calls past the cap, so a marathon can say 10,000+", async () => {
    const commands = Array.from({ length: 10_002 }, (_, n) =>
      event({ type: "item_completed", item: { type: "CommandExecution", command: `echo ${n}`, exit_code: 0, status: "completed" }, started_at_ms: 1_770_000_000_000 + n }),
    );
    const session = await parseOne([meta(uuid(1)), ...userMessage("go"), ...commands]);
    expect(session.toolCalls).toHaveLength(10_000);
    expect(session.toolCallsDropped).toBe(2);
  });

  it("counts guardian reviews on the parent without their thinking", async () => {
    const parentId = uuid(1);
    tree.write(rolloutName(1), [meta(parentId, { thread_source: "user" }), ...userMessage("build it"), item({ type: "reasoning", id: "p", summary: [], encrypted_content: "x" })]);
    // A review thread with nothing but its metadata still counts.
    tree.write(rolloutName(4), [meta(uuid(4), { thread_source: "guardian_review", source: { subagent: { other: "guardian" } }, parent_thread_id: parentId })]);
    for (const n of [2, 3]) {
      tree.write(rolloutName(n), [
        meta(uuid(n), { thread_source: "guardian_review", source: { subagent: { other: "guardian" } }, parent_thread_id: parentId }),
        item({ type: "reasoning", id: `g${n}`, summary: [], encrypted_content: "x" }),
        rec("token_usage_record", { response_id: `g${n}`, thread_id: uuid(n), usage: { input_tokens: 50, output_tokens: 5 } }),
      ]);
    }
    const files = await codexSource.discover({ roots: [tree.sessions] });
    const session = (await codexSource.parse(files[0]!))!;
    expect(session.approvals).toEqual({ guardianReviews: 3 });
    expect(session.thinking).toEqual({ blocks: 1, totalMs: null, longestMs: null });
  });
});
