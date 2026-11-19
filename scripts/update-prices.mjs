#!/usr/bin/env node
// Builds `src/analysis/prices.generated.ts` from a pinned LiteLLM price snapshot plus hand-written overrides.
//
//   node scripts/update-prices.mjs            regenerate the table from the committed snapshot (no network)
//   node scripts/update-prices.mjs --check    exit 1 when the committed table is not what would be generated (CI)
//   node scripts/update-prices.mjs --refresh  download LiteLLM's table, rewrite the snapshot, then regenerate
//
// Only --refresh touches the network. The package never fetches prices: the analysis imports the generated file.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "scripts/prices/litellm-snapshot.json");
const OVERRIDES = join(ROOT, "scripts/prices/overrides.mjs");
const OUTPUT = join(ROOT, "src/analysis/prices.generated.ts");
const COMMAND = "node scripts/update-prices.mjs";

/** Snapshot fields the generator reads. Batch, flex and other tiers are left out of the pinned file. */
const KEEP = /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)(_above_(1hr|12hr))?(_above_\d+k_tokens)?(_(priority|ultrafast))?$/;

const round = (value) => Math.round(value * 1e9) / 1e9;
const perMillion = (value) => (typeof value === "number" && Number.isFinite(value) ? round(value * 1e6) : undefined);

const overridesModule = await import(pathToFileURL(OVERRIDES).href);

/** Reads the committed snapshot and the overrides. */
export function readInputs() {
  return { snapshot: JSON.parse(readFileSync(SNAPSHOT, "utf8")), overrides: { sources: overridesModule.SOURCES, models: overridesModule.MODELS } };
}

const providerOf = (model) => (model.startsWith("claude-") ? "anthropic" : "openai");

/** Field name in LiteLLM's scheme. */
function field(kind, { lifetime, threshold, tier } = {}) {
  const base = {
    input: "input_cost_per_token",
    output: "output_cost_per_token",
    cacheRead: "cache_read_input_token_cost",
    write: "cache_creation_input_token_cost",
  }[kind];
  return `${base}${lifetime ? `_above_${lifetime}` : ""}${threshold ? `_above_${threshold / 1000}k_tokens` : ""}${tier ? `_${tier}` : ""}`;
}

/** Rates for one tier and context band from a snapshot entry, or null when the entry has no input price for it. */
function sourceRates(entry, provider, options) {
  const get = (kind, lifetime) => perMillion(entry[field(kind, { ...options, lifetime })]);
  const input = get("input");
  const output = get("output");
  if (input === undefined || output === undefined) return null;
  if (provider === "anthropic") {
    return {
      input,
      write5m: get("write") ?? round(input * 1.25),
      write1h: get("write", "1hr") ?? round(input * 2),
      cacheRead: get("cacheRead") ?? round(input * 0.1),
      output,
    };
  }
  const write = get("write");
  return {
    input,
    write5m: write ?? input,
    // 12-hour writes cost 2.5x input; a model with no write price bills written tokens as plain input.
    write1h: get("write", "12hr") ?? (write === undefined ? input : round(input * 2.5)),
    // A "-" cached-input cell: cached tokens are billed as the input they are.
    cacheRead: get("cacheRead") ?? input,
    output,
  };
}

/** Anthropic rates from an input and output price, with the model's own cache multipliers. */
function anthropicFrom(base, input, output) {
  const hit = base.cacheRead / base.input;
  return { input, write5m: round(input * 1.25), write1h: round(input * 2), cacheRead: round(input * hit), output };
}

function thresholdOf(entry) {
  for (const key of Object.keys(entry)) {
    const match = /_above_(\d+)k_tokens/.exec(key);
    if (match) return Number(match[1]) * 1000;
  }
  return undefined;
}

const tidyRates = (rates) => ({
  input: round(rates.input),
  write5m: round(rates.write5m),
  write1h: round(rates.write1h),
  cacheRead: round(rates.cacheRead),
  output: round(rates.output),
});

function tidyTier(price) {
  if (!price) return undefined;
  const out = { rates: tidyRates(price.rates) };
  if (price.long !== undefined) out.long = price.long === null ? null : tidyRates(price.long);
  return out;
}

function tidyRow(row) {
  const out = {};
  if (row.from) out.from = row.from;
  if (row.until) out.until = row.until;
  if (row.overTokens !== undefined) out.overTokens = row.overTokens;
  for (const name of ["standard", "fast", "ultrafast"]) {
    const price = tidyTier(row[name]);
    if (price) out[name] = price;
  }
  return out;
}

