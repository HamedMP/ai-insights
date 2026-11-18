import type { Harness, ModelRequest, RecordedCost, Session, TokenUsage, UsageSummary, UsageTotals } from "../schema/types.js";
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
interface TierPrice {
  rates: Rates;
  /**
   * Rates for prompts (all input tokens: uncached, cache reads and cache writes) above the row's
   * `overTokens`. Null when the source gives no rate for them, so such a prompt stays unpriced.
   * Absent means the whole context window is billed at `rates`.
   */
  long?: Rates | null;
}

/** The prices in force for one model during one period. */
interface PriceRow {
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

/** Anthropic rows, read straight from the table: input, 5m write, 1h write, cache hit, output. */
const claude = (input: number, write5m: number, write1h: number, cacheRead: number, output: number): Rates => ({
  input,
  write5m,
  write1h,
  cacheRead,
  output,
});

/**
 * OpenAI rows: input, cached input, 30-minute cache write, output. Codex records one undifferentiated
 * cache-write count, priced at the 30-minute rate (the shortest retention, like Anthropic's 5-minute
 * default). 12-hour writes cost 2.5x input (changelog, 2026-10-20). A row whose page cell is "-" lists no
 * write price: written tokens are then billed as the ordinary input they are part of.
 */
const openai = (input: number, cacheRead: number, write30m: number | null, output: number): Rates => ({
  input,
  write5m: write30m ?? input,
  write1h: write30m === null ? input : input * 2.5,
  cacheRead,
  output,
});

const tier = (rates: Rates, long?: Rates | null): TierPrice => (long === undefined ? { rates } : { rates, long });

/**
 * Anthropic's long-context surcharge, for rows where the vendor published input and output rates
 * above 200k. Its pricing page applies the prompt-caching multipliers (5m write 1.25x, 1h write 2x,
 * cache hit 0.1x) to the input price and says they stack with other modifiers, so cache rates follow
 * from the long-context input price.
 */
const claudeLong = (input: number, output: number): Rates => claude(input, input * 1.25, input * 2, input * 0.1, output);

/** Claude models whose window never went past 200k tokens: a longer prompt has no honest price. */
const NO_LONG_CONTEXT = null;

/**
 * OpenAI: "Short context: <=272K input tokens. Long context: >272K input tokens." The API's
 * `input_tokens` includes cached tokens, so the whole prompt is compared.
 */
const OPENAI_LONG = 272_000;
const CLAUDE_LONG = 200_000;

const ANTHROPIC_SONNET_4_LONG = claudeLong(6, 22.5);

/**
 * Exact model ids (after `canonicalModel`), so a renamed or new model is reported as unpriced instead
 * of silently borrowing a price. Rows for one model are disjoint periods; a request is priced by the
 * row in force at its timestamp (UTC), and a request without one by the current row.
 *
 * Anthropic, current rows: https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-16.
 * Cache-hit prices are per model (0.025x on Fable/Mythos 5.2 and 5.1, 0.05x on Opus 5.5 and Sonnet 5.5,
 * 0.1x elsewhere). Claude 4.6 and later, except Haiku 5.5, bill the full 1M window at standard rates;
 * Haiku 5.5 has a higher tier for prompts over 100,000 tokens.
 * Dated Anthropic rows, read 2026-11-16:
 * - Opus 4.6 over 200k, $10/$37.50 until the 1M window went GA at standard pricing:
 *   https://www.anthropic.com/news/claude-opus-4-6 and the 2026-03-13 entry of
 *   https://platform.claude.com/docs/en/release-notes/api
 * - Sonnet 4 over 200k, $6/$22.50: https://claude.com/blog/1m-context (2025-08-12). Sonnet 4.5
 *   (https://www.anthropic.com/news/claude-sonnet-4-5) and Sonnet 4.6
 *   (https://www.anthropic.com/news/claude-sonnet-4-6) launched "at the same price" as the previous Sonnet,
 *   with the same 1M beta and its long-context pricing (2026-02-05 release note); Sonnet 4.6's surcharge
 *   ended on 2026-03-13 (https://claude.com/blog/1m-context-ga), Sonnet 4 and 4.5 kept it until their
 *   1M beta was retired on 2026-04-30, after which such prompts are rejected.
 *
 * OpenAI, current rows: https://developers.openai.com/api/docs/pricing, read 2026-11-16, Standard, Fast
 * and Ultrafast tables, short and long context. Fast replaced Priority processing on 2026-07-30 and
 * Codex's `fast` is the request value `priority`
 * (https://learn.chatgpt.com/docs/config-file/config-reference). Cache writes at 1.25x input:
 * https://developers.openai.com/api/docs/models/gpt-5.6-sol. Dated OpenAI rows, read 2026-11-16, from
 * https://developers.openai.com/api/docs/changelog: 2026-07-30 "GPT-5.6 Luna costs 80% less, while
 * GPT-5.6 Terra costs 20% less" and Sol Fast mode "at twice the price"; 2026-08-21 Sol "now costs $4 ...
 * and $20", 20% and 33% lower. The earlier absolute rates ($5/$0.50/$30 Sol, $2.50/$0.25/$15 Terra,
 * $1/$0.10/$6 Luna) are OpenAI's announcement table,
 * https://community.openai.com/t/20-price-reduction-for-gpt-5-6-sol-api-codex-credits-and-chatgpt-work/1391726,
 * and match those percentages; their long-context and write rates follow the model card's rule
 * (2x input and cached, 1.5x output above 272k; writes at 1.25x input). Before 2026-07-30 a priority
 * request ran on Priority processing, whose rates are no longer published, so it stays unpriced.
 *
 * Added 2026-11-16 from OpenAI's own pages, read that day: gpt-5.2 (Standard 1.75 / 0.175 / 14, Fast 3.50 /
 * 0.35 / 28, no long-context tier) from https://developers.openai.com/api/docs/pricing and
 * https://developers.openai.com/api/docs/models/gpt-5.2; gpt-5.2-pro (21 / - / 168: the cached-input cell is "-",
 * so cached tokens are billed as the input they are) from https://developers.openai.com/api/docs/models/gpt-5.2-pro;
 * gpt-5.2-codex (1.75 / 0.175 / 14, marked shut down but still priced) from
 * https://developers.openai.com/api/docs/models/gpt-5.2-codex. OpenAI publishes no `gpt-5.5-fast` id (Fast is
 * a tier), so OpenCode's `openai/gpt-5.5-fast` stays unpriced rather than being guessed into the Fast table.
 * Gemini: `gemini-3-pro-preview` was shut down on 2026-03-09 and Google's pricing page no longer lists a rate
 * (https://ai.google.dev/gemini-api/docs/pricing, read 2026-11-16), so it stays unpriced.
 *
 * Anthropic fast mode (Claude Code records `usage.speed: "fast"`), read 2026-11-18 from
 * https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing: $16 / $80 on Fable 5.2 and
 * Mythos 5.2, $8 / $40 on Opus 5.5, $10 / $50 on Opus 5 and Opus 4.8, across the full context window, with the
 * prompt-caching multipliers applied on top. Other models publish no fast-mode price, so such a request stays unpriced.
 *
 * Not modelled: batch, flex, data residency (1.1x; Claude Code records `usage.inference_geo`, the request does
 * not carry it yet) and 12-hour OpenAI cache writes. `codex-auto-review` has no API price and stays unpriced.
 */
const PRICES: Record<string, PriceRow[]> = {
  "claude-fable-5-2": [{ standard: tier(claude(8, 10, 16, 0.2, 40)), fast: tier(claude(16, 20, 32, 0.4, 80)) }],
  "claude-mythos-5-2": [{ standard: tier(claude(8, 10, 16, 0.2, 40)), fast: tier(claude(16, 20, 32, 0.4, 80)) }],
  "claude-fable-5-1": [{ standard: tier(claude(10, 12.5, 20, 0.25, 50)) }],
  "claude-mythos-5-1": [{ standard: tier(claude(10, 12.5, 20, 0.25, 50)) }],
  "claude-fable-5": [{ standard: tier(claude(10, 12.5, 20, 1, 50)) }],
  "claude-mythos-5": [{ standard: tier(claude(10, 12.5, 20, 1, 50)) }],
  "claude-opus-5-5": [{ standard: tier(claude(4, 5, 8, 0.2, 20)), fast: tier(claude(8, 10, 16, 0.4, 40)) }],
  "claude-opus-5": [{ standard: tier(claude(5, 6.25, 10, 0.5, 25)), fast: tier(claude(10, 12.5, 20, 1, 50)) }],
  "claude-opus-4-8": [{ standard: tier(claude(5, 6.25, 10, 0.5, 25)), fast: tier(claude(10, 12.5, 20, 1, 50)) }],
  "claude-opus-4-7": [{ standard: tier(claude(5, 6.25, 10, 0.5, 25)) }],
  "claude-opus-4-6": [
    { until: "2026-03-13T00:00:00Z", overTokens: CLAUDE_LONG, standard: tier(claude(5, 6.25, 10, 0.5, 25), claudeLong(10, 37.5)) },
    { from: "2026-03-13T00:00:00Z", standard: tier(claude(5, 6.25, 10, 0.5, 25)) },
  ],
  "claude-opus-4-5": [{ overTokens: CLAUDE_LONG, standard: tier(claude(5, 6.25, 10, 0.5, 25), NO_LONG_CONTEXT) }],
  "claude-opus-4-1": [{ overTokens: CLAUDE_LONG, standard: tier(claude(15, 18.75, 30, 1.5, 75), NO_LONG_CONTEXT) }],
  "claude-opus-4": [{ overTokens: CLAUDE_LONG, standard: tier(claude(15, 18.75, 30, 1.5, 75), NO_LONG_CONTEXT) }],
  "claude-sonnet-5-5": [{ standard: tier(claude(2, 2.5, 4, 0.1, 10)) }],
  "claude-sonnet-5": [{ standard: tier(claude(2, 2.5, 4, 0.2, 10)) }],
  "claude-sonnet-4-6": [
    { until: "2026-03-13T00:00:00Z", overTokens: CLAUDE_LONG, standard: tier(claude(3, 3.75, 6, 0.3, 15), ANTHROPIC_SONNET_4_LONG) },
    { from: "2026-03-13T00:00:00Z", standard: tier(claude(3, 3.75, 6, 0.3, 15)) },
  ],
  "claude-sonnet-4-5": [{ overTokens: CLAUDE_LONG, standard: tier(claude(3, 3.75, 6, 0.3, 15), ANTHROPIC_SONNET_4_LONG) }],
  "claude-sonnet-4": [{ overTokens: CLAUDE_LONG, standard: tier(claude(3, 3.75, 6, 0.3, 15), ANTHROPIC_SONNET_4_LONG) }],
  "claude-haiku-5-5": [{ overTokens: 100_000, standard: tier(claude(0.1, 0.125, 0.2, 0.01, 0.5), claude(0.5, 0.625, 1, 0.05, 2.5)) }],
  "claude-haiku-4-5": [{ overTokens: CLAUDE_LONG, standard: tier(claude(1, 1.25, 2, 0.1, 5), NO_LONG_CONTEXT) }],

  "gpt-6-astra": [
    {
      overTokens: OPENAI_LONG,
      standard: tier(openai(10, 1, 12.5, 50), openai(20, 2, 25, 75)),
      fast: tier(openai(20, 2, 25, 100), openai(40, 4, 50, 150)),
      ultrafast: tier(openai(60, 6, 75, 300), openai(120, 12, 150, 450)),
    },
  ],
  "gpt-6.1-sol": [
    {
      overTokens: OPENAI_LONG,
      standard: tier(openai(2, 0.1, 2.5, 10), openai(4, 0.2, 5, 15)),
      fast: tier(openai(4, 0.2, 5, 20), openai(8, 0.4, 10, 30)),
      ultrafast: tier(openai(12, 0.6, 15, 60), openai(24, 1.2, 30, 90)),
    },
  ],
  "gpt-6.1-terra": [
    { overTokens: OPENAI_LONG, standard: tier(openai(1, 0.05, 1.25, 5), openai(2, 0.1, 2.5, 7.5)), fast: tier(openai(2, 0.1, 2.5, 10), openai(4, 0.2, 5, 15)) },
  ],
  "gpt-6-sol": [
    { overTokens: OPENAI_LONG, standard: tier(openai(2, 0.2, 2.5, 10), openai(4, 0.4, 5, 15)), fast: tier(openai(4, 0.4, 5, 20), openai(8, 0.8, 10, 30)) },
  ],
  "gpt-6-luna": [
    { overTokens: OPENAI_LONG, standard: tier(openai(0.1, 0.01, 0.125, 0.5), openai(0.2, 0.02, 0.25, 0.75)), fast: tier(openai(0.2, 0.02, 0.25, 1), openai(0.4, 0.04, 0.5, 1.5)) },
  ],
  "gpt-5.6-sol": [
    { until: "2026-07-30T00:00:00Z", overTokens: OPENAI_LONG, standard: tier(openai(5, 0.5, 6.25, 30), openai(10, 1, 12.5, 45)) },
    {
      from: "2026-07-30T00:00:00Z",
      until: "2026-08-21T00:00:00Z",
      overTokens: OPENAI_LONG,
      standard: tier(openai(5, 0.5, 6.25, 30), openai(10, 1, 12.5, 45)),
      fast: tier(openai(10, 1, 12.5, 60), openai(20, 2, 25, 90)),
    },
    {
      from: "2026-08-21T00:00:00Z",
      overTokens: OPENAI_LONG,
      standard: tier(openai(4, 0.4, 5, 20), openai(8, 0.8, 10, 30)),
      fast: tier(openai(8, 0.8, 10, 40), openai(16, 1.6, 20, 60)),
    },
  ],
  "gpt-5.6-terra": [
    { until: "2026-07-30T00:00:00Z", overTokens: OPENAI_LONG, standard: tier(openai(2.5, 0.25, 3.125, 15), openai(5, 0.5, 6.25, 22.5)) },
    {
      from: "2026-07-30T00:00:00Z",
      overTokens: OPENAI_LONG,
      standard: tier(openai(2, 0.2, 2.5, 12), openai(4, 0.4, 5, 18)),
      fast: tier(openai(4, 0.4, 5, 24), openai(8, 0.8, 10, 36)),
    },
  ],
  "gpt-5.6-luna": [
    { until: "2026-07-30T00:00:00Z", overTokens: OPENAI_LONG, standard: tier(openai(1, 0.1, 1.25, 6), openai(2, 0.2, 2.5, 9)) },
    {
      from: "2026-07-30T00:00:00Z",
      overTokens: OPENAI_LONG,
      standard: tier(openai(0.2, 0.02, 0.25, 1.2), openai(0.4, 0.04, 0.5, 1.8)),
      fast: tier(openai(0.4, 0.04, 0.5, 2.4), openai(0.8, 0.08, 1, 3.6)),
    },
  ],
  "gpt-5.5": [{ overTokens: OPENAI_LONG, standard: tier(openai(5, 0.5, null, 30), openai(10, 1, null, 45)), fast: tier(openai(12.5, 1.25, null, 75), null) }],
  "gpt-5.4": [{ overTokens: OPENAI_LONG, standard: tier(openai(2.5, 0.25, null, 15), openai(5, 0.5, null, 22.5)), fast: tier(openai(5, 0.5, null, 30), null) }],
  "gpt-5.2": [{ standard: tier(openai(1.75, 0.175, null, 14)), fast: tier(openai(3.5, 0.35, null, 28)) }],
  "gpt-5.2-pro": [{ standard: tier(openai(21, 21, null, 168)) }],
  "gpt-5.2-codex": [{ standard: tier(openai(1.75, 0.175, null, 14)) }],
  "gpt-5.3-codex": [{ overTokens: OPENAI_LONG, standard: tier(openai(1.75, 0.175, null, 14), null), fast: tier(openai(3.5, 0.35, null, 28), null) }],
  "gpt-5": [{ overTokens: OPENAI_LONG, standard: tier(openai(1.25, 0.125, null, 10), null), fast: tier(openai(2.5, 0.25, null, 20), null) }],
};

export const PRICING_VERSION = "api-list-2026-11-18";

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
  return { ...total, daily, models, cacheHitRate: cacheHitRate(total), pricingVersion: PRICING_VERSION, ...recordedCost(requests) };
}
