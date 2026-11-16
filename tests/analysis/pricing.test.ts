import { describe, expect, it } from "vitest";
import { canonicalModel, estimateUsd, PRICING_VERSION } from "../../src/analysis/usage.js";
import type { TokenUsage } from "../../src/schema/types.js";

const usage = (overrides: Partial<TokenUsage>): TokenUsage => ({ input: 0, cachedInput: 0, cacheWrite: 0, output: 0, ...overrides });
const M = 1_000_000;

describe("Anthropic list prices", () => {
  it("prices Opus 5.5 prompts beyond 200k tokens at standard rates, as its full 1M window is", () => {
    // 300k * $4 + 500k * $0.20 + 1k * $20
    expect(estimateUsd("claude-opus-5-5", usage({ input: 300_000, cachedInput: 500_000, output: 1000 }))).toBeCloseTo(1.32, 9);
  });

  it("uses each model's own cache-hit price rather than one global multiplier", () => {
    const read = (model: string) => estimateUsd(model, usage({ cachedInput: M }));
    expect(read("claude-fable-5-2")).toBeCloseTo(0.2, 9);
    expect(read("claude-mythos-5-1")).toBeCloseTo(0.25, 9);
    expect(read("claude-opus-5-5")).toBeCloseTo(0.2, 9);
    expect(read("claude-sonnet-5-5")).toBeCloseTo(0.1, 9);
    expect(read("claude-fable-5")).toBeCloseTo(1, 9);
    expect(read("claude-opus-4-6")).toBeCloseTo(0.5, 9);
  });

  it("prices both cache-write lifetimes from the table", () => {
    expect(estimateUsd("claude-fable-5-2", usage({ cacheWrite: 2 * M, cacheWrite5m: M, cacheWrite1h: M }))).toBeCloseTo(10 + 16, 9);
  });

  it("prices a cache write with no lifetime split at the 5-minute rate", () => {
    expect(estimateUsd("claude-opus-5-5", usage({ cacheWrite: M }))).toBeCloseTo(5, 9);
    // 400k recorded as 1h, the unsplit 600k at the 5m rate
    expect(estimateUsd("claude-opus-5-5", usage({ cacheWrite: M, cacheWrite1h: 400_000 }))).toBeCloseTo(3.2 + 3, 9);
  });

  it("refuses to price a cache write whose split exceeds its total", () => {
    expect(estimateUsd("claude-opus-5-5", usage({ cacheWrite: 10, cacheWrite5m: 20 }))).toBeNull();
  });

  it("prices Haiku 5.5 per request by prompt length, counting cache reads and writes", () => {
    expect(estimateUsd("claude-haiku-5-5", usage({ input: 100_000, output: M }))).toBeCloseTo(0.01 + 0.5, 9);
    // 100,001-token prompt mostly from cache: the whole request pays the higher tier
    expect(estimateUsd("claude-haiku-5-5", usage({ input: 1, cachedInput: 100_000, output: M }))).toBeCloseTo(0.5 / M + 0.005 + 2.5, 9);
    expect(estimateUsd("claude-haiku-5-5", usage({ input: 1, cacheWrite: 100_000, cacheWrite1h: 100_000 }))).toBeCloseTo(0.5 / M + 0.1, 9);
  });

  it("prices Sonnet 4 and 4.5 prompts over 200k at their published long-context rates", () => {
    // $6 input, $22.50 output above 200k; cache multipliers apply to the long-context input price
    expect(estimateUsd("claude-sonnet-4-5-20250929", usage({ input: 250_000, output: 1000 }))).toBeCloseTo(1.5 + 0.0225, 9);
    expect(estimateUsd("claude-sonnet-4-20250514", usage({ input: 1, cachedInput: 250_000 }))).toBeCloseTo(6 / M + 0.15, 9);
    expect(estimateUsd("claude-sonnet-4-5-20250929", usage({ input: 150_000 }))).toBeCloseTo(0.45, 9);
  });

  it("keeps long prompts unpriced on models whose window never went past 200k", () => {
    expect(estimateUsd("claude-opus-4-5", usage({ input: 250_000 }))).toBeNull();
    expect(estimateUsd("claude-haiku-4-5", usage({ input: 250_000 }))).toBeNull();
  });

  it("prices Opus 4.6 and Sonnet 4.6 long prompts at the surcharge in force before 13 March 2026, standard after", () => {
    const before = { timestamp: "2026-03-12T23:59:59Z" };
    const after = { timestamp: "2026-03-13T00:00:00Z" };
    expect(estimateUsd("claude-sonnet-4-6", usage({ input: 250_000 }), after)).toBeCloseTo(0.75, 9);
    expect(estimateUsd("claude-sonnet-4-6", usage({ input: 250_000 }), before)).toBeCloseTo(1.5, 9);
    // Opus 4.6 over 200k: $10 input, $37.50 output, cache hits at 0.1x and 5m writes at 1.25x of $10
    expect(estimateUsd("claude-opus-4-6", usage({ input: 100_000, cachedInput: 100_000, cacheWrite: 100_000, output: 1000 }), before)).toBeCloseTo(1 + 0.1 + 1.25 + 0.0375, 9);
    expect(estimateUsd("claude-opus-4-6", usage({ input: 100_000, cachedInput: 100_000, cacheWrite: 100_000, output: 1000 }), after)).toBeCloseTo(0.5 + 0.05 + 0.625 + 0.025, 9);
    // Short prompts never paid the surcharge.
    expect(estimateUsd("claude-opus-4-6", usage({ input: 100_000 }), before)).toBeCloseTo(0.5, 9);
  });

  it("prices a request with no timestamp at today's rates", () => {
    expect(estimateUsd("claude-sonnet-4-6", usage({ input: 250_000 }))).toBeCloseTo(0.75, 9);
  });

  it("leaves unknown models and models missing from the page unpriced", () => {
    expect(estimateUsd("mystery-model", usage({ input: 10 }))).toBeNull();
    expect(estimateUsd("claude-3-5-haiku-20241022", usage({ input: 10 }))).toBeNull();
    expect(estimateUsd("<synthetic>", usage({ input: 10 }))).toBeNull();
  });
});

