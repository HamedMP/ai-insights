import type { Harness, ModelRequest, Session, TokenUsage, UsageSummary, UsageTotals } from "../schema/types.js";
import { continuousDays, type Clock } from "./time.js";

/**
 * USD per million tokens: [input, cache read, output]. Exact model ids only, so a
 * renamed or new model is reported as unpriced instead of silently borrowing a price.
 * Sources: https://platform.claude.com/docs/en/about-claude/pricing and
 * https://developers.openai.com/api/docs/pricing, reviewed 2026-11-09.
 * Cache writes without a TTL split and long-context surcharges stay unpriced.
 */
const PRICES: Record<string, readonly [number, number, number]> = {
  "claude-3-5-haiku-20241022": [0.8, 0.08, 4],
  "claude-haiku-4-5-20251001": [1, 0.1, 5],
  "claude-sonnet-4-20250514": [3, 0.3, 15],
  "claude-sonnet-4-5-20250929": [3, 0.3, 15],
  "claude-sonnet-4-6": [3, 0.3, 15],
  "claude-opus-4-20250514": [15, 1.5, 75],
  "claude-opus-4-1-20250805": [15, 1.5, 75],
  "claude-opus-4-5-20251101": [5, 0.5, 25],
  "claude-opus-4-6": [5, 0.5, 25],
  "claude-opus-4-8": [5, 0.5, 25],
  "claude-opus-5": [5, 0.5, 25],
  "claude-sonnet-5-5": [2, 0.1, 10],
  "claude-opus-5-5": [4, 0.2, 20],
  "claude-fable-5-1": [10, 0.25, 50],
  "gpt-5": [1.25, 0.125, 10],
  "gpt-5-codex": [1.25, 0.125, 10],
  "gpt-5.3-codex": [1.75, 0.175, 14],
  "gpt-5.4": [2.5, 0.25, 15],
  "gpt-5.5": [5, 0.5, 30],
  "gpt-5.6-sol": [4, 0.4, 20],
  "gpt-6.1-sol": [2, 0.1, 10],
};

export const PRICING_VERSION = "api-list-2026-11-09";

/** Requests whose prompt exceeds this are billed at long-context rates we do not model. */
const LONG_CONTEXT_TOKENS = 200_000;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;
/** Daily rollups keep at most this many of the newest days, bounding a report built from years of history. */
export const MAX_DAYS = 1100;

export function priceFor(model: string): readonly [number, number, number] | null {
  return PRICES[model] ?? null;
}

/** API list-price estimate for one request, or null when it cannot be priced honestly. */
export function estimateUsd(model: string, usage: TokenUsage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  if (usage.input + usage.cachedInput + usage.cacheWrite > LONG_CONTEXT_TOKENS) return null;
  const short = usage.cacheWrite5m ?? 0;
  const long = usage.cacheWrite1h ?? 0;
  if (short + long !== usage.cacheWrite) return null;
  return (
    (usage.input * price[0] +
      usage.cachedInput * price[1] +
      usage.output * price[2] +
      short * price[0] * CACHE_WRITE_5M_MULTIPLIER +
      long * price[0] * CACHE_WRITE_1H_MULTIPLIER) /
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
