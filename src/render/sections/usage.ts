import type { UsageTotals } from "../../schema/types.js";
import { columnChart, meter, monthTicks } from "../charts.js";
import { card, sectionHead, tiles, type RenderContext } from "../components.js";
import { clip, count, dayNumber, formatCompact, formatDay, formatInt, formatPercent, formatUsd, plural } from "../format.js";
import { html, type SafeHtml } from "../html.js";
import { harnessLabel } from "../labels.js";
import { dayWindow } from "./activity.js";

const MAX_MODELS = 15;

function usd(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function modelCost(row: UsageTotals): string {
  const cost = usd(row.estimatedUsd);
  if (cost === null) return "Unpriced";
  return count(row.unpriced) > 0 ? `${formatUsd(cost)} + unpriced` : formatUsd(cost);
}

export function usageSection(context: RenderContext): SafeHtml {
  const { usage } = context.report;
  const daily = usage.daily ?? [];
  const byDay = new Map<number, (typeof daily)[number]>();
  for (const entry of daily) {
    const day = dayNumber(entry.day);
    if (day !== null) byDay.set(day, entry);
  }
  const window = dayWindow(daily.map((entry) => entry.day));
  const columns = window ? Array.from({ length: window.columns }, (_, index) => window.first + index) : [];
  const pick = (key: "cachedInput" | "input" | "cacheWrite" | "output") => columns.map((day) => count(byDay.get(day)?.[key]));
  const cached = pick("cachedInput");
  const input = pick("input");
  const write = pick("cacheWrite");
  const output = pick("output");

  const chart = columnChart({
    id: "daily-tokens",
    series: [
      { className: "s1", label: "Cached input", values: cached },
      { className: "s2", label: "Fresh input and cache writes", values: input.map((value, index) => value + (write[index] ?? 0)) },
      { className: "s3", label: "Output", values: output },
    ],
    xTicks: window ? monthTicks(window.first, window.columns) : [],
    yTitle: "Tokens",
    xTitle: "Day",
    tooltips: columns.map((day, index) => {
      const entry = byDay.get(day);
      const date = formatDay(day, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      if (!entry) return `${date}: no usage`;
      const cost = usd(entry.estimatedUsd);
      return `${date}: ${formatCompact(count(entry.tokens))} tokens (${formatCompact(cached[index] ?? 0)} cached, ${formatCompact(output[index] ?? 0)} output)${cost !== null ? `, about ${formatUsd(cost)}` : ""}`;
    }),
    ariaLabel: "Tokens per day by kind",
    emptyMessage: "No token usage recorded yet.",
    tall: true,
  });

  const models = [...(usage.models ?? [])].sort((a, b) => count(b.tokens) - count(a.tokens));
  const shown = models.slice(0, MAX_MODELS);
  const rest = models.slice(MAX_MODELS);
  const restRow = rest.length > 0 ? rest.reduce<UsageTotals>(
    (sum, row) => ({
      tokens: sum.tokens + count(row.tokens),
      input: sum.input + count(row.input),
      cachedInput: sum.cachedInput + count(row.cachedInput),
      cacheWrite: sum.cacheWrite + count(row.cacheWrite),
      output: sum.output + count(row.output),
      requests: sum.requests + count(row.requests),
      estimatedUsd: usd(row.estimatedUsd) === null ? sum.estimatedUsd : (sum.estimatedUsd ?? 0) + usd(row.estimatedUsd)!,
      unpriced: sum.unpriced + count(row.unpriced),
    }),
    { tokens: 0, input: 0, cachedInput: 0, cacheWrite: 0, output: 0, requests: 0, estimatedUsd: null, unpriced: 0 },
  ) : null;

  const row = (name: SafeHtml, harness: string, entry: UsageTotals, className = "") =>
    html`<tr${className ? html` class="${className}"` : null}><td class="model">${name}</td><td>${harness}</td><td>${formatInt(entry.requests)}</td><td>${formatCompact(entry.input)}</td><td>${formatCompact(entry.cachedInput)}</td><td>${formatCompact(entry.cacheWrite)}</td><td>${formatCompact(entry.output)}</td><td>${modelCost(entry)}</td></tr>`;

  const table = shown.length > 0
    ? html`<div class="table-wrap" data-chart="models"><table>
<thead><tr><th scope="col">Model</th><th scope="col">Tool</th><th scope="col">Requests</th><th scope="col">Input</th><th scope="col">Cached</th><th scope="col">Cache write</th><th scope="col">Output</th><th scope="col">Est. cost</th></tr></thead>
<tbody>${shown.map((entry) => row(html`${clip(String(entry.model), 80)}`, harnessLabel(entry.harness), entry))}${restRow ? row(html`${plural(rest.length, "other model")}`, "", restRow) : null}${row(html`Total`, "", usage, "total")}</tbody>
</table></div>`
    : html`<div class="chart-empty" data-chart="models">No model requests recorded yet.</div>`;

  const unpricedModels = models.filter((entry) => count(entry.unpriced) > 0).length;
  const hitRate = typeof usage.cacheHitRate === "number" && Number.isFinite(usage.cacheHitRate) ? usage.cacheHitRate : null;
  const cost = usd(usage.estimatedUsd);
  const pricing = clip(String(usage.pricingVersion ?? ""), 40);

  return html`<section id="usage">
${sectionHead("Tokens and cost", "What all of that cost", "Costs are estimated at API list prices. If you pay a flat subscription, this is what the same usage would cost on the API, not what you were billed.")}
<div class="stack">
${tiles(
    [
      { value: formatCompact(usage.tokens), label: "Total tokens", sub: `${formatCompact(usage.requests)} requests` },
      { value: formatUsd(cost), label: "Estimated cost", sub: cost === null ? "No priced models" : "at API list prices" },
      { value: formatCompact(usage.output), label: "Output tokens", sub: `${formatCompact(usage.input)} fresh input` },
      { value: formatPercent(hitRate), label: "Cache hit rate", sub: "share of input read from cache" },
    ],
    "Token totals",
  )}
${card(html`<div class="card-head"><h3>Tokens per day</h3><span class="muted">Hover a day for details</span></div>${chart}`)}
<div class="grid two">
${card(html`<div class="card-head"><h3>Cache hit rate</h3><span class="muted">${formatPercent(hitRate, 1)}</span></div>${meter(hitRate, "Cache hit rate")}<p class="note">Cached input is billed at a fraction of the normal input price. A higher rate means long sessions are being reused, not re-sent.</p>`)}
${card(html`<div class="card-head"><h3>Where the tokens went</h3></div><dl class="facts">
<dt>Cached input</dt><dd>${formatCompact(usage.cachedInput)}</dd>
<dt>Fresh input</dt><dd>${formatCompact(usage.input)}</dd>
<dt>Cache writes</dt><dd>${formatCompact(usage.cacheWrite)}</dd>
<dt>Output</dt><dd>${formatCompact(usage.output)}</dd>
</dl>`)}
</div>
${card(html`<div class="card-head"><h3>By model</h3></div>${table}<p class="note">All costs are estimated at API list prices${pricing ? html` (pricing table ${pricing})` : null}.${
    count(usage.unpriced) > 0
      ? html` ${plural(count(usage.unpriced), "request")}${unpricedModels > 0 ? html` (${plural(unpricedModels, "model")})` : null} had no known price and are left out of the estimate rather than counted as free.`
      : null
  }</p>`)}
</div>
</section>`;
}
