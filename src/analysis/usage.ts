import type { Harness, ModelRequest, Session, TokenUsage, UsageSummary, UsageTotals } from "../schema/types.js";
import { continuousDays, type Clock } from "./time.js";

/** USD per million tokens. */
export interface Rates {
  input: number;
  write5m: number;
  write1h: number;
  cacheRead: number;
  output: number;
}

interface ModelPrice {
  rates: Rates;
  /**
   * Prompts (all input tokens: uncached, cache reads and cache writes) above `overTokens`
   * pay `rates`, or stay unpriced when the source gives no rate for them. Absent means
   * the whole context window is billed at the standard rates.
   */
  longContext?: { overTokens: number; rates: Rates | null };
}

/** Anthropic rows, read straight from the table: input, 5m write, 1h write, cache hit, output. */
const claude = (input: number, write5m: number, write1h: number, cacheRead: number, output: number): Rates => ({
  input,
  write5m,
  write1h,
  cacheRead,
  output,
});

/** OpenAI bills no cache writes; the write rates only matter if a source ever reports them. */
const openai = (input: number, cacheRead: number, output: number): Rates => ({ input, write5m: input, write1h: input, cacheRead, output });

/**
 * Models before Claude 4.6 had a 200k window or a long-context surcharge the pricing page no
 * longer lists, so a longer prompt on them has no honest price.
 */
const LEGACY_LONG_CONTEXT = { overTokens: 200_000, rates: null };
/**
 * OpenAI: "Short context: <=272K input tokens. Long context: >272K input tokens." The page does
 * not say whether cached tokens count; the API's `input_tokens` includes them, so the whole prompt is compared.
 */
const OPENAI_LONG_CONTEXT_TOKENS = 272_000;

/**
 * Exact model ids (after `canonicalModel`), so a renamed or new model is reported as
 * unpriced instead of silently borrowing a price.
 *
 * Anthropic: https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-15.
 * Cache-hit prices are per model (0.025x on Fable/Mythos 5.2 and 5.1, 0.05x on Opus 5.5 and
 * Sonnet 5.5, 0.1x elsewhere). Claude 4.6 and later, except Haiku 5.5, bill the full 1M window
 * at standard rates; Haiku 5.5 has a higher tier for prompts over 100,000 tokens.
 *
 * OpenAI: https://developers.openai.com/api/docs/pricing, read 2026-11-15. Standard tier only.
 * Only models seen in Codex history on the development machine, each checked against the page;
 * `gpt-5.3-codex` is listed under specialized models with no long-context rate.
 *
 * Not modelled, because transcripts do not record them: fast mode, batch, data residency
 * (`inference_geo: "us"`, 1.1x) and OpenAI flex/priority tiers. Estimates assume standard global API calls.
 */
const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-2": { rates: claude(8, 10, 16, 0.2, 40) },
  "claude-mythos-5-2": { rates: claude(8, 10, 16, 0.2, 40) },
  "claude-fable-5-1": { rates: claude(10, 12.5, 20, 0.25, 50) },
  "claude-mythos-5-1": { rates: claude(10, 12.5, 20, 0.25, 50) },
  "claude-fable-5": { rates: claude(10, 12.5, 20, 1, 50) },
  "claude-mythos-5": { rates: claude(10, 12.5, 20, 1, 50) },
  "claude-opus-5-5": { rates: claude(4, 5, 8, 0.2, 20) },
  "claude-opus-5": { rates: claude(5, 6.25, 10, 0.5, 25) },
  "claude-opus-4-8": { rates: claude(5, 6.25, 10, 0.5, 25) },
  "claude-opus-4-7": { rates: claude(5, 6.25, 10, 0.5, 25) },
  "claude-opus-4-6": { rates: claude(5, 6.25, 10, 0.5, 25) },
  "claude-opus-4-5": { rates: claude(5, 6.25, 10, 0.5, 25), longContext: LEGACY_LONG_CONTEXT },
  "claude-opus-4-1": { rates: claude(15, 18.75, 30, 1.5, 75), longContext: LEGACY_LONG_CONTEXT },
  "claude-opus-4": { rates: claude(15, 18.75, 30, 1.5, 75), longContext: LEGACY_LONG_CONTEXT },
  "claude-sonnet-5-5": { rates: claude(2, 2.5, 4, 0.1, 10) },
  "claude-sonnet-5": { rates: claude(2, 2.5, 4, 0.2, 10) },
  "claude-sonnet-4-6": { rates: claude(3, 3.75, 6, 0.3, 15) },
  "claude-sonnet-4-5": { rates: claude(3, 3.75, 6, 0.3, 15), longContext: LEGACY_LONG_CONTEXT },
  "claude-sonnet-4": { rates: claude(3, 3.75, 6, 0.3, 15), longContext: LEGACY_LONG_CONTEXT },
  "claude-haiku-5-5": {
    rates: claude(0.1, 0.125, 0.2, 0.01, 0.5),
    longContext: { overTokens: 100_000, rates: claude(0.5, 0.625, 1, 0.05, 2.5) },
  },
  "claude-haiku-4-5": { rates: claude(1, 1.25, 2, 0.1, 5), longContext: LEGACY_LONG_CONTEXT },

  "gpt-6-astra": { rates: openai(10, 1, 50), longContext: { overTokens: OPENAI_LONG_CONTEXT_TOKENS, rates: openai(20, 2, 75) } },
  "gpt-6.1-sol": { rates: openai(2, 0.1, 10), longContext: { overTokens: OPENAI_LONG_CONTEXT_TOKENS, rates: openai(4, 0.2, 15) } },
  "gpt-5.6-sol": { rates: openai(4, 0.4, 20), longContext: { overTokens: OPENAI_LONG_CONTEXT_TOKENS, rates: openai(8, 0.8, 30) } },
  "gpt-5.5": { rates: openai(5, 0.5, 30), longContext: { overTokens: OPENAI_LONG_CONTEXT_TOKENS, rates: openai(10, 1, 45) } },
  "gpt-5.4": { rates: openai(2.5, 0.25, 15), longContext: { overTokens: OPENAI_LONG_CONTEXT_TOKENS, rates: openai(5, 0.5, 22.5) } },
  "gpt-5.3-codex": { rates: openai(1.75, 0.175, 14), longContext: { overTokens: OPENAI_LONG_CONTEXT_TOKENS, rates: null } },
  "gpt-5": { rates: openai(1.25, 0.125, 10), longContext: { overTokens: OPENAI_LONG_CONTEXT_TOKENS, rates: null } },
};

