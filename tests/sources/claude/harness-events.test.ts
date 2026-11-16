import { describe, expect, it } from "vitest";
import { claudeSource } from "../../../src/sources/claude/index.js";
import { fitTurns } from "../../../src/mcp/excerpt.js";
import { assistant, attachment, prompt, text, toolResult, toolUse, transcript } from "./helpers.js";

const T = (minute: number, second = 0) => new Date(Date.UTC(2026, 0, 5, 10, minute, second)).toISOString();
const human = { origin: { kind: "human" }, promptSource: "typed" };

const notification = (id: string, summary: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_${id}</tool-use-id>\n<output-file>/tmp/tasks/${id}.output</output-file>\n` +
  `<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>\n${"Read the output file to retrieve the result. ".repeat(4)}`;

const harnessLines = () => [
  prompt(T(0), "watch the CI run and fix what breaks", human),
  assistant(T(1), "m1", [toolUse("b1", "Bash", { command: "gh run watch", run_in_background: true })], { stop: "tool_use" }),
  toolResult(T(1, 5), "b1", "Command running in background with ID: b1"),
  assistant(T(1, 10), "m2", [text("Watching.")]),
  // A background command finishing, as a user line and as a queued attachment.
  prompt(T(5), notification("b1", 'Background command "gh run watch" completed (exit code 0)'), {
    origin: { kind: "task-notification" },
    promptSource: "system",
  }),
  attachment(T(6), {
    type: "queued_command",
    commandMode: "task-notification",
    prompt: notification("m9", 'Monitor event: "CI status"'),
    origin: { kind: "task-notification" },
  }),
  // A wake-up the agent scheduled for itself.
  prompt(T(7), "Continue PR #12: check the review score", { isMeta: true, promptSource: "system" }),
  // The hub saying a peer went idle.
  prompt(T(8), "[Cross-session idle notice] t3 has been idle for 10 minutes", { isMeta: true, promptSource: "system" }),
  prompt(T(9), '<hc from="t35">merge main before you push</hc>', human),
  assistant(T(10), "m3", [text("All green and merged.")]),
];

describe("claude source: harness events", () => {
  it("carries a parser version, so sessions cached by the old counting get parsed again", () => {
    expect(claudeSource.parserVersion).toBe("2");
  });

  it("counts task notifications, monitor events and wake-ups as neither the person nor another agent", async () => {
    const session = (await claudeSource.parse(transcript(harnessLines())))!;
    expect(session.prompts.map((p) => p.text)).toEqual(["watch the CI run and fix what breaks"]);
    expect(session.userMessageCount).toBe(1);
    expect(session.agentMessageCount).toBe(1);
    expect(session.userResponseTimesSec).toEqual([]);
  });

  it("agrees with the excerpt on how many messages came from other agents", async () => {
    const file = transcript(harnessLines());
    const session = (await claudeSource.parse(file))!;
    const turns = await claudeSource.excerpt(file, { maxTurns: 500 });
    expect(turns.filter((turn) => turn.role === "agent")).toHaveLength(session.agentMessageCount!);
    expect(turns.filter((turn) => turn.role === "user")).toHaveLength(session.userMessageCount);
  });

  it("shows harness events as one short tool line, only when there is room", async () => {
    const file = transcript(harnessLines());
    const all = await claudeSource.excerpt(file, { maxTurns: 500 });
    const events = all.filter((turn) => turn.toolName === "harness");
    expect(events.map((turn) => turn.text)).toEqual([
      '[task notification] Background command "gh run watch" completed (exit code 0)',
      '[task notification] Monitor event: "CI status"',
      "[scheduled wake-up] Continue PR #12: check the review score",
      "[Cross-session idle notice] t3 has been idle for 10 minutes",
    ]);
    expect(events.every((turn) => turn.role === "tool" && !turn.text.includes("\n") && turn.text.length <= 120)).toBe(true);

    // Everything else fills five turns, so no harness event is sampled.
    const few = await claudeSource.excerpt(file, { maxTurns: 5 });
    expect(few.some((turn) => turn.toolName === "harness")).toBe(false);
    expect(few.map((turn) => turn.role)).toEqual(["user", "tool", "assistant", "agent", "assistant"]);
  });
});

describe("claude source: the brief survives the default excerpt", () => {
  // A long orchestrated session: a long brief, many prompts, hundreds of notifications and tool calls.
  function longSession() {
    const brief = `Continue ticket gtm-305 in this worktree. ${"Read the handoff notes, then fix the sync bug and add tests. ".repeat(60)}`;
    const lines: unknown[] = [prompt(T(0), brief, human)];
    for (let i = 0; i < 300; i += 1) {
      const at = 1 + i * 0.3;
      const minute = Math.floor(at);
      const second = Math.round((at - minute) * 60) % 60;
      lines.push(assistant(T(minute, second), `m${i}`, [toolUse(`t${i}`, "Bash", { command: `pnpm test --filter step-${i}` })], { stop: "tool_use" }));
      lines.push(toolResult(T(minute, second), `t${i}`, "ok"));
      if (i % 2 === 0) {
        lines.push(prompt(T(minute, second), notification(`n${i}`, `Background command "poll ${i}" completed (exit code 0)`), {
          origin: { kind: "task-notification" },
          promptSource: "system",
        }));
      }
      if (i % 15 === 0) lines.push(prompt(T(minute, second), `also check case ${i}: ${"the retry path needs a test ".repeat(20)}`, human));
      if (i % 40 === 0) lines.push(assistant(T(minute, second), `a${i}`, [text(`progress ${i}: ${"details ".repeat(100)}`)]));
    }
    lines.push(assistant(T(120), "final", [text(`Done: the sync bug is fixed. ${"summary ".repeat(100)}`)]));
    return transcript(lines);
  }

  it("keeps about 600 characters of the first prompt within about 4k characters overall", async () => {
    // What the MCP server asks for by default, and then fits into its 4,000-character budget.
    const turns = await claudeSource.excerpt(longSession(), { maxTurns: 24, maxCharsPerTurn: 600 });
    const total = turns.reduce((sum, turn) => sum + turn.text.length, 0);
    expect(total).toBeLessThanOrEqual(4_000);
    expect(turns[0]!.text.startsWith("Continue ticket gtm-305")).toBe(true);
    expect(turns[0]!.text.length).toBeGreaterThanOrEqual(590);
    expect(turns.at(-1)!.text.startsWith("Done: the sync bug is fixed.")).toBe(true);
    expect(turns.filter((turn) => turn.role === "user").length).toBeGreaterThanOrEqual(10);
    expect(turns.some((turn) => turn.toolName === "harness")).toBe(false);

    const fitted = fitTurns(turns, 4_000);
    expect(fitted.omitted).toBe(0);
    expect(fitted.turns[0]!.text).toBe(turns[0]!.text);
  });

  it("still gives longer turns to a caller who asks for them", async () => {
    const turns = await claudeSource.excerpt(longSession(), { maxTurns: 24, maxCharsPerTurn: 2_000 });
    expect(turns[0]!.text.length).toBeGreaterThan(1_500);
    expect(turns.reduce((sum, turn) => sum + turn.text.length, 0)).toBeGreaterThan(4_000);
  });
});
