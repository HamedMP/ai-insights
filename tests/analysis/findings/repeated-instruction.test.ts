import { describe, expect, it } from "vitest";
import { day, prompt, sessionsOverDays, task } from "../factory.js";
import { findings } from "./helpers.js";

const variants = [
  "Always use pnpm, never npm.",
  "always use pnpm never npm",
  "Please always use pnpm and never npm!",
  "always use pnpm, never npm please",
  "Always use pnpm. Never npm.",
];

describe("repeated_instruction", () => {
  it("spots a rule typed again and again and offers it as instruction text", () => {
    const sessions = sessionsOverDays(5, (index) => ({ prompts: [prompt(task(), day(index)), prompt(variants[index]!, day(index, 2))] }));
    const result = findings("repeated_instruction", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.metric?.value).toBe(5);
    expect(result[0]!.suggestion?.type).toBe("instructions");
    expect(result[0]!.suggestion?.instructionText?.toLowerCase()).toContain("pnpm");
    expect(result[0]!.evidence.every((item) => item.note.startsWith("Typed:"))).toBe(true);
  });

  it("stays quiet when the repeats all happened on one day", () => {
    const sessions = sessionsOverDays(5, (index) => ({ startTime: day(0, index * 60), prompts: [prompt(variants[index]!, day(0, index * 60))] }));
    expect(findings("repeated_instruction", sessions)).toEqual([]);
  });

  it("ignores short replies and slash commands", () => {
    const sessions = sessionsOverDays(8, (index) => ({ prompts: [prompt("yes continue", day(index)), prompt("/review", day(index, 1)), prompt(task(), day(index, 2))] }));
    expect(findings("repeated_instruction", sessions)).toEqual([]);
  });

  it("stays quiet on varied, ordinary prompts", () => {
    expect(findings("repeated_instruction", sessionsOverDays(20))).toEqual([]);
  });
});
