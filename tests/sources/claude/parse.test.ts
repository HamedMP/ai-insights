import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeSource } from "../../../src/sources/claude/index.js";
import {
  CWD,
  SESSION,
  assistant,
  attachment,
  prompt,
  system,
  tempRoot,
  text,
  thinking,
  toolResult,
  toolUse,
  transcript,
  writeLines,
} from "./helpers.js";

const T = (minute: number, second = 0) => new Date(Date.UTC(2026, 0, 5, 10, minute, second)).toISOString();

async function parse(lines: Array<unknown | string>) {
  const session = await claudeSource.parse(transcript(lines));
  expect(session).not.toBeNull();
  return session!;
}

describe("claude source: session basics", () => {
  it("reads where, when and with which model a session ran", async () => {
    const session = await parse([
      { type: "permission-mode", permissionMode: "acceptEdits", sessionId: SESSION },
      prompt(T(0), "add a login page"),
      assistant(T(1), "msg_1", [text("ok")], { model: "claude-sonnet-4-5" }),
      prompt(T(30), "now add tests"),
      assistant(T(32), "msg_2", [text("done")], { model: "claude-opus-4-5" }),
    ]);
    expect(session.id).toBe(SESSION);
    expect(session.harness).toBe("claude-code");
    expect(session.projectPath).toBe(CWD);
    expect(session.gitBranch).toBe("main");
    expect(session.startTime).toBe(T(0));
    expect(session.endTime).toBe(T(32));
    expect(session.durationMinutes).toBe(32);
    // The 29-minute gap is idle, not work.
    expect(session.activeMinutes).toBe(3);
    expect(session.models.sort()).toEqual(["claude-opus-4-5", "claude-sonnet-4-5"]);
    expect(session.permissionMode).toBe("acceptEdits");
    expect(session.userMessageCount).toBe(2);
    expect(session.assistantMessageCount).toBe(2);
    expect(session.issues).toBe(0);
  });

  it("returns null for files that hold no conversation", async () => {
    expect(await claudeSource.parse(transcript([]))).toBeNull();
    expect(await claudeSource.parse(transcript([{ type: "summary", summary: "x", leafUuid: "a" }]))).toBeNull();
    expect(await claudeSource.parse(transcript([{ type: "file-history-snapshot", messageId: "m", snapshot: {} }]))).toBeNull();
  });

  it("returns null instead of throwing when the file is missing", async () => {
    expect(await claudeSource.parse({ harness: "claude-code", path: "/nonexistent/x.jsonl", mtimeMs: 0, sizeBytes: 0 })).toBeNull();
  });

  it("survives corrupt lines and unknown record types, counting what it could not read", async () => {
    const session = await parse([
      "{not json",
      "[1,2,3]",
      { type: "some-future-record", payload: { anything: true } },
      { type: "assistant", timestamp: T(0) },
      prompt(T(0), "hello"),
      assistant(T(1), "msg_1", [text("hi")]),
    ]);
    expect(session.userMessageCount).toBe(1);
    // Two unparseable lines and one assistant line with no message; the unknown type is not an issue.
    expect(session.issues).toBe(3);
  });

  it("skips a single enormous line rather than loading it", async () => {
    const { parseClaudeTranscript } = await import("../../../src/sources/claude/parse.js");
    const file = transcript([prompt(T(0), "x".repeat(5000)), prompt(T(1), "short one"), assistant(T(2), "msg_1", [text("ok")])]);
    const session = await parseClaudeTranscript(file, { maxBytes: 1e9, maxLineBytes: 1000, maxLines: 1000 });
    expect(session?.userMessageCount).toBe(1);
    expect(session?.issues).toBe(1);
  });
});

