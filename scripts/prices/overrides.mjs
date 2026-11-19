// Hand-written price data that LiteLLM's machine-readable table lacks or gets wrong. `scripts/update-prices.mjs`
// reads it together with the pinned snapshot (`litellm-snapshot.json`) and writes `src/analysis/prices.generated.ts`.
//
// Each entry is one model id as `canonicalModel` spells it. The current price row comes from the snapshot entry
// named by `source` (default: the id), unless `source` is null, in which case `rows` holds the whole history by hand.
// Everything set here wins over the snapshot; when the snapshot has a different value for a pinned field, the
// generator lists the disagreement. Prices are USD per million tokens.
//
// Fields:
//   source       snapshot key for the current row, or null for a model the snapshot does not list
//   standard     pinned standard-tier values: { input, write5m, write1h, cacheRead, output }
//   fast         Anthropic fast mode: { input, output } from the pricing page; cache prices follow from the fast input
//                price and the model's own cache multipliers
//   long         "unpriced": prompts over the threshold have no honest price (window never went past it);
//                or Anthropic { input, output } above the threshold, cache prices following the model's multipliers
//   overTokens   long-context threshold when the snapshot does not imply one
//   currentFrom  first instant (UTC) the current row applies; earlier periods are in `history`
//   history      earlier rows, oldest first, written out in full
//   rows         the full history of a model the snapshot does not list
//
// Anthropic: https://platform.claude.com/docs/en/about-claude/pricing (model table, cache-hit multipliers,
// fast mode, long context), read 2026-11-18. OpenAI: https://developers.openai.com/api/docs/pricing (Standard, Fast
// and Ultrafast; short and long context) and https://developers.openai.com/api/docs/changelog, read 2026-11-18.

/** Anthropic rates in the pricing table's column order: input, 5m write, 1h write, cache hit, output. */
const claude = (input, write5m, write1h, cacheRead, output) => ({ input, write5m, write1h, cacheRead, output });
/** Above 200k Anthropic applies the caching multipliers (5m 1.25x, 1h 2x, hit 0.1x on these models) to the long input price. */
const claudeLong = (input, output) => claude(input, input * 1.25, input * 2, input * 0.1, output);
/** OpenAI rates in the page's order: input, cached input, 30-minute write (null when the page lists none), output. */
const openai = (input, cacheRead, write30m, output) => ({
  input,
  write5m: write30m ?? input,
  write1h: write30m === null ? input : input * 2.5,
  cacheRead,
  output,
});
const tier = (rates, long) => (long === undefined ? { rates } : { rates, long });

const CLAUDE_LONG = 200_000;
const OPENAI_LONG = 272_000;

export const SOURCES = {
  litellm: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
  openai: "https://developers.openai.com/api/docs/pricing",
  openaiChangelog: "https://developers.openai.com/api/docs/changelog",
};