/** The current row of a model from its snapshot entry and overrides. */
function currentRow(model, spec, entry, disagreements) {
  const provider = providerOf(model);
  const threshold = spec.overTokens ?? thresholdOf(entry) ?? (spec.long === "unpriced" ? (provider === "anthropic" ? 200_000 : 272_000) : undefined);
  const standard = sourceRates(entry, provider, {});
  if (!standard) throw new Error(`${model}: the snapshot entry has no standard input and output price`);
  for (const [key, value] of Object.entries(spec.standard ?? {})) {
    if (standard[key] !== value) disagreements.push({ model, field: `standard.${key}`, source: standard[key], used: value });
    standard[key] = value;
  }
  const band = (tier, base) => {
    if (threshold === undefined) return undefined;
    if (spec.long === "unpriced") return null;
    if (tier === undefined && spec.long && typeof spec.long === "object") return anthropicFrom(base, spec.long.input, spec.long.output);
    return sourceRates(entry, provider, { threshold, tier }) ?? null;
  };
  const row = { standard: { rates: standard, long: band(undefined, standard) } };
  if (threshold !== undefined) row.overTokens = threshold;
  if (spec.currentFrom) row.from = spec.currentFrom;
  if (provider === "anthropic") {
    if (spec.fast) row.fast = { rates: anthropicFrom(standard, spec.fast.input, spec.fast.output), ...(threshold !== undefined ? { long: null } : {}) };
  } else {
    for (const [name, tier] of [["fast", "priority"], ["ultrafast", "ultrafast"]]) {
      const rates = sourceRates(entry, provider, { tier });
      if (rates) row[name] = { rates, long: band(tier, rates) };
    }
  }
  for (const name of ["standard", "fast", "ultrafast"]) if (row[name] && row[name].long === undefined) delete row[name].long;
  return row;
}

/** Builds the table and the source text of the generated module. Pure: same inputs, same output. */
export function generate({ snapshot, overrides }) {
  const disagreements = [];
  const prices = {};
  for (const [model, spec] of Object.entries(overrides.models)) {
    if (spec.source === null) {
      if (!spec.rows?.length) throw new Error(`${model}: no snapshot source and no hand-written rows`);
      prices[model] = spec.rows.map(tidyRow);
      continue;
    }
    const key = spec.source ?? model;
    const entry = snapshot.models[key];
    if (!entry) throw new Error(`${model}: the snapshot has no entry "${key}"; refresh the snapshot or write its rows by hand`);
    prices[model] = [...(spec.history ?? []), currentRow(model, spec, entry, disagreements)].map(tidyRow);
  }
  const source = render(prices, snapshot, overrides.sources);
  return { prices, disagreements, source };
}

function render(prices, snapshot, sources) {
  const lines = [
    `// Generated by \`${COMMAND}\` from scripts/prices/litellm-snapshot.json and scripts/prices/overrides.mjs. Do not edit:`,
    "// change the overrides, or refresh the snapshot with --refresh, and regenerate.",
    `// Snapshot: ${snapshot.fetched} of ${snapshot.source} (sha256 ${snapshot.sha256}).`,
    `// Checked against ${sources.anthropic}`,
    `// and ${sources.openai}.`,
    "// USD per million tokens.",
    "",
    'import type { PriceRow } from "./usage.js";',
    "",
    `export const PRICE_SNAPSHOT = { date: ${JSON.stringify(snapshot.fetched)}, source: ${JSON.stringify(snapshot.source)}, sha256: ${JSON.stringify(snapshot.sha256)} } as const;`,
    "",
    `export const PRICES: Record<string, PriceRow[]> = ${JSON.stringify(prices, null, 2)};`,
    "",
  ];
  return lines.join("\n");
}

/** Keeps only the price fields of the models the overrides list, sorted, so the pinned file diffs cleanly. */
export function pin(upstream, overrides, { fetched, source, sha256 }) {
  const models = {};
  for (const [model, spec] of Object.entries(overrides.models)) {
    if (spec.source === null) continue;
    const key = spec.source ?? model;
    const entry = upstream[key];
    if (!entry) continue;
    const kept = {};
    for (const name of Object.keys(entry).sort()) if (KEEP.test(name) && typeof entry[name] === "number") kept[name] = entry[name];
    models[key] = kept;
  }
  const sorted = Object.fromEntries(Object.keys(models).sort().map((key) => [key, models[key]]));
  return { source, fetched, sha256, models: sorted };
}

async function refresh() {
  const { overrides } = { overrides: { sources: overridesModule.SOURCES, models: overridesModule.MODELS } };
  const source = overrides.sources.litellm;
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok) throw new Error(`fetching ${source} failed: HTTP ${response.status}`);
  const text = await response.text();
  const sha256 = createHash("sha256").update(text).digest("hex");
  const fetched = new Date().toISOString().slice(0, 10);
  const snapshot = pin(JSON.parse(text), overrides, { fetched, source, sha256 });
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const sameModels = previous !== null && JSON.stringify(previous.models) === JSON.stringify(snapshot.models);
  // Keep the old date when nothing that is priced changed, so a refresh with no price change is a no-op.
  writeFileSync(SNAPSHOT, `${JSON.stringify(sameModels ? previous : snapshot, null, 2)}\n`);
  return !sameModels;
}

function report(disagreements) {
  for (const d of disagreements) console.log(`override wins for ${d.model} ${d.field}: snapshot ${d.source}, used ${d.used}`);
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  const args = new Set(process.argv.slice(2));
  try {
    if (args.has("--refresh")) console.log((await refresh()) ? "snapshot updated" : "snapshot unchanged");
    const result = generate(readInputs());
    report(result.disagreements);
    if (args.has("--check")) {
      const committed = readFileSync(OUTPUT, "utf8");
      if (committed !== result.source) {
        console.error(`${OUTPUT} is out of date: run \`${COMMAND}\` and commit the result.`);
        process.exit(1);
      }
      console.log("prices.generated.ts is up to date");
    } else {
      writeFileSync(OUTPUT, result.source);
      console.log(`wrote ${OUTPUT}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