describe("claude source: token usage", () => {
  it("counts a response written as several lines only once, keeping the final counters", async () => {
    const session = await parse([
      prompt(T(0), "go"),
      assistant(T(1), "msg_A", [thinking("...")], { usage: { input: 3, output: 1, cacheRead: 100, cacheWrite: 50 }, stop: null }),
      assistant(T(1, 5), "msg_A", [text("x")], { usage: { input: 3, output: 40, cacheRead: 100, cacheWrite: 50 }, stop: null }),
      assistant(T(1, 6), "msg_A", [toolUse("t1", "Read", { file_path: "/w/a.ts" })], {
        usage: { input: 3, output: 40, cacheRead: 100, cacheWrite: 50, cache5m: 20, cache1h: 30 },
        stop: "tool_use",
      }),
      toolResult(T(2), "t1", "contents"),
      assistant(T(3), "msg_B", [text("done")], { usage: { input: 1, output: 2 } }),
    ]);
    expect(session.requests).toHaveLength(2);
    const first = session.requests[0]!;
    expect(first.id).toBe("claude:msg_A");
    expect(first.timestamp).toBe(T(1));
    expect(first.model).toBe("claude-opus-4-5");
    expect(first.usage).toEqual({ input: 3, cachedInput: 100, cacheWrite: 50, cacheWrite5m: 20, cacheWrite1h: 30, output: 40 });
    expect(session.assistantMessageCount).toBe(2);
  });

  it("ignores synthetic placeholder responses that never reached the API", async () => {
    const session = await parse([
      prompt(T(0), "go"),
      assistant(T(1), "msg_s", [text("No response requested.")], { model: "<synthetic>", usage: { input: 0, output: 0 } }),
      assistant(T(2), "msg_1", [text("ok")]),
    ]);
    expect(session.models).toEqual(["claude-opus-4-5"]);
    expect(session.requests.map((r) => r.id)).toEqual(["claude:msg_1"]);
  });

  it("falls back to the request id when a response has no message id", async () => {
    const line = assistant(T(1), "", [text("ok")]);
    const session = await parse([prompt(T(0), "go"), line]);
    expect(session.requests.map((r) => r.id)).toEqual([`claude:${SESSION}:req-`]);
  });
});

describe("claude source: prompts", () => {
  it("keeps only what the person typed", async () => {
    const session = await parse([
      prompt(T(0), "fix the flaky test"),
      prompt(T(0, 1), "<system-reminder>injected context</system-reminder>"),
      prompt(T(0, 2), "Caveat: The messages below were generated by the user while running local commands. DO NOT respond.", {
        isMeta: true,
      }),
      prompt(T(0, 3), "<local-command-stdout>Set model to opus</local-command-stdout>"),
      prompt(T(0, 4), "<task-notification><task-id>a</task-id></task-notification>", { origin: { kind: "task-notification" } }),
      prompt(T(0, 5), "Another Claude session sent a message: hello", { origin: { kind: "peer" }, isMeta: true }),
      prompt(T(0, 6), "This session is being continued from a previous conversation that ran out of context.", { isCompactSummary: true }),
      prompt(T(0, 7), [{ type: "text", text: "# Skill body expanded by the harness" }], { isMeta: true }),
      assistant(T(1), "msg_1", [toolUse("t1", "Bash", { command: "ls" })], { stop: "tool_use" }),
      toolResult(T(1, 1), "t1", "a.ts"),
      assistant(T(2), "msg_2", [text("done")]),
      prompt(T(3), [{ type: "text", text: "and this screenshot" }, { type: "image", source: { type: "base64", data: "AAAA" } }], {
        origin: { kind: "human" },
        promptSource: "typed",
      }),
    ]);
    expect(session.prompts.map((p) => p.text)).toEqual(["fix the flaky test", "and this screenshot\n[image]"]);
    expect(session.userMessageCount).toBe(2);
  });

  it("records slash commands as features and keeps them as typed prompts", async () => {
    const session = await parse([
      prompt(T(0), "<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>PR 12</command-args>"),
      assistant(T(1), "msg_1", [text("reviewing")]),
      system(T(2), "local_command", { content: "<command-name>/model</command-name>\n<command-args></command-args>" }),
      prompt(T(3), "<command-name>clear</command-name>"),
    ]);
    expect(session.features.slashCommands).toEqual(["/clear", "/model", "/review"]);
    expect(session.prompts.map((p) => p.text)).toEqual(["/review PR 12", "/clear"]);
  });

  it("keeps bang-prefixed shell input as a prompt", async () => {
    const session = await parse([prompt(T(0), "<bash-input>git status</bash-input>"), prompt(T(0, 1), "<bash-stdout>clean</bash-stdout><bash-stderr></bash-stderr>")]);
    expect(session.prompts.map((p) => p.text)).toEqual(["! git status"]);
  });

  it("redacts secrets and caps prompt length", async () => {
    const session = await parse([
      prompt(T(0), `use OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456 please ${"y".repeat(3000)}`),
      assistant(T(1), "msg_1", [text("ok")]),
    ]);
    const typed = session.prompts[0]!.text;
    expect(typed).not.toContain("sk-abcdefghijklmnop");
    expect(typed).toContain("[redacted]");
    expect(typed.length).toBeLessThanOrEqual(2000);
  });

  it("marks prompts sent while the agent was still working, and times replies to finished turns", async () => {
    const session = await parse([
      prompt(T(0), "start the refactor"),
      assistant(T(0, 30), "msg_1", [toolUse("t1", "Bash", { command: "pnpm test" })], { stop: "tool_use" }),
      // Typed while the tool ran: Claude Code records it as a queued command.
      attachment(T(0, 40), { type: "queued_command", commandMode: "prompt", prompt: "also update the docs", origin: { kind: "human" } }),
      attachment(T(0, 41), { type: "queued_command", commandMode: "task-notification", prompt: "<task-notification/>", origin: { kind: "task-notification" } }),
      toolResult(T(1), "t1", "ok"),
      assistant(T(2), "msg_2", [text("done")]),
      system(T(2, 1), "turn_duration", { durationMs: 120000 }),
      prompt(T(3), "thanks, now ship it"),
      assistant(T(3, 10), "msg_3", [toolUse("t2", "Bash", { command: "git push" })], { stop: "tool_use" }),
      toolResult(T(3, 20), "t2", "The user doesn't want to proceed with this tool use.", { error: true }),
      prompt(T(3, 21), [{ type: "text", text: "[Request interrupted by user for tool use]" }]),
      prompt(T(3, 30), "wait, run the tests first"),
    ]);
    expect(session.prompts.map((p) => [p.text, p.interrupted ?? false])).toEqual([
      ["start the refactor", false],
      ["also update the docs", true],
      ["thanks, now ship it", false],
      ["wait, run the tests first", true],
    ]);
    expect(session.userResponseTimesSec).toEqual([60]);
  });
});

