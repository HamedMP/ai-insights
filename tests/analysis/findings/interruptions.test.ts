import { describe, expect, it } from "vitest";
import { day, prompt, sessionsOverDays, task } from "../factory.js";
import { findings } from "./helpers.js";

describe("slow_correction", () => {
  it("flags stepping in only after the agent has run alone for a long time", () => {
    const sessions = sessionsOverDays(3, (index) => ({
      prompts: [prompt(task(), day(index)), prompt("no, stop, that is the wrong file", day(index, 25), true)],
    }));
    const result = findings("slow_correction", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.metric).toEqual({ value: 25, unit: "minutes", label: "typical time before stepping in" });
    expect(result[0]!.evidence).toHaveLength(3);
  });

  it("does not count sessions an orchestrator was steering", () => {
    const sessions = sessionsOverDays(4, (index) => ({
      agentMessageCount: 12,
      userMessageCount: 2,
      prompts: [prompt(task(), day(index)), prompt("no, stop, that is the wrong file", day(index, 25), true)],
    }));
    expect(findings("slow_correction", sessions)).toEqual([]);
  });

  it("stays quiet when corrections come quickly", () => {
    const sessions = sessionsOverDays(6, (index) => ({ prompts: [prompt(task(), day(index)), prompt("wait, use the other one", day(index, 2), true)] }));
    expect(findings("slow_correction", sessions)).toEqual([]);
  });
});

describe("frequent_interruptions", () => {
  it("flags a high share of prompts sent mid-turn", () => {
    const sessions = sessionsOverDays(5, (index) => ({
      prompts: [prompt(task(), day(index)), prompt(task(), day(index, 1), true), prompt(task(), day(index, 2), true), prompt(task(), day(index, 3))],
    }));
    const result = findings("frequent_interruptions", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.metric?.value).toBe(50);
    expect(result[0]!.severity).toBe("medium");
  });

  it("does not count interruptions in sessions an orchestrator was steering", () => {
    const sessions = sessionsOverDays(5, (index) => ({
      agentMessageCount: 20,
      userMessageCount: 4,
      prompts: [prompt(task(), day(index)), prompt(task(), day(index, 1), true), prompt(task(), day(index, 2), true), prompt(task(), day(index, 3))],
    }));
    expect(findings("frequent_interruptions", sessions)).toEqual([]);
  });

  it("stays quiet on the odd interruption", () => {
    const sessions = sessionsOverDays(20, (index) => ({
      prompts: [prompt(task(), day(index)), prompt(task(), day(index, 5), index % 5 === 0), prompt(task(), day(index, 9))],
    }));
    expect(findings("frequent_interruptions", sessions)).toEqual([]);
  });
});