/** Order here is the order of the generated table. */
export const MODELS = {
  // Fast mode: "Fast mode pricing" on the Anthropic page. The snapshot has no fast-mode prices.
  "claude-fable-5-2": { fast: { input: 16, output: 80 } },
  "claude-mythos-5-2": { fast: { input: 16, output: 80 } },
  "claude-fable-5-1": {},
  "claude-mythos-5-1": {},
  "claude-fable-5": {},
  "claude-mythos-5": {},
  "claude-opus-5-5": { fast: { input: 8, output: 40 } },
  "claude-opus-5": { fast: { input: 10, output: 50 } },
  "claude-opus-4-8": { fast: { input: 10, output: 50 } },
  "claude-opus-4-7": {},
  // $10 / $37.50 over 200k until the 1M window went GA at standard prices on 2026-03-13
  // (https://www.anthropic.com/news/claude-opus-4-6, release notes 2026-03-13).
  "claude-opus-4-6": {
    currentFrom: "2026-03-13T00:00:00Z",
    history: [{ until: "2026-03-13T00:00:00Z", overTokens: CLAUDE_LONG, standard: tier(claude(5, 6.25, 10, 0.5, 25), claudeLong(10, 37.5)) }],
  },
  // A 200k window: a longer prompt has no honest price.
  "claude-opus-4-5": { long: "unpriced" },
  // Not in the snapshot under these ids.
  "claude-opus-4-1": { source: null, rows: [{ overTokens: CLAUDE_LONG, standard: tier(claude(15, 18.75, 30, 1.5, 75), null) }] },
  "claude-opus-4": { source: null, rows: [{ overTokens: CLAUDE_LONG, standard: tier(claude(15, 18.75, 30, 1.5, 75), null) }] },
  "claude-sonnet-5-5": {},
  "claude-sonnet-5": {},
  // Sonnet 4.6 kept the Sonnet 4 long-context surcharge until 2026-03-13 (https://claude.com/blog/1m-context-ga).
  "claude-sonnet-4-6": {
    currentFrom: "2026-03-13T00:00:00Z",
    history: [{ until: "2026-03-13T00:00:00Z", overTokens: CLAUDE_LONG, standard: tier(claude(3, 3.75, 6, 0.3, 15), claudeLong(6, 22.5)) }],
  },
  // Sonnet 4 and 4.5 over 200k: $6 / $22.50 (https://claude.com/blog/1m-context). The snapshot lists no long tier.
  "claude-sonnet-4-5": { long: { input: 6, output: 22.5 }, overTokens: CLAUDE_LONG },
  "claude-sonnet-4": { source: null, rows: [{ overTokens: CLAUDE_LONG, standard: tier(claude(3, 3.75, 6, 0.3, 15), claudeLong(6, 22.5)) }] },
  "claude-haiku-5-5": {},
  "claude-haiku-4-5": { long: "unpriced" },

  "gpt-6-astra": {},
  "gpt-6.1-sol": {},
  "gpt-6.1-terra": {},
  "gpt-6-sol": {},
  "gpt-6-luna": {},
  // Changelog 2026-07-30: Fast replaced Priority processing; Luna -80%, Terra -20%, Sol Fast at twice the price.
  // Changelog 2026-08-21: Sol $4 / $20. Earlier absolute rates: OpenAI's announcement table
  // (https://community.openai.com/t/20-price-reduction-for-gpt-5-6-sol-api-codex-credits-and-chatgpt-work/1391726).
  // Before 2026-07-30 a priority request ran on Priority processing, whose rates are no longer published: unpriced.
  "gpt-5.6-sol": {
    currentFrom: "2026-08-21T00:00:00Z",
    history: [
      { until: "2026-07-30T00:00:00Z", overTokens: OPENAI_LONG, standard: tier(openai(5, 0.5, 6.25, 30), openai(10, 1, 12.5, 45)) },
      {
        from: "2026-07-30T00:00:00Z",
        until: "2026-08-21T00:00:00Z",
        overTokens: OPENAI_LONG,
        standard: tier(openai(5, 0.5, 6.25, 30), openai(10, 1, 12.5, 45)),
        fast: tier(openai(10, 1, 12.5, 60), openai(20, 2, 25, 90)),
      },
    ],
  },
  "gpt-5.6-terra": {
    currentFrom: "2026-07-30T00:00:00Z",
    history: [{ until: "2026-07-30T00:00:00Z", overTokens: OPENAI_LONG, standard: tier(openai(2.5, 0.25, 3.125, 15), openai(5, 0.5, 6.25, 22.5)) }],
  },
  "gpt-5.6-luna": {
    currentFrom: "2026-07-30T00:00:00Z",
    history: [{ until: "2026-07-30T00:00:00Z", overTokens: OPENAI_LONG, standard: tier(openai(1, 0.1, 1.25, 6), openai(2, 0.2, 2.5, 9)) }],
  },
  "gpt-5.5": {},
  "gpt-5.4": {},
  "gpt-5.2": {},
  // The cached-input cell is "-": cached tokens are billed as the input they are.
  "gpt-5.2-pro": {},
  "gpt-5.2-codex": {},
  // A 272k window: a longer prompt has no honest price.
  "gpt-5.3-codex": { long: "unpriced" },
  "gpt-5": { long: "unpriced" },
  // `codex-auto-review` is deliberately absent: OpenAI publishes no price for it.
};