describe("claude source: tools", () => {
  it("categorises tool calls and keeps only safe metadata", async () => {
    const session = await parse([
      prompt(T(0), "go"),
      assistant(T(1), "msg_1", [
        toolUse("a", "Bash", { command: `curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123" x ${"z".repeat(400)}` }),
        toolUse("b", "Read", { file_path: "/w/src/app.tsx" }),
        toolUse("c", "Grep", { pattern: "foo", path: "/w" }),
        toolUse("d", "mcp__linear-server__get_issue", { id: "X-1" }),
        toolUse("e", "Skill", { skill: "code-review", args: "high" }),
        toolUse("f", "Agent", { description: "explore", prompt: "look around" }),
        toolUse("g", "WebSearch", { query: "q" }),
        toolUse("h", "WebFetch", { url: "https://example.com" }),
        toolUse("i", "ExitPlanMode", { plan: "p" }),
        toolUse("j", "AskUserQuestion", { questions: [] }),
        toolUse("k", "TodoWrite", { todos: [] }),
      ], { stop: "tool_use" }),
    ]);
    expect(session.toolCalls.map((c) => [c.name, c.category])).toEqual([
      ["Bash", "shell"],
      ["Read", "read"],
      ["Grep", "search"],
      ["mcp__linear-server__get_issue", "mcp"],
      ["Skill", "skill"],
      ["Agent", "subagent"],
      ["WebSearch", "web"],
      ["WebFetch", "web"],
      ["ExitPlanMode", "plan"],
      ["AskUserQuestion", "ask_user"],
      ["TodoWrite", "other"],
    ]);
    const [bash, read, , mcp, skill] = session.toolCalls;
    expect(bash!.command!.length).toBeLessThanOrEqual(300);
    expect(bash!.command).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(read!.filePath).toBe("/w/src/app.tsx");
    expect(mcp!.mcpServer).toBe("linear-server");
    expect(skill!.skill).toBe("code-review");
    expect(session.features).toMatchObject({
      mcpServers: ["linear-server"],
      skills: ["code-review"],
      subagents: 1,
      planMode: true,
      webSearch: true,
      webFetch: true,
    });
    expect(session.languages).toEqual({ TypeScript: 1 });
  });

  it("counts a tool call once even when the transcript repeats its block", async () => {
    const block = toolUse("dup", "Bash", { command: "ls" });
    const session = await parse([
      prompt(T(0), "go"),
      assistant(T(1), "msg_1", [block], { stop: "tool_use" }),
      assistant(T(1, 1), "msg_1", [{ ...block, input: { command: "cd /w && ls" } }], { stop: "tool_use" }),
    ]);
    expect(session.toolCalls).toHaveLength(1);
  });

  it("explains why tool calls failed", async () => {
    const calls: Array<[string, string, Record<string, unknown>, string]> = [
      ["1", "Bash", { command: "pnpm test" }, "Exit code 1\nError: ENOENT: no such file or directory"],
      ["2", "Read", { file_path: "/w/missing.ts" }, "File does not exist."],
      ["3", "Edit", { file_path: "/w/a.ts", old_string: "x", new_string: "y" }, "<tool_use_error>String to replace not found in file.</tool_use_error>"],
      ["4", "Edit", { file_path: "/w/a.ts", old_string: "x", new_string: "y" }, "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>"],
      ["5", "Bash", { command: "rm -rf /" }, "Permission for this action was denied."],
      ["6", "Write", { file_path: "/w/b.ts", content: "z" }, "The user doesn't want to proceed with this tool use. The tool use was rejected."],
      ["7", "Bash", { command: "sleep 999" }, "Command timed out after 2m 0.0s"],
      ["8", "Read", { file_path: "/w/big.log" }, "File content (300000 tokens) exceeds maximum allowed tokens (25000)."],
      ["9", "WebFetch", { url: "https://x" }, "Something odd happened"],
    ];
    const lines: unknown[] = [prompt(T(0), "go"), assistant(T(1), "msg_1", calls.map(([id, name, input]) => toolUse(id, name, input)), { stop: "tool_use" })];
    for (const [id, , , message] of calls) lines.push(toolResult(T(2), id, message, { error: true }));
    const session = await parse(lines);
    expect(session.toolCalls.map((c) => c.error)).toEqual([
      "command_failed",
      "file_not_found",
      "edit_mismatch",
      "file_changed",
      "permission_denied",
      "user_rejected",
      "timeout",
      "too_large",
      "other",
    ]);
  });
});

