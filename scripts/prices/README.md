# Price table

The report's cost estimate uses `src/analysis/prices.generated.ts`. Nothing in `src/` fetches prices: the table is generated and committed when it changes.

## Where the numbers come from

- **Input:** `litellm-snapshot.json` is a pinned copy of the price fields of [LiteLLM's model price table](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json), kept for the models we price. It records the date it was fetched and the sha256 of the whole upstream file. LiteLLM is the input because it is machine-readable and lists most of what we need per model: cache read, cache write (5 minutes and 1 hour, 30 minutes and 12 hours), long-context bands (`_above_272k_tokens`, `_above_100k_tokens`), and OpenAI's Fast (`_priority`) and Ultrafast tiers. models.dev has no tier or long-context fields, so it is not used.
- **Overrides:** `overrides.mjs` holds what LiteLLM lacks or gets wrong:
  - Anthropic fast mode
  - long-context rules for 200k-window models
  - the Sonnet 4 and 4.5 surcharge
  - dated rows for past price changes
  - models LiteLLM does not list
  
  Every override cites the provider page it comes from. The providers' pricing pages are the authority, so an override always wins, and the generator prints each disagreement with the snapshot.

## Commands

```bash
node scripts/update-prices.mjs            # regenerate from the committed snapshot (no network)
node scripts/update-prices.mjs --check    # CI: fail if the committed table is stale (no network)
node scripts/update-prices.mjs --refresh  # download LiteLLM's table, rewrite the snapshot, regenerate
```

## Refreshing prices (before a release)

1. Run `node scripts/update-prices.mjs --refresh`, or let the weekly `Price snapshot refresh` workflow open a pull request labelled `prices`. If no price we use changed, the snapshot and its date stay as they are.
2. Read the diff of `src/analysis/prices.generated.ts`. Check every changed price against the [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing) and [OpenAI](https://developers.openai.com/api/docs/pricing) pricing pages.
3. Where LiteLLM is wrong, pin the right value in `overrides.mjs` (for example `standard: { input: 4 }`) and regenerate. The generator prints `override wins for …` for each pin that differs from the snapshot.
4. `tests/analysis/price-snapshot.test.ts` fails until `tests/analysis/fixtures/verified-prices.json` names the new snapshot date and holds the checked prices. Update it only after step 2, so a changed price cannot slip through unread.
5. `PRICING_VERSION` follows the snapshot date (`api-list-YYYY-MM-DD`). Reports and caches built on older prices show the old version.

Keep `codex-auto-review` out of the table: OpenAI publishes no price for it.
