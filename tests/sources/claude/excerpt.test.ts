import { describe, expect, it } from "vitest";
import { claudeSource } from "../../../src/sources/claude/index.js";
import { assistant, attachment, prompt, thinking, text, toolResult, toolUse, transcript } from "./helpers.js";

const T = (minute: number) => new Date(Date.UTC(2026, 0, 5, 10, minute)).toISOString();

describe("claude source: excerpts for the model pass", () => {
  it("shows the conversation and failures, redacted, without thinking or successful tool output", async () => {
    const file = transcript([
      prompt(T(0), "deploy with token ghp_abcdefghijklmnopqrstuvwxyz0123"),
      prompt(T(0), "<system-reminder>hidden</system-reminder>"),
      assistant(T(1), "m1", [thinking("private reasoning"), text("Running the deploy."), toolUse("t1", "Bash", { command: "make deploy" })], {
        stop: "tool_use",
      }),
      toolResult(T(2), "t1", "SECRET OUTPUT that should not be shown"),
      assistant(T(3), "m2", [toolUse("t2", "Bash", { command: "make test" })], { stop: "tool_use" }),
      toolResult(T(4), "t2", "Exit code 2\nmake: *** No rule to make target", { error: true }),
      attachment(T(5), { type: "queued_command", commandMode: "prompt", prompt: "use the staging target", origin: { kind: "human" } }),
    ]);
    const turns = await claudeSource.excerpt(file);
    expect(turns).toEqual([
      { timestamp: T(0), role: "user", text: "deploy with token [redacted]" },
      { timestamp: T(1), role: "assistant", text: "Running the deploy." },
      { timestamp: T(1), role: "tool", toolName: "Bash", text: "make deploy" },
      { timestamp: T(3), role: "tool", toolName: "Bash", text: "make test" },
      { timestamp: T(4), role: "tool", toolName: "Bash", isError: true, text: "Exit code 2\nmake: *** No rule to make target" },
      { timestamp: T(5), role: "user", text: "use the staging target" },
    ]);
    expect(JSON.stringify(turns)).not.toContain("private reasoning");
    expect(JSON.stringify(turns)).not.toContain("SECRET OUTPUT");
  });

  it("honours turn and length limits, spreading picks across the session and favouring the person's prompts", async () => {
    const lines: unknown[] = [];
    for (let i = 0; i < 30; i += 1) {
      lines.push(prompt(T(i), `prompt ${i}`));
      lines.push(assistant(T(i), `m${i}`, [text(`answer ${i} ${"x".repeat(500)}`)]));
    }
    const turns = await claudeSource.excerpt(transcript(lines), { maxTurns: 10, maxCharsPerTurn: 50 });
    expect(turns).toHaveLength(10);
    expect(turns.every((turn) => turn.text.length <= 50)).toBe(true);
    expect(turns.filter((turn) => turn.role === "user").length).toBeGreaterThanOrEqual(5);
    expect(turns[0]!.text).toBe("prompt 0");
    expect(turns.at(-1)!.timestamp).toBe(T(29));
    const times = turns.map((turn) => turn.timestamp);
    expect([...times].sort()).toEqual(times);
  });

  it("keeps the turns closest to a moment when asked", async () => {
    const lines: unknown[] = [];
    for (let i = 0; i < 20; i += 1) lines.push(prompt(T(i), `prompt ${i}`));
    const turns = await claudeSource.excerpt(transcript(lines), { maxTurns: 3, around: T(10) });
    expect(turns.map((turn) => turn.text)).toEqual(["prompt 9", "prompt 10", "prompt 11"]);
  });

  it("returns nothing rather than throwing for a missing or broken file", async () => {
    expect(await claudeSource.excerpt({ harness: "claude-code", path: "/nonexistent.jsonl", mtimeMs: 0, sizeBytes: 0 })).toEqual([]);
    expect(await claudeSource.excerpt(transcript(["{broken", "]"]))).toEqual([]);
  });
});