describe("claude source: code changes and git", () => {
  it("counts lines and files changed by successful edits only", async () => {
    const session = await parse([
      prompt(T(0), "go"),
      assistant(T(1), "msg_1", [
        toolUse("w", "Write", { file_path: "/w/new.py", content: "a\nb\nc\n" }),
        toolUse("e", "Edit", { file_path: "/w/old.ts", old_string: "one\ntwo\nthree", new_string: "one\n2\nthree\nfour" }),
        toolUse("m", "MultiEdit", { file_path: "/w/multi.go", edits: [{ old_string: "x", new_string: "x\ny" }] }),
        toolUse("bad", "Edit", { file_path: "/w/fail.ts", old_string: "q", new_string: "q\nq\nq" }),
        toolUse("ow", "Write", { file_path: "/w/over.md", content: "keep\nnew\n" }),
      ], { stop: "tool_use" }),
      toolResult(T(2), "w", "File created", { result: { type: "create", filePath: "/w/new.py", content: "a\nb\nc\n" } }),
      toolResult(T(2), "e", "ok"),
      toolResult(T(2), "m", "ok"),
      toolResult(T(2), "bad", "String to replace not found", { error: true }),
      toolResult(T(2), "ow", "File updated", { result: { type: "update", filePath: "/w/over.md", content: "keep\nnew\n", originalFile: "keep\nold\ngone\n" } }),
    ]);
    // Write 3 + Edit (+2 -1) + MultiEdit (+1) + overwrite (+1 -2)
    expect(session.linesAdded).toBe(7);
    expect(session.linesRemoved).toBe(3);
    expect(session.filesModified.sort()).toEqual(["/w/multi.go", "/w/new.py", "/w/old.ts", "/w/over.md"]);
    expect(session.languages).toEqual({ Python: 1, TypeScript: 2, Go: 1, Markdown: 1 });
  });

  it("counts commits and pushes that actually ran", async () => {
    const commands = [
      "git add -A && git commit -m 'feat: x'",
      "git -C /w/repo commit --amend --no-edit && git push --force-with-lease origin main",
      "git push origin main", // fails below
      "git commit -F - <<'EOF'\nfix: mention git push in the body\nEOF",
      "echo \"git commit is not run here\"; git status",
      "git commit-tree abc -m x",
      "GIT_EDITOR=true git commit && (cd sub && git push)",
    ];
    const lines: unknown[] = [prompt(T(0), "ship it"), assistant(T(1), "msg_1", commands.map((command, i) => toolUse(`g${i}`, "Bash", { command })), { stop: "tool_use" })];
    commands.forEach((_c, i) => lines.push(toolResult(T(2), `g${i}`, i === 2 ? "Exit code 1\nrejected" : "ok", { error: i === 2 })));
    const session = await parse(lines);
    expect(session.gitCommits).toBe(4);
    expect(session.gitPushes).toBe(2);
  });

  it("uses Claude Code's own git annotation when the command text hides the push", async () => {
    const session = await parse([
      prompt(T(0), "push"),
      assistant(T(1), "msg_1", [toolUse("s", "Bash", { command: "./scripts/ship.sh" })], { stop: "tool_use" }),
      toolResult(T(2), "s", "done", { result: { stdout: "done", stderr: "", interrupted: false, gitOperation: { push: { branch: "main" } } } }),
    ]);
    expect(session.gitPushes).toBe(1);
  });
});

