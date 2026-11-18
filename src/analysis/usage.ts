import type { Harness, ModelRequest, RecordedCost, Session, TokenUsage, UsageSummary, UsageTotals } from "../schema/types.js";
import { PRICE_SNAPSHOT, PRICES } from "./prices.generated.js";
import { continuousDays, type Clock } from "./time.js";

/** USD per million tokens. */
export interface Rates {
  input: number;
  write5m: number;
  write1h: number;
  cacheRead: number;
  output: number;
}

/** One service tier's rates. */
export interface TierPrice {
  rates: Rates;
  /**
   * Rates for prompts (all input tokens: uncached, cache reads and cache writes) above the row's
   * `overTokens`. Null when the source gives no rate for them, so such a prompt stays unpriced.
   * Absent means the whole context window is billed at `rates`.
   */
  long?: Rates | null;
}

/** The prices in force for one model during one period. */
export interface PriceRow {
  /** First instant (inclusive, UTC) the row applies; absent means from the model's release. */
  from?: string;
  /** Instant (exclusive, UTC) the row stops applying; absent means it is current. */
  until?: string;
  overTokens?: number;
  standard: TierPrice;
  /** OpenAI Fast mode (request value `priority`) or Anthropic fast mode (`usage.speed: "fast"`). */
  fast?: TierPrice;
  ultrafast?: TierPrice;
}

/**
 * The price table lives in `prices.generated.ts`, written by `scripts/update-prices.mjs` from a pinned LiteLLM
 * snapshot plus hand-written overrides (`scripts/prices/overrides.mjs`, which cites the providers' pages). Keys are
 * exact model ids after `canonicalModel`, so a renamed or new model is reported as unpriced instead of silently
 * borrowing a price. Rows for one model are disjoint periods; a request is priced by the row in force at its
 * timestamp (UTC), and a request without one by the current row. OpenAI's long context is "> 272K input tokens",
 * counted over the whole prompt including cached tokens; Anthropic's surcharge applies above 200k (100k on Haiku 5.5).
 *
 * Not modelled: batch, flex, data residency (1.1x; Claude Code records `usage.inference_geo`, the request does not
 * carry it yet) and 12-hour OpenAI cache writes. `codex-auto-review` has no API price and stays unpriced.
 */
export const PRICING_VERSION = `api-list-${PRICE_SNAPSHOT.date}`;

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
    .replace(/^(?:anthropic|openai|openai-codex)\//, "")
    .replace(/^(?:[a-z]{2,6}\.)?anthropic\./, "")
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-v\d+(?::\d+)?$/, "")
    .replace(/@[\w.-]+$/, "")
    .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "")
    .replace(/-latest$/, "");
}

/** When and how a request ran, beyond its token counts. */
export interface PriceContext {
  /** ISO time of the request; picks the price row in force then. Absent: today's prices. */
  timestamp?: string;
  /** Service tier as the transcript records it: OpenAI `default`, `priority`, `ultrafast`, ...; Claude `fast`. */
  serviceTier?: string;
}

function rowFor(rows: PriceRow[], timestamp: string | undefined): PriceRow | null {
  const time = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  if (!Number.isFinite(time)) return rows.find((row) => row.until === undefined) ?? null;
  return rows.find((row) => (row.from === undefined || Date.parse(row.from) <= time) && (row.until === undefined || time < Date.parse(row.until))) ?? null;
}

function tierFor(row: PriceRow, serviceTier: string | undefined): TierPrice | null {
  const name = serviceTier?.trim().toLowerCase();
  if (!name || name === "default" || name === "standard" || name === "auto") return row.standard;
  if (name === "priority" || name === "fast") return row.fast ?? null;
  if (name === "ultrafast") return row.ultrafast ?? null;
  // Flex, scale or a tier added later: no rate this table vouches for.
  return null;
}

/** The rates this request is billed at, or null when the model, period, tier or prompt length has no known price. */
export function ratesFor(model: string, usage: TokenUsage, context: PriceContext = {}): Rates | null {
  const rows = PRICES[canonicalModel(model)];
  if (!rows) return null;
  const row = rowFor(rows, context.timestamp);
  if (!row) return null;
  const price = tierFor(row, context.serviceTier);
  if (!price) return null;
  const prompt = usage.input + usage.cachedInput + usage.cacheWrite;
  if (price.long !== undefined && row.overTokens !== undefined && prompt > row.overTokens) return price.long;
  return price.rates;
}

