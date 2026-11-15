import { describe, expect, it } from "vitest";
import { claudeSource } from "../../../src/sources/claude/index.js";
import { assistant, attachment, prompt, text, toolResult, toolUse, transcript } from "./helpers.js";

const T = (minute: number, second = 0) => new Date(Date.UTC(2026, 0, 5, 10, 0, 0) + minute * 60_000 + second * 1000).toISOString();
const human = { origin: { kind: "human" }, promptSource: "typed" };

describe("claude source: excerpts that show how a long session went", () => {
  it("keeps prompts, interruptions, failures and the final answer when a huge session is squeezed", async () => {
    const lines: unknown[] = [prompt(T(0), "migrate the billing service")];
    let minute = 0;
    for (let i = 0; i < 2000; i += 1) {
      minute += 1;
      lines.push(assistant(T(minute), `m${i}`, [toolUse(`t${i}`, "Bash", { command: `step ${i}\nsecond line of a long script ${"x".repeat(300)}` })], { stop: "tool_use" }));
      const fail = i === 500 || i === 1500;
      lines.push(toolResult(T(minute, 30), `t${i}`, fail ? `Exit code 1\nfailure ${i}` : `ok ${i}`, { error: fail }));
      if (i === 700) lines.push(attachment(T(minute, 40), { type: "queued_command", commandMode: "prompt", prompt: "stop, use the new schema", origin: { kind: "human" } }));
      if (i === 1000) lines.push(prompt(T(minute, 45), "now the invoices", human));
      if (i === 1200) lines.push(prompt(T(minute, 50), '<hc from="t9">orchestrator: hurry up</hc>', human));
    }
    lines.push(assistant(T(minute + 1), "final", [text("Migration finished; all tests pass.")]));

    const turns = await claudeSource.excerpt(transcript(lines), { maxTurns: 20, maxCharsPerTurn: 200 });
    expect(turns.length).toBeLessThanOrEqual(20);
    const texts = turns.map((turn) => turn.text);
    expect(texts[0]).toBe("migrate the billing service");
    expect(texts).toContain("now the invoices");
    expect(texts.some((t) => t.includes("stop, use the new schema"))).toBe(true);
    expect(turns.filter((turn) => turn.isError).map((turn) => turn.text)).toEqual([
      expect.stringContaining("failure 500"),
      expect.stringContaining("failure 1500"),
    ]);
    expect(turns.find((turn) => turn.role === "agent")?.text).toContain("orchestrator: hurry up");
    expect(turns.at(-1)).toMatchObject({ role: "assistant", text: "Migration finished; all tests pass." });
    // Tool-call turns are one short line each.
    for (const turn of turns.filter((t) => t.role === "tool" && !t.isError)) {
      expect(turn.text).not.toContain("\n");
      expect(turn.text.length).toBeLessThanOrEqual(120);
    }
    const total = texts.reduce((sum, t) => sum + t.length, 0);
    expect(total).toBeLessThanOrEqual(4000);
    const times = turns.map((turn) => turn.timestamp);
    expect([...times].sort()).toEqual(times);
  });

  it("marks agent messages, interruptions and prompts sent mid-turn so the reader can tell who steered", async () => {
    const turns = await claudeSource.excerpt(
      transcript([
        prompt(T(0), "deploy it"),
        assistant(T(1), "m1", [toolUse("t1", "Bash", { command: "make deploy" })], { stop: "tool_use" }),
        attachment(T(1, 10), { type: "queued_command", commandMode: "prompt", prompt: "use staging", origin: { kind: "human" } }),
        toolResult(T(1, 20), "t1", "The user doesn't want to proceed with this tool use.", { error: true }),
        prompt(T(1, 21), [{ type: "text", text: "[Request interrupted by user for tool use]" }]),
        prompt(T(2), "Another Claude session sent a message: the build is red"),
        prompt(T(3), "<task-notification><summary>tests done</summary></task-notification>", { origin: { kind: "task-notification" } }),
      ]),
    );
    expect(turns.map((turn) => [turn.role, turn.text])).toEqual([
      ["user", "deploy it"],
      ["tool", "make deploy"],
      ["user", "[sent while the agent was working] use staging"],
      ["tool", "make deploy → The user doesn't want to proceed with this tool use."],
      ["user", "[interrupted the agent]"],
      ["agent", "Another Claude session sent a message: the build is red"],
      ["agent", "<task-notification><summary>tests done</summary></task-notification>"],
    ]);
  });

  it("shortens home directories everywhere in the excerpt", async () => {
    const turns = await claudeSource.excerpt(
      transcript([
        prompt(T(0), "read /home/alice/a.md"),
        assistant(T(1), "m1", [text("Reading /home/alice/a.md"), toolUse("t", "Read", { file_path: "/Users/alice/a.md" })], { stop: "tool_use" }),
        toolResult(T(2), "t", "File does not exist: /home/alice/a.md", { error: true }),
      ]),
    );
    expect(JSON.stringify(turns)).not.toMatch(/alice/);
    expect(turns.map((turn) => turn.text)).toEqual(["read ~/a.md", "Reading ~/a.md", "~/a.md", "~/a.md → File does not exist: ~/a.md"]);
  });
});
