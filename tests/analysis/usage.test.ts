import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import { estimateUsd, PRICING_VERSION } from "../../src/analysis/usage.js";
import { coverage, NOW, request, session } from "./factory.js";

const build = (sessions: ReturnType<typeof session>[], timeZone = "UTC") =>
  buildReport({ sessions, coverage: [coverage("claude-code", sessions.length)], now: NOW, timeZone });

describe("usage and cost", () => {
  it("prices a known model at list price, including both cache-write lifetimes", () => {
    const usd = estimateUsd("claude-sonnet-4-6", {
      input: 100_000,
      cachedInput: 50_000,
      cacheWrite: 30_000,
      cacheWrite5m: 20_000,
      cacheWrite1h: 10_000,
      output: 10_000,
    });
    // input 0.3 + cache read 0.015 + output 0.15 + 5m writes 0.075 + 1h writes 0.06
    expect(usd).toBeCloseTo(0.6, 9);
  });

  it("leaves unknown models unpriced instead of calling them free", () => {
    const report = build([session({ requests: [request({ model: "mystery-model-9" })] })]);
    expect(report.usage.estimatedUsd).toBeNull();
    expect(report.usage.unpriced).toBe(1);
    expect(report.usage.requests).toBe(1);
    expect(report.usage.tokens).toBeGreaterThan(0);
  });

  it("does not guess the price of cache writes without a lifetime split", () => {
    expect(estimateUsd("claude-sonnet-4-6", { input: 10, cachedInput: 0, cacheWrite: 50, output: 5 })).toBeNull();
  });

  it("does not price long-context requests at standard rates", () => {
    expect(estimateUsd("claude-sonnet-4-6", { input: 250_000, cachedInput: 0, cacheWrite: 0, output: 5 })).toBeNull();
  });

  it("counts a response copied into a resumed session only once", () => {
    const shared = request({ id: "msg-1" });
    const report = build([
      session({ id: "a", requests: [shared] }),
      session({ id: "b", startTime: "2026-06-02T09:00:00Z", requests: [shared, request({ id: "msg-2" })] }),
    ]);
    expect(report.usage.requests).toBe(2);
  });

  it("keeps the same response id from two harnesses apart", () => {
    const report = build([
      session({ id: "a", requests: [request({ id: "same" })] }),
      session({ id: "b", harness: "codex", requests: [request({ id: "same", model: "gpt-5" })] }),
    ]);
    expect(report.usage.requests).toBe(2);
    expect(report.usage.models.map((row) => row.harness).sort()).toEqual(["claude-code", "codex"]);
  });

  it("rolls usage up per model and per day, with the hit rate over all input", () => {
    const report = build([
      session({
        requests: [
          request({ timestamp: "2026-06-01T10:00:00Z", usage: { input: 100, cachedInput: 300, cacheWrite: 0, output: 10 } }),
          request({ timestamp: "2026-06-03T10:00:00Z", model: "claude-opus-4-6", usage: { input: 100, cachedInput: 0, cacheWrite: 0, output: 10 } }),
        ],
      }),
    ]);
    expect(report.usage.daily.map((row) => [row.day, row.requests])).toEqual([
      ["2026-06-01", 1],
      ["2026-06-02", 0],
      ["2026-06-03", 1],
    ]);
    expect(report.usage.models.map((row) => row.model)).toEqual(["claude-sonnet-4-6", "claude-opus-4-6"]);
    expect(report.usage.cacheHitRate).toBeCloseTo(300 / 500, 6);
    expect(report.usage.pricingVersion).toBe(PRICING_VERSION);
  });

  it("buckets days in the report's time zone, not UTC", () => {
    const late = session({ requests: [request({ timestamp: "2026-06-02T03:00:00Z" })] });
    expect(build([late], "America/Los_Angeles").usage.daily.map((row) => row.day)).toEqual(["2026-06-01"]);
    expect(build([late], "UTC").usage.daily.map((row) => row.day)).toEqual(["2026-06-02"]);
  });

  it("reports no hit rate when there was no input at all", () => {
    expect(build([session({ requests: [] })]).usage.cacheHitRate).toBeNull();
  });
});