describe("model id matching", () => {
  it("maps dated, provider-prefixed and variant ids onto their table row", () => {
    expect(canonicalModel("claude-opus-4-1-20250805")).toBe("claude-opus-4-1");
    expect(canonicalModel("openai-codex/gpt-5.5")).toBe("gpt-5.5");
    expect(canonicalModel("claude-opus-4-20250514")).toBe("claude-opus-4");
    expect(canonicalModel("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5");
    expect(canonicalModel("claude-opus-4-6[1m]")).toBe("claude-opus-4-6");
    expect(canonicalModel("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe("claude-sonnet-4-5");
    expect(canonicalModel("anthropic/claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(canonicalModel("claude-opus-4-5@20251101")).toBe("claude-opus-4-5");
    expect(canonicalModel("CLAUDE-OPUS-5-5")).toBe("claude-opus-5-5");
    expect(canonicalModel("claude-sonnet-4-5-latest")).toBe("claude-sonnet-4-5");
    expect(canonicalModel("gpt-5-2025-08-07")).toBe("gpt-5");
  });

  it("does not borrow a price for an id it does not recognise", () => {
    expect(estimateUsd("claude-opus-5-5-preview", usage({ input: 10 }))).toBeNull();
    expect(estimateUsd("claude-opus-4-1-20250805", usage({ input: M / 10 }))).toBeCloseTo(1.5, 9);
    expect(estimateUsd("claude-opus-4-20250514", usage({ input: M / 10 }))).toBeCloseTo(1.5, 9);
  });
});

describe("OpenAI list prices", () => {
  it("prices gpt-6.1-sol at short-context rates up to 272k prompt tokens", () => {
    // 100k * $2 + 100k * $0.10 + 1k * $10
    expect(estimateUsd("gpt-6.1-sol", usage({ input: 100_000, cachedInput: 100_000, output: 1000 }))).toBeCloseTo(0.22, 9);
  });

  it("prices a prompt over 272k tokens, cached input included, at long-context rates", () => {
    // 200k * $4 + 100k * $0.20 + 1k * $15
    expect(estimateUsd("gpt-6.1-sol", usage({ input: 200_000, cachedInput: 100_000, output: 1000 }))).toBeCloseTo(0.835, 9);
    expect(estimateUsd("gpt-6-astra", usage({ input: 300_000, output: 1000 }))).toBeCloseTo(6 + 0.075, 9);
  });

  it("bills Codex cache writes at 1.25x input on models that list a cache-write price", () => {
    expect(estimateUsd("gpt-6.1-sol", usage({ input: 1, cacheWrite: 100_000 }))).toBeCloseTo(2 / M + 0.25, 9);
    expect(estimateUsd("gpt-5.6-sol", usage({ cacheWrite: 100_000 }), { timestamp: "2026-10-01T00:00:00Z" })).toBeCloseTo(0.5, 9);
    // Models whose row lists no write price bill written tokens as ordinary input.
    expect(estimateUsd("gpt-5.5", usage({ cacheWrite: 100_000 }))).toBeCloseTo(0.5, 9);
  });

  it("prices Fast (priority) requests from the published Fast table, not a flat multiplier", () => {
    const fast = { serviceTier: "priority", timestamp: "2026-11-01T00:00:00Z" };
    expect(estimateUsd("gpt-6.1-sol", usage({ input: 100_000, cachedInput: 100_000, output: 1000 }), fast)).toBeCloseTo(0.44, 9);
    expect(estimateUsd("gpt-6.1-sol", usage({ input: 100_000 }), { ...fast, serviceTier: "fast" })).toBeCloseTo(0.4, 9);
    // gpt-5.5 Fast is 2.5x Standard on the page.
    expect(estimateUsd("gpt-5.5", usage({ input: 100_000 }), fast)).toBeCloseTo(1.25, 9);
    // Long-context Fast rows exist for gpt-6.1-sol, not for gpt-5.5.
    expect(estimateUsd("gpt-6.1-sol", usage({ input: 300_000 }), fast)).toBeCloseTo(2.4, 9);
    expect(estimateUsd("gpt-5.5", usage({ input: 300_000 }), fast)).toBeNull();
    expect(estimateUsd("gpt-6.1-sol", usage({ input: 100_000 }), { ...fast, serviceTier: "default" })).toBeCloseTo(0.2, 9);
  });

  it("prices Ultrafast from its own rows and leaves tiers without a published row unpriced", () => {
    expect(estimateUsd("gpt-6.1-sol", usage({ input: 100_000, output: 1000 }), { serviceTier: "ultrafast" })).toBeCloseTo(1.2 + 0.06, 9);
    expect(estimateUsd("gpt-5.6-sol", usage({ input: 10 }), { serviceTier: "ultrafast" })).toBeNull();
    expect(estimateUsd("gpt-6.1-sol", usage({ input: 10 }), { serviceTier: "mystery" })).toBeNull();
  });

  it("prices GPT-5.6 history at the rates in force on the day", () => {
    const day = (timestamp: string, serviceTier?: string) => ({ timestamp, ...(serviceTier ? { serviceTier } : {}) });
    // Sol: $5/$30 until the 21 August 2026 promotion, $4/$20 after.
    expect(estimateUsd("gpt-5.6-sol", usage({ input: 100_000, output: 100_000 }), day("2026-08-20T23:59:59Z"))).toBeCloseTo(3.5, 9);
    expect(estimateUsd("gpt-5.6-sol", usage({ input: 100_000, output: 100_000 }), day("2026-08-21T00:00:00Z"))).toBeCloseTo(2.4, 9);
    // Fast mode cost twice Standard when it replaced Priority processing on 30 July 2026.
    expect(estimateUsd("gpt-5.6-sol", usage({ input: 100_000 }), day("2026-08-01T00:00:00Z", "priority"))).toBeCloseTo(1, 9);
    // Before 30 July a priority request ran on Priority processing, whose rates the page no longer lists.
    expect(estimateUsd("gpt-5.6-sol", usage({ input: 100_000 }), day("2026-07-20T00:00:00Z", "priority"))).toBeNull();
    // Terra was 20% and Luna 80% dearer before 30 July 2026.
    expect(estimateUsd("gpt-5.6-terra", usage({ input: 100_000, output: 100_000 }), day("2026-07-29T12:00:00Z"))).toBeCloseTo(1.75, 9);
    expect(estimateUsd("gpt-5.6-terra", usage({ input: 100_000, output: 100_000 }), day("2026-07-30T00:00:00Z"))).toBeCloseTo(1.4, 9);
    expect(estimateUsd("gpt-5.6-luna", usage({ input: 100_000, output: 100_000 }), day("2026-07-29T12:00:00Z"))).toBeCloseTo(0.7, 9);
    expect(estimateUsd("gpt-5.6-luna", usage({ input: 100_000, output: 100_000 }), day("2026-07-30T00:00:00Z"))).toBeCloseTo(0.14, 9);
  });

  it("keeps models without a published price or long-context rate unpriced", () => {
    expect(estimateUsd("codex-auto-review", usage({ input: 10 }))).toBeNull();
    expect(estimateUsd("gpt-5-codex", usage({ input: 10 }))).toBeNull();
    expect(estimateUsd("gpt-5.3-codex", usage({ input: 300_000 }))).toBeNull();
    expect(estimateUsd("gpt-5.3-codex", usage({ input: M / 10 }))).toBeCloseTo(0.175, 9);
  });
});

it("names the price table revision", () => {
  expect(PRICING_VERSION).not.toBe("api-list-2026-11-15");
  expect(PRICING_VERSION).toMatch(/^api-list-\d{4}-\d{2}-\d{2}/);
});

describe("OpenAI rows added from the vendor's pages (2026-11-16)", () => {
  const usage = { input: 1_000_000, cachedInput: 1_000_000, cacheWrite: 0, output: 1_000_000 };
  it("prices gpt-5.2 and gpt-5.2-codex at 1.75 / 0.175 / 14, and gpt-5.2 Fast at 3.50 / 0.35 / 28", () => {
    expect(estimateUsd("openai/gpt-5.2", usage)).toBeCloseTo(1.75 + 0.175 + 14, 9);
    expect(estimateUsd("gpt-5.2-codex", usage)).toBeCloseTo(1.75 + 0.175 + 14, 9);
    expect(estimateUsd("gpt-5.2", usage, { serviceTier: "priority" })).toBeCloseTo(3.5 + 0.35 + 28, 9);
  });

  it("bills gpt-5.2-pro cached tokens at the input rate, because the page lists no cached-input price", () => {
    expect(estimateUsd("gpt-5.2-pro", usage)).toBeCloseTo(21 + 21 + 168, 9);
  });

  it("keeps ids the vendor does not publish unpriced: OpenCode's gpt-5.5-fast and third-party hosts", () => {
    expect(estimateUsd("openai/gpt-5.5-fast", usage)).toBeNull();
    expect(estimateUsd("baseten/zai-org/GLM-5.2", usage)).toBeNull();
    expect(estimateUsd("gemini-3-pro-preview", usage)).toBeNull();
  });

  it("prices Pi's openai-codex provider ids from the OpenAI rows", () => {
    expect(estimateUsd("openai-codex/gpt-5.5", usage)).toBe(estimateUsd("gpt-5.5", usage));
  });
});
