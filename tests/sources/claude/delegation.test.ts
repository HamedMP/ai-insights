import { describe, expect, it } from "vitest";
import { claudeSource } from "../../../src/sources/claude/index.js";
import { assistant, prompt, text, toolResult, toolUse, transcript } from "./helpers.js";

const T = (minute: number, second = 0) => new Date(Date.UTC(2026, 0, 5, 10, minute, second)).toISOString();
const human = { origin: { kind: "human" }, promptSource: "typed" };
const peer = { origin: { kind: "peer" }, promptSource: "system", isMeta: true };

const teammate = (id: string, body: string, summary?: string) =>
  `Another Claude session sent a message:\n<teammate-message teammate_id="${id}" color="blue"${summary ? ` summary="${summary}"` : ""}>\n${body}\n</teammate-message>`;
const idle = (id: string) => teammate(id, JSON.stringify({ type: "idle_notification", from: id, timestamp: T(9) }));

// A person leads: they launch a named teammate and a background subagent, which report back.
const leadLines = () => [
  prompt(T(0), "split the migration between two helpers", human),
  assistant(T(1), "m1", [
    toolUse("a1", "Agent", { name: "t1-builder", description: "build", prompt: "build the parser", run_in_background: true }),
    toolUse("a2", "Agent", { description: "review", prompt: "review the diff", run_in_background: true }),
  ], { stop: "tool_use" }),
  toolResult(T(1, 5), "a1", "Spawned t1-builder", { result: { status: "teammate_spawned", name: "t1-builder" } }),
  toolResult(T(1, 6), "a2", "Async agent launched", { result: { status: "async_launched", agentId: "a9f3c2d1e0b4" } }),
  assistant(T(1, 10), "m2", [text("Both are running.")]),
  prompt(T(3), teammate("t1-builder", "Parser done, 12 tests pass.", "Parser done"), {}),
  prompt(T(4), idle("t1-builder"), {}),
  prompt(T(4, 30), '<agent-message from="a9f3c2d1e0b4">Review: two nits, no blockers.</agent-message>', peer),
  prompt(T(5), "good, merge the parser", human),
  // A teammate this session never launched, and a message from another session: those are other agents.
  prompt(T(6), teammate("team-lead", "Please also update the docs."), {}),
  prompt(T(7), '<cross-session-message from="uds:/tmp/s/1.sock" from-name="lead">ship it</cross-session-message>', peer),
  assistant(T(8), "m3", [text("Merged.")]),
];

describe("claude source: replies from the session's own teammates and subagents", () => {
  it("are neither the person nor another agent steering the session", async () => {
    const session = (await claudeSource.parse(transcript(leadLines())))!;
    expect(session.prompts.map((p) => p.text)).toEqual(["split the migration between two helpers", "good, merge the parser"]);
    expect(session.userMessageCount).toBe(2);
    expect(session.agentMessageCount).toBe(2);
  });

  it("agree between the session and its excerpt, shown as one-line tool turns", async () => {
    const file = transcript(leadLines());
    const session = (await claudeSource.parse(file))!;
    const turns = await claudeSource.excerpt(file, { maxTurns: 500 });
    expect(turns.filter((turn) => turn.role === "agent")).toHaveLength(session.agentMessageCount!);
    expect(turns.filter((turn) => turn.toolName === "teammate").map((turn) => [turn.role, turn.text])).toEqual([
      ["tool", "[teammate t1-builder] Parser done"],
      ["tool", "[teammate t1-builder idle]"],
      ["tool", "[subagent] Review: two nits, no blockers."],
    ]);
  });

  it("keeps messages from other agents visible next to many prompts", async () => {
    const lines: unknown[] = [];
    for (let i = 0; i < 40; i += 1) {
      lines.push(prompt(T(i), `step ${i}`, human));
      lines.push(assistant(T(i, 20), `m${i}`, [toolUse(`b${i}`, "Bash", { command: `run ${i}` })], { stop: "tool_use" }));
      lines.push(toolResult(T(i, 30), `b${i}`, "Exit code 1\nfailed", { error: true }));
    }
    lines.push(prompt(T(50), '<cross-session-message from="uds:/tmp/s/1.sock">ship it</cross-session-message>', peer));
    lines.push(assistant(T(51), "end", [text("Shipped.")]));
    const turns = await claudeSource.excerpt(transcript(lines), { maxTurns: 60, maxCharsPerTurn: 600 });
    expect(turns.filter((turn) => turn.role === "agent")).toHaveLength(1);
  });
});