export const PRICING_VERSION = "api-list-2026-11-15";

/** Daily rollups keep at most this many of the newest days, bounding a report built from years of history. */
export const MAX_DAYS = 1100;

/**
 * The table key for a model id as transcripts and cloud providers spell it. Only known
 * decorations are removed: a provider prefix, a context-size tag like `[1m]`, a Bedrock
 * version, a Vertex `@date`, a trailing release date or `-latest`. Anything else stays, so
 * an unfamiliar variant misses the table instead of matching the wrong row.
 */
export function canonicalModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(?:anthropic|openai)\//, "")
    .replace(/^(?:[a-z]{2,6}\.)?anthropic\./, "")
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-v\d+(?::\d+)?$/, "")
    .replace(/@[\w.-]+$/, "")
    .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "")
    .replace(/-latest$/, "");
}

function priceFor(model: string): ModelPrice | null {
  return PRICES[canonicalModel(model)] ?? null;
}

/** The rates this request is billed at, or null when the model or its prompt length has no known price. */
export function ratesFor(model: string, usage: TokenUsage): Rates | null {
  const price = priceFor(model);
  if (!price) return null;
  const prompt = usage.input + usage.cachedInput + usage.cacheWrite;
  if (price.longContext && prompt > price.longContext.overTokens) return price.longContext.rates;
  return price.rates;
}

/** API list-price estimate for one request, or null when it cannot be priced honestly. */
export function estimateUsd(model: string, usage: TokenUsage): number | null {
  const rates = ratesFor(model, usage);
  if (!rates) return null;
  const long = usage.cacheWrite1h ?? 0;
  const short = usage.cacheWrite5m ?? 0;
  if (short + long > usage.cacheWrite) return null;
  // Writes the source could not split are priced at the 5-minute rate, the API's default cache lifetime.
  const unsplit = usage.cacheWrite - short - long;
  return (
    (usage.input * rates.input +
      usage.cachedInput * rates.cacheRead +
      usage.output * rates.output +
      (short + unsplit) * rates.write5m +
      long * rates.write1h) /
    1e6
  );
}

export interface OwnedRequest {
  session: Session;
  request: ModelRequest;
  usd: number | null;
}

/**
 * Every request once. Ids are unique per harness, and a resumed or forked session
 * repeats its parent's responses, so the first session (by start time) keeps them.
 */
export function uniqueRequests(sessions: Session[]): OwnedRequest[] {
  const seen = new Set<string>();
  const out: OwnedRequest[] = [];
  for (const session of sessions) {
    for (const request of session.requests) {
      const key = `${session.harness}\u0000${request.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ session, request, usd: estimateUsd(request.model, request.usage) });
    }
  }
  return out;
}

export function emptyTotals(): UsageTotals {
  return { tokens: 0, input: 0, cachedInput: 0, cacheWrite: 0, output: 0, requests: 0, estimatedUsd: null, unpriced: 0 };
}

export function addRequest(totals: UsageTotals, usage: TokenUsage, usd: number | null): void {
  totals.input += usage.input;
  totals.cachedInput += usage.cachedInput;
  totals.cacheWrite += usage.cacheWrite;
  totals.output += usage.output;
  totals.tokens += usage.input + usage.cachedInput + usage.cacheWrite + usage.output;
  totals.requests += 1;
  if (usd === null) totals.unpriced += 1;
  else totals.estimatedUsd = (totals.estimatedUsd ?? 0) + usd;
}

export function cacheHitRate(totals: Pick<UsageTotals, "input" | "cachedInput" | "cacheWrite">): number | null {
  const denominator = totals.input + totals.cachedInput + totals.cacheWrite;
  return denominator > 0 ? totals.cachedInput / denominator : null;
}

export function summarizeUsage(requests: OwnedRequest[], clock: Clock): UsageSummary {
  const total = emptyTotals();
  const byDay = new Map<string, UsageTotals>();
  const byModel = new Map<string, UsageTotals & { harness: Harness; model: string }>();
  for (const { session, request, usd } of requests) {
    addRequest(total, request.usage, usd);
    const day = clock.day(request.timestamp);
    if (day) {
      let bucket = byDay.get(day);
      if (!bucket) byDay.set(day, (bucket = emptyTotals()));
      addRequest(bucket, request.usage, usd);
    }
    const key = `${session.harness}\u0000${request.model}`;
    let row = byModel.get(key);
    if (!row) byModel.set(key, (row = { ...emptyTotals(), harness: session.harness, model: request.model }));
    addRequest(row, request.usage, usd);
  }
  const daily = continuousDays(byDay.keys(), MAX_DAYS).map((day) => ({ ...(byDay.get(day) ?? emptyTotals()), day }));
  const models = [...byModel.values()].sort(
    (a, b) => b.tokens - a.tokens || a.harness.localeCompare(b.harness) || a.model.localeCompare(b.model),
  );
  return { ...total, daily, models, cacheHitRate: cacheHitRate(total), pricingVersion: PRICING_VERSION };
}