/** API list-price estimate for one request, or null when it cannot be priced honestly. */
export function estimateUsd(model: string, usage: TokenUsage, context: PriceContext = {}): number | null {
  const rates = ratesFor(model, usage, context);
  if (!rates) return null;
  const long = usage.cacheWrite1h ?? 0;
  const short = usage.cacheWrite5m ?? 0;
  if (short + long > usage.cacheWrite) return null;
  // Writes the source could not split are priced at the shortest lifetime's rate, the API's default.
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

/** Pricing context carried by a request. */
export function priceContext(request: ModelRequest): PriceContext {
  return request.serviceTier === undefined ? { timestamp: request.timestamp } : { timestamp: request.timestamp, serviceTier: request.serviceTier };
}

/** What de-duplicating requests needs from a session; the usage-only scan has no more than this. */
export type RequestOwner = Pick<Session, "harness" | "requests">;

export interface OwnedRequest<S extends RequestOwner = Session> {
  session: S;
  request: ModelRequest;
  usd: number | null;
}

/**
 * Every request once. Ids are unique per harness, and a resumed or forked session
 * repeats its parent's responses, so the first session (by start time) keeps them.
 */
export function uniqueRequests<S extends RequestOwner = Session>(sessions: S[]): Array<OwnedRequest<S>> {
  const seen = new Set<string>();
  const out: Array<OwnedRequest<S>> = [];
  for (const session of sessions) {
    for (const request of session.requests) {
      const key = `${session.harness}\u0000${request.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ session, request, usd: estimateUsd(request.model, request.usage, priceContext(request)) });
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

/**
 * What the harnesses themselves recorded (`ModelRequest.costUsd`), kept apart from the list-price estimate. A
 * recorded $0 is counted in `zeroRequests`: subscriptions and coding plans record 0, which is not "free".
 */
function recordedCost(requests: OwnedRequest[]): Pick<UsageSummary, "recorded" | "recordedByHarness"> {
  const byHarness = new Map<Harness, RecordedCost>();
  const total: RecordedCost = { usd: 0, requests: 0, zeroRequests: 0 };
  for (const { session, request } of requests) {
    const usd = request.costUsd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) continue;
    let row = byHarness.get(session.harness);
    if (!row) byHarness.set(session.harness, (row = { usd: 0, requests: 0, zeroRequests: 0 }));
    for (const bucket of [row, total]) {
      bucket.usd += usd;
      bucket.requests += 1;
      if (usd === 0) bucket.zeroRequests += 1;
    }
  }
  if (total.requests === 0) return {};
  const tidy = (cost: RecordedCost): RecordedCost => ({ ...cost, usd: Math.round(cost.usd * 1e6) / 1e6 });
  return {
    recorded: tidy(total),
    recordedByHarness: [...byHarness].sort((a, b) => b[1].usd - a[1].usd || a[0].localeCompare(b[0])).map(([harness, cost]) => ({ harness, ...tidy(cost) })),
  };
}

/** Harnesses whose transcripts can record an OpenAI service tier; a request without one is priced at Standard. */
const TIER_HARNESSES: ReadonlySet<Harness> = new Set(["codex"]);

function untieredSpend(requests: OwnedRequest[]): Pick<UsageSummary, "untiered"> {
  const rows = new Map<Harness, { requests: number; estimatedUsd: number; atFastUsd: number }>();
  for (const { session, request, usd } of requests) {
    if (usd === null || request.serviceTier !== undefined || !TIER_HARNESSES.has(session.harness)) continue;
    let row = rows.get(session.harness);
    if (!row) rows.set(session.harness, (row = { requests: 0, estimatedUsd: 0, atFastUsd: 0 }));
    row.requests += 1;
    row.estimatedUsd += usd;
    // A model or period with no published Fast price stays at its Standard price.
    row.atFastUsd += estimateUsd(request.model, request.usage, { timestamp: request.timestamp, serviceTier: "priority" }) ?? usd;
  }
  const tidy = (usd: number) => Math.round(usd * 1e6) / 1e6;
  const untiered = [...rows].map(([harness, row]) => ({ harness, requests: row.requests, estimatedUsd: tidy(row.estimatedUsd), atFastUsd: tidy(row.atFastUsd) }));
  return untiered.length ? { untiered } : {};
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
  return { ...total, daily, models, cacheHitRate: cacheHitRate(total), pricingVersion: PRICING_VERSION, ...recordedCost(requests), ...untieredSpend(requests) };
}