describe("claude source: session features", () => {
  it("counts compactions and notices plan mode", async () => {
    const session = await parse([
      prompt(T(0), "go", { permissionMode: "plan" }),
      assistant(T(1), "msg_1", [text("plan")]),
      system(T(2), "compact_boundary", { compactMetadata: { trigger: "auto", preTokens: 1 } }),
      prompt(T(2, 1), "This session is being continued from a previous conversation.", { isCompactSummary: true }),
      system(T(5), "compact_boundary", { compactMetadata: { trigger: "manual", preTokens: 1 } }),
      prompt(T(6), "keep going"),
      assistant(T(7), "msg_2", [text("ok")]),
    ]);
    expect(session.features.compactions).toBe(2);
    expect(session.features.planMode).toBe(true);
    expect(session.userMessageCount).toBe(2);
  });

  it("collects skills the harness reports as invoked", async () => {
    const session = await parse([
      prompt(T(0), "go"),
      attachment(T(0, 1), { type: "invoked_skills", skills: [{ name: "pdf" }, "docx"] }),
      attachment(T(0, 2), { type: "skill_mention", skillName: "xlsx" }),
      assistant(T(1), "msg_1", [text("ok")]),
    ]);
    expect(session.features.skills).toEqual(["docx", "pdf", "xlsx"]);
  });
});

describe("claude source: subagents", () => {
  it("folds subagent spend and tool calls into the parent, but not its prompts", async () => {
    const root = tempRoot();
    const file = transcript(
      [
        prompt(T(0), "investigate the outage"),
        assistant(T(1), "msg_p1", [toolUse("task1", "Agent", { description: "dig", prompt: "find the cause" })], { stop: "tool_use", usage: { input: 5, output: 5 } }),
        toolResult(T(20), "task1", "found it"),
        assistant(T(21), "msg_p2", [text("the cause is X")], { usage: { input: 5, output: 5 } }),
      ],
      { root },
    );
    const side = { isSidechain: true, agentId: "abc" };
    writeLines(join(root, "-work-demo", SESSION, "subagents", "agent-abc.jsonl"), [
      prompt(T(1, 5), "find the cause", side),
      assistant(T(5), "msg_s1", [toolUse("s1", "Grep", { pattern: "error" }), toolUse("s2", "Edit", { file_path: "/w/fix.rs", old_string: "a", new_string: "a\nb" })], {
        stop: "tool_use",
        usage: { input: 100, output: 50 },
        extra: side,
      }),
      toolResult(T(6), "s1", "hits", { result: undefined }),
      toolResult(T(6), "s2", "ok"),
      assistant(T(15), "msg_s2", [text("report")], { usage: { input: 100, output: 50 }, extra: side }),
    ]);
    writeLines(join(root, "-work-demo", SESSION, "subagents", "agent-abc.meta.json"), [{ agentType: "general-purpose" }]);

    const session = (await claudeSource.parse(file))!;
    expect(session.prompts.map((p) => p.text)).toEqual(["investigate the outage"]);
    expect(session.assistantMessageCount).toBe(2);
    expect(session.requests.map((r) => r.id).sort()).toEqual(["claude:msg_p1", "claude:msg_p2", "claude:msg_s1", "claude:msg_s2"]);
    expect(session.toolCalls.map((c) => c.name)).toEqual(["Agent", "Grep", "Edit"]);
    expect(session.linesAdded).toBe(1);
    expect(session.filesModified).toEqual(["/w/fix.rs"]);
    expect(session.features.subagents).toBe(1);
    // The subagent kept the session busy through the parent's quiet stretch.
    expect(session.activeMinutes).toBe(21);
    expect(session.endTime).toBe(T(21));
  });

  it("treats old-style sidechain lines in the main file the same way", async () => {
    const session = await parse([
      prompt(T(0), "go"),
      assistant(T(1), "msg_1", [toolUse("t", "Task", { description: "d", prompt: "p" })], { stop: "tool_use" }),
      prompt(T(1, 1), "p", { isSidechain: true }),
      assistant(T(2), "msg_side", [toolUse("r", "Read", { file_path: "/w/x.ts" })], { stop: "tool_use", extra: { isSidechain: true } }),
      toolResult(T(3), "t", "done"),
      assistant(T(4), "msg_2", [text("done")]),
    ]);
    expect(session.userMessageCount).toBe(1);
    expect(session.assistantMessageCount).toBe(2);
    expect(session.requests).toHaveLength(3);
    expect(session.toolCalls.map((c) => c.name)).toEqual(["Task", "Read"]);
  });
});
