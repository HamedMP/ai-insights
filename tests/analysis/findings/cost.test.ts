import { describe, expect, it } from "vitest";
import { day, prompt, request, sessionsOverDays, task, tool } from "../factory.js";
import { findings } from "./helpers.js";

describe("cache_miss_cost", () => {
  it("prices what a poor cache hit rate cost", () => {
    const sessions = sessionsOverDays(4, (index) => ({
      requests: Array.from({ length: 20 }, (_, n) =>
        request({ timestamp: day(index, n), model: "claude-opus-4-6", usage: { input: 150_000, cachedInput: 10_000, cacheWrite: 0, output: 1000 } }),
      ),
    }));
    const result = findings("cache_miss_cost", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("cache_miss_cost:claude-code");
    expect(result[0]!.metric?.unit).toBe("USD");
    // 80 requests * (0.8 * 160k - 10k) missing reads * ($5 - $0.5) / 1M
    expect(result[0]!.metric?.value).toBeCloseTo((80 * 118_000 * 4.5) / 1e6, 2);
    expect(result[0]!.evidence).toHaveLength(4);
  });

  it("stays quiet when most input comes from cache", () => {
    const sessions = sessionsOverDays(4, (index) => ({
      requests: Array.from({ length: 20 }, (_, n) =>
        request({ timestamp: day(index, n), model: "claude-opus-4-6", usage: { input: 5_000, cachedInput: 150_000, cacheWrite: 0, output: 1000 } }),
      ),
    }));
    expect(findings("cache_miss_cost", sessions)).toEqual([]);
  });

  it("stays quiet when the volume is too small to matter", () => {
    const sessions = sessionsOverDays(2, (index) => ({ requests: [request({ timestamp: day(index), usage: { input: 1000, cachedInput: 0, cacheWrite: 0, output: 10 } })] }));
    expect(findings("cache_miss_cost", sessions)).toEqual([]);
  });
});

describe("expensive_model_for_simple_work", () => {
  const quick = (model: string) => (index: number) => ({
    models: [model],
    userMessageCount: 1,
    activeMinutes: 3,
    linesAdded: 0,
    linesRemoved: 0,
    gitCommits: 0,
    prompts: [prompt(task(), day(index))],
    toolCalls: [tool("read", { timestamp: day(index, 1) })],
    requests: [request({ timestamp: day(index, 1), model }), request({ timestamp: day(index, 2), model })],
  });

  it("flags many quick questions answered by a top-tier model", () => {
    const result = findings("expensive_model_for_simple_work", sessionsOverDays(10, quick("claude-opus-4-6")));
    expect(result).toHaveLength(1);
    expect(result[0]!.metric?.value).toBe(10);
    expect(result[0]!.suggestion?.type).toBe("model_choice");
    expect(result[0]!.suggestion?.action).toContain("/model sonnet");
  });

  it("stays quiet when quick questions go to a mid-tier model", () => {
    expect(findings("expensive_model_for_simple_work", sessionsOverDays(10, quick("claude-sonnet-4-6")))).toEqual([]);
  });

  it("stays quiet when the top-tier sessions are real work", () => {
    const sessions = sessionsOverDays(10, (index) => ({ models: ["claude-opus-4-6"], requests: [request({ timestamp: day(index), model: "claude-opus-4-6" })] }));
    expect(findings("expensive_model_for_simple_work", sessions)).toEqual([]);
  });
});
