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

  it("does not price long prompts on models whose long-context price is unknown", () => {
    expect(estimateUsd("claude-opus-4-5-20251101", { input: 250_000, cachedInput: 0, cacheWrite: 0, output: 5 })).toBeNull();
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

  it("carries unpriced counts on each model row, so the share priced can be shown per model", () => {
    const report = build([
      session({
        requests: [
          request({ model: "claude-opus-5-5" }),
          request({ model: "mystery-model-9" }),
          request({ model: "mystery-model-9" }),
          request({ model: "claude-opus-4-5-20251101", usage: { input: 250_000 } }),
        ],
      }),
    ]);
    const rows = Object.fromEntries(report.usage.models.map((row) => [row.model, row]));
    expect(rows["mystery-model-9"]).toMatchObject({ requests: 2, unpriced: 2, estimatedUsd: null });
    expect(rows["claude-opus-5-5"]).toMatchObject({ requests: 1, unpriced: 0 });
    expect(rows["claude-opus-4-5-20251101"]).toMatchObject({ requests: 1, unpriced: 1, estimatedUsd: null });
    expect(report.usage.models.reduce((sum, row) => sum + row.unpriced, 0)).toBe(report.usage.unpriced);
    expect(report.usage.unpriced).toBe(3);
  });

  it("reports no hit rate when there was no input at all", () => {
    expect(build([session({ requests: [] })]).usage.cacheHitRate).toBeNull();
  });
});

describe("cost the harness recorded", () => {
  it("shows recorded spend apart from the list-price estimate, per harness and in total", () => {
    const report = build([
      session({ id: "o1", harness: "opencode", requests: [request({ id: "r1", model: "openai/gpt-5.5", costUsd: 0.4 }), request({ id: "r2", model: "mystery-model-9", costUsd: 0.1 })] }),
      session({ id: "p1", harness: "pi", requests: [request({ id: "r3", model: "openai-codex/gpt-5.5", costUsd: 0 })] }),
      session({ id: "c1", harness: "claude-code", requests: [request({ id: "r4", model: "claude-sonnet-4-6" })] }),
    ]);
    expect(report.usage.recorded).toEqual({ usd: 0.5, requests: 3, zeroRequests: 1 });
    expect(report.usage.recordedByHarness).toEqual([
      { harness: "opencode", usd: 0.5, requests: 2, zeroRequests: 0 },
      { harness: "pi", usd: 0, requests: 1, zeroRequests: 1 },
    ]);
    // The estimate is still the list-price one; the recorded cost never fills an unpriced gap.
    expect(report.usage.unpriced).toBe(1);
  });

  it("has no recorded cost when no harness recorded one, rather than $0", () => {
    const report = build([session({ requests: [request({ model: "claude-sonnet-4-6" })] })]);
    expect(report.usage.recorded).toBeUndefined();
    expect(report.usage.recordedByHarness).toBeUndefined();
  });

  it("adds up the Codex spend whose rollouts recorded no service tier, and what it would cost on Fast", () => {
    const codex = (serviceTier?: string) =>
      request({ model: "gpt-6.1-sol", timestamp: "2026-11-01T00:00:00Z", usage: { input: 100_000, cachedInput: 0, output: 0 }, ...(serviceTier ? { serviceTier } : {}) });
    const report = buildReport({
      sessions: [
        session({ harness: "codex", requests: [codex(), codex(), codex("default"), codex("priority")] }),
        // Claude Code requests carry no OpenAI tier; they are not part of this figure.
        session({ requests: [request({ model: "claude-opus-5-5" })] }),
      ],
      coverage: [coverage("codex", 1), coverage("claude-code", 1)],
      now: NOW,
      timeZone: "UTC",
    });
    // Two untiered requests at $0.20 each on Standard, $0.40 each on Fast.
    expect(report.usage.untiered).toEqual([{ harness: "codex", requests: 2, estimatedUsd: 0.4, atFastUsd: 0.8 }]);
  });

  it("says nothing about tiers when every Codex request recorded one", () => {
    const report = buildReport({
      sessions: [session({ harness: "codex", requests: [request({ model: "gpt-6.1-sol", serviceTier: "default" })] })],
      coverage: [coverage("codex", 1)],
      now: NOW,
      timeZone: "UTC",
    });
    expect(report.usage.untiered).toBeUndefined();
  });
});
