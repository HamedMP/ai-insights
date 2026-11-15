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

  it("keeps older models' long prompts unpriced, since the page gives no basis for them", () => {
    expect(estimateUsd("claude-sonnet-4-5-20250929", usage({ input: 250_000 }))).toBeNull();
    expect(estimateUsd("claude-sonnet-4-5-20250929", usage({ input: 150_000 }))).toBeCloseTo(0.45, 9);
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

  it("keeps models without a published price or long-context rate unpriced", () => {
    expect(estimateUsd("codex-auto-review", usage({ input: 10 }))).toBeNull();
    expect(estimateUsd("gpt-5-codex", usage({ input: 10 }))).toBeNull();
    expect(estimateUsd("gpt-5.3-codex", usage({ input: 300_000 }))).toBeNull();
    expect(estimateUsd("gpt-5.3-codex", usage({ input: M / 10 }))).toBeCloseTo(0.175, 9);
  });
});

it("names the price table revision", () => {
  expect(PRICING_VERSION).not.toBe("api-list-2026-11-09");
  expect(PRICING_VERSION).toMatch(/^api-list-\d{4}-\d{2}-\d{2}/);
});
